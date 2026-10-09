import ReactDOM from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { CachedActivities } from '@/lib/db';
import {
  isGetTranscriptMessage,
  isOpenAskMessage,
  isOpenQuizMessage,
  isQuizStatusMessage,
  isVideoInfoMessage,
  type AskQuestionMessage,
  type AskQuestionResponse,
  type GenerateQuizMessage,
  type GenerateQuizResponse,
  type GetTranscriptMessage,
  type GetTranscriptResponse,
  type RecordResultMessage,
  type RecordResultResponse,
  type VideoInfoResponse,
  type VideoSummary,
} from '@/lib/messages';
import { channelRule, checkEligibility, promptSettingsItem } from '@/lib/prompt-settings';
import { toFixture } from '@/lib/transcript/sanitize';
import {
  Store,
  WatchSession,
  type OverlayState,
  type SessionStatus,
  type WatchDeps,
} from '@/lib/watch/session';
import { videoIdFromUrl, type VideoInfo } from '@/lib/youtube/player-response';
import { Overlay, type OverlayActions } from './Overlay';
import { AskButton, LearnButton } from './LearnButton';
import { isAdShowing, loadTranscript, loadVideoInfo, mainVideo, moviePlayer } from './video';
import '@/components/activities/activities.css';
import './overlay.css';
import './learn-button.css';

/** Events that must not reach YouTube's player, which uses keys and clicks as shortcuts. */
const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'wheel',
  'contextmenu',
  'touchstart',
];

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const overlay = new Store<OverlayState>({ view: 'hidden' });
    const status = new Store<SessionStatus | null>(null);
    let session: WatchSession | null = null;

    const deps: WatchDeps = {
      loadVideo: loadVideoInfo,
      loadPrefs: () => promptSettingsItem.getValue(),
      getCachedQuiz: (videoId) =>
        browser.runtime.sendMessage({
          type: 'quiz:get-cached',
          videoId,
        }) as Promise<CachedActivities | null>,
      loadTranscript: async (video) => {
        const { transcript, attempts } = await loadTranscript(video);
        if (!transcript) console.warn('[YouTube Learn] Transcript steps:', attempts);
        return transcript?.segments ?? null;
      },
      generateQuiz: (video, segments) => {
        const message: GenerateQuizMessage = {
          type: 'quiz:generate',
          video: {
            videoId: video.videoId,
            title: video.title,
            channelName: video.channelName,
            durationSec: video.durationSec,
          },
          segments,
        };
        return browser.runtime.sendMessage(message) as Promise<GenerateQuizResponse>;
      },
      askQuestion: (video, segments, turns) => {
        const message: AskQuestionMessage = {
          type: 'video:ask',
          video: {
            videoId: video.videoId,
            title: video.title,
            channelName: video.channelName,
            durationSec: video.durationSec,
          },
          segments,
          turns,
        };
        return browser.runtime.sendMessage(message) as Promise<AskQuestionResponse>;
      },
      currentSec: () => mainVideo()?.currentTime ?? 0,

      pauseVideo: () => mainVideo()?.pause(),
      onStatus: (value) => status.set(value),
      log: (message) => console.warn('[YouTube Learn]', message),
    };

    const syncSession = () => {
      const videoId = videoIdFromUrl(location.href);
      if (session?.videoId === videoId) return;
      session?.dispose();
      status.set(null);
      session = videoId ? new WatchSession(videoId, deps, overlay) : null;
      void session?.start();
    };
    ctx.addEventListener(window, 'wxt:locationchange', syncSession);
    syncSession();

    // Media events do not bubble, but the capture phase on document sees them.
    const isMainVideo = (target: EventTarget | null): target is HTMLVideoElement =>
      target instanceof HTMLVideoElement && target === mainVideo() && !isAdShowing();
    document.addEventListener(
      'timeupdate',
      (event) => {
        if (isMainVideo(event.target)) session?.onProgress(event.target.currentTime);
      },
      { capture: true, signal: ctx.signal },
    );

    const actions: OverlayActions = {
      close: () => {
        session?.close();
        moviePlayer()?.focus();
      },
      openSettings: () => void browser.runtime.sendMessage({ type: 'options:open' }),
      seekAndPlay: (seconds) => {
        const video = mainVideo();
        if (!video) return;
        video.currentTime = seconds;
        void video.play();
      },
      resume: () => void mainVideo()?.play(),
      ask: (question) => session?.ask(question) ?? Promise.resolve(false),
      record: (result) => {
        const message: RecordResultMessage = { type: 'activity:record', result };
        void (browser.runtime.sendMessage(message) as Promise<RecordResultResponse>).then(
          (response) => {
            if (!response?.ok) console.warn('[YouTube Learn] Result not saved:', response?.error);
          },
          (error: unknown) => console.warn('[YouTube Learn] Result not saved:', error),
        );
      },
    };

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isQuizStatusMessage(message)) {
        try {
          sendResponse(session?.getStatus() ?? null);
        } catch (error) {
          sendResponse({ state: 'failed', code: 'unknown', message: String(error) });
        }
        return;
      }
      if (isOpenQuizMessage(message) || isOpenAskMessage(message)) {
        if (!session) {
          sendResponse({ ok: false, error: 'Open a YouTube video page first.' });
          return;
        }
        if (isOpenAskMessage(message)) session.openAsk();
        else void session.openNow();
        sendResponse({ ok: true });
        return;
      }
      const handler = isVideoInfoMessage(message)
        ? handleVideoInfo
        : isGetTranscriptMessage(message)
          ? () => handleGetTranscript(message)
          : null;
      if (!handler) return;
      handler().then(sendResponse, (error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      return true;
    });

    // Mounted independently so a failure in one UI never hides the other.
    await Promise.all([
      mountUi(ctx, 'ytl-quiz-overlay', '#movie_player', 'last', () => (
        <Overlay store={overlay} actions={actions} />
      )),
      mountUi(ctx, 'ytl-learn-button', '#movie_player .ytp-right-controls', 'first', () => (
        <>
          <LearnButton status={status} onOpen={() => void session?.openNow()} />
          <AskButton status={status} onOpen={() => session?.openAsk()} />
        </>
      )),
    ]);
  },
});

