import { Dexie } from 'dexie';
import type { LearnDatabase, StoredActivity, StoredVideo } from '@/lib/db';
import type { Activity } from '@/lib/learn/schema';
import { createScheduler } from './scheduler';
import { FALLBACK_TOPIC, resolveTopicId, topicPath, topicsById } from './topics';

export interface BankOptions {
  now: number;
  desiredRetention: number;
  newId?: () => string;
}

export interface VideoResult {
  video: Omit<StoredVideo, 'activitiesGeneratedAt'>;
  topic: string;
  /** When the activity set was generated. */
  generatedAt: number;
  activity: Activity;
  correct: boolean;
}

export interface ReviewItem {
  activity: StoredActivity;
  topic: string;
  videoTitle: string;
}

/**
 * Saves one answer from a video session. A new activity is seeded from the answer; an activity
 * already in the bank (same video, type, and generated prompt) gets a review instead of a
 * duplicate. New activities join the topic that the video's saved activities are in, so manual
 * moves are kept; otherwise the suggested topic is matched by name or created.
 */
export async function recordVideoResult(
  db: LearnDatabase,
  result: VideoResult,
  options: BankOptions,
): Promise<StoredActivity> {
  const { now } = options;
  const newId = options.newId ?? (() => crypto.randomUUID());
  return db.transaction('rw', [db.videos, db.topics, db.activities, db.reviewLogs], async () => {
    await db.videos.put({ ...result.video, activitiesGeneratedAt: result.generatedAt });

    const { activity } = result;
    const saved = await db.activities.where('videoId').equals(result.video.id).toArray();
    const existing = saved.find(
      (a) => a.type === activity.type && (a.generatedPrompt ?? a.prompt) === activity.prompt,
    );
    if (existing) return applyReview(db, existing, result.correct, options);

    const scheduler = createScheduler(options.desiredRetention);
    const created: StoredActivity = {
      ...pickActivity(activity),
      id: newId(),
      videoId: result.video.id,
      topicId:
        (await videoTopicId(db, saved)) ?? (await resolveTopicId(db, result.topic, now, newId)),
      fsrs: scheduler.newCard(now),
      due: now,
      suspended: 0,
      createdAt: now,
      updatedAt: now,
    };
    return applyReview(db, created, result.correct, options);
  });
}

/** Records a review from the dashboard. Returns null when the activity no longer exists. */
export async function recordReview(
  db: LearnDatabase,
  activityId: string,
  correct: boolean,
  options: BankOptions,
): Promise<StoredActivity | null> {
  return db.transaction('rw', [db.activities, db.reviewLogs], async () => {
    const activity = await db.activities.get(activityId);
    return activity ? applyReview(db, activity, correct, options) : null;
  });
}

async function applyReview(
  db: LearnDatabase,
  activity: StoredActivity,
  correct: boolean,
  { now, desiredRetention, newId = () => crypto.randomUUID() }: BankOptions,
): Promise<StoredActivity> {
  const { card, log, rating } = createScheduler(desiredRetention).review(
    activity.fsrs,
    correct,
    now,
  );
  const updated: StoredActivity = {
    ...activity,
    fsrs: card,
    due: card.due.getTime(),
    updatedAt: now,
  };
  await db.activities.put(updated);
  await db.reviewLogs.add({
    id: newId(),
    activityId: activity.id,
    rating,
    reviewedAt: now,
    fsrsLog: log,
  });
  return updated;
}

/** The topic most of a video's saved activities are in. */
async function videoTopicId(
  db: LearnDatabase,
  saved: readonly StoredActivity[],
): Promise<string | undefined> {
  const counts = new Map<string, number>();
  for (const { topicId } of saved) counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
  const [topicId] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return topicId && (await db.topics.get(topicId)) ? topicId : undefined;
}

function pickActivity(activity: Activity): Activity {
  const { type, prompt, answer, explanation, options, sourceStartSec } = activity;
  return { type, prompt, answer, explanation, options, sourceStartSec };
}

const dueRange = (db: LearnDatabase, now: number) =>
  db.activities.where('[suspended+due]').between([0, Dexie.minKey], [0, now], true, true);

export function countDue(db: LearnDatabase, now: number): Promise<number> {
  return dueRange(db, now).count();
}

/** Due activities, most overdue first, with their topic and video for display. */
export async function loadReviewQueue(db: LearnDatabase, now: number): Promise<ReviewItem[]> {
  const activities = await dueRange(db, now).toArray();
  const [topics, videos] = await Promise.all([
    db.topics.toArray(),
    db.videos.bulkGet([...new Set(activities.map((a) => a.videoId))]),
  ]);
  const byId = topicsById(topics);
  const videoTitles = new Map(videos.flatMap((v) => (v ? [[v.id, v.title] as const] : [])));
  return activities.map((activity) => {
    const topic = byId.get(activity.topicId);
    return {
      activity,
      topic: topic ? topicPath(topic, byId) : FALLBACK_TOPIC,
      videoTitle: videoTitles.get(activity.videoId) ?? '',
    };
  });
}

export interface BankSummary {
  total: number;
  due: number;
  /** Epoch ms of the next activity to come due, or null when none is scheduled. */
  nextDue: number | null;
}

export async function summarizeBank(db: LearnDatabase, now: number): Promise<BankSummary> {
  const [total, due, next] = await Promise.all([
    db.activities.count(),
    countDue(db, now),
    db.activities
      .where('[suspended+due]')
      .between([0, now], [0, Dexie.maxKey], false, true)
      .first(),
  ]);
  return { total, due, nextDue: next?.due ?? null };
}
