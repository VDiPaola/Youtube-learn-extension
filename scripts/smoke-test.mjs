// Loads the built Chromium extension, runs the transcript pipeline on real videos,
// and checks the results. Includes one in-app (SPA) navigation to a related video.
// Successful transcripts are saved as sanitized fixtures in tests/fixtures/transcripts.
//
// Usage: pnpm build && pnpm test:smoke [videoId ...]
// Env: HEADED=1 shows the browser, VERBOSE=1 logs transcript network traffic.
//
// YouTube rejects attestation in automated browsers, so here transcript steps are expected
// to fail with "HTTP 400" or "Empty response body". The test checks that the extension
// loads, reads video details, triggers and captures YouTube's own requests, and cleans up.
import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXTENSION_DIR = path.resolve('.output/chrome-mv3');
const FIXTURE_DIR = path.resolve('tests/fixtures/transcripts');
const DEFAULT_VIDEOS = ['QaKuVOhikaY', 'aircAruvnKk'];
const OVERLAY_VIDEO = 'aircAruvnKk';
/** One activity of each type, in the order the session shows them (sorted by time). */
const SEEDED_ACTIVITIES = [
  {
    type: 'recall',
    prompt: 'Why do networks need hidden layers?',
    answer: 'To build complex features.',
    explanation: '',
    options: [],
    sourceStartSec: 30,
  },
  {
    type: 'flashcard',
    prompt: 'Activation',
    answer: 'The number a neuron holds.',
    explanation: '',
    options: [],
    sourceStartSec: 60,
  },
  {
    type: 'cloze',
    prompt: 'Each neuron holds a number called its ____.',
    answer: 'activation',
    explanation: '',
    options: [],
    sourceStartSec: 90,
  },
  {
    type: 'multiple_choice',
    prompt: 'How many input neurons does the network have?',
    answer: '784',
    explanation: 'One per pixel.',
    options: ['10', '16', '256'],
    sourceStartSec: 120,
  },
  {
    type: 'true_false',
    prompt: 'The output layer has 10 neurons.',
    answer: 'true',
    explanation: 'One per digit.',
    options: [],
    sourceStartSec: 150,
  },
  {
    type: 'ordering',
    prompt: 'Put the layers in order.',
    answer: '',
    explanation: '',
    options: ['Input', 'Hidden', 'Output'],
    sourceStartSec: 180,
  },
  {
    type: 'apply',
    prompt: 'A 28x28 image arrives. What happens first?',
    answer: 'Each pixel sets one input activation.',
    explanation: '',
    options: [],
    sourceStartSec: 210,
  },
];
const SOURCES = [
  'captured-transcript',
  'captured-captions',
  'caption-track',
  'transcript-panel',
  'panel-dom',
];

const videoIds = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_VIDEOS;
const userDataDir = await mkdtemp(path.join(tmpdir(), 'ytl-profile-'));
const failures = [];

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  locale: 'en-GB',
  colorScheme: 'dark',
  args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
});

try {
  const extensionId = await findExtensionId(context);
  const page = context.pages()[0] ?? (await context.newPage());
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const emptyReviews = await popup
    .locator('.reviews')
    .textContent({ timeout: 5_000 })
    .catch(() => '');
  console.log(`Popup with an empty knowledge bank: ${JSON.stringify(emptyReviews)}`);
  if (!emptyReviews.includes('No activities saved yet'))
    failures.push('popup: the Reviews section is missing when the knowledge bank is empty');
  await mkdir(FIXTURE_DIR, { recursive: true });
  if (process.env.VERBOSE) logTranscriptTraffic(page);

  for (const videoId of videoIds) {
    await page.bringToFront();
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'domcontentloaded',
    });
    await dismissConsent(page);
    await page.waitForSelector('#movie_player', { timeout: 30_000 });
    await checkVideo(page, popup, videoId);
  }

  const relatedId = await navigateToRelatedVideo(page);
  if (relatedId) await checkVideo(page, popup, relatedId, 'after in-app navigation');
  else failures.push('Could not find a related video link to test in-app navigation');

  await checkQuizBackground(popup, extensionId);
  await checkOverlay(page, popup);
  await checkDashboard(popup, extensionId);
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nSmoke test failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nSmoke test passed.');

