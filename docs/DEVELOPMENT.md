# Development

Requirements: Node.js 20 or later, pnpm.

```sh
pnpm install
pnpm dev            # Chrome with live reload
pnpm dev:firefox    # Firefox with live reload
```

## Load a build manually

1. Run `pnpm build` (Chromium) or `pnpm build:firefox`.
2. Chrome, Edge, Opera, Brave: open `chrome://extensions`, turn on Developer mode, select **Load unpacked**, and choose `.output/chrome-mv3`.
3. Firefox: open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `.output/firefox-mv3/manifest.json`.

## Commands

| Command                        | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `pnpm test`                    | Unit tests (Vitest)                                           |
| `pnpm test:smoke`              | Live YouTube smoke test in Chromium (run `pnpm build` first)  |
| `pnpm eval:activities`         | Command-line activity evaluation for automation (costs money) |
| `pnpm compile`                 | Type check                                                    |
| `pnpm format`                  | Format with Prettier                                          |
| `pnpm lint:firefox`            | `web-ext lint` on the Firefox build                           |
| `pnpm zip`, `pnpm zip:firefox` | Store-ready archives                                          |

YouTube rejects attestation in automated browsers, so the smoke test cannot retrieve a transcript. It verifies everything up to that point. Check successful retrieval manually with the steps below.

## Developer tools

The popup's collapsed **Developer tools** section shows the transcript and can regenerate a video's activities. Activities are cached per video.

To check a transcript:

1. Open a YouTube video. Reload the tab if it was open before the extension loaded.
2. Open the popup, expand **Developer tools**, and select **Get transcript**.
3. The popup lists each retrieval step and its outcome, then the transcript.
4. Select **Download fixture** to save a sanitized copy of the raw response. Move it to `tests/fixtures/transcripts/` to add it to the parser tests.

To check activity quality, see [Evaluation](EVALUATION.md).

## Releases

Each push to `main` runs the type check, unit tests, both store archives, and `web-ext lint` on GitHub Actions (`.github/workflows/release.yml`). If every step passes, a GitHub release is created with three files:

- `youtube-learn-<version>-chrome.zip`: Chrome, Edge, Opera, Brave
- `youtube-learn-<version>-firefox.zip`: Firefox
- `youtube-learn-<version>-sources.zip`: source code, required by Firefox Add-ons review

Releases are tagged `v<version>-build.<run number>`, for example `v0.0.0-build.12`. The version comes from `package.json` and is also the extension's version, so raise it before a store submission. The smoke test needs live YouTube and does not run in CI. A release can also be started by hand from the repository's **Actions** tab (**Release**, then **Run workflow**).
