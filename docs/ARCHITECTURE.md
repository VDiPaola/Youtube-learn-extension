# Architecture

## Overview

The extension has four parts that communicate through extension messaging:

```
YouTube tab                         Extension
+---------------------------+       +------------------------------+
| Main-world script         |       | Background                   |
|  reads player data        |       |  AI provider calls           |
|           |               |       |  generation queue + cache    |
| Content script            | <---> |  review reminders (alarms)   |
|  video detection          |       |  due-count badge             |
|  playback tracking        |       +------------------------------+
|  Learn and Ask buttons    |                     |
|  activity and question UI |                     |
|  (Shadow DOM overlay)     |                     v
+---------------------------+       +------------------------------+
                                    | IndexedDB (Dexie)            |
+---------------------------+       |  videos, topics, activities,  |
| Popup                     | <---> |  review logs                 |
|  due count, start review  |       +------------------------------+
+---------------------------+                     ^
| Dashboard (extension page)| <-------------------+
|  review, knowledge bank,  |
|  export, backup, settings |
+---------------------------+
```

## Components

### Content script (`youtube.com/watch*`, `youtube.com/shorts` excluded)

- **Navigation:** YouTube is a single-page app. WXT's `wxt:locationchange` event starts a new watch session (`lib/watch/session.ts`) for each video ID.
- **Learn button (`lib/prompt-settings.ts`):** Shown in YouTube's player controls (`.ytp-right-controls`) when the setting is on, the channel is not blocked, the video is not live, is at least 3 minutes long, has captions, and is either in the Education category or from an allowed channel. Nothing pops up on the video; the button is the only entry point on the page.
- **Button states:** **Learn** (not prepared yet; a click generates and opens the activities), **Preparing…**, **Learn (N)** (ready), **Nothing to learn**, and **Learn failed, retry**. A click always opens the activities, waiting for or retrying generation as needed.
- **Background preparation:** A capture-phase `timeupdate` listener on `document` reads the main video's position, ignoring ads. At 50% the activities are prepared once: a cached set is used if one exists, otherwise the transcript is loaded and the background generates them. One attempt per video, so a failure never repeats paid requests.
- **Manual trigger:** "Learn from this video" in the popup opens activities for any video, ignoring the rules above.
- **Questions (`lib/learn/ask.ts`, `entrypoints/youtube.content/AskPanel.tsx`):** An **Ask** button sits beside the Learn button and follows the same rules; "Ask about this video" in the popup opens it for any video. The dialog pauses the video and starts loading the transcript. Each question goes to the background (`video:ask`) with the transcript and the conversation so far; each user turn carries the playback position, so "this part" has a meaning. The answer appears as plain text. `[m:ss]` markers become buttons that close the dialog and play from that point. The conversation lives in the watch session, so it survives closing the dialog and ends on navigation to another video. It is not saved. A failed question is removed from the conversation and its text returns to the input box. The transcript is loaded once per video and shared with activity preparation.
- **Updates:** Browsers leave already-open tabs running a disconnected copy of the old content script after an update. On install or update, the background injects the current content scripts into open YouTube tabs (`lib/reinject.ts`). If a tab still does not answer, the popup says so and offers **Reload tab**.
- **Status:** The popup polls the session status (`quiz:status`) every second: waiting, each preparation step, ready, or failed with the reason. Failures are also logged to the page console with the prefix `[YouTube Learn]`.
- **UI:** The button and the activity dialog render in Shadow DOM roots. The dialog is mounted inside `#movie_player`, so it stays visible in theater mode and fullscreen. Key and mouse events are stopped at each shadow root so YouTube's player shortcuts (Space, digits, `f`, `k`) do not fire. Opening the activities pauses the video.
- **Activity runner (`lib/learn/runner.ts`, `components/activities/ActivityView.tsx`, `entrypoints/youtube.content/LearnPanel.tsx`):** Shows each activity by type. Recall questions, flashcards, and apply-it scenarios are self-graded: show the answer (Space), then mark it Correct (1) or Incorrect (2). Fill in the blank (typed, forgiving of case, articles, and small typos, with an "I was right" override), multiple choice (1 to 4), true or false (1 or T, 2 or F), and put in order (arrow buttons) are checked automatically. When an activity has an explanation, it sits in a collapsed **Explanation** dropdown below the answer. Only activity types enabled in settings are shown. The summary reports how many answers were correct, and lists the incorrect ones as worth rewatching, with buttons that jump to their timestamp. The activity views and the `useActivityRunner` hook are shared with the dashboard.
- **Saving results:** Each finished activity is sent to the background (`activity:record`) and saved to the knowledge bank. A checked answer also counts if the dialog closes before **Continue**. A self-graded answer that was shown but not graded is not saved. The video details travel with the open dialog, so an answer saved during in-app navigation stays with its own video.
- **Styling:** Activity styles live in `components/activities/activities.css`, scoped to a container with the `ytl-surface` class and colored by `--ytl-*` variables, so the dashboard reuses them. WXT resets each shadow host with `all: initial !important`, so host styles (position, font, color) need `!important` in the shadow stylesheet. Every stylesheet the content script imports is injected into both shadow roots, so host rules name their element (`:host(ytl-learn-button)`). Sizes use px because YouTube sets the page root font size to 10px.