/** Runs the in-video quiz overlay with a seeded quiz, so no provider is needed. */
async function checkOverlay(page, popup) {
  console.log('\nIn-video quiz overlay');
  const fail = (message) => failures.push(`overlay: ${message}`);
  const sendToTab = (message) =>
    popup.evaluate(async (msg) => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
      return chrome.tabs.sendMessage(tab.id, msg);
    }, message);

  await page.bringToFront();
  await page.goto(`https://www.youtube.com/watch?v=${OVERLAY_VIDEO}`, {
    waitUntil: 'domcontentloaded',
  });
  await dismissConsent(page);
  await page.waitForSelector('#movie_player', { timeout: 30_000 });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    if (video) video.muted = true;
  });
  await seedQuiz(popup, OVERLAY_VIDEO);

  const dialog = page.getByRole('dialog', { name: /^Learn:/ });
  const openQuiz = async () => {
    // The content script may still be starting right after navigation.
    for (let attempt = 0; ; attempt++) {
      try {
        await sendToTab({ type: 'quiz:open' });
        break;
      } catch (error) {
        if (attempt === 20) throw error;
        await page.waitForTimeout(500);
      }
    }
    await dialog.waitFor({ timeout: 10_000 });
  };

  await openQuiz();
  // Signed-out YouTube ignores the browser color scheme; set its dark theme attribute directly.
  await page.evaluate(() => document.documentElement.setAttribute('dark', ''));

  await page.keyboard.press('f');
  if (await page.evaluate(() => Boolean(document.fullscreenElement))) {
    fail('YouTube handled the "f" shortcut while the quiz had focus');
  }

  // Work through one activity of each type with the keyboard only.
  const press = (key) => page.keyboard.press(key);
  const waitFor = (role, name) =>
    page.getByRole(role, { name }).first().waitFor({ timeout: 5_000 });
  await press('Enter');
  await waitFor('button', 'Show answer');
  await press('Space');
  const selfGrades = await page.locator('ytl-quiz-overlay .ytl-grade').allTextContents();
  await press('1');
  await waitFor('button', 'Flip card');
  await press('Space');
  await press('1');
  await waitFor('textbox', 'Missing word');
  await page.keyboard.type('activaton');
  await press('Enter');
  const clozeCorrect = await page.getByText('Correct.').isVisible();
  await press('Enter');
  const options = await page.locator('ytl-quiz-overlay .ytl-option').allTextContents();
  const wrongIndex = options.findIndex((text) => !text.includes('784'));
  await press(String(wrongIndex + 1));
  const mcWrong = await page.getByText('The answer is: 784').isVisible();
  const explanationText = page.getByText('One per pixel.');
  const explanationHidden = !(await explanationText.isVisible());
  await page.locator('ytl-quiz-overlay .ytl-explanation summary').click();
  const explanationShown = await explanationText.isVisible();
  await page.getByRole('button', { name: 'Continue' }).focus();
  await press('Enter');
  await waitFor('button', /True/);
  await press('t');
  await press('Enter');
  await waitFor('button', 'Check order');
  await page
    .getByRole('button', { name: 'Move "Output" up' })
    .click()
    .catch(() => {});
  await page.getByRole('button', { name: 'Check order' }).focus();
  await press('Enter');
  await page.getByRole('button', { name: 'Continue' }).focus();
  await press('Enter');
  await waitFor('button', 'Show answer');
  await press('Space');
  await press('2');

  const summary = await page.locator('ytl-quiz-overlay .ytl-dialog').textContent();
  const complete = summary?.includes('Session complete') ?? false;
  console.log(
    `  keyboard run through ${SEEDED_ACTIVITIES.length} activity types: ${complete ? 'summary shown' : 'no summary'}`,
  );
  console.log(
    `  fill in the blank accepted a typo: ${clozeCorrect}; wrong multiple choice explained: ${mcWrong}`,
  );
  console.log(`  summary: ${summary?.match(/\d+ of \d+ correct\./)?.[0] ?? 'none'}`);
  console.log(`  self-grade buttons: ${selfGrades.map((text) => `"${text.trim()}"`).join(', ')}`);
  if (selfGrades.join('|').replace(/\s+/g, ' ') !== '1 Correct|2 Incorrect') {
    fail(`expected Correct and Incorrect buttons, found ${selfGrades.join(', ')}`);
  }
  if (!complete) fail('keyboard flow did not reach the summary');
  if (!clozeCorrect) fail('fill in the blank rejected a one-letter typo');
  if (!mcWrong) fail('wrong multiple choice answer did not show the correct one');
  console.log(
    `  explanation collapsed by default: ${explanationHidden}; opens on click: ${explanationShown}`,
  );
  if (!explanationHidden) fail('explanation was visible before opening the dropdown');
  if (!explanationShown) fail('explanation did not open from the dropdown');
  const rewatch = await page.locator('.ytl-review li').count();
  console.log(`  worth rewatching: ${rewatch}`);
  if (rewatch < 2) fail(`expected at least 2 activities to rewatch, found ${rewatch}`);

  await page.waitForTimeout(1_000);
  const bank = await readBank(popup);
  console.log(
    `  knowledge bank: ${bank.activities.length} activities, ${bank.reviewLogs} review logs, topics ${JSON.stringify(bank.topics)}, video "${bank.videos[0]?.title ?? 'none'}"`,
  );
  if (bank.activities.length !== SEEDED_ACTIVITIES.length)
    fail(`expected ${SEEDED_ACTIVITIES.length} saved activities, found ${bank.activities.length}`);
  if (bank.reviewLogs !== SEEDED_ACTIVITIES.length) fail('each answer should log one review');
  if (bank.topics.join() !== 'Smoke Test') fail('activities were not saved under the set topic');
  if (bank.videos[0]?.id !== OVERLAY_VIDEO) fail('the source video was not saved');

  await page.keyboard.press('Escape');
  if (await dialog.isVisible().catch(() => false)) fail('Escape did not close the quiz');

  for (const mode of ['default', 'theater', 'fullscreen']) {
    if (mode !== 'default') {
      await page.locator('#movie_player').focus();
      await page.keyboard.press(mode === 'theater' ? 't' : 'f');
      await page.waitForTimeout(1_000);
      if (mode === 'fullscreen') {
        // Same call as YouTube's fullscreen button, in case the shortcut is ignored here.
        const error = await page.evaluate(async () => {
          if (document.fullscreenElement) return null;
          return document
            .querySelector('#movie_player')
            .requestFullscreen()
            .then(
              () => null,
              (e) => String(e),
            );
        });
        if (error) console.log(`  fullscreen request failed: ${error}`);
        await page.waitForTimeout(1_000);
      }
    }
    const active = await page.evaluate((m) => {
      if (m === 'theater')
        return document.querySelector('ytd-watch-flexy')?.hasAttribute('theater');
      // YouTube makes the whole document fullscreen and lays the player over it.
      if (m === 'fullscreen') return Boolean(document.fullscreenElement);
      return true;
    }, mode);
    await openQuiz();
    const visible = await page.evaluate(() => {
      const host = document.querySelector('ytl-quiz-overlay');
      const panel = host?.shadowRoot?.querySelector('.ytl-dialog');
      const player = document.querySelector('#movie_player');
      if (!panel || !player) return 'missing';
      const box = panel.getBoundingClientRect();
      const bounds = player.getBoundingClientRect();
      const inside =
        box.left >= bounds.left - 1 &&
        box.right <= bounds.right + 1 &&
        box.top >= bounds.top - 1 &&
        box.bottom <= bounds.bottom + 1;
      const onTop =
        document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === host;
      return inside && onTop ? 'visible' : `inside=${inside} onTop=${onTop}`;
    });
    console.log(`  ${mode} (YouTube dark theme)${active ? '' : ' (mode not entered)'}: ${visible}`);
    if (!active) fail(`could not enter ${mode} mode`);
    if (visible !== 'visible') fail(`${mode}: overlay ${visible}`);
    await page.keyboard.press('Escape');
    if (mode === 'theater') {
      await page.locator('#movie_player').focus();
      await page.keyboard.press('t');
    }
    if (mode === 'fullscreen') {
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    }
  }

  await checkQuizButton(page, popup, fail);
}

