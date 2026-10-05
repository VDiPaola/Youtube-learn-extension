import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Dexie } from 'dexie';
import { State } from 'ts-fsrs';
import { LearnDatabase } from '@/lib/db';
import {
  countDue,
  loadReviewQueue,
  recordReview,
  recordVideoResult,
  summarizeBank,
  type VideoResult,
} from '@/lib/knowledge/bank';
import type { Activity } from '@/lib/learn/schema';

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1, 12);

const activity = (prompt = 'What is DNA?', type: Activity['type'] = 'recall'): Activity => ({
  type,
  prompt,
  answer: 'A molecule.',
  explanation: '',
  options: [],
  sourceStartSec: 30,
});

const result = (overrides: Partial<VideoResult> = {}): VideoResult => ({
  video: { id: 'vid', title: 'Genes', channelId: 'UC1', channelName: 'Channel', durationSec: 600 },
  topic: 'Biology',
  generatedAt: START - 1000,
  activity: activity(),
  correct: true,
  ...overrides,
});

const options = (now: number, desiredRetention = 0.9) => ({ now, desiredRetention });
const days = (ms: number) => Math.round(ms / DAY);

let db: LearnDatabase;

beforeEach(() => {
  db = new LearnDatabase(`bank-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('saving video results', () => {
  it('stores the video, topic, activity, and first review', async () => {
    const saved = await recordVideoResult(db, result(), options(START));

    expect(await db.videos.get('vid')).toEqual({
      id: 'vid',
      title: 'Genes',
      channelId: 'UC1',
      channelName: 'Channel',
      durationSec: 600,
      activitiesGeneratedAt: START - 1000,
    });
    const topics = await db.topics.toArray();
    expect(topics).toMatchObject([{ name: 'Biology', parentId: null, createdAt: START }]);
    expect(saved).toMatchObject({
      ...activity(),
      videoId: 'vid',
      topicId: topics[0]!.id,
      suspended: 0,
      createdAt: START,
    });
    expect(saved.fsrs.state).toBe(State.Review);
    expect(saved.due).toBe(saved.fsrs.due.getTime());
    expect(await db.reviewLogs.where('activityId').equals(saved.id).count()).toBe(1);
  });

  it('seeds a correct answer as Good and an incorrect one as Again', async () => {
    const good = await recordVideoResult(db, result(), options(START));
    const again = await recordVideoResult(
      db,
      result({ activity: activity('Other?'), correct: false }),
      options(START),
    );
    const logs = await db.reviewLogs.toArray();
    expect(logs.find((l) => l.activityId === good.id)?.rating).toBe(3);
    expect(logs.find((l) => l.activityId === again.id)?.rating).toBe(1);
    expect(days(again.due - START)).toBe(1);
    expect(days(good.due - START)).toBeGreaterThan(1);
  });

  it('counts a repeated session as a review instead of a duplicate', async () => {
    const first = await recordVideoResult(db, result(), options(START));
    const second = await recordVideoResult(db, result(), options(first.due));

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(START);
    expect(await db.activities.count()).toBe(1);
    expect(await db.reviewLogs.count()).toBe(2);
    expect(second.due - first.due).toBeGreaterThan(first.due - START);
  });

  it('treats the same prompt with a different type as a separate activity', async () => {
    await recordVideoResult(db, result(), options(START));
    await recordVideoResult(db, result({ activity: activity('What is DNA?', 'apply') }), {
      now: START,
      desiredRetention: 0.9,
    });
    expect(await db.activities.count()).toBe(2);
  });

  it('reuses topics by name, ignoring case', async () => {
    const video = (id: string) => ({ ...result().video, id });
    await recordVideoResult(db, result(), options(START));
    await recordVideoResult(db, result({ video: video('b'), topic: 'biology' }), options(START));
    await recordVideoResult(db, result({ video: video('c'), topic: '  ' }), options(START));
    expect((await db.topics.toArray()).map((t) => t.name).sort()).toEqual(['Biology', 'General']);
  });

  it("adds new activities to the topic the video's activities were moved to", async () => {
    const first = await recordVideoResult(db, result(), options(START));
    await db.topics.add({ id: 'chosen', name: 'Chosen', parentId: null, createdAt: START });
    await db.activities.update(first.id, { topicId: 'chosen' });

    const next = await recordVideoResult(db, result({ activity: activity('B?') }), options(START));
    expect(next.topicId).toBe('chosen');
  });

  it('matches an edited activity by its generated prompt', async () => {
    const first = await recordVideoResult(db, result(), options(START));
    await db.activities.update(first.id, { prompt: 'Edited?', generatedPrompt: 'What is DNA?' });

    const again = await recordVideoResult(db, result(), options(first.due));
    expect(again.id).toBe(first.id);
    expect(again.prompt).toBe('Edited?');
    expect(await db.activities.count()).toBe(1);
  });

  it('stores only the activity fields', async () => {
    const extra = { ...activity(), unexpected: true } as Activity;
    const saved = await recordVideoResult(db, result({ activity: extra }), options(START));
    expect(saved).not.toHaveProperty('unexpected');
  });
});

describe('scheduling on simulated dates', () => {
  it('lengthens the interval after each correct review on the due date', async () => {
    let current = await recordVideoResult(db, result(), options(START));
    const intervals = [days(current.due - START)];
    for (let i = 0; i < 4; i++) {
      const now = current.due;
      current = (await recordReview(db, current.id, true, options(now)))!;
      intervals.push(days(current.due - now));
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]!);
    }
    expect(current.fsrs.reps).toBe(5);
    expect(await db.reviewLogs.count()).toBe(5);
  });

  it('shortens the interval and counts a lapse after an incorrect review', async () => {
    let current = await recordVideoResult(db, result(), options(START));
    current = (await recordReview(db, current.id, true, options(current.due)))!;
    const before = current.due - current.fsrs.last_review!.getTime();

    const now = current.due;
    current = (await recordReview(db, current.id, false, options(now)))!;
    expect(current.fsrs.lapses).toBe(1);
    expect(current.due - now).toBeLessThan(before);
  });

  it('schedules sooner with a higher desired retention', async () => {
    const low = await recordVideoResult(db, result(), options(START, 0.8));
    const high = await recordVideoResult(
      db,
      result({ activity: activity('B?') }),
      options(START, 0.95),
    );
    expect(high.due).toBeLessThan(low.due);
  });

  it('returns null when reviewing an activity that no longer exists', async () => {
    expect(await recordReview(db, 'missing', true, options(START))).toBeNull();
    expect(await db.reviewLogs.count()).toBe(0);
  });
});

describe('due activities', () => {
  it('lists due activities, most overdue first, without suspended or future ones', async () => {
    const a = await recordVideoResult(db, result({ correct: false }), options(START));
    const b = await recordVideoResult(
      db,
      result({ activity: activity('B?'), correct: false }),
      options(START - DAY),
    );
    const suspended = await recordVideoResult(
      db,
      result({ activity: activity('C?'), correct: false }),
      options(START),
    );
    await db.activities.update(suspended.id, { suspended: 1 });
    await recordVideoResult(db, result({ activity: activity('D?') }), options(START));

    const now = START + DAY;
    expect(await countDue(db, now)).toBe(2);
    const queue = await loadReviewQueue(db, now);
    expect(queue.map((item) => item.activity.id)).toEqual([b.id, a.id]);
    expect(queue[0]).toMatchObject({ topic: 'Biology', videoTitle: 'Genes' });
  });

  it('shows subtopics as a path in the review queue', async () => {
    const saved = await recordVideoResult(
      db,
      result({ topic: 'Biology > Genetics', correct: false }),
      options(START),
    );
    const [item] = await loadReviewQueue(db, saved.due);
    expect(item?.topic).toBe('Biology > Genetics');
  });

  it('summarizes the bank with the next due time', async () => {
    expect(await summarizeBank(db, START)).toEqual({ total: 0, due: 0, nextDue: null });
    const saved = await recordVideoResult(db, result(), options(START));
    expect(await summarizeBank(db, START)).toEqual({ total: 1, due: 0, nextDue: saved.due });
    expect(await summarizeBank(db, saved.due)).toEqual({ total: 1, due: 1, nextDue: null });
  });
});

describe('database upgrade to version 3', () => {
  it('keeps cached activity sets and adds empty knowledge bank tables', async () => {
    const name = `upgrade-v3-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(2).stores({ quizCache: 'videoId, createdAt' });
    const cached = {
      videoId: 'v',
      title: 'T',
      set: { topic: 'Biology', activities: [activity()] },
      providerId: 'custom',
      model: 'm',
      createdAt: 1,
    };
    await old.table('quizCache').put(cached);
    old.close();

    const upgraded = new LearnDatabase(name);
    expect(await upgraded.quizCache.toArray()).toEqual([cached]);
    expect(await upgraded.activities.count()).toBe(0);
    const saved = await recordVideoResult(upgraded, result(), options(START));
    expect(await countDue(upgraded, saved.due)).toBe(1);
    await upgraded.delete();
  });
});
