# YouTube Learn (working title)

A browser extension that turns educational YouTube videos into active learning activities, then keeps the material in long-term memory with spaced repetition.

## How it works

1. Watch an educational video on YouTube.
2. The extension reads the video transcript and an AI model writes learning activities: recall questions, flashcards, fill in the blank, multiple choice, true or false, put in order, and apply it.
3. A **Learn** button in the player controls opens the activities whenever you want.
4. Completed activities go into a local knowledge bank, grouped by topic (Phase 4).
5. The extension schedules reviews at expanding intervals (FSRS algorithm) and shows a badge when activities are due.
6. Activities can be edited, suspended, or deleted at any time. Topics can be exported to Anki.

## Key decisions

| Area          | Decision                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------- |
| Browsers (v1) | Chrome, Edge, Firefox, Opera, Brave. Safari in a later phase.                                 |
| Framework     | [WXT](https://wxt.dev) + TypeScript + React                                                   |
| AI            | User supplies an API key (Anthropic, OpenAI, Gemini, OpenRouter) or runs a local Ollama model |
| Storage       | Local only (IndexedDB via Dexie). JSON backup and import.                                     |
| Scheduling    | FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)                       |
| Activities    | Seven types; the AI picks the best fit per idea, and settings can turn types off.             |
| Anki export   | `.apkg` (one deck per topic) and TSV fallback                                                 |

## Privacy

- All activities and review history stay in the browser.
- Transcripts are sent only to the AI provider the user configures.
- No accounts, analytics, or servers operated by this project.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): components, data model, and technical decisions
- [Roadmap](docs/ROADMAP.md): build phases and acceptance criteria
- [Evaluation](docs/EVALUATION.md): checking activity quality with real transcripts

## Status

Phases 1 to 3 are implemented: transcripts, activity generation, and the Learn button on the YouTube page. Results are not saved yet; that comes with the knowledge bank in Phase 4. See the [Roadmap](docs/ROADMAP.md) for progress.

## Development

Requirements: Node.js 20 or later, pnpm.

```sh
pnpm install
pnpm dev            # Chrome with live reload
pnpm dev:firefox    # Firefox with live reload
```

### Load a build manually

1. Run `pnpm build` (Chromium) or `pnpm build:firefox`.
2. Chrome, Edge, Opera, Brave: open `chrome://extensions`, turn on Developer mode, select **Load unpacked**, and choose `.output/chrome-mv3`.
3. Firefox: open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `.output/firefox-mv3/manifest.json`.

### Check a transcript

1. Open a YouTube video. Reload the tab if it was open before the extension loaded.
2. Open the extension popup, expand **Developer tools**, and select **Get transcript**.
3. The popup lists each retrieval step and its outcome, then the transcript.
4. Select **Download fixture** to save a sanitized copy of the raw response. Move it to `tests/fixtures/transcripts/` to add it to the parser tests.

### Learn from a video

1. Open the popup and select **Settings**. Choose a provider, paste an API key, and select **Save and test connection**. Accept the browser prompt that grants access to the provider.
2. Watch an Education video. A **Learn** button appears in the player controls, next to autoplay. Halfway through, activities are prepared in the background and the button shows how many are ready. Click it whenever you want; clicking earlier generates them on the spot.
3. For any other video, open the popup and select **Learn from this video**. The popup also sets a channel to always or never show the button, and shows the quiz status.
4. In a session: Enter or Space continues, 1 to 4 picks an option, 1 or 2 marks your answer correct or incorrect, Esc closes. Settings can turn activity types off.

Activities are cached per video. The popup's **Developer tools** section shows the transcript and can regenerate activities.

### Commands

| Command                        | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `pnpm test`                    | Unit tests (Vitest)                                           |
| `pnpm test:smoke`              | Live YouTube smoke test in Chromium (run `pnpm build` first)  |
| `pnpm eval:activities`         | Command-line activity evaluation for automation (costs money) |
| `pnpm compile`                 | Type check                                                    |
| `pnpm format`                  | Format with Prettier                                          |
| `pnpm lint:firefox`            | `web-ext lint` on the Firefox build                           |
| `pnpm zip`, `pnpm zip:firefox` | Store-ready archives                                          |

YouTube rejects attestation in automated browsers, so the smoke test cannot retrieve a transcript. It verifies everything up to that point. Check successful retrieval manually with the steps above.
