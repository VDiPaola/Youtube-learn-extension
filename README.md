# YouTube Learn

A browser extension that turns educational YouTube videos into learning activities and brings them back for review before you forget them.

An AI model reads the video transcript and writes questions, flashcards, fill-in-the-blank items, and other activities. Your answers go into a knowledge bank, which schedules reviews at growing intervals.

## Install

1. Download the latest zip from [Releases](https://github.com/VDiPaola/Youtube-learn-extension/releases): `chrome` for Chrome, Edge, Opera, and Brave, or `firefox` for Firefox.
2. Chrome, Edge, Opera, Brave: unzip it, open `chrome://extensions`, turn on **Developer mode**, select **Load unpacked**, and choose the unzipped folder.
3. Firefox: open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose the zip. Firefox removes it when the browser closes.

## Set up

1. Select the extension icon, then **Settings**.
2. Choose a provider (Anthropic, OpenAI, Gemini, OpenRouter, Ollama, or a custom server) and paste your API key.
3. Select **Save and test connection**, and accept the browser prompt.

## Use

- **Learn from a video:** On Education videos, a **Learn** button appears in the player controls. Activities are prepared halfway through the video. Click the button whenever you are ready. For any other video, select **Learn from this video** in the extension popup.
- **Review:** The toolbar icon shows how many activities are due. Select **Start review** in the popup.
- **Manage:** Select **Knowledge bank** in the popup to browse topics, search, and edit, suspend, move, or delete activities. Every change can be undone.

Keys: Enter or Space continues, 1 to 4 picks an option, 1 or 2 marks your answer correct or incorrect, Esc closes.

Settings also turn activity types off, set the review retention, and enable a daily reminder.

## Privacy

Everything stays in your browser. Transcripts go only to the AI provider you choose. No accounts, no analytics.
