import { useState } from 'react';
import type { GenerateQuizMessage, GenerateQuizResponse, VideoSummary } from '@/lib/messages';
import { ActivityList } from '@/components/ActivityList';
import type { QuizErrorCode } from '@/lib/learn/errors';
import type { Transcript } from '@/lib/transcript/types';

type State =
  { status: 'idle' } | { status: 'loading' } | { status: 'done'; response: GenerateQuizResponse };

const SETTINGS_ERRORS: QuizErrorCode[] = ['not-configured', 'permission', 'auth'];

export function QuizSection({
  video,
  transcript,
}: {
  video: VideoSummary;
  transcript: Transcript;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function generate(force: boolean) {
    setState({ status: 'loading' });
    const message: GenerateQuizMessage = {
      type: 'quiz:generate',
      video: {
        videoId: video.videoId,
        title: video.title,
        channelName: video.channelName,
        durationSec: video.durationSec,
      },
      segments: transcript.segments,
      force,
    };
    const response: GenerateQuizResponse = await browser.runtime.sendMessage(message);
    setState({ status: 'done', response });
  }

  const response = state.status === 'done' ? state.response : null;

  return (
    <section aria-labelledby="quiz-heading">
      <h2 id="quiz-heading">Learning activities</h2>
      <div className="actions">
        <button type="button" onClick={() => generate(false)} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Generating...' : 'Generate activities'}
        </button>
        {response?.ok && (
          <button type="button" className="secondary" onClick={() => generate(true)}>
            Regenerate
          </button>
        )}
      </div>

      <div aria-live="polite">
        {response && !response.ok && (
          <p className="error">
            {response.error}{' '}
            {SETTINGS_ERRORS.includes(response.code) && (
              <button
                type="button"
                className="secondary"
                onClick={() => browser.runtime.openOptionsPage()}
              >
                Open settings
              </button>
            )}
          </p>
        )}
        {response?.ok && (
          <>
            <p className="muted">
              {response.quiz.set.topic} · {response.quiz.set.activities.length} activities ·{' '}
              {response.quiz.model}
              {response.cached && ' · cached'}
            </p>
            {response.quiz.set.activities.length === 0 ? (
              <p>The video has nothing worth learning.</p>
            ) : (
              <ActivityList activities={response.quiz.set.activities} />
            )}
          </>
        )}
      </div>
    </section>
  );
}
