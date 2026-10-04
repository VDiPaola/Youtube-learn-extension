import { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { summarizeBank, type BankSummary } from '@/lib/knowledge/bank';

export function ReviewSummary() {
  const [summary, setSummary] = useState<BankSummary | null>(null);

  useEffect(() => {
    void summarizeBank(db, Date.now()).then(setSummary);
  }, []);

  if (!summary) return null;

  const open = async (hash = '') => {
    await browser.tabs.create({ url: browser.runtime.getURL(`/dashboard.html${hash}`) });
    window.close();
  };

  return (
    <section aria-labelledby="reviews-heading" className="reviews">
      <h2 id="reviews-heading">Reviews</h2>
      <p>{describe(summary)}</p>
      <div className="actions">
        {summary.due > 0 && (
          <button type="button" onClick={() => void open('#review')}>
            Start review
          </button>
        )}
        <button type="button" className="secondary" onClick={() => void open()}>
          Knowledge bank
        </button>
      </div>
    </section>
  );
}

function describe({ total, due }: BankSummary): string {
  if (total === 0) {
    return 'No activities saved yet. Answers from video sessions are saved here for review.';
  }
  if (due === 0) return 'Nothing due right now.';
  return `${due} ${due === 1 ? 'activity' : 'activities'} due.`;
}
