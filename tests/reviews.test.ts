import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnDatabase } from '@/lib/db';
import { createReviewService, type ReviewServiceDeps } from '@/lib/knowledge/background';
import type { VideoResult } from '@/lib/knowledge/bank';
import { badgeText, localDay, shouldRemind } from '@/lib/knowledge/reminders';
import { clampRetention, DEFAULT_REVIEW_SETTINGS } from '@/lib/review-settings';

const DAY = 86_400_000;

describe('badge text', () => {
  it('is empty when nothing is due and caps large counts', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(999)).toBe('999');
    expect(badgeText(1000)).toBe('999+');
  });
});

describe('daily reminder', () => {
  const on = { reminderEnabled: true, reminderHour: 9 };
  const at = (hour: number, day = 4) => new Date(2026, 9, day, hour, 30);

  it('reminds once per day after the chosen hour when activities are due', () => {
    expect(shouldRemind(on, '', at(9), 3)).toBe(true);
    expect(shouldRemind(on, localDay(at(9)), at(20), 3)).toBe(false);
    expect(shouldRemind(on, localDay(at(9, 3)), at(9), 3)).toBe(true);
  });

  it('stays quiet before the hour, with nothing due, or when turned off', () => {
    expect(shouldRemind(on, '', at(8), 3)).toBe(false);
    expect(shouldRemind(on, '', at(10), 0)).toBe(false);
    expect(shouldRemind({ ...on, reminderEnabled: false }, '', at(10), 3)).toBe(false);
  });

  it('formats the local day with zero padding', () => {
    expect(localDay(new Date(2026, 0, 5, 23))).toBe('2026-01-05');
  });
});

describe('desired retention', () => {
  it('is clamped to a safe range', () => {
    expect(clampRetention(0.5)).toBe(0.7);
    expect(clampRetention(1)).toBe(0.97);
    expect(clampRetention(Number.NaN)).toBe(0.9);
    expect(clampRetention(0.85)).toBe(0.85);
  });
});

describe('review service', () => {
  const NOW = new Date(2026, 9, 4, 10).getTime();
  const result: VideoResult = {
    video: { id: 'vid', title: 'T', channelId: 'UC', channelName: 'C', durationSec: 600 },
    topic: 'Biology',
    generatedAt: NOW,
    activity: {
      type: 'recall',
      prompt: 'Q?',
      answer: 'A.',
      explanation: '',
      options: [],
      sourceStartSec: 0,
    },
    correct: false,
  };

  let db: LearnDatabase;
  let now: number;
  let deps: ReviewServiceDeps & {
    setBadge: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
    saveLastReminderDay: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    db = new LearnDatabase(`reviews-${crypto.randomUUID()}`);
    now = NOW;
    let lastDay = '';
    deps = {
      db,
      now: () => now,
      loadSettings: async () => ({ ...DEFAULT_REVIEW_SETTINGS, reminderEnabled: true }),
      loadLastReminderDay: async () => lastDay,
      saveLastReminderDay: vi.fn(async (day: string) => {
        lastDay = day;
      }),
      setBadge: vi.fn(async () => {}),
      notify: vi.fn(async () => true),
      log: vi.fn(),
    };
  });

  afterEach(async () => {
    await db.delete();
  });

  it('saves a result and updates the badge', async () => {
    const service = createReviewService(deps);
    expect(await service.recordResult({ type: 'activity:record', result })).toEqual({ ok: true });
    expect(await db.activities.count()).toBe(1);
    expect(deps.setBadge).toHaveBeenLastCalledWith('');

    now = NOW + DAY;
    expect(await service.refreshBadge()).toBe(1);
    expect(deps.setBadge).toHaveBeenLastCalledWith('1');
  });

  it('reports a failed save without throwing', async () => {
    const service = createReviewService({
      ...deps,
      loadSettings: async () => {
        throw new Error('storage unavailable');
      },
    });
    expect(await service.recordResult({ type: 'activity:record', result })).toEqual({
      ok: false,
      error: 'storage unavailable',
    });
    expect(deps.log).toHaveBeenCalledOnce();
  });

  it('shows one reminder per day when activities are due', async () => {
    const service = createReviewService(deps);
    await service.recordResult({ type: 'activity:record', result });
    await service.check();
    expect(deps.notify).not.toHaveBeenCalled();

    now = NOW + DAY;
    await service.check();
    await service.check();
    expect(deps.notify).toHaveBeenCalledOnce();
    expect(deps.notify).toHaveBeenCalledWith(1);
    expect(deps.saveLastReminderDay).toHaveBeenCalledWith(localDay(new Date(now)));
  });

  it('tries again later when notifications are not permitted', async () => {
    deps.notify.mockResolvedValue(false);
    const service = createReviewService(deps);
    await service.recordResult({ type: 'activity:record', result });
    now = NOW + DAY;
    await service.check();
    await service.check();
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.saveLastReminderDay).not.toHaveBeenCalled();
  });
});
