import { useState, type FormEvent } from 'react';
import { db, type StoredActivity } from '@/lib/db';
import type { TopicRow } from '@/lib/knowledge/browse';
import {
  deleteActivities,
  editActivity,
  moveActivities,
  setSuspended,
} from '@/lib/knowledge/manage';
import { activityFields } from '@/lib/learn/describe';
import { ACTIVITY_LABELS, BLANK, type ActivityType } from '@/lib/learn/schema';
import { formatTimestamp } from '@/lib/transcript/format';
import { onEscape, type RunAction } from './bank-actions';

const PROMPT_LABELS: Record<ActivityType, string> = {
  recall: 'Question',
  flashcard: 'Front',
  cloze: `Sentence, with ${BLANK} for the blank`,
  multiple_choice: 'Question',
  true_false: 'Statement',
  ordering: 'Instruction',
  apply: 'Scenario',
};

const ANSWER_LABELS: Partial<Record<ActivityType, string>> = {
  recall: 'Answer',
  flashcard: 'Back',
  cloze: 'Missing word or phrase',
  multiple_choice: 'Correct answer',
  apply: 'Answer',
};

const OPTION_LABELS: Partial<Record<ActivityType, string>> = {
  cloze: 'Other accepted answers, one per line',
  multiple_choice: 'Wrong options, one per line (two or three)',
  ordering: 'Items in the correct order, one per line',
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

interface ItemProps {
  activity: StoredActivity;
  rows: readonly TopicRow[];
  now: number;
  run: RunAction;
  /** Runs an action and shows a rejection in the toast. */
  act: (message: string, action: () => Promise<unknown>) => void;
}

export function ActivityItem({ activity, rows, now, run, act }: ItemProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'move'>('view');
  const { id, type, videoId, sourceStartSec, suspended } = activity;
  const promptId = `prompt-${id}`;
  const status = suspended
    ? 'Suspended'
    : activity.due <= now
      ? 'Due now'
      : `Due ${dateFormat.format(activity.due)}`;

  if (mode === 'edit') {
    return (
      <li className="activity-item">
        <p className="activity-meta">{ACTIVITY_LABELS[type]}</p>
        <EditForm activity={activity} run={run} onDone={() => setMode('view')} />
      </li>
    );
  }

  return (
    <li className={suspended ? 'activity-item suspended' : 'activity-item'}>
      <p className="activity-meta">
        {ACTIVITY_LABELS[type]} · {status} ·{' '}
        <a
          href={`https://youtu.be/${videoId}?t=${sourceStartSec}`}
          target="_blank"
          rel="noreferrer"
        >
          {formatTimestamp(sourceStartSec * 1000)}
        </a>
      </p>
      <p className="activity-prompt" id={promptId}>
        {activity.prompt}
      </p>
      {activityFields(activity).map((field) => (
        <p key={field.label} className="activity-field">
          <span className="muted">{field.label}:</span> {field.value}
        </p>
      ))}
      {mode === 'move' ? (
        <MoveForm
          rows={rows}
          current={activity.topicId}
          label="Move to topic"
          onCancel={() => setMode('view')}
          onMove={(topicId, path) => {
            setMode('view');
            act(`Moved to ${path}.`, () => moveActivities(db, [id], topicId, Date.now()));
          }}
        />
      ) : (
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            aria-describedby={promptId}
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            className="secondary"
            aria-describedby={promptId}
            onClick={() =>
              act(suspended ? 'Activity resumed.' : 'Activity suspended.', () =>
                setSuspended(db, [id], !suspended, Date.now()),
              )
            }
          >
            {suspended ? 'Resume' : 'Suspend'}
          </button>
          <button
            type="button"
            className="secondary"
            aria-describedby={promptId}
            onClick={() => setMode('move')}
          >
            Move
          </button>
          <button
            type="button"
            className="secondary danger"
            aria-describedby={promptId}
            onClick={() => act('Activity deleted.', () => deleteActivities(db, [id]))}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function EditForm({
  activity,
  run,
  onDone,
}: {
  activity: StoredActivity;
  run: RunAction;
  onDone: () => void;
}) {
  const { type } = activity;
  const [prompt, setPrompt] = useState(activity.prompt);
  const [answer, setAnswer] = useState(activity.answer);
  const [options, setOptions] = useState(activity.options.join('\n'));
  const [explanation, setExplanation] = useState(activity.explanation);
  const [error, setError] = useState<string | null>(null);
  const answerLabel = ANSWER_LABELS[type];
  const optionsLabel = OPTION_LABELS[type];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const edit = { prompt, answer, explanation, options: optionsLabel ? options.split('\n') : [] };
    const problem = await run('Activity saved.', () =>
      editActivity(db, activity.id, edit, Date.now()),
    );
    if (problem) setError(problem);
    else onDone();
  };

  return (
    <form
      className="edit-form"
      aria-label={`Edit ${ACTIVITY_LABELS[type].toLowerCase()}`}
      onSubmit={(event) => void submit(event)}
      onKeyDown={onEscape(onDone)}
    >
      <label>
        {PROMPT_LABELS[type]}
        <textarea value={prompt} rows={2} autoFocus onChange={(e) => setPrompt(e.target.value)} />
      </label>
      {type === 'true_false' && (
        <label>
          Answer
          <select value={answer} onChange={(e) => setAnswer(e.target.value)}>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </label>
      )}
      {answerLabel && (
        <label>
          {answerLabel}
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} />
        </label>
      )}
      {optionsLabel && (
        <label>
          {optionsLabel}
          <textarea value={options} rows={4} onChange={(e) => setOptions(e.target.value)} />
        </label>
      )}
      <label>
        Explanation (optional)
        <textarea value={explanation} rows={2} onChange={(e) => setExplanation(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function MoveForm({
  rows,
  current,
  label,
  onMove,
  onCancel,
}: {
  rows: readonly TopicRow[];
  current?: string;
  label: string;
  onMove: (topicId: string, path: string) => void;
  onCancel: () => void;
}) {
  const [topicId, setTopicId] = useState(current ?? rows[0]?.topic.id ?? '');
  const target = rows.find((row) => row.topic.id === topicId);

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (target) onMove(target.topic.id, target.path);
      }}
      onKeyDown={onEscape(onCancel)}
    >
      <label>
        {label}
        <TopicSelect rows={rows} value={topicId} onChange={setTopicId} autoFocus />
      </label>
      <div className="row-actions">
        <button type="submit" disabled={!target || topicId === current}>
          Move
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function TopicSelect({
  rows,
  value,
  onChange,
  autoFocus,
  topLevelLabel,
}: {
  rows: readonly TopicRow[];
  value: string;
  onChange: (topicId: string) => void;
  autoFocus?: boolean;
  /** Adds an empty-value option, for "no parent". */
  topLevelLabel?: string;
}) {
  return (
    <select value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}>
      {topLevelLabel !== undefined && <option value="">{topLevelLabel}</option>}
      {rows.map((row) => (
        <option key={row.topic.id} value={row.topic.id}>
          {row.path}
        </option>
      ))}
    </select>
  );
}
