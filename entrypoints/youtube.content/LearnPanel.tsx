import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import {
  checkCloze,
  checkOrder,
  checkTrueFalse,
  moveItem,
  multipleChoiceOptions,
  shuffledOrder,
} from '@/lib/learn/check-answer';
import {
  currentActivity,
  initialRunnerState,
  runnerReducer,
  type RunnerAction,
  type RunnerState,
} from '@/lib/learn/runner';
import { ACTIVITY_LABELS, BLANK, type Activity } from '@/lib/learn/schema';
import { formatTimestamp } from '@/lib/transcript/format';
import { Dialog, type OverlayActions } from './Overlay';

type Dispatch = React.Dispatch<RunnerAction>;
type PrimaryRef = React.RefObject<HTMLElement | null>;
const asButtonRef = (ref: PrimaryRef) => ref as React.RefObject<HTMLButtonElement>;

const SELF_GRADES = [
  { correct: true, label: 'Correct' },
  { correct: false, label: 'Incorrect' },
] as const;

const digitOf = (event: KeyboardEvent) => {
  const digit = Number(event.key);
  return Number.isInteger(digit) && digit >= 1 && digit <= 9 ? digit : null;
};

export function LearnPanel({
  topic,
  activities,
  actions,
}: {
  topic: string;
  activities: readonly Activity[];
  actions: OverlayActions;
}) {
  const [state, dispatch] = useReducer(runnerReducer, activities, initialRunnerState);
  const primary = useRef<HTMLElement>(null);
  const activity = currentActivity(state);

  // Keep focus on the main control of each step so Enter and Space move the session forward.
  useEffect(() => {
    primary.current?.focus();
  }, [state.phase, state.index, state.answered, state.correct]);

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

interface ActivityProps {
  activity: Activity;
  state: RunnerState;
  dispatch: Dispatch;
  primary: PrimaryRef;
}

function ActivityView(props: ActivityProps) {
  switch (props.activity.type) {
    case 'recall':
    case 'flashcard':
    case 'apply':
      return <SelfGradedActivity {...props} />;
    case 'cloze':
      return <ClozeActivity {...props} />;
    case 'multiple_choice':
      return <MultipleChoiceActivity {...props} />;
    case 'true_false':
      return <TrueFalseActivity {...props} />;
    case 'ordering':
      return <OrderingActivity {...props} />;
  }
}

function SelfGradedActivity({ activity, state, dispatch, primary }: ActivityProps) {
  const flashcard = activity.type === 'flashcard';
  const onKeyDown = (event: KeyboardEvent) => {
    const digit = digitOf(event);
    const grade = digit === null ? undefined : SELF_GRADES[digit - 1];
    if (state.answered && grade) {
      event.preventDefault();
      dispatch({ type: 'grade', correct: grade.correct });
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <p className={flashcard ? 'ytl-card-front' : 'ytl-question'}>{activity.prompt}</p>
      {!state.answered ? (
        <div className="ytl-actions">
          <button
            ref={asButtonRef(primary)}
            type="button"
            className="ytl-primary"
            onClick={() => dispatch({ type: 'reveal' })}
          >
            {flashcard ? 'Flip card' : 'Show answer'}
          </button>
        </div>
      ) : (
        <>
          <div className="ytl-answer" role="status">
            <p>{activity.answer}</p>
            <Explanation text={activity.explanation} />
          </div>
          <p className="ytl-muted ytl-small" id="ytl-grade-label">
            Did you get it right?
          </p>
          <div className="ytl-grades" role="group" aria-labelledby="ytl-grade-label">
            {SELF_GRADES.map(({ correct, label }, i) => (
              <button
                key={label}
                ref={correct ? asButtonRef(primary) : undefined}
                type="button"
                className={`ytl-grade ${correct ? 'ytl-grade-correct' : 'ytl-grade-wrong'}`}
                aria-keyshortcuts={String(i + 1)}
                onClick={() => dispatch({ type: 'grade', correct })}
              >
                <span className="ytl-key">{i + 1}</span> {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ClozeActivity({ activity, state, dispatch, primary }: ActivityProps) {
  const [input, setInput] = useState('');
  const [before, after] = activity.prompt.split(BLANK);

  return (
    <>
      <form
        className="ytl-cloze"
        onSubmit={(event) => {
          event.preventDefault();
          if (!state.answered && input.trim()) {
            dispatch({ type: 'submit', correct: checkCloze(input, activity) });
          }
        }}
      >
        <p className="ytl-question">
          {before}
          <input
            ref={state.answered ? undefined : (primary as React.RefObject<HTMLInputElement>)}
            className="ytl-blank"
            aria-label="Missing word"
            autoComplete="off"
            spellCheck={false}
            value={input}
            readOnly={state.answered}
            onChange={(event) => setInput(event.target.value)}
          />
          {after}
        </p>
        {!state.answered && (
          <div className="ytl-actions">
            <button type="submit" className="ytl-primary" disabled={!input.trim()}>
              Check
            </button>
          </div>
        )}
      </form>
      {state.answered && (
        <Feedback
          state={state}
          dispatch={dispatch}
          primary={primary}
          correction={`The answer is: ${activity.answer}`}
          explanation={activity.explanation}
          allowOverride
        />
      )}
    </>
  );
}

function MultipleChoiceActivity({ activity, state, dispatch, primary }: ActivityProps) {
  const choices = useMemo(() => multipleChoiceOptions(activity), [activity]);
  const [selected, setSelected] = useState<number | null>(null);
  const choose = (index: number) => {
    if (state.answered || index >= choices.options.length) return;
    setSelected(index);
    dispatch({ type: 'submit', correct: index === choices.answerIndex });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const digit = digitOf(event);
    if (!state.answered && digit !== null) {
      event.preventDefault();
      choose(digit - 1);
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <p className="ytl-question">{activity.prompt}</p>
      <ol className="ytl-options">
        {choices.options.map((option, i) => (
          <li key={option}>
            <button
              ref={i === 0 && !state.answered ? asButtonRef(primary) : undefined}
              type="button"
              className={`ytl-option ${optionStatus(state.answered, i === choices.answerIndex, i === selected)}`}
              disabled={state.answered}
              aria-keyshortcuts={String(i + 1)}
              onClick={() => choose(i)}
            >
              <span className="ytl-key">{i + 1}</span> {option}
            </button>
          </li>
        ))}
      </ol>
      {state.answered && (
        <Feedback
          state={state}
          dispatch={dispatch}
          primary={primary}
          correction={`The answer is: ${activity.answer}`}
          explanation={activity.explanation}
        />
      )}
    </div>
  );
}

function TrueFalseActivity({ activity, state, dispatch, primary }: ActivityProps) {
  const [selected, setSelected] = useState<boolean | null>(null);
  const choose = (value: boolean) => {
    if (state.answered) return;
    setSelected(value);
    dispatch({ type: 'submit', correct: checkTrueFalse(value, activity) });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (state.answered) return;
    const key = event.key.toLowerCase();
    if (key === '1' || key === 't') choose(true);
    else if (key === '2' || key === 'f') choose(false);
    else return;
    event.preventDefault();
  };
  const truth = activity.answer === 'true';

  return (
    <div onKeyDown={onKeyDown}>
      <p className="ytl-question">{activity.prompt}</p>
      <div className="ytl-options ytl-true-false">
        {[true, false].map((value, i) => (
          <button
            key={String(value)}
            ref={value && !state.answered ? asButtonRef(primary) : undefined}
            type="button"
            className={`ytl-option ${optionStatus(state.answered, value === truth, value === selected)}`}
            disabled={state.answered}
            aria-keyshortcuts={`${i + 1} ${value ? 'T' : 'F'}`}
            onClick={() => choose(value)}
          >
            <span className="ytl-key">{i + 1}</span> {value ? 'True' : 'False'}
          </button>
        ))}
      </div>
      {state.answered && (
        <Feedback
          state={state}
          dispatch={dispatch}
          primary={primary}
          correction={`The statement is ${truth ? 'true' : 'false'}.`}
          explanation={activity.explanation}
        />
      )}
    </div>
  );
}

function OrderingActivity({ activity, state, dispatch, primary }: ActivityProps) {
  const [order, setOrder] = useState(() => shuffledOrder(activity));
  const [announcement, setAnnouncement] = useState('');
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    setOrder(moveItem(order, from, to));
    setAnnouncement(`Moved "${order[from]}" to position ${to + 1}.`);
  };

  return (
    <>
      <p className="ytl-question">{activity.prompt}</p>
      <p className="ytl-muted ytl-small">Use the arrows to put the items in order.</p>
      <ol className="ytl-order">
        {order.map((item, i) => {
          const status = state.answered
            ? activity.options[i] === item
              ? 'ytl-correct'
              : 'ytl-wrong'
            : '';
          return (
            <li key={item} className={status}>
              <div className="ytl-order-row">
                <span className="ytl-order-text">{item}</span>
                {!state.answered && (
                  <span className="ytl-order-buttons">
                    <button
                      type="button"
                      aria-label={`Move "${item}" up`}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move "${item}" down`}
                      disabled={i === order.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="ytl-visually-hidden" role="status">
        {announcement}
      </p>
      {!state.answered ? (
        <div className="ytl-actions">
          <button
            ref={asButtonRef(primary)}
            type="button"
            className="ytl-primary"
            onClick={() => dispatch({ type: 'submit', correct: checkOrder(order, activity) })}
          >
            Check order
          </button>
        </div>
      ) : (
        <Feedback
          state={state}
          dispatch={dispatch}
          primary={primary}
          correction={`Correct order: ${activity.options.map((item, i) => `${i + 1}. ${item}`).join('  ')}`}
          explanation={activity.explanation}
        />
      )}
    </>
  );
}

function Feedback({
  state,
  dispatch,
  primary,
  correction,
  explanation,
  allowOverride = false,
}: {
  state: RunnerState;
  dispatch: Dispatch;
  primary: PrimaryRef;
  correction: string;
  explanation: string;
  allowOverride?: boolean;
}) {
  return (
    <>
      <div className="ytl-feedback" role="status">
        <p className={state.correct ? 'ytl-correct-text' : 'ytl-wrong-text'}>
          {state.correct ? 'Correct.' : 'Not quite.'}
        </p>
        {!state.correct && <p>{correction}</p>}
        <Explanation text={explanation} />
      </div>
      <div className="ytl-actions">
        <button
          ref={asButtonRef(primary)}
          type="button"
          className="ytl-primary"
          onClick={() => dispatch({ type: 'next' })}
        >
          Continue
        </button>
        {allowOverride && !state.correct && (
          <button type="button" onClick={() => dispatch({ type: 'override' })}>
            I was right
          </button>
        )}
      </div>
    </>
  );
}

function Explanation({ text }: { text: string }) {
  if (!text) return null;
  return (
    <details className="ytl-explanation">
      <summary>Explanation</summary>
      <p className="ytl-muted">{text}</p>
    </details>
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

function optionStatus(answered: boolean, isAnswer: boolean, isSelected: boolean): string {
  if (!answered) return '';
  if (isAnswer) return 'ytl-correct';
  return isSelected ? 'ytl-wrong' : '';
}
