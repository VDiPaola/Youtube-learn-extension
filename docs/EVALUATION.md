# Activity evaluation

The evaluation generates learning activities for each saved test transcript and checks the result. Use it to judge activity quality and to compare prompt or model changes.

Each video is one request to your AI provider, so each run costs whatever your provider charges. It never runs as part of `pnpm test`.

## Run

1. Run `pnpm build` and reload the extension.
2. Open **Settings** and select **Activity evaluation** at the bottom of the page.
3. Select **Run evaluation**.

The page uses the provider, model, and key already saved in Settings. Nothing else to configure.

The page is included in local builds only. Store archives from `pnpm zip` leave it out.

## Inputs

Every fixture in `tests/fixtures/transcripts/` is evaluated. Add fixtures with the popup's **Download fixture** button, then rebuild. Fixtures saved since Phase 2 include the video title, channel, and duration, which improve the prompt.

Aim for at least 5 fixtures covering different subjects, lengths, and caption types.

## Results

Each video shows:

- **Automated checks:** activity count, topic length, at least two activity types, timestamps inside the video, no references to "the video" or "the speaker", answer length, and explanations that repeat the answer.
- **Activities:** type, prompt, answer details, and a link to the source timestamp.

Review each activity for: accurate to the video, worth remembering, understandable without the video, a fitting activity type, and wrong options that are plausible but clearly wrong.

**Download report** saves all results as one Markdown file.

## Comparing changes

1. Run the evaluation and download the report.
2. Make the prompt or model change, rebuild, and reload the extension.
3. Run it again and compare the two reports activity by activity.

## Automation

`pnpm eval:activities` runs the same evaluation from the command line, for scripts and CI. It reads the provider from environment variables (`YTL_EVAL_PROVIDER`, `YTL_EVAL_API_KEY`, `YTL_EVAL_MODEL`, `YTL_EVAL_BASE_URL`) and writes reports to `eval/output/`. Use the page for manual runs.
