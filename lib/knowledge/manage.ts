import type { LearnDatabase, ReviewLogEntry, StoredActivity, StoredVideo, Topic } from '@/lib/db';
import { normalizeActivity } from '@/lib/learn/clean';
import { BLANK, type ActivityType } from '@/lib/learn/schema';
import { cleanTopicName, sameTopicName, topicNameProblem } from './topics';

/** A management action that cannot be applied, with a message for the user. */
export class BankError extends Error {}

/** Records as they were before an action. Putting them back undoes it. */
export interface Snapshot {
  topics: Topic[];
  videos: StoredVideo[];
  activities: StoredActivity[];
  reviewLogs: ReviewLogEntry[];
}

export interface BankContents {
  topics: Topic[];
  videos: StoredVideo[];
  activities: StoredActivity[];
}

export interface ActivityEdit {
  prompt: string;
  answer: string;
  explanation: string;
  options: string[];
}

const emptySnapshot = (): Snapshot => ({ topics: [], videos: [], activities: [], reviewLogs: [] });

const bankTables = (db: LearnDatabase) => [db.topics, db.videos, db.activities, db.reviewLogs];

export async function loadBank(db: LearnDatabase): Promise<BankContents> {
  const [topics, videos, activities] = await Promise.all([
    db.topics.toArray(),
    db.videos.toArray(),
    db.activities.toArray(),
  ]);
  return { topics, videos, activities };
}

export async function undo(db: LearnDatabase, snapshot: Snapshot): Promise<void> {
  await db.transaction('rw', bankTables(db), async () => {
    await db.topics.bulkPut(snapshot.topics);
    await db.videos.bulkPut(snapshot.videos);
    await db.activities.bulkPut(snapshot.activities);
    await db.reviewLogs.bulkPut(snapshot.reviewLogs);
  });
}

const EDIT_PROBLEMS: Record<ActivityType, string> = {
  recall: 'Enter a question and an answer.',
  flashcard: 'Enter a front and a back.',
  apply: 'Enter a scenario and an answer.',
  cloze: `Enter a sentence with one blank (${BLANK}) and the missing answer.`,
  multiple_choice:
    'Enter a question, the correct answer, and at least two different wrong options.',
  true_false: 'Enter a statement and choose true or false.',
  ordering: 'Enter an instruction and 3 to 8 different items.',
};

/** Saves edited text, checked by the same rules as generated activities. */
export async function editActivity(
  db: LearnDatabase,
  id: string,
  edit: ActivityEdit,
  now: number,
): Promise<Snapshot> {
  return db.transaction('rw', db.activities, async () => {
    const activity = await requireActivity(db, id);
    const normalized = normalizeActivity(
      { ...edit, type: activity.type, sourceStartSec: activity.sourceStartSec },
      Number.MAX_SAFE_INTEGER,
    );
    if (!normalized) throw new BankError(EDIT_PROBLEMS[activity.type]);
    await db.activities.put({
      ...activity,
      ...normalized,
      generatedPrompt: activity.generatedPrompt ?? activity.prompt,
      updatedAt: now,
    });
    return { ...emptySnapshot(), activities: [activity] };
  });
}

/** Suspended activities stay in the bank but leave the review queue. */
export function setSuspended(
  db: LearnDatabase,
  ids: readonly string[],
  suspended: boolean,
  now: number,
): Promise<Snapshot> {
  return updateActivities(db, ids, { suspended: suspended ? 1 : 0, updatedAt: now });
}

export async function moveActivities(
  db: LearnDatabase,
  ids: readonly string[],
  topicId: string,
  now: number,
): Promise<Snapshot> {
  return db.transaction('rw', [db.topics, db.activities], async () => {
    await requireTopic(db, topicId);
    return updateActivities(db, ids, { topicId, updatedAt: now });
  });
}

async function updateActivities(
  db: LearnDatabase,
  ids: readonly string[],
  changes: Partial<StoredActivity>,
): Promise<Snapshot> {
  return db.transaction('rw', db.activities, async () => {
    const activities = (await db.activities.bulkGet([...ids])).filter((a) => a !== undefined);
    await db.activities.bulkPut(activities.map((activity) => ({ ...activity, ...changes })));
    return { ...emptySnapshot(), activities };
  });
}

/** Deletes activities with their review logs, and videos left without activities. */
export async function deleteActivities(
  db: LearnDatabase,
  ids: readonly string[],
): Promise<Snapshot> {
  return db.transaction('rw', bankTables(db), async () => {
    const activities = (await db.activities.bulkGet([...ids])).filter((a) => a !== undefined);
    const activityIds = activities.map((activity) => activity.id);
    const reviewLogs = await db.reviewLogs.where('activityId').anyOf(activityIds).toArray();
    await db.reviewLogs.bulkDelete(reviewLogs.map((log) => log.id));
    await db.activities.bulkDelete(activityIds);

    const videos: StoredVideo[] = [];
    for (const videoId of new Set(activities.map((activity) => activity.videoId))) {
      if ((await db.activities.where('videoId').equals(videoId).count()) > 0) continue;
      const video = await db.videos.get(videoId);
      if (video) videos.push(video);
    }
    await db.videos.bulkDelete(videos.map((video) => video.id));
    return { ...emptySnapshot(), videos, activities, reviewLogs };
  });
}

