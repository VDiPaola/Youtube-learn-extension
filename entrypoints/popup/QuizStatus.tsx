import { useEffect, useState } from 'react';
import type { OpenQuizMessage, QuizStatusMessage } from '@/lib/messages';
import type { QuizErrorCode } from '@/lib/learn/errors';
import { formatTimestamp } from '@/lib/transcript/format';
import type { PrepareStep, SessionStatus } from '@/lib/watch/session';
import { ReloadTab } from './ReloadTab';

const POLL_INTERVAL_MS = 1_000;
const SETTINGS_ERRORS: QuizErrorCode[] = ['not-configured', 'permission', 'auth'];

const STEP_LABELS: Record<PrepareStep, string> = {
  cache: 'Checking for saved activities...',
  transcript: 'Reading the transcript...',
  generating: 'Writing learning activities. This can take up to a minute...',
};

const at = (seconds: number) => formatTimestamp(seconds * 1000);

/** Live status of the learning activities for the video in the current tab. */
export function QuizStatus({ tabId }: { tabId: number }) {
  const [status, setStatus] = useState<SessionStatus | 'no-answer' | null>(null);

  useEffect(() => {
    const message: QuizStatusMessage = { type: 'quiz:status' };
    const poll = () =>
      browser.tabs
        .sendMessage(tabId, message)
        .then((value: SessionStatus | null) => setStatus(value ?? 'no-answer'))
        .catch(() => setStatus('no-answer'));
    void poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [tabId]);

  async function retry() {
    const message: OpenQuizMessage = { type: 'quiz:open' };
    await browser.tabs.sendMessage(tabId, message);
    window.close();
  }

  if (!status) return null;
  if (status === 'no-answer') {
    return (
      <ReloadTab
        tabId={tabId}
        message="Status unavailable: the YouTube tab is not tracking this video."
      />
    );
  }

  return (
    <div className="status" role="status">
      <strong>Status: </strong>
      {status.state === 'loading' && 'Checking this video...'}
      {status.state === 'not-eligible' && <>No Learn button on this video. {status.reason}</>}
      {status.state === 'waiting' && (
        <>
          Prepared automatically at {at(status.prepareAtSec)}. The Learn button on the player works
          now.
        </>
      )}
      {status.state === 'preparing' && STEP_LABELS[status.step]}
      {status.state === 'ready' &&
        (status.activityCount === 0
          ? 'The video had nothing worth learning.'
          : `${status.activityCount} activities ready. Click Learn on the player.`)}
      {status.state === 'failed' && (
        <>
          <span className="error">Failed: {status.message}</span>
          <span className="actions">
            <button type="button" onClick={retry}>
              Try again
            </button>
            {SETTINGS_ERRORS.includes(status.code) && (
              <button
                type="button"
                className="secondary"
                onClick={() => browser.runtime.openOptionsPage()}
              >
                Open settings
              </button>
            )}
          </span>
        </>
      )}
    </div>
  );
}