/**
 * Checks the quiz button in the player controls. Automated browsers cannot play far into a
 * video, so the test sets the position and dispatches the playback event itself.
 */
async function checkQuizButton(page, popup, fail) {
  const sendToTab = (message) =>
    popup.evaluate(async (msg) => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
      return chrome.tabs.sendMessage(tab.id, msg);
    }, message);
  const status = () => sendToTab({ type: 'quiz:status' });
  const playTo = (fraction, offsetSec) =>
    page.evaluate(
      ({ fraction, offsetSec }) => {
        const video = document.querySelector('#movie_player video.html5-main-video');
        video.currentTime = video.duration * fraction + offsetSec;
        video.dispatchEvent(new Event('timeupdate'));
      },
      { fraction, offsetSec },
    );
  const freshPage = async (videoId) => {
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'domcontentloaded',
    });
    await dismissConsent(page);
    await page.waitForFunction(
      () => document.querySelector('#movie_player video')?.duration > 0,
      null,
      { timeout: 30_000 },
    );
    // Playback events during ads are ignored, so wait for any ad to end or be skipped.
    for (let i = 0; i < 45; i++) {
      const adShowing = await page.evaluate(() =>
        document.querySelector('#movie_player')?.classList.contains('ad-showing'),
      );
      if (!adShowing) return waitForSession();
      await page
        .locator('.ytp-skip-ad-button, .ytp-ad-skip-button-modern')
        .first()
        .click({ timeout: 1_000 })
        .catch(() => {});
      await page.waitForTimeout(1_000);
    }
    return false;
  };
  const waitForSession = async () => {
    for (let i = 0; i < 20 && (await status().catch(() => null))?.state !== 'waiting'; i++) {
      await page.waitForTimeout(500);
    }
    return true;
  };

  const button = page.locator('#movie_player .ytp-right-controls ytl-learn-button button');
  const label = () => button.textContent({ timeout: 5_000 }).catch(() => null);
  const waitForLabel = async (pattern) => {
    for (let i = 0; i < 40; i++) {
      const text = await label();
      if (text && pattern.test(text)) return text;
      await page.waitForTimeout(500);
    }
    return label();
  };

  // Seeded activities: the button shows the count after the halfway point and opens them.
  if (!(await freshPage(OVERLAY_VIDEO))) {
    console.log('  quiz button: skipped (an unskippable ad kept playing)');
    return;
  }
  console.log(`  button before halfway: ${JSON.stringify(await label())}`);
  await playTo(0.5, 5);
  const ready = await waitForLabel(/Learn \(/);
  console.log(`  button after halfway: ${JSON.stringify(ready)}`);
  if (!ready?.includes(`Learn (${SEEDED_ACTIVITIES.length})`))
    fail('button did not show the prepared quiz');

  await page.locator('#movie_player').hover();
  await button.click();
  const opened = await page
    .getByRole('dialog', { name: /^Learn:/ })
    .waitFor({ timeout: 5_000 })
    .then(
      () => true,
      () => false,
    );
  console.log(`  click opens the quiz: ${opened}`);
  if (!opened) fail('clicking the button did not open the quiz');
  const cards = await page.locator('ytl-quiz-overlay .ytl-prompt').count();
  if (cards > 0) fail('a prompt card appeared on the player');
  await page.keyboard.press('Escape');

  // No cached quiz: preparation fails here (no transcript or provider) and the button says so.
  if (!(await freshPage('QaKuVOhikaY'))) {
    console.log('  failed preparation: skipped (an unskippable ad kept playing)');
    return;
  }
  await playTo(0.5, 5);
  const failed = await waitForLabel(/failed/);
  console.log(`  button after a failed preparation: ${JSON.stringify(failed)}`);
  console.log(`  status: ${JSON.stringify(await status())}`);
  if (failed !== 'Learn failed, retry') fail('failed preparation was not shown on the button');
}

