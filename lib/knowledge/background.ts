import type { LearnDatabase } from '@/lib/db';
import type { RecordResultMessage, RecordResultResponse } from '@/lib/messages';
import type { ReviewSettings } from '@/lib/review-settings';
import { countDue, recordVideoResult } from './bank';
import { badgeText, localDay, shouldRemind } from './reminders';

export interface ReviewServiceDeps {
  db: LearnDatabase;
  now(): number;
  loadSettings(): Promise<ReviewSettings>;
  loadLastReminderDay(): Promise<string>;
  saveLastReminderDay(day: string): Promise<void>;
  setBadge(text: string): Promise<void>;
  /** Resolves false when notifications are not permitted. */
  notify(dueCount: number): Promise<boolean>;
  log(message: string): void;
}

export function createReviewService(deps: ReviewServiceDeps) {
  async function refreshBadge(): Promise<number> {
    const due = await countDue(deps.db, deps.now());
    await deps.setBadge(badgeText(due));
    return due;
  }

  return {
    refreshBadge,

    async recordResult(message: RecordResultMessage): Promise<RecordResultResponse> {
      try {
        const { desiredRetention } = await deps.loadSettings();
        await recordVideoResult(deps.db, message.result, { now: deps.now(), desiredRetention });
        await refreshBadge();
        return { ok: true };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        deps.log(`Could not save an activity result: ${text}`);
        return { ok: false, error: text };
      }
    },

    /** Runs on the periodic alarm: updates the badge and shows the daily reminder when due. */
    async check(): Promise<void> {
      const due = await refreshBadge();
      const now = new Date(deps.now());
      const [settings, lastDay] = await Promise.all([
        deps.loadSettings(),
        deps.loadLastReminderDay(),
      ]);
      if (shouldRemind(settings, lastDay, now, due) && (await deps.notify(due))) {
        await deps.saveLastReminderDay(localDay(now));
      }
    },
  };
}