async function mountUi(
  ctx: ContentScriptContext,
  name: string,
  anchor: string,
  append: 'first' | 'last',
  render: () => React.ReactNode,
): Promise<void> {
  try {
    const ui = await createShadowRootUi(ctx, {
      name,
      position: 'inline',
      anchor,
      append,
      isolateEvents: ISOLATED_EVENTS,
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(render());
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.autoMount();
  } catch (error) {
    console.error('[YouTube Learn] Could not show', name, error);
  }
}

function summarize(video: VideoInfo): VideoSummary {
  return {
    ...video,
    captionTracks: video.captionTracks.map(({ languageCode, name, isAutoGenerated }) => ({
      languageCode,
      name,
      isAutoGenerated,
    })),
  };
}

async function currentVideo(): Promise<VideoInfo> {
  const videoId = videoIdFromUrl(location.href);
  if (!videoId) throw new Error('Open a YouTube video page first.');
  return loadVideoInfo(videoId);
}

async function handleVideoInfo(): Promise<VideoInfoResponse> {
  const video = await currentVideo();
  const settings = await promptSettingsItem.getValue();
  return {
    ok: true,
    video: summarize(video),
    eligibility: checkEligibility(video, settings),
    rule: channelRule(settings, video.channelId),
  };
}

async function handleGetTranscript(message: GetTranscriptMessage): Promise<GetTranscriptResponse> {
  const video = await currentVideo();
  const result = await loadTranscript(video);
  return {
    ok: true,
    video: summarize(video),
    transcript: result.transcript,
    attempts: result.attempts,
    fixture:
      message.includeFixture && result.raw
        ? toFixture(result.raw, {
            title: video.title,
            channelName: video.channelName,
            durationSec: video.durationSec,
          })
        : undefined,
  };
}