/** Reads the knowledge bank tables through the popup, which shares the extension origin. */
function readBank(popup) {
  return popup.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('youtube-learn');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = (store) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const [activities, reviewLogs, topics, videos] = await Promise.all(
      ['activities', 'reviewLogs', 'topics', 'videos'].map(all),
    );
    db.close();
    return {
      activities: activities.map(
        ({ id, type, due, prompt, generatedPrompt, topicId, suspended }) => ({
          id,
          type,
          due,
          prompt,
          generatedPrompt,
          topicId,
          suspended,
        }),
      ),
      reviewLogs: reviewLogs.length,
      topics: topics.map((topic) => topic.name),
      topicRecords: topics,
      videos,
    };
  });
}

/** Makes every saved activity due now, as if the scheduled days had passed. */
function makeAllDue(popup) {
  return popup.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('youtube-learn');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = Date.now() - 1_000;
    await new Promise((resolve, reject) => {
      const tx = db.transaction('activities', 'readwrite');
      const store = tx.objectStore('activities');
      store.getAll().onsuccess = (event) => {
        for (const activity of event.target.result) {
          store.put({ ...activity, due: now, fsrs: { ...activity.fsrs, due: new Date(now) } });
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
}

/** Completes a review of the saved activities on the dashboard with the keyboard. */
async function checkDashboard(popup, extensionId) {
  console.log('\nDashboard reviews');
  const fail = (message) => failures.push(`dashboard: ${message}`);
  const badge = () => popup.evaluate(() => chrome.action.getBadgeText({}));
  const refreshBadge = async () => {
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'badge:refresh' }));
    await popup.waitForTimeout(500);
  };

  await refreshBadge();
  const before = await badge();
  console.log(`  badge right after the video session: ${JSON.stringify(before)}`);
  if (before !== '') fail('activities were due immediately after the video session');

  await makeAllDue(popup);
  await refreshBadge();
  const dueBadge = await badge();
  console.log(`  badge once activities are due: ${JSON.stringify(dueBadge)}`);
  if (dueBadge !== String(SEEDED_ACTIVITIES.length))
    fail(`expected badge ${SEEDED_ACTIVITIES.length}`);

  await popup.reload();
  const popupText = await popup
    .locator('.reviews')
    .textContent({ timeout: 5_000 })
    .catch(() => '');
  console.log(`  popup: ${JSON.stringify(popupText)}`);
  if (!popupText.includes(`${SEEDED_ACTIVITIES.length} activities due`))
    fail('popup did not show the due count');

  const page = await popup.context().newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const dueText = await page
    .locator('.due-count')
    .textContent({ timeout: 5_000 })
    .catch(() => null);
  console.log(`  overview: ${JSON.stringify(dueText)}`);
  if (dueText !== `${SEEDED_ACTIVITIES.length} activities due`) fail('overview due count is wrong');

  await page.getByRole('button', { name: 'Start review' }).click();
  const press = (key) => page.keyboard.press(key);
  const seen = [];
  for (let step = 0; step < SEEDED_ACTIVITIES.length; step++) {
    const text = await page
      .locator('.ytl-progress')
      .textContent({ timeout: 5_000 })
      .catch(() => null);
    if (!text?.startsWith(`${step + 1} of`)) {
      fail(`step ${step + 1}: unexpected progress ${JSON.stringify(text)}`);
      break;
    }
    const type = text.split(' · ')[1];
    seen.push(type);
    switch (type) {
      case 'Recall question':
      case 'Flashcard':
      case 'Apply it':
        await press('Space');
        await press('1');
        break;
      case 'Fill in the blank':
        await page.keyboard.type('activation');
        await press('Enter');
        await press('Enter');
        break;
      case 'Multiple choice':
        await press('1');
        await press('Enter');
        break;
      case 'True or false':
        await press('t');
        await press('Enter');
        break;
      case 'Put in order':
        await press('Enter');
        await press('Enter');
        break;
      default:
        fail(`unknown activity type ${type}`);
    }
    await page
      .waitForFunction(
        (next) =>
          document.querySelector('#review-heading')?.textContent === 'Review complete' ||
          document.querySelector('.ytl-progress')?.textContent?.startsWith(`${next} of`),
        step + 2,
        { timeout: 5_000 },
      )
      .catch(() => fail(`step ${step + 1} (${type}) did not advance`));
  }
  const heading = await page.locator('#review-heading').textContent();
  const summary = await page.locator('.review').textContent();
  console.log(
    `  keyboard review of ${seen.length} activities: ${heading}; ${summary.match(/\d+ of \d+ correct/)?.[0]}`,
  );
  if (heading !== 'Review complete') fail('review did not reach the summary');
  if (new Set(seen).size !== SEEDED_ACTIVITIES.length) fail(`types reviewed: ${seen.join(', ')}`);

  await page.waitForTimeout(500);
  const bank = await readBank(popup);
  const stillDue = bank.activities.filter((activity) => activity.due <= Date.now()).length;
  const afterBadge = await badge();
  console.log(
    `  after review: ${bank.reviewLogs} review logs, ${stillDue} still due, badge ${JSON.stringify(afterBadge)}`,
  );
  if (bank.reviewLogs !== SEEDED_ACTIVITIES.length * 2) fail('each review should add a log');
  if (stillDue !== 0) fail('reviewed activities are still due');
  if (afterBadge !== '') fail('badge was not cleared after the review');

  await page.getByRole('button', { name: 'Done' }).click();
  await page
    .getByText('Nothing due right now.')
    .waitFor({ timeout: 5_000 })
    .catch(() => {
      fail('overview did not update after the review');
    });
  await checkKnowledgeBank(page, popup);
  await page.close();
}

/** Runs every knowledge bank action in the dashboard and checks the bank and the due count. */
async function checkKnowledgeBank(page, popup) {
  console.log('\nKnowledge bank');
  const fail = (message) => failures.push(`knowledge bank: ${message}`);
  const total = SEEDED_ACTIVITIES.length;
  const toast = page.locator('.toast');
  const dueCount = page.locator('.due-count');
  const heading = page.locator('.bank-main h3');
  const row = (prompt) =>
    page.locator('.activity-item', {
      has: page.locator('.activity-prompt').getByText(prompt, { exact: true }),
    });
  const topicButton = (name) => page.locator('.topic-list button', { hasText: name });
  const expectText = async (locator, text, what) => {
    const shown = await locator
      .filter({ hasText: text })
      .first()
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!shown) fail(`${what}: expected ${JSON.stringify(text)}`);
  };
  const step = async (name, action) => {
    try {
      await action();
      console.log(`  ${name}: done`);
    } catch (error) {
      fail(`${name}: ${error.message.split('\n')[0]}`);
    }
  };

  await step('browse and search', async () => {
    await expectText(topicButton('All topics'), `${total}`, 'all topics count');
    await expectText(topicButton('Smoke Test'), `${total}`, 'topic count');
    const search = page.getByRole('searchbox', { name: 'Search activities' });
    await search.fill('784');
    await expectText(page.locator('.bank-main [role=status]'), '1 activity found', 'search');
    if ((await page.locator('.activity-item').count()) !== 1)
      fail('search showed other activities');
    await search.fill('');
  });

  const recall = SEEDED_ACTIVITIES[0].prompt;
  const edited = 'Why do neural networks need hidden layers?';
  await step('edit', async () => {
    await row(recall).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('textbox', { name: 'Question' }).fill(edited);
    await page.getByRole('button', { name: 'Save' }).click();
    await expectText(toast, 'Activity saved.', 'edit toast');
    const saved = (await readBank(popup)).activities.find((a) => a.prompt === edited);
    if (saved?.generatedPrompt !== recall) fail('edit did not keep the generated prompt');
  });

  await step('suspend and resume, with the due count updated', async () => {
    await makeAllDue(popup);
    await page.reload();
    await expectText(dueCount, `${total} activities due`, 'due count before suspending');
    await row('Activation').getByRole('button', { name: 'Suspend' }).click();
    await expectText(row('Activation'), 'Suspended', 'suspended label');
    await expectText(dueCount, `${total - 1} activities due`, 'due count after suspending');
    await row('Activation').getByRole('button', { name: 'Resume' }).click();
    await expectText(dueCount, `${total} activities due`, 'due count after resuming');
  });

  await step('delete and undo', async () => {
    const statement = SEEDED_ACTIVITIES[4].prompt;
    await row(statement).getByRole('button', { name: 'Delete' }).click();
    await expectText(toast, 'Activity deleted.', 'delete toast');
    await expectText(dueCount, `${total - 1} activities due`, 'due count after deleting');
    if ((await row(statement).count()) !== 0) fail('deleted activity is still listed');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expectText(dueCount, `${total} activities due`, 'due count after undo');
    await expectText(row(statement), statement, 'restored activity');
  });

  await step('create, nest, and rename topics', async () => {
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Neural Networks');
    await page.getByRole('button', { name: 'Create' }).click();
    await expectText(heading, 'Neural Networks', 'new topic selected');

    await topicButton('Smoke Test').click();
    await page.getByRole('button', { name: 'Change parent' }).click();
    await page
      .getByRole('combobox', { name: 'Parent topic' })
      .selectOption({ label: 'Neural Networks' });
    await page.getByRole('button', { name: 'Save' }).click();
    await expectText(heading, 'Neural Networks > Smoke Test', 'nested path');

    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByRole('textbox', { name: 'New name' }).fill('Basics');
    await page.getByRole('button', { name: 'Rename' }).click();
    await expectText(page.locator('.topic-list .subtopic'), 'Basics', 'renamed subtopic');
  });

  await step('move an activity', async () => {
    const ordering = SEEDED_ACTIVITIES[5].prompt;
    await row(ordering).getByRole('button', { name: 'Move' }).click();
    await page
      .getByRole('combobox', { name: 'Move to topic' })
      .selectOption({ label: 'Neural Networks' });
    await row(ordering).getByRole('button', { name: 'Move' }).click();
    await expectText(toast, 'Moved to Neural Networks.', 'move toast');
    await expectText(topicButton('Basics'), `${total - 1}`, 'count after moving');
    if ((await row(ordering).count()) !== 0) fail('moved activity is still listed under Basics');
  });

  await step('merge topics', async () => {
    await page.getByRole('button', { name: 'Merge' }).click();
    await page
      .getByRole('combobox', { name: /Merge "Basics" into/ })
      .selectOption({ label: 'Neural Networks' });
    await page.getByRole('button', { name: 'Merge' }).click();
    await expectText(toast, 'Merged "Basics" into "Neural Networks".', 'merge toast');
    const bank = await readBank(popup);
    const [topic] = bank.topicRecords;
    if (bank.topicRecords.length !== 1 || topic?.name !== 'Neural Networks')
      fail(`topics after merge: ${JSON.stringify(bank.topics)}`);
    if (!['Smoke Test', 'Basics'].every((name) => topic?.aliases?.includes(name)))
      fail(`merged names were not kept as aliases: ${JSON.stringify(topic?.aliases)}`);
    if (bank.activities.some((a) => a.topicId !== topic?.id)) fail('activities were not merged');
    await expectText(dueCount, `${total} activities due`, 'due count after merge');
  });

  await step('delete all activities from a video and undo', async () => {
    await page
      .getByRole('button', { name: new RegExp(`^Delete all ${total} activities from`) })
      .click();
    await expectText(page.locator('section p'), 'Your knowledge bank is empty.', 'empty bank');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expectText(dueCount, `${total} activities due`, 'due count after undo');
  });

  await step('delete a topic and undo', async () => {
    await topicButton('Neural Networks').click();
    await page.getByRole('button', { name: 'Delete topic' }).click();
    await expectText(toast, `Deleted topic "Neural Networks" and ${total} activities.`, 'toast');
    if ((await readBank(popup)).activities.length !== 0) fail('topic activities were not deleted');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expectText(dueCount, `${total} activities due`, 'due count after undo');
  });

  await page.waitForTimeout(500);
  const badge = await popup.evaluate(() => chrome.action.getBadgeText({}));
  console.log(`  badge after the management actions: ${JSON.stringify(badge)}`);
  if (badge !== String(total)) fail(`expected badge ${total}`);
}