### Transcript retrieval

YouTube has no official transcript API, and both internal endpoints now require attestation on many videos:

- `youtubei/v1/get_transcript` expects `attestationResponseData` generated by YouTube's BotGuard code. Hand-built requests return `400 Precondition check failed`.
- Caption track URLs containing `exp=xpe` return an empty `200` body unless a video-bound proof-of-origin token (`pot`) is appended. Only the player mints that token.

The extension does not replicate attestation or mint tokens. Copying BotGuard output is single-use, breaks often, and risks store rejection. Instead, a main-world script installed at `document_start` wraps `fetch` and `XMLHttpRequest` and reads responses that YouTube's own code requests. Retrieval uses ordered fallbacks:

1. **Captured response.** If YouTube already fetched `get_transcript` or a caption track for the current video, parse that response. The player requests the video's caption track (`fmt=json3`, with a valid `pot`) on page load, so this step usually succeeds without opening anything.
2. **Direct caption fetch.** If the chosen track's `baseUrl` (from `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks`) has no `exp=xpe` flag, fetch it with `fmt=json3`. No visible side effects. Prefer manual captions over auto-generated, and the user's language over others.
3. **Triggered panel.** Click "Show transcript" with the panel made transparent, so YouTube's code sends the attested `get_transcript` request. Parse the first response captured after opening, then close the panel.
4. **Panel DOM scraping.** If the JSON shape is unrecognized, read the segment elements from the same panel.
5. **Failure state.** Show "No transcript available" and offer no activities.

This is the most fragile part of the system. Parsing lives in one isolated module with fixture-based tests so breakage is detected and fixed in one place.

Implementation notes, confirmed against live YouTube (October 2026):

- **Hook timing:** The hook is a `world: "MAIN"` content script with `run_at: document_start`, so it wraps `fetch` before YouTube's scripts run. It talks to the isolated content script through `CustomEvent`s with JSON string payloads, because Firefox blocks object access across worlds.
- **Gzipped requests:** YouTube gzips the `get_transcript` request body. The hook decompresses it with `DecompressionStream` to read the video ID, and falls back to the page URL's video ID.
- **Panel visibility:** The panel only loads while inside the viewport. Moving it off-screen stops the request, so it is shown at `opacity: 0` with `pointer-events: none` instead.
- **Panel variants:** YouTube currently renders both `engagement-panel-searchable-transcript` and a newer `PAmodern_transcript_view` panel. Both are handled. DOM scraping reads the leaf text of each segment rather than class names.
- **Automated browsers:** Attestation fails under Playwright, even in a visible window. Caption requests return an empty body and `get_transcript` returns `400 FAILED_PRECONDITION`. Automated tests can verify everything except a successful transcript. Success is verified manually in a normal browser.

### Background

- **Provider adapters:** One interface, two implementations (`lib/learn/providers/`):
  ```ts
  interface QuizProvider {
    generate(request: QuizRequest): Promise<ActivitySet>;
    chat(request: ChatRequest): Promise<string>;
    listModels(): Promise<string[]>;
  }
  ```
  `chat` sends a system prompt and a conversation and returns plain text, with no output schema.
  - **Anthropic:** official `@anthropic-ai/sdk` with structured outputs (`output_config.format`, schema from `betaZodOutputFormat`). Default model `claude-opus-5-5`. Server-side refusal fallbacks (`fallbacks: "default"`) are enabled for models that support them. `stop_reason` is checked before the JSON is parsed, so refusals and truncation get their own errors.
  - **OpenAI-compatible:** plain `fetch` to `/chat/completions` with `response_format: json_schema` (strict). Presets: OpenAI, Google Gemini (through its OpenAI-compatible endpoint), OpenRouter, Ollama, and any custom server.
