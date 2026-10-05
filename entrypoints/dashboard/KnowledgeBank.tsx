import { useCallback, useEffect, useState } from 'react';
import { db } from '@/lib/db';
import {
  ALL_TOPICS,
  filterActivities,
  groupByVideo,
  topicRows,
  type TopicRow,
  type VideoGroup,
} from '@/lib/knowledge/browse';
import {
  BankError,
  deleteVideo,
  loadBank,
  moveActivities,
  undo,
  type BankContents,
  type Snapshot,
} from '@/lib/knowledge/manage';
import { ActivityItem, MoveForm } from './ActivityItem';
import { refreshBadge, useLiveQuery, type RunAction } from './bank-actions';
import { TopicActions, TopicNav } from './TopicPanel';

const PAGE_SIZE = 100;
const TOAST_MS = 10_000;

interface Toast {
  message: string;
  snapshot?: Snapshot;
  error?: boolean;
}

const plural = (count: number) => `${count} ${count === 1 ? 'activity' : 'activities'}`;

export function KnowledgeBank() {
  const bank = useLiveQuery(() => loadBank(db));
  const [selected, setSelected] = useState(ALL_TOPICS);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [toast, setToast] = useState<Toast | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  const run: RunAction = async (message, action) => {
    try {
      const snapshot = await action();
      setToast({ message, snapshot: snapshot ?? undefined });
      void refreshBadge();
      return null;
    } catch (error) {
      if (error instanceof BankError) return error.message;
      console.warn('[YouTube Learn] Knowledge bank change failed:', error);
      return 'The change could not be saved. Try again.';
    }
  };

  const act = (message: string, action: () => Promise<unknown>) =>
    void run(message, action as () => Promise<Snapshot | void>).then((problem) => {
      if (problem) setToast({ message: problem, error: true });
    });

  const undoLast = async () => {
    if (!toast?.snapshot) return;
    await undo(db, toast.snapshot);
    setToast({ message: 'Undone.' });
    void refreshBadge();
  };

  const select = (id: string) => {
    setSelected(id);
    setLimit(PAGE_SIZE);
  };

  const toastRegion = (
    <ToastRegion toast={toast} onUndo={() => void undoLast()} onClose={closeToast} />
  );
  if (!bank) return null;
  if (bank.activities.length === 0 && bank.topics.length === 0) return toastRegion;

  const now = Date.now();
  const rows = topicRows(bank, now);
  const selectedRow = rows.find((row) => row.topic.id === selected);
  const current = selectedRow ? selected : ALL_TOPICS;
  const matches = filterActivities(bank, current, query);
  const groups = groupByVideo(matches.slice(0, limit), bank.videos);

  return (
    <section className="bank" aria-labelledby="bank-heading">
      <h2 id="bank-heading">Knowledge bank</h2>
      <div className="bank-layout">
        <TopicNav
          rows={rows}
          total={bank.activities.length}
          selected={current}
          onSelect={select}
          run={run}
        />
        <div className="bank-main">
          <h3>{selectedRow?.path ?? 'All topics'}</h3>
          {selectedRow && (
            <TopicActions
              key={selectedRow.topic.id}
              row={selectedRow}
              rows={rows}
              ownCount={bank.activities.filter((a) => a.topicId === selectedRow.topic.id).length}
              run={run}
              act={act}
              onSelect={select}
            />
          )}
          <input
            type="search"
            className="search"
            aria-label="Search activities"
            placeholder="Search activities"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
          <p className="muted" role="status">
            {query ? `${plural(matches.length)} found` : plural(matches.length)}
          </p>
          {groups.map((group) => (
            <VideoSection
              key={group.videoId}
              group={group}
              bank={bank}
              rows={rows}
              now={now}
              run={run}
              act={act}
            />
          ))}
          {matches.length > limit && (
            <button
              type="button"
              className="secondary show-more"
              onClick={() => setLimit(limit + PAGE_SIZE)}
            >
              Show more
            </button>
          )}
        </div>
      </div>
      {toastRegion}
    </section>
  );
}

function VideoSection({
  group,
  bank,
  rows,
  now,
  run,
  act,
}: {
  group: VideoGroup;
  bank: BankContents;
  rows: readonly TopicRow[];
  now: number;
  run: RunAction;
  act: (message: string, action: () => Promise<unknown>) => void;
}) {
  const [moving, setMoving] = useState(false);
  const { videoId } = group;
  const title = group.video?.title || 'Unknown video';
  const allIds = bank.activities.filter((a) => a.videoId === videoId).map((a) => a.id);

  return (
    <section className="video-group" aria-label={title}>
      <div className="video-header">
        <h4>
          <a href={`https://youtu.be/${videoId}`} target="_blank" rel="noreferrer">
            {title}
          </a>
        </h4>
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            aria-label={`Move all ${plural(allIds.length)} from ${title}`}
            onClick={() => setMoving(true)}
          >
            Move all
          </button>
          <button
            type="button"
            className="secondary danger"
            aria-label={`Delete all ${plural(allIds.length)} from ${title}`}
            onClick={() =>
              act(`Deleted ${plural(allIds.length)} from "${title}".`, () =>
                deleteVideo(db, videoId),
              )
            }
          >
            Delete all
          </button>
        </div>
      </div>
      {moving && (
        <MoveForm
          rows={rows}
          label={`Move all ${plural(allIds.length)} from this video to`}
          onCancel={() => setMoving(false)}
          onMove={(topicId, path) => {
            setMoving(false);
            act(`Moved ${plural(allIds.length)} to ${path}.`, () =>
              moveActivities(db, allIds, topicId, Date.now()),
            );
          }}
        />
      )}
      <ul className="activity-list">
        {group.activities.map((activity) => (
          <ActivityItem
            key={activity.id}
            activity={activity}
            rows={rows}
            now={now}
            run={run}
            act={act}
          />
        ))}
      </ul>
    </section>
  );
}

function ToastRegion({
  toast,
  onUndo,
  onClose,
}: {
  toast: Toast | null;
  onUndo: () => void;
  onClose: () => void;
}) {
  const [paused, setPaused] = useState(false);

  // A replaced toast unmounts its focused button without a blur event.
  useEffect(() => setPaused(false), [toast]);

  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, paused, onClose]);

  return (
    <div
      className="toast-region"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {toast && (
        <div
          className={toast.error ? 'toast error-toast' : 'toast'}
          role={toast.error ? 'alert' : undefined}
        >
          <span>{toast.message}</span>
          {toast.snapshot && (
            <button type="button" className="secondary" onClick={onUndo}>
              Undo
            </button>
          )}
          <button type="button" className="secondary" aria-label="Dismiss" onClick={onClose}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