/** Writes activities into the extension's cache so the overlay opens without a provider. */
async function seedQuiz(popup, videoId) {
  await popup.evaluate(
    async ({ videoId, activities }) => {
      // Opens the database through the background so the schema exists before writing.
      await chrome.runtime.sendMessage({ type: 'quiz:get-cached', videoId });
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('youtube-learn');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('quizCache', 'readwrite');
        tx.objectStore('quizCache').put({
          videoId,
          title: 'Smoke test',
          set: { topic: 'Smoke Test', activities },
          providerId: 'custom',
          model: 'smoke',
          createdAt: Date.now(),
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { videoId, activities: SEEDED_ACTIVITIES },
  );
}

/** Checks that the background worker, storage, and IndexedDB work in the built extension. */
async function checkQuizBackground(popup, extensionId) {
  console.log('\nQuiz background');
  const fail = (message) => failures.push(`quiz background: ${message}`);
  const generate = () =>
    popup.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'quiz:generate',
        video: { videoId: 'smoke-test', title: 'Smoke', channelName: 'Test', durationSec: 600 },
        segments: [{ startMs: 0, durationMs: 1000, text: 'word '.repeat(200) }],
      }),
    );

  await popup.evaluate(() => chrome.storage.local.clear());
  const unconfigured = await generate();
  console.log(`  no API key: ${unconfigured?.code} (${unconfigured?.error})`);
  if (unconfigured?.code !== 'not-configured')
    fail(`expected not-configured, got ${unconfigured?.code}`);

  await popup.evaluate(() => chrome.storage.local.set({ apiKeys: { anthropic: 'sk-test' } }));
  const noPermission = await generate();
  console.log(`  no host permission: ${noPermission?.code} (${noPermission?.error})`);
  if (noPermission?.code !== 'permission') fail(`expected permission, got ${noPermission?.code}`);
  await popup.evaluate(() => chrome.storage.local.clear());

  const options = await popup.context().newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options
    .locator('label[for="api-key"]')
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  const labels = await options
    .locator('label')
    .allTextContents()
    .catch(() => []);
  console.log(`  settings page fields: ${labels.join(', ')}`);
  for (const label of ['Provider', 'API key', 'Model']) {
    if (!labels.includes(label)) fail(`settings page is missing "${label}"`);
  }
  await options.close();

  const evalPage = await popup.context().newPage();
  await evalPage.goto(`chrome-extension://${extensionId}/eval.html`);
  const runButton = await evalPage
    .getByRole('button', { name: /Run evaluation/ })
    .textContent({ timeout: 5_000 })
    .catch(() => null);
  const configError = await evalPage
    .locator('.error')
    .first()
    .textContent()
    .catch(() => null);
  console.log(`  evaluation page: "${runButton}", "${configError?.trim()}"`);
  if (!runButton?.includes('videos')) fail('evaluation page did not render the run button');
  if (!configError?.includes('API key')) fail('evaluation page did not report the missing key');
  await evalPage.close();
}