- **Generation (`lib/learn/generate.ts`):** Caption segments are merged into ~20 second lines with `[m:ss]` markers. The prompt describes the seven activity types and when each fits, and includes the title, channel, existing topic names, the enabled types, and the target activity count. Existing topics are the knowledge bank's topics (subtopics as `Parent > Subtopic`), then topics of cached sets not saved to the bank yet, up to 50. The model picks the type that fits each idea. Output is validated with Zod, normalized per type (`lib/learn/clean.ts`), and invalid output is retried once, then reported as an error.
- **Questions (`lib/learn/ask.ts`):** The system prompt sets a coaching style: a direct answer first, then a step-by-step explanation in plain words, examples or analogies when useful, timestamps to rewatch, and an optional check-your-understanding question. It allows a short general answer, labeled as beyond the video, when the transcript does not cover the question. The video details and transcript follow the instructions in the system prompt, so follow-up questions share a stable prefix. Anthropic requests mark it for prompt caching. Transcripts over 150,000 characters send only the part that contains the latest question's position.
- **Activity count:** One activity per three minutes of video, between 5 and 15.
- **Activity format (`lib/learn/schema.ts`):** One flat shape for every type: `type`, `prompt`, `answer`, `explanation`, `options`, `sourceStartSec`, with unused fields empty. `options` holds wrong choices (multiple choice), the items in correct order (put in order), or accepted alternatives (fill in the blank). Strict JSON schema modes handle a flat shape more reliably than a union of shapes.
- **Long transcripts:** Transcripts over 150,000 characters (about three hours of speech) are split into parts. Later parts receive the first part's topic. Activities are merged, near-duplicates (word overlap of 80% or more) removed, and the total capped.
- **Cache:** Generated activity sets are stored per video ID in the `quizCache` table, so rewatching does not cost another API call. Concurrent requests for the same video share one generation.
- **Keep-alive:** Browsers stop idle background workers after about 30 seconds. During generation, the background calls a cheap extension API every 20 seconds.
- **Knowledge bank (`lib/knowledge/`):** `bank.ts` saves answers and reviews, `scheduler.ts` wraps `ts-fsrs`, `topics.ts` matches topic names, `manage.ts` holds the management actions, `browse.ts` builds the dashboard's topic list and search results, and `background.ts` handles saving, the badge, and reminders. Extension pages share the extension origin, so the dashboard and popup read and write IndexedDB directly. The content script runs on YouTube's origin and goes through the background.
- **Reminders:** An alarm every 5 minutes updates the toolbar badge with the due count. The badge also refreshes after each saved answer or review (`badge:refresh`). When the daily reminder is on, the first check after the chosen hour shows one notification if activities are due. Clicking it opens a review.

### Dashboard (extension page)

`dashboard.html`. The page reads IndexedDB through Dexie live queries, so counts and lists update after any change, including answers saved by the background. Export and backup come in Phase 6.

- **Overview:** Due count, **Start review**, the next due time, and the bank size. `dashboard.html#review` starts a review directly (popup and notification).
- **Review:** Due activities, most overdue first, each in its own form with the shared activity views. Each answer is saved as it is given. After answering, the source video link opens at the activity's timestamp. Esc or **End review** stops; the summary shows how many were correct.
- **Knowledge bank:** A topic list (subtopics indented, with activity counts) beside the activities of the selected topic and its subtopics, grouped by video, newest video first. Search matches every word in the prompt, answer, explanation, options, and video title, ignoring case and accents. 100 activities show at a time.
  - Activities: **Edit** (text fields for the type, checked with the same rules as generated activities), **Suspend** or **Resume**, **Move** to another topic, **Delete**.
  - Videos: **Move all** and **Delete all** for every activity from the video, in any topic.
  - Topics: **New topic**, **Rename**, **Change parent**, **Merge** into another topic, **Delete topic** (with its activities; subtopics move to the top level).
  - **Undo:** Each action returns a snapshot of the records it changed or removed. The toast offers **Undo** for 10 seconds (paused while hovered or focused), which puts the snapshot back. Only the latest action can be undone.
