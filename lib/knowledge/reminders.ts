import type { ReviewSettings } from '@/lib/review-settings';

const MAX_BADGE_COUNT = 999;

export function badgeText(dueCount: number): string {
  if (dueCount <= 0) return '';
  return dueCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(dueCount);
}

/** Local calendar date, for example "2026-10-04". */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One reminder per day, after the chosen hour, only when activities are due. */
export function shouldRemind(
  settings: Pick<ReviewSettings, 'reminderEnabled' | 'reminderHour'>,
  lastReminderDay: string,
  now: Date,
  dueCount: number,
): boolean {
  return (
    settings.reminderEnabled &&
    dueCount > 0 &&
    now.getHours() >= settings.reminderHour &&
    localDay(now) !== lastReminderDay
  );
}
