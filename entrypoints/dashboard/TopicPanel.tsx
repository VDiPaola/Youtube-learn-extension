import { useState, type FormEvent } from 'react';
import { db } from '@/lib/db';
import { ALL_TOPICS, type TopicRow } from '@/lib/knowledge/browse';
import {
  createTopic,
  deleteTopic,
  mergeTopics,
  renameTopic,
  setTopicParent,
} from '@/lib/knowledge/manage';
import { TopicSelect } from './ActivityItem';
import { onEscape, type RunAction } from './bank-actions';

const TOP_LEVEL = 'Top level';

const plural = (count: number) => `${count} ${count === 1 ? 'activity' : 'activities'}`;

export function TopicNav({
  rows,
  total,
  selected,
  onSelect,
  run,
}: {
  rows: readonly TopicRow[];
  total: number;
  selected: string;
  onSelect: (id: string) => void;
  run: RunAction;
}) {
  const [creating, setCreating] = useState(false);
  const item = (id: string, name: string, count: number, depth = 0) => (
    <li key={id} className={depth ? 'subtopic' : undefined}>
      <button
        type="button"
        aria-current={selected === id ? 'true' : undefined}
        onClick={() => onSelect(id)}
      >
        <span>{name}</span>
        <span className="count">
          {count}
          <span className="visually-hidden"> {count === 1 ? 'activity' : 'activities'}</span>
        </span>
      </button>
    </li>
  );

  return (
    <nav className="topic-nav" aria-label="Topics">
      <ul className="topic-list">
        {item(ALL_TOPICS, 'All topics', total)}
        {rows.map((row) => item(row.topic.id, row.topic.name, row.count, row.depth))}
      </ul>
      {creating ? (
        <NewTopicForm
          rows={rows}
          run={run}
          onDone={(id) => {
            setCreating(false);
            if (id) onSelect(id);
          }}
        />
      ) : (
        <button type="button" className="secondary" onClick={() => setCreating(true)}>
          New topic
        </button>
      )}
    </nav>
  );
}

function NewTopicForm({
  rows,
  run,
  onDone,
}: {
  rows: readonly TopicRow[];
  run: RunAction;
  onDone: (createdId?: string) => void;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let createdId: string | undefined;
    const problem = await run(`Created topic "${name.trim()}".`, async () => {
      createdId = (await createTopic(db, name, parentId || null, Date.now())).id;
    });
    if (problem) setError(problem);
    else onDone(createdId);
  };

  return (
    <form
      className="inline-form"
      aria-label="New topic"
      onSubmit={(event) => void submit(event)}
      onKeyDown={onEscape(() => onDone())}
    >
      <label>
        Name
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Parent topic
        <TopicSelect
          rows={rows.filter((row) => row.depth === 0)}
          value={parentId}
          onChange={setParentId}
          topLevelLabel={TOP_LEVEL}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        <button type="submit">Create</button>
        <button type="button" className="secondary" onClick={() => onDone()}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Mode = 'rename' | 'parent' | 'merge' | null;

export function TopicActions({
  row,
  rows,
  ownCount,
  run,
  act,
  onSelect,
}: {
  row: TopicRow;
  rows: readonly TopicRow[];
  /** Activities directly in the topic, not in its subtopics. */
  ownCount: number;
  run: RunAction;
  act: (message: string, action: () => Promise<unknown>) => void;
  onSelect: (id: string) => void;
}) {
  const { topic } = row;
  const [mode, setMode] = useState<Mode>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hasSubtopics = rows.some((r) => r.topic.parentId === topic.id);
  const others = rows.filter((r) => r.topic.id !== topic.id);
  const parents = others.filter((r) => r.depth === 0);

  const open = (next: Mode, initial: string) => {
    setMode(next);
    setValue(initial);
    setError(null);
  };
  const close = () => setMode(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let problem: string | null = null;
    if (mode === 'rename') {
      problem = await run(`Renamed to "${value.trim()}".`, () => renameTopic(db, topic.id, value));
    } else if (mode === 'parent') {
      const parent = rows.find((r) => r.topic.id === value);
      problem = await run(
        parent
          ? `Moved "${topic.name}" under "${parent.path}".`
          : `Moved "${topic.name}" to the top level.`,
        () => setTopicParent(db, topic.id, value || null),
      );
    } else if (mode === 'merge') {
      const target = rows.find((r) => r.topic.id === value);
      problem = await run(`Merged "${topic.name}" into "${target?.path}".`, () =>
        mergeTopics(db, topic.id, value, Date.now()),
      );
      if (!problem) onSelect(value);
    }
    if (problem) setError(problem);
    else close();
  };

  if (mode === null) {
    return (
      <div className="row-actions topic-actions">
        <button type="button" className="secondary" onClick={() => open('rename', topic.name)}>
          Rename
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => open('parent', topic.parentId ?? '')}
        >
          Change parent
        </button>
        <button
          type="button"
          className="secondary"
          disabled={others.length === 0}
          onClick={() => open('merge', others[0]?.topic.id ?? '')}
        >
          Merge
        </button>
        <button
          type="button"
          className="secondary danger"
          onClick={() => {
            onSelect(ALL_TOPICS);
            act(`Deleted topic "${topic.name}" and ${plural(ownCount)}.`, () =>
              deleteTopic(db, topic.id),
            );
          }}
        >
          Delete topic
        </button>
      </div>
    );
  }

  return (
    <form
      className="inline-form topic-actions"
      aria-label={`${mode === 'rename' ? 'Rename' : mode === 'merge' ? 'Merge' : 'Change parent of'} ${topic.name}`}
      onSubmit={(event) => void submit(event)}
      onKeyDown={onEscape(close)}
    >
      {mode === 'rename' && (
        <label>
          New name
          <input value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
      )}
      {mode === 'parent' &&
        (hasSubtopics ? (
          <p className="muted">
            &quot;{topic.name}&quot; has subtopics, so it stays at the top level. Topics nest only
            one level deep.
          </p>
        ) : (
          <label>
            Parent topic
            <TopicSelect
              rows={parents}
              value={value}
              onChange={setValue}
              topLevelLabel={TOP_LEVEL}
              autoFocus
            />
          </label>
        ))}
      {mode === 'merge' && (
        <>
          <label>
            Merge &quot;{topic.name}&quot; into
            <TopicSelect rows={others} value={value} onChange={setValue} autoFocus />
          </label>
          <p className="muted">
            Its {plural(ownCount)} move to the chosen topic, and &quot;{topic.name}&quot; is
            removed. Later AI suggestions for &quot;{topic.name}&quot; go there too.
            {hasSubtopics && ' Its subtopics move under the chosen topic, or to the top level.'}
          </p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        {!(mode === 'parent' && hasSubtopics) && (
          <button type="submit">
            {mode === 'rename' ? 'Rename' : mode === 'merge' ? 'Merge' : 'Save'}
          </button>
        )}
        <button type="button" className="secondary" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