- **Export:** Anki `.apkg` and TSV per topic or for everything.
- **Backup:** Full JSON export and import (cards, review history, settings except API keys).
- **Settings:** Provider, API key, model, prompt timing, card count, eligibility rules, reminder schedule, desired retention.

### Popup

When the knowledge bank has activities: the due count, **Start review**, and **Knowledge bank** (opens the dashboard). On a watch page: the live status (see Status above), "Learn from this video", "Ask about this video", and a per-channel rule (automatic, always, never). A collapsed developer section holds the transcript and activity debug tools.

## Data model

Stored in IndexedDB through Dexie. IDs are UUIDs so backups merge without collisions.

| Table        | Key fields                                                                                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `videos`     | `id` (YouTube video ID), `title`, `channelId`, `channelName`, `durationSec`, `transcriptLang`, `activitiesGeneratedAt`                                                                                                                                   |
| `topics`     | `id`, `name`, `parentId` (nullable, for nested topics), `createdAt`, `aliases` (former names)                                                                                                                                                            |
| `activities` | `id`, `videoId`, `topicId`, the activity fields (`type`, `prompt`, `answer`, `explanation`, `options`), `generatedPrompt` (set on first edit), `sourceStartSec`, `fsrs` (ts-fsrs card), `due` (epoch ms), `suspended` (0 or 1), `createdAt`, `updatedAt` |
| `reviewLogs` | `id`, `activityId`, `rating`, `reviewedAt`, `fsrsLog` (ts-fsrs review log)                                                                                                                                                                               |
| `quizCache`  | `videoId`, `title`, `set` (validated activity set), `providerId`, `model`, `createdAt`. Version 2 of the database cleared entries saved in the earlier flashcard format.                                                                                 |

Version 3 added `videos`, `topics`, `activities`, and `reviewLogs` without changing `quizCache`. IndexedDB cannot index booleans, so `suspended` is 0 or 1, and the `[suspended+due]` index serves the due queue and count. `due` copies `fsrs.due` as a number for that index. Phase 5 added `aliases` and `generatedPrompt` as optional fields without indexes, so the database stayed at version 3; records without them behave as before.

Settings and API keys live in `browser.storage.local`, not IndexedDB. API keys are never included in backups or exports.

Schema changes go through Dexie version upgrades. Every version bump ships with an upgrade function and a test that opens a database at the previous version.

## Learning model

- **Activity types:** recall question, flashcard, fill in the blank, multiple choice, true or false, put in order, and apply it. Each stored activity is reviewed in its own form.
- **First retrieval:** The session on the video counts as the first review. Every result is correct or incorrect, whether self-graded or checked; correct counts as Good and incorrect as Again. That result seeds FSRS state, so the next review is scheduled from it. Activities from a skipped session are not saved by default.
- **Repeats:** A video session for activities already in the bank (same video, type, and generated prompt, so edits keep the match) counts as a review of those activities. New activities from a video already in the bank join the topic most of its activities are in, so manual moves stick.
- **Scheduler:** `ts-fsrs` with default weights and a user-configurable desired retention (80% to 95%, default 90%). Same-day learning steps are off, because reviews happen on a daily scale: a first incorrect answer comes back the next day, a correct one a few days later. Fuzz is off, so activities from one video stay due together. Review logs are kept so parameters can be optimized later.
- **Deletion:** Deleting an activity removes it and its review logs, and the video record once no activities remain. Every knowledge bank change can be undone from the toast. Suspending keeps the activity but removes it from reviews. A deleted activity returns if the same video session is answered again.

## Topics

- The generation prompt receives existing topic names and must reuse one when it fits, or propose a new one.
- Topics support one level of nesting (for example `Biology > Genetics`), which maps to Anki subdecks (`Biology::Genetics`). Topic names are unique, ignoring case, and cannot contain `>`.
- A suggested name is matched against current names first, then former names, and accepts either `Subtopic` or `Parent > Subtopic`. An unknown name creates a topic (and a missing parent).
- Users can create, rename, nest, merge, and delete topics, and move activities between them. AI suggestions never override manual changes: renamed and merged topics keep their former names as aliases, and a video's new activities follow its existing ones.

## Anki export