export async function deleteVideo(db: LearnDatabase, videoId: string): Promise<Snapshot> {
  return db.transaction('rw', bankTables(db), async () => {
    const ids = await db.activities.where('videoId').equals(videoId).primaryKeys();
    const snapshot = await deleteActivities(db, ids);
    const video = await db.videos.get(videoId);
    if (video) {
      await db.videos.delete(videoId);
      snapshot.videos.push(video);
    }
    return snapshot;
  });
}

export async function createTopic(
  db: LearnDatabase,
  name: string,
  parentId: string | null,
  now: number,
  newId: () => string = () => crypto.randomUUID(),
): Promise<Topic> {
  return db.transaction('rw', db.topics, async () => {
    const topics = await db.topics.toArray();
    const problem = topicNameProblem(name, topics);
    if (problem) throw new BankError(problem);
    if (parentId !== null) checkParent(topics, parentId);
    const topic: Topic = { id: newId(), name: cleanTopicName(name), parentId, createdAt: now };
    await db.topics.add(topic);
    return topic;
  });
}

/** Renames a topic. The old name becomes an alias, so suggestions with it land here. */
export async function renameTopic(db: LearnDatabase, id: string, name: string): Promise<Snapshot> {
  return db.transaction('rw', db.topics, async () => {
    const topics = await db.topics.toArray();
    const topic = findIn(topics, id);
    const problem = topicNameProblem(name, topics, id);
    if (problem) throw new BankError(problem);
    const cleaned = cleanTopicName(name);
    await db.topics.put({
      ...topic,
      name: cleaned,
      aliases: withAliases(topic.aliases, [topic.name], cleaned),
    });
    return { ...emptySnapshot(), topics: [topic] };
  });
}

/** Nests a topic under a top-level topic, or moves it to the top level with `null`. */
export async function setTopicParent(
  db: LearnDatabase,
  id: string,
  parentId: string | null,
): Promise<Snapshot> {
  return db.transaction('rw', db.topics, async () => {
    const topics = await db.topics.toArray();
    const topic = findIn(topics, id);
    if (parentId !== null) {
      if (parentId === id) throw new BankError('A topic cannot be nested under itself.');
      checkParent(topics, parentId);
      if (topics.some((t) => t.parentId === id)) {
        throw new BankError(`"${topic.name}" has subtopics, so it stays at the top level.`);
      }
    }
    await db.topics.put({ ...topic, parentId });
    return { ...emptySnapshot(), topics: [topic] };
  });
}

/**
 * Moves a topic's activities into another topic and removes it. Its subtopics move under the
 * target when the target is top-level, otherwise to the top level.
 */
export async function mergeTopics(
  db: LearnDatabase,
  sourceId: string,
  targetId: string,
  now: number,
): Promise<Snapshot> {
  if (sourceId === targetId) throw new BankError('Choose a different topic to merge into.');
  return db.transaction('rw', [db.topics, db.activities], async () => {
    const topics = await db.topics.toArray();
    const source = findIn(topics, sourceId);
    const target = findIn(topics, targetId);
    const mergedTarget: Topic = {
      ...target,
      parentId: target.parentId === sourceId ? null : target.parentId,
      aliases: withAliases(target.aliases, [source.name, ...(source.aliases ?? [])], target.name),
    };
    const childParent = mergedTarget.parentId === null ? targetId : null;
    const children = topics.filter((t) => t.parentId === sourceId && t.id !== targetId);

    await db.topics.put(mergedTarget);
    await db.topics.bulkPut(children.map((child) => ({ ...child, parentId: childParent })));
    await db.topics.delete(sourceId);
    const ids = await db.activities.where('topicId').equals(sourceId).primaryKeys();
    const moved = await updateActivities(db, ids, { topicId: targetId, updatedAt: now });
    return { ...moved, topics: [source, target, ...children] };
  });
}

/** Deletes a topic with its activities. Its subtopics and their activities move to the top level. */
export async function deleteTopic(db: LearnDatabase, id: string): Promise<Snapshot> {
  return db.transaction('rw', bankTables(db), async () => {
    const topics = await db.topics.toArray();
    const topic = findIn(topics, id);
    const children = topics.filter((t) => t.parentId === id);
    await db.topics.bulkPut(children.map((child) => ({ ...child, parentId: null })));
    await db.topics.delete(id);
    const ids = await db.activities.where('topicId').equals(id).primaryKeys();
    const snapshot = await deleteActivities(db, ids);
    return { ...snapshot, topics: [topic, ...children] };
  });
}

function checkParent(topics: readonly Topic[], parentId: string): void {
  const parent = findIn(topics, parentId);
  if (parent.parentId !== null) {
    throw new BankError(`"${parent.name}" is a subtopic. Topics nest only one level deep.`);
  }
}

function withAliases(
  current: readonly string[] | undefined,
  added: readonly string[],
  name: string,
): string[] {
  const aliases: string[] = [];
  for (const alias of [...(current ?? []), ...added]) {
    if (!sameTopicName(alias, name) && !aliases.some((kept) => sameTopicName(kept, alias))) {
      aliases.push(alias);
    }
  }
  return aliases;
}

function findIn(topics: readonly Topic[], id: string): Topic {
  const topic = topics.find((t) => t.id === id);
  if (!topic) throw new BankError('This topic no longer exists.');
  return topic;
}

async function requireTopic(db: LearnDatabase, id: string): Promise<Topic> {
  const topic = await db.topics.get(id);
  if (!topic) throw new BankError('This topic no longer exists.');
  return topic;
}

async function requireActivity(db: LearnDatabase, id: string): Promise<StoredActivity> {
  const activity = await db.activities.get(id);
  if (!activity) throw new BankError('This activity no longer exists.');
  return activity;
}