async function checkVideo(page, popup, videoId, label = '') {
  const response = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
    return chrome.tabs.sendMessage(tab.id, { type: 'transcript:get', includeFixture: true });
  });
  const fail = (message) => failures.push(`${videoId}: ${message}`);

  if (!response?.ok) return fail(`pipeline error: ${response?.error}`);
  console.log(`\n${videoId}${label ? ` (${label})` : ''}: ${response.video.title}`);
  for (const attempt of response.attempts) {
    console.log(
      `  ${attempt.source}: ${attempt.outcome}${attempt.detail ? ` (${attempt.detail})` : ''}`,
    );
  }

  if (response.video.videoId !== videoId) fail(`reported video ${response.video.videoId}`);
  if (!response.video.title) fail('missing title');

  const sources = response.attempts.map((attempt) => attempt.source);
  const expected = SOURCES.slice(0, sources.length);
  if (JSON.stringify([...new Set(sources)]) !== JSON.stringify(expected)) {
    fail(`unexpected step order: ${sources.join(', ')}`);
  }
  if (!response.transcript && sources.length !== SOURCES.length) fail('stopped before panel-dom');

  const leftovers = await page.evaluate(() => ({
    hideStyle: Boolean(document.getElementById('ytl-hide-transcript-panel')),
    expandedPanels: document.querySelectorAll(
      '[target-id="engagement-panel-searchable-transcript"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
    ).length,
  }));
  if (leftovers.hideStyle) fail('hide style was not removed');
  if (leftovers.expandedPanels > 0) fail('transcript panel was left open');

  if (response.transcript) {
    if (response.transcript.segments.length === 0) fail('transcript has no segments');
    if (response.fixture) {
      const file = path.join(FIXTURE_DIR, `${videoId}.${response.fixture.kind}.json`);
      await writeFile(file, `${JSON.stringify(response.fixture, null, 2)}\n`);
      console.log(`  saved ${path.relative(process.cwd(), file)}`);
    }
  }
}