- **`.apkg`:** One deck per topic, nested topics as subdecks. Recall, apply it, and true or false become Basic notes (prompt on the front; answer and explanation on the back). Flashcards become "Basic (and reversed card)" notes. Fill in the blank becomes a Cloze note. Multiple choice lists its options on the front. Put in order shows the items shuffled on the front and the correct order on the back. Every note has a Source field (video title and timestamped link) and tags for the topic and video ID. Exported activities arrive as new cards in Anki; FSRS state is not transferred.
- **TSV:** Plain text import for users who prefer it or if `.apkg` generation fails.
- **Library:** Candidates are `genanki-js` and `apkg-browser-builder`. Both depend on `sql.js` (SQLite in WebAssembly). The WASM file must be bundled with the extension because Manifest V3 forbids remotely hosted code. Choose during Phase 6 after a spike.

## Cross-browser strategy

- WXT builds separate outputs per browser from one codebase and handles manifest differences (service worker in Chromium, background script in Firefox).
- Use the `browser` namespace through WXT; avoid Chrome-only APIs.
- Chromium build covers Chrome, Edge, Opera, and Brave.
- Firefox build targets Manifest V3 (minimum Firefox 140, or 142 on Android) and is submitted to addons.mozilla.org.
- Safari (later): WXT output converted with `xcrun safari-web-extension-converter`. Requires macOS, Xcode, and an Apple Developer account.

## Permissions

| Permission                    | Reason                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripting`                   | After an install or update, injects the current content scripts into YouTube tabs that were already open, so they keep working without a reload |
| `storage`, `unlimitedStorage` | Settings and knowledge bank                                                                                                                     |
| `alarms`                      | Due-count badge refresh and the daily reminder check                                                                                            |
| Optional: `notifications`     | Daily reminder. Requested when the user turns it on, so installs and updates show no permission warning                                         |
| Host: `*://*.youtube.com/*`   | Content script and transcript fetch                                                                                                             |
| Optional host: `*://*/*`      | Requested per provider origin when the user saves settings, never at install                                                                    |

## Security

- API keys are stored unencrypted in `browser.storage.local`. This is standard for user-key extensions; the settings page states it plainly.
- AI calls are made from the background, never from the YouTube page context, so page scripts cannot read the key.
- Firefox requires a data collection declaration. The manifest declares `websiteContent` because transcripts are sent to the AI provider the user configures.
- Generated text is rendered as plain text, never as HTML, to prevent injection from transcripts or model output.

## Testing

- **Unit (Vitest):** transcript parsing (with saved fixtures), chunking, Zod validation of model output, the knowledge bank and FSRS intervals on simulated dates, reminders, the activity runner hook, topic matching, every knowledge management action with its undo and its effect on the review queue, browsing and search, export file contents, backup round trip, Dexie migrations.
- **Extension APIs:** WXT's fake browser for storage and messaging in unit tests.
- **Smoke test (Playwright, `pnpm test:smoke`):** Loads the Chromium build on live YouTube videos and checks video details, step order, request capture, in-app navigation, and panel cleanup. For the activities, it seeds one of each type, completes them with the keyboard (including a fill-in-the-blank typo and a wrong multiple-choice answer), confirms YouTube shortcuts do not fire, and checks the dialog is on top in default, theater, and fullscreen views with YouTube's dark theme. It also checks the button's states (Learn, Learn (N), Learn failed) and that a click opens the activities. Then it checks the saved activities, makes them due, and checks the badge, the popup, and a keyboard review of every type in the dashboard. Finally it runs every knowledge bank action in the dashboard (search, edit, suspend, delete and undo, create, nest, rename, move, merge, delete a video, delete a topic) and checks the due count and badge after each. Automated browsers cannot play far into a video, so the test sets the position and dispatches the playback event.
- **Manual:** Successful transcript retrieval and live activity generation, in Edge.
- **Firefox:** `web-ext lint` in CI plus a manual test checklist per release.

## Risks

| Risk                                                   | Mitigation                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| YouTube changes transcript endpoints or page structure | Isolated parser module, multiple fallbacks, fixture tests, fast patch releases                             |
| YouTube extends attestation to more requests           | Rely on intercepting first-party requests rather than building requests; panel DOM scraping as last resort |
| Store review rejects use of "YouTube" in the name      | Pick a final name without the trademark before submission                                                  |
| Poor activity quality                                  | Prompt iteration with a fixed evaluation set of transcripts; users can edit or delete activities           |
| API cost surprises users                               | Show estimated tokens per video in settings; cache activities per video                                    |
| Videos without captions                                | Clear "no transcript" state; no silent failure                                                             |
