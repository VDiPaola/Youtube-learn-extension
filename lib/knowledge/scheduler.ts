import { createEmptyCard, fsrs, Rating, type Card, type ReviewLog } from 'ts-fsrs';
import { clampRetention } from '@/lib/review-settings';

export type { Card as FsrsCard, ReviewLog as FsrsLog } from 'ts-fsrs';

export interface Scheduled {
  card: Card;
  log: ReviewLog;
  rating: Rating;
}

/**
 * Correct counts as Good and incorrect as Again. Reviews happen on a daily scale, so same-day
 * learning steps are off; fuzz is off so activities from one video stay due together.
 */
export function createScheduler(desiredRetention: number) {
  const scheduler = fsrs({
    request_retention: clampRetention(desiredRetention),
    enable_short_term: false,
    enable_fuzz: false,
  });

  return {
    newCard: (now: number): Card => createEmptyCard(new Date(now)),

    review(card: Card, correct: boolean, now: number): Scheduled {
      const rating = correct ? Rating.Good : Rating.Again;
      const { card: next, log } = scheduler.next(card, new Date(now), rating);
      return { card: next, log, rating };
    },
  };
}
