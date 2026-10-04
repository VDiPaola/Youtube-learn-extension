import { useCallback, useEffect, useState } from 'react';
import { db } from '@/lib/db';
import {
  loadReviewQueue,
  summarizeBank,
  type BankSummary,
  type ReviewItem,
} from '@/lib/knowledge/bank';
import { ReviewSession } from './ReviewSession';

type View = { kind: 'overview' } | { kind: 'review'; items: ReviewItem[] };

const REVIEW_HASH = '#review';

export default function App() {
  const [summary, setSummary] = useState<BankSummary | null>(null);
  const [view, setView] = useState<View>({ kind: 'overview' });

  const refresh = useCallback(async () => {
    const next = await summarizeBank(db, Date.now());
    setSummary(next);
    return next;
  }, []);

  const startReview = useCallback(async () => {
    const items = await loadReviewQueue(db, Date.now());
    if (items.length > 0) setView({ kind: 'review', items });
  }, []);

  useEffect(() => {
    void refresh().then((next) => {
      if (location.hash === REVIEW_HASH && next.due > 0) void startReview();
    });
  }, [refresh, startReview]);

  const finish = () => {
    history.replaceState(null, '', location.pathname);
    setView({ kind: 'overview' });
    void refresh();
  };

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
      {view.kind === 'review' ? (
        <ReviewSession items={view.items} onFinish={finish} />
      ) : (
        <Overview summary={summary} onStart={() => void startReview()} />
      )}
    </main>
  );
}

function Overview({ summary, onStart }: { summary: BankSummary | null; onStart: () => void }) {
  if (!summary) return <p className="muted">Loading...</p>;
  if (summary.total === 0) {
    return (
      <section aria-labelledby="reviews-heading">
        <h2 id="reviews-heading">Reviews</h2>
        <p>Your knowledge bank is empty.</p>
        <p className="muted">
          Complete learning activities on a YouTube video. Each answer is saved here and comes back
          for review at growing intervals.
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="reviews-heading">
      <h2 id="reviews-heading">Reviews</h2>
      {summary.due > 0 ? (
        <>
          <p className="due-count">
            {summary.due} {summary.due === 1 ? 'activity' : 'activities'} due
          </p>
          <button type="button" onClick={onStart} autoFocus>
            Start review
          </button>
        </>
      ) : (
        <p>
          Nothing due right now.
          {summary.nextDue !== null && <> Next review: {formatDue(summary.nextDue)}.</>}
        </p>
      )}
      <p className="muted">
        {summary.total} {summary.total === 1 ? 'activity' : 'activities'} in your knowledge bank.
      </p>
    </section>
  );
}

function formatDue(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    epochMs,
  );
}
