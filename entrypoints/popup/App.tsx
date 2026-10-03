import { useCallback, useEffect, useState } from 'react';
import type { OpenQuizMessage, VideoInfoMessage, VideoInfoResponse } from '@/lib/messages';
import { promptSettingsItem, withChannelRule, type ChannelRule } from '@/lib/prompt-settings';
import { DebugTools } from './DebugTools';
import { QuizStatus } from './QuizStatus';
import { ReloadTab } from './ReloadTab';

type VideoState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'disconnected'; tabId: number }
  | { status: 'ready'; tabId: number; info: Extract<VideoInfoResponse, { ok: true }> };

const NOT_ON_VIDEO = 'Open a YouTube video to learn from it.';

const RULE_LABELS: Record<ChannelRule, string> = {
  auto: 'Automatic (Education videos)',
  always: 'Always show the Learn button',
  never: 'Never show the Learn button',
};

export default function App() {
  const [video, setVideo] = useState<VideoState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return setVideo({ status: 'unavailable', message: NOT_ON_VIDEO });
    const message: VideoInfoMessage = { type: 'video:info' };
    const info: VideoInfoResponse | null = await browser.tabs
      .sendMessage(tab.id, message)
      .catch(() => null);
    // The extension can read YouTube tab URLs, so a silent YouTube tab is a disconnected one.
    if (!info) {
      const onYouTube = (tab.url ?? '').startsWith('https://www.youtube.com/');
      return setVideo(
        onYouTube
          ? { status: 'disconnected', tabId: tab.id }
          : { status: 'unavailable', message: NOT_ON_VIDEO },
      );
    }
    setVideo(
      info.ok
        ? { status: 'ready', tabId: tab.id, info }
        : { status: 'unavailable', message: info.error },
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main>
      <header>
        <h1>YouTube Learn</h1>
        <button
          type="button"
          className="secondary"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </header>

      {video.status === 'loading' && <p className="muted">Checking this tab...</p>}
      {video.status === 'unavailable' && <p className="muted">{video.message}</p>}
      {video.status === 'disconnected' && <ReloadTab tabId={video.tabId} />}
      {video.status === 'ready' && <VideoPanel {...video} onChange={refresh} />}

      <details className="dev-tools">
        <summary>Developer tools</summary>
        <DebugTools />
      </details>
    </main>
  );
}

function VideoPanel({
  tabId,
  info,
  onChange,
}: {
  tabId: number;
  info: Extract<VideoInfoResponse, { ok: true }>;
  onChange: () => Promise<void>;
}) {
  const { video, rule } = info;
  const [openError, setOpenError] = useState('');

  async function openQuiz() {
    const message: OpenQuizMessage = { type: 'quiz:open' };
    const response: { ok: boolean; error?: string } | null = await browser.tabs
      .sendMessage(tabId, message)
      .catch(() => null);
    if (response?.ok) window.close();
    else setOpenError(response?.error ?? 'The YouTube tab did not respond.');
  }

  async function changeRule(next: ChannelRule) {
    const settings = await promptSettingsItem.getValue();
    await promptSettingsItem.setValue(
      withChannelRule(settings, { id: video.channelId, name: video.channelName }, next),
    );
    await onChange();
  }

  return (
    <section aria-labelledby="video-title">
      <h2 id="video-title">{video.title}</h2>
      <p className="muted">{video.channelName}</p>
      <QuizStatus tabId={tabId} />
      <div className="actions">
        <button type="button" onClick={openQuiz}>
          Learn from this video
        </button>
      </div>
      {openError && <ReloadTab tabId={tabId} message={openError} />}
      <label className="field">
        <span>Learn button for this channel</span>
        <select value={rule} onChange={(e) => void changeRule(e.target.value as ChannelRule)}>
          {(Object.keys(RULE_LABELS) as ChannelRule[]).map((value) => (
            <option key={value} value={value}>
              {RULE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
