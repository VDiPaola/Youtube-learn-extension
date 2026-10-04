import {
  ActivityView,
  asButtonRef,
  useActivityRunner,
  type PrimaryRef,
} from '@/components/activities/ActivityView';
import { currentActivity, type RunnerState } from '@/lib/learn/runner';
import { ACTIVITY_LABELS, BLANK, type Activity } from '@/lib/learn/schema';
import { formatTimestamp } from '@/lib/transcript/format';
import { Dialog, type OverlayActions } from './Overlay';

export function LearnPanel({
  topic,
  activities,
  actions,
  onResult,
}: {
  topic: string;
  activities: readonly Activity[];
  actions: OverlayActions;
  onResult: (activity: Activity, correct: boolean) => void;
}) {
  const { state, dispatch, primary } = useActivityRunner(activities, { onResult });
  const activity = currentActivity(state);

  return (
    <Dialog title={`Learn: ${topic}`} onClose={actions.close}>
      {state.phase === 'start' && (
        <StartView
          activities={activities}
          onStart={() => dispatch({ type: 'start' })}
          primary={primary}
        />
      )}
      {activity && (
        <>
          <p className="ytl-progress">
            {state.index + 1} of {activities.length} · {ACTIVITY_LABELS[activity.type]}
          </p>
          <ActivityView
            key={state.index}
            activity={activity}
            state={state}
            dispatch={dispatch}
            primary={primary}
          />
        </>
      )}
      {state.phase === 'summary' && (
        <SummaryView state={state} actions={actions} primary={primary} />
      )}
    </Dialog>
  );
}

function StartView({
  activities,
  onStart,
  primary,
}: {
  activities: readonly Activity[];
  onStart: () => void;
  primary: PrimaryRef;
}) {
  const counts = new Map<string, number>();
  for (const activity of activities) {
    const label = ACTIVITY_LABELS[activity.type];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return (
    <>
      <p>
        {activities.length} {activities.length === 1 ? 'activity' : 'activities'} from this video.
        Answer from memory before checking.
      </p>
      <ul className="ytl-chips" aria-label="Activity types">
        {[...counts].map(([label, count]) => (
          <li key={label}>
            {label} × {count}
          </li>
        ))}
      </ul>
      <p className="ytl-muted ytl-small">
        Keys: Enter or Space continues, 1 to 4 picks an option, 1 or 2 marks your answer correct or
        incorrect, Esc closes.
      </p>
      <div className="ytl-actions">
        <button ref={asButtonRef(primary)} type="button" className="ytl-primary" onClick={onStart}>
          Start
        </button>
      </div>
    </>
  );
}

function SummaryView({
  state,
  actions,
  primary,
}: {
  state: RunnerState;
  actions: OverlayActions;
  primary: PrimaryRef;
}) {
  const correctCount = state.results.filter((r) => r.correct).length;
  const toReview = state.activities.filter((_, i) => !state.results[i]!.correct);

  return (
    <>
      <p className="ytl-question">Session complete</p>
      <p>
        {correctCount} of {state.results.length} correct.
      </p>
      <p className="ytl-muted ytl-small">
        Saved for spaced review. The toolbar icon shows how many activities are due.
      </p>
      {toReview.length > 0 && (
        <>
          <p>Worth rewatching:</p>
          <ul className="ytl-review">
            {toReview.map((activity, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="ytl-link"
                  onClick={() => {
                    actions.close();
                    actions.seekAndPlay(activity.sourceStartSec);
                  }}
                >
                  {formatTimestamp(activity.sourceStartSec * 1000)}
                </button>{' '}
                {activity.prompt.replace(BLANK, '…')}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="ytl-actions">
        <button
          ref={asButtonRef(primary)}
          type="button"
          className="ytl-primary"
          onClick={() => {
            actions.close();
            actions.resume();
          }}
        >
          Close and resume
        </button>
        <button type="button" onClick={actions.close}>
          Close
        </button>
      </div>
    </>
  );
}