async function navigateToRelatedVideo(page) {
  const currentId = new URL(page.url()).searchParams.get('v');
  const link = page.locator(`#secondary a[href^="/watch?v="]:not([href*="${currentId}"])`).first();
  try {
    await link.waitFor({ state: 'attached', timeout: 15_000 });
    const href = await link.getAttribute('href');
    const relatedId = new URL(href, 'https://www.youtube.com').searchParams.get('v');
    await link.evaluate((element) => element.click());
    await page.waitForURL((url) => url.searchParams.get('v') === relatedId, { timeout: 15_000 });
    return relatedId;
  } catch {
    return null;
  }
}

function logTranscriptTraffic(page) {
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (!/get_transcript|timedtext/.test(url.pathname)) return;
    const length = (await response.text().catch(() => '')).length;
    console.log(`  [network] ${response.status()} ${url.pathname} (${length} bytes)`);
  });
}

async function findExtensionId(browserContext) {
  const page = await browserContext.newPage();
  await page.goto('chrome://extensions');
  const id = await page.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const list = manager?.shadowRoot?.querySelector('extensions-item-list');
    return list?.shadowRoot?.querySelector('extensions-item')?.id;
  });
  await page.close();
  if (!id) throw new Error('Extension did not load. Run "pnpm build" first.');
  return id;
}

/** Rejects cookies on the consent page or the in-page consent dialog, whichever appears. */
async function dismissConsent(page) {
  const reject = page
    .locator('ytd-consent-bump-v2-lightbox, form[action*="consent"]')
    .getByRole('button', { name: /^reject/i })
    .first();
  try {
    await reject.click({ timeout: 8_000 });
    await page.waitForLoadState('domcontentloaded');
    await page
      .locator('ytd-consent-bump-v2-lightbox tp-yt-paper-dialog')
      .waitFor({ state: 'hidden', timeout: 5_000 });
  } catch {
    // No consent prompt in this region or session.
  }
}
