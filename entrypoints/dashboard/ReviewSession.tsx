import { useMemo, type KeyboardEvent } from 'react';
import { ActivityView, asButtonRef, useActivityRunner } from '@/components/activities/ActivityView';
import { db, type StoredActivity } from '@/lib/db';
import { recordReview, type ReviewItem } from '@/lib/knowledge/bank';
import { currentActivity } from '@/lib/learn/runner';
import { ACTIVITY_LABELS, type Activity } from '@/lib/learn/schema';
import type { RefreshBadgeMessage } from '@/lib/messages';
import { reviewSettingsItem } from '@/lib/review-settings';
import { formatTimestamp } from '@/lib/transcript/format';

export function ReviewSession({ items, onFinish }: { items: ReviewItem[]; onFinish: () => void }) {
  const activities = useMemo(() => items.map((item) => item.activity), [items]);
  const { state, dispatch, primary } = useActivityRunner(activities, {
    autoStart: true,
    onResult: (activity, correct) => void saveReview(activity, correct),
  });
  const activity = currentActivity(state);
  const item = activity ? items[state.index]! : null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onFinish();
    }
  };

  if (state.phase === 'summary') {
    const correct = state.results.filter((result) => result.correct).length;
    return (
      <section className="review ytl-surface" aria-labelledby="review-heading">
        <h2 id="review-heading">Review complete</h2>
        <p>
          {correct} of {state.results.length} correct.
        </p>
        <div className="ytl-actions">
          <button
            ref={asButtonRef(primary)}
            type="button"
            className="ytl-primary"
            onClick={onFinish}
          >
            Done
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="review ytl-surface" aria-labelledby="review-heading" onKeyDown={onKeyDown}>
      <div className="review-header">
        <h2 id="review-heading">Review</h2>
        <button type="button" onClick={onFinish}>
          End review
        </button>
      </div>
      {activity && item && (
        <>
          <p className="ytl-progress">
            {state.index + 1} of {activities.length} · {ACTIVITY_LABELS[activity.type]} ·{' '}
            {item.topic}
          </p>
          <ActivityView
            key={state.index}
            activity={activity}
            state={state}
            dispatch={dispatch}
            primary={primary}
          />
          {state.answered && <Source item={item} />}
        </>
      )}
      <p className="ytl-muted ytl-small">
        Keys: Enter or Space continues, 1 to 4 picks an option, 1 or 2 marks your answer correct or
        incorrect, Esc ends the review.
      </p>
    </section>
  );
}

function Source({ item }: { item: ReviewItem }) {
  const { videoId, sourceStartSec } = item.activity;
  return (
    <p className="ytl-muted ytl-small">
      From{' '}
      <a href={`https://youtu.be/${videoId}?t=${sourceStartSec}`} target="_blank" rel="noreferrer">
        {item.videoTitle || 'the source video'} at {formatTimestamp(sourceStartSec * 1000)}
      </a>
    </p>
  );
}

async function saveReview(activity: Activity, correct: boolean): Promise<void> {
  const { id } = activity as StoredActivity;
  try {
    const { desiredRetention } = await reviewSettingsItem.getValue();
    await recordReview(db, id, correct, { now: Date.now(), desiredRetention });
    const message: RefreshBadgeMessage = { type: 'badge:refresh' };
    await browser.runtime.sendMessage(message);
  } catch (error) {
    console.warn('[YouTube Learn] Review not saved:', error);
  }
}
