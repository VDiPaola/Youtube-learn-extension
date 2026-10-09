import { db } from '@/lib/db';
import { createReviewService } from '@/lib/knowledge/background';
import {
  isAskQuestionMessage,
  isGenerateQuizMessage,
  isGetCachedQuizMessage,
  isOpenOptionsMessage,
  isRecordResultMessage,
  isRefreshBadgeMessage,
  isTestProviderMessage,
} from '@/lib/messages';
import { createProvider } from '@/lib/learn/providers';
import { createQuizService } from '@/lib/learn/service';
import { enabledActivityTypes, promptSettingsItem } from '@/lib/prompt-settings';
import { reinjectContentScripts, type ContentScriptEntry } from '@/lib/reinject';
import { lastReminderDayItem, reviewSettingsItem } from '@/lib/review-settings';
import { apiKeysItem, resolveProviderConfig, settingsItem } from '@/lib/settings';

const KEEP_ALIVE_INTERVAL_MS = 20_000;
const REVIEW_ALARM = 'reviews';
const REVIEW_CHECK_MINUTES = 5;
const REMINDER_ID = 'review-reminder';
const REVIEW_URL = '/dashboard.html#review';

export default defineBackground(() => {
  const quizService = createQuizService({
    db,
    loadConfig: async () =>
      resolveProviderConfig(await settingsItem.getValue(), await apiKeysItem.getValue()),
    hasPermission: (origin) => browser.permissions.contains({ origins: [origin] }),
    createProvider: (config) => createProvider(config),
    loadAllowedTypes: async () => enabledActivityTypes(await promptSettingsItem.getValue()),
    now: Date.now,
  });

  const reviewService = createReviewService({
    db,
    now: Date.now,
    loadSettings: () => reviewSettingsItem.getValue(),
    loadLastReminderDay: () => lastReminderDayItem.getValue(),
    saveLastReminderDay: (day) => lastReminderDayItem.setValue(day),
    setBadge: (text) => browser.action.setBadgeText({ text }),
    notify: async (dueCount) => {
      if (!(await browser.permissions.contains({ permissions: ['notifications'] }))) return false;
      await browser.notifications.create(REMINDER_ID, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('/icon/128.png'),
        title: 'Time to review',
        message: `${dueCount} ${dueCount === 1 ? 'activity is' : 'activities are'} due.`,
      });
      return true;
    },
    log: (message) => console.warn('[YouTube Learn]', message),
  });

  // Listeners for an optional permission's API exist only after it is granted.
  browser.notifications?.onClicked.addListener((id) => {
    if (id !== REMINDER_ID) return;
    void browser.tabs.create({ url: browser.runtime.getURL(REVIEW_URL) });
    void browser.notifications.clear(id);
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REVIEW_ALARM) void reviewService.check();
  });
  // The worker starts often; creating the alarm again would postpone it each time.
  void browser.alarms.get(REVIEW_ALARM).then((alarm) => {
    if (!alarm) void browser.alarms.create(REVIEW_ALARM, { periodInMinutes: REVIEW_CHECK_MINUTES });
  });

  browser.runtime.onStartup.addListener(() => void reviewService.refreshBadge());

  browser.runtime.onInstalled.addListener(() => {
    void reviewService.refreshBadge();
    void reinjectContentScripts({
      contentScripts: (browser.runtime.getManifest().content_scripts ?? []) as ContentScriptEntry[],
      queryTabIds: async (matches) =>
        (await browser.tabs.query({ url: matches }))
          .filter((tab) => tab.id !== undefined && !tab.discarded)
          .map((tab) => tab.id!),
      inject: (tabId, files, world) =>
        // Paths come from the manifest, so they are valid public paths.
        browser.scripting.executeScript({ target: { tabId }, files: files as never[], world }),
      log: (message) => console.warn('[YouTube Learn]', message),
    });
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isGenerateQuizMessage(message)) {
      void keepAliveDuring(quizService.generateQuiz(message)).then(sendResponse);
      return true;
    }
    if (isAskQuestionMessage(message)) {
      void keepAliveDuring(quizService.ask(message)).then(sendResponse);
      return true;
    }
    if (isGetCachedQuizMessage(message)) {
      void quizService.getCachedQuiz(message.videoId).then(sendResponse);
      return true;
    }
    if (isRecordResultMessage(message)) {
      void reviewService.recordResult(message).then(sendResponse);
      return true;
    }
    if (isRefreshBadgeMessage(message)) {
      void reviewService.refreshBadge();
      return;
    }
    if (isOpenOptionsMessage(message)) {
      void browser.runtime.openOptionsPage();
      return;
    }
    if (isTestProviderMessage(message)) {
      void quizService.testProvider().then(sendResponse);
      return true;
    }
  });
});

/** Browsers stop idle background workers after ~30 seconds; AI requests can take longer. */
async function keepAliveDuring<T>(work: Promise<T>): Promise<T> {
  const timer = setInterval(() => void browser.runtime.getPlatformInfo(), KEEP_ALIVE_INTERVAL_MS);
  try {
    return await work;
  } finally {
    clearInterval(timer);
  }
}
