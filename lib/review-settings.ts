import { storage } from 'wxt/utils/storage';

export interface ReviewSettings {
  /** Probability of recalling an activity when it comes due. Higher means shorter intervals. */
  desiredRetention: number;
  reminderEnabled: boolean;
  /** Local hour (0 to 23) after which the daily reminder can be shown. */
  reminderHour: number;
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  desiredRetention: 0.9,
  reminderEnabled: false,
  reminderHour: 9,
};

export const MIN_RETENTION = 0.7;
export const MAX_RETENTION = 0.97;

export const reviewSettingsItem = storage.defineItem<ReviewSettings>('local:reviewSettings', {
  fallback: DEFAULT_REVIEW_SETTINGS,
});

/** Local date of the last reminder, so at most one is shown per day. */
export const lastReminderDayItem = storage.defineItem<string>('local:lastReminderDay', {
  fallback: '',
});

export function clampRetention(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REVIEW_SETTINGS.desiredRetention;
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, value));
}
