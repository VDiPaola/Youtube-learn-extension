# Roadmap

Each phase ends with working, tested software. Phases 1 and 2 can run in parallel after Phase 0.

## Phase 0: Scaffold

- WXT project with TypeScript and React. Package manager: pnpm.
- ESLint, Prettier, Vitest, Playwright.
- Build scripts for Chromium and Firefox.
- CI: lint, unit tests, both builds, `web-ext lint`.

**Done when:** an empty extension loads in Chrome and Firefox from CI build artifacts.

**Status:** Mostly done. WXT, React, TypeScript, Prettier, Vitest, Playwright, and both builds are set up. Remaining: ESLint, and CI once the project is a git repository.

## Phase 1: Transcript pipeline

- Detect watch pages and SPA navigation.
- Read video metadata (title, channel, category, duration).
- Retrieve transcripts using the fallback chain in [Architecture](ARCHITECTURE.md#transcript-retrieval).
- Save transcript fixtures from 10+ real videos (manual captions, auto captions, non-English, no captions, caption URLs with `exp=xpe`).
- Save captured `get_transcript` responses as fixtures. Strip cookies, auth headers, visitor data, and IP addresses first.

**Done when:** a debug panel shows the correct transcript for every fixture video, and parser tests pass on all fixtures.

**Status:** Implemented and confirmed in a normal browser profile. Real fixtures so far: 2 videos with manual English captions, both retrieved from the player's own caption request (`captured-captions`). Remaining fixture coverage:

- Auto-generated captions only.
- Non-English captions.
- No captions.
- A `get_transcript` response (from a video where the panel step is reached).

## Phase 2: Quiz generation

- Provider adapters: Anthropic, OpenAI, Google Gemini, OpenAI-compatible.
- Settings page: provider, API key, model, "Test connection" button.
- Generation prompt, Zod output schema, chunking, deduplication, card count limits.
- Quiz cache per video ID.
- Evaluation set: 5 transcripts with manually reviewed output, used to compare prompt changes.

**Done when:** each provider returns a valid quiz for every evaluation transcript, and invalid model output produces a clear error instead of a crash.

**Status:** Implemented and confirmed live in Edge with a custom OpenAI-compatible endpoint. Two adapters cover all providers: Anthropic through the official SDK, and one OpenAI-compatible adapter with presets for OpenAI, Gemini, OpenRouter, Ollama, and custom servers. Covered by unit tests with mocked responses and a browser smoke test of the background worker and settings page. Remaining:

- Run the evaluation page (Settings, then **Activity evaluation**) on 5+ fixtures and review the results (see [Evaluation](EVALUATION.md)).

## Phase 3: In-video prompt and quiz

- Eligibility rules (category, channel allowlist and blocklist, manual trigger).
- Generation starts at 50% watched; prompt appears at the configured point.
- Quiz overlay in Shadow DOM: optional MCQ warm-up, then free recall with reveal and self-grade.
- Keyboard controls (space to reveal, 1 or 2 to mark correct or incorrect) and screen reader labels.

**Done when:** the Playwright test with a mocked provider completes a quiz on a real video page, and the overlay works with YouTube in theater, fullscreen, and dark modes.

**Status:** Done, confirmed in Edge. Changed after testing: instead of a prompt card near the end, a **Quiz** button in the player controls shows the state (preparing, ready, failed) and opens the quiz. The smoke test checks the button states, completes a seeded quiz with the keyboard, and confirms the dialog in default, theater, and fullscreen views with YouTube's dark theme.

## Phase 3b: Learning activities

- Replace flashcard quizzes with seven activity types: recall question, flashcard, fill in the blank, multiple choice, true or false, put in order, and apply it.
- The AI picks the type that fits each idea; settings can turn types off.
- Automatic checking for fill in the blank, multiple choice, true or false, and put in order.
- Rename the feature to **Learn** throughout the interface.

**Status:** Implemented. Unit tests cover the activity format, per-type cleanup, answer checking, the runner, and the database upgrade that clears old quizzes. The smoke test completes one activity of each type with the keyboard on a live video page. Remaining:

- Confirm in Edge with your provider (saved quizzes regenerate on first use).

## Phase 4: Knowledge bank and reviews

- Dexie schema (see [Data model](ARCHITECTURE.md#data-model)).
- Save session results as activities with FSRS state seeded from the first result (correct as Good, incorrect as Again).
- Dashboard review session.
- Toolbar badge with due count; optional daily notification.
- Popup with due count and "Start review".

**Done when:** activities reviewed on simulated dates follow FSRS intervals in unit tests, and a full session-to-review cycle works in the browser.

**Status:** Implemented. Each answer in a video session is saved as it is given; repeating a video session reviews the same activities instead of adding duplicates. The dashboard page (`dashboard.html`) runs review sessions with the same activity views as the video. The badge refreshes every 5 minutes and after each answer. The daily notification uses an optional permission, requested when it is turned on. Unit tests cover the bank, FSRS intervals on simulated dates, reminders, and the version 3 database upgrade. The smoke test saves a video session, makes it due, and completes a keyboard review in the dashboard. A separate check upgraded the previous build's database across an extension reload, with a YouTube tab left open. Remaining:

- Confirm in Edge with your provider: a real session, then a review the next day.

## Phase 5: Knowledge management

- Topic assignment using existing topic names in the prompt.
- Browse by topic, search, edit, suspend, delete (with undo).
- Delete all activities from one video.
- Rename, merge, nest, and delete topics; move activities between topics.

**Done when:** every management action is covered by a unit test and reflected immediately in the review queue.

## Phase 6: Export and backup

- Spike: compare `.apkg` libraries; confirm bundled `sql.js` WASM works in both builds.
- Anki `.apkg` export per topic or all, with subdecks and tags.
- TSV export.
- JSON backup and import with merge by activity ID.

**Done when:** an exported `.apkg` imports into current Anki desktop with correct decks, fields, and tags, and a backup round trip restores identical data.

## Phase 7: Release

- Final name without "YouTube" trademark, icons, store screenshots.
- Privacy policy page (no data collection; transcripts go to the user's chosen provider).
- Onboarding page: get an API key, choose a provider, first session walkthrough.
- Test the Firefox build and the remaining Chromium browsers. Development and testing happen in Edge until this phase.
- Submit to Chrome Web Store, Microsoft Edge Add-ons, Firefox Add-ons, Opera Add-ons.

**Done when:** the extension is published in at least the Chrome and Firefox stores.

## Later

- Safari build (needs macOS, Xcode, Apple Developer Program).
- Optional cloud sync across devices.
- Optional hosted AI tier for users without an API key.
- Chrome Built-in AI as a free provider where supported.
- FSRS parameter optimization from the user's review history.
- Activities for non-YouTube video sites and articles.

## Open questions

- Final product name.
- Default UI language and whether to localize the extension interface in v1.
- Whether to allow typed answers with AI grading (adds API cost per review) or keep self-grading only.
