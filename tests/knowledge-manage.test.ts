import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LearnDatabase, type StoredActivity } from '@/lib/db';
import {
  countDue,
  loadReviewQueue,
  recordVideoResult,
  type VideoResult,
} from '@/lib/knowledge/bank';
import { ALL_TOPICS, filterActivities, groupByVideo, topicRows } from '@/lib/knowledge/browse';
import {
  BankError,
  createTopic,
  deleteActivities,
  deleteTopic,
  deleteVideo,
  editActivity,
  loadBank,
  mergeTopics,
  moveActivities,
  renameTopic,
  setSuspended,
  setTopicParent,
  undo,
  type Snapshot,
} from '@/lib/knowledge/manage';
import type { Activity } from '@/lib/learn/schema';

const START = Date.UTC(2026, 9, 1, 12);
const LATER = START + 30 * 86_400_000;

const activity = (prompt: string, overrides: Partial<Activity> = {}): Activity => ({
  type: 'recall',
  prompt,
  answer: 'An answer.',
  explanation: '',
  options: [],
  sourceStartSec: 30,
  ...overrides,
});

let db: LearnDatabase;

/** Saves an incorrect answer, so the activity is due by `LATER`. */
async function save(
  prompt: string,
  {
    videoId = 'v1',
    topic = 'Biology',
    ...overrides
  }: Partial<Activity> & {
    videoId?: string;
    topic?: string;
  } = {},
): Promise<StoredActivity> {
  const result: VideoResult = {
    video: {
      id: videoId,
      title: `Video ${videoId}`,
      channelId: 'UC1',
      channelName: 'Channel',
      durationSec: 600,
    },
    topic,
    generatedAt: START,
    activity: activity(prompt, overrides),
    correct: false,
  };
  return recordVideoResult(db, result, { now: START, desiredRetention: 0.9 });
}

const queueIds = async () => (await loadReviewQueue(db, LATER)).map((item) => item.activity.id);
const topicId = async (name: string) => (await db.topics.where('name').equals(name).first())!.id;

/** Every record in the bank, for comparing before and after an undo. */
const everything = async () => {
  const bank = await loadBank(db);
  const reviewLogs = await db.reviewLogs.toArray();
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    topics: byId(bank.topics),
    videos: byId(bank.videos),
    activities: byId(bank.activities),
    reviewLogs: byId(reviewLogs),
  };
};

async function expectUndoRestores(action: () => Promise<Snapshot>) {
  const before = await everything();
  const snapshot = await action();
  expect(await everything()).not.toEqual(before);
  await undo(db, snapshot);
  expect(await everything()).toEqual(before);
}

beforeEach(() => {
  db = new LearnDatabase(`manage-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('activities', () => {
  it('edits text, keeps the generated prompt, and validates by type', async () => {
    const saved = await save('Old?');
    await editActivity(
      db,
      saved.id,
      { prompt: ' New? ', answer: 'New.', explanation: 'Why.', options: [] },
      LATER,
    );
    expect(await db.activities.get(saved.id)).toMatchObject({
      prompt: 'New?',
      answer: 'New.',
      explanation: 'Why.',
      generatedPrompt: 'Old?',
      updatedAt: LATER,
      fsrs: saved.fsrs,
    });

    await editActivity(
      db,
      saved.id,
      { prompt: 'Newer?', answer: 'A.', explanation: '', options: [] },
      LATER,
    );
    expect((await db.activities.get(saved.id))?.generatedPrompt).toBe('Old?');

    const choice = await save('Pick one', {
      type: 'multiple_choice',
      answer: 'A',
      options: ['B', 'C'],
    });
    await expect(
      editActivity(
        db,
        choice.id,
        { prompt: 'Pick', answer: 'A', explanation: '', options: ['B'] },
        LATER,
      ),
    ).rejects.toThrow(BankError);
    await expect(
      editActivity(
        db,
        'missing',
        { prompt: 'P', answer: 'A', explanation: '', options: [] },
        LATER,
      ),
    ).rejects.toThrow('no longer exists');
  });

  it('suspends and resumes, updating the review queue', async () => {
    const a = await save('A?');
    const b = await save('B?');
    await setSuspended(db, [a.id], true, LATER);
    expect(await queueIds()).toEqual([b.id]);
    expect(await countDue(db, LATER)).toBe(1);
    await setSuspended(db, [a.id], false, LATER);
    expect(await countDue(db, LATER)).toBe(2);
  });

  it('moves activities between topics, shown in the review queue', async () => {
    const a = await save('A?');
    const chemistry = await createTopic(db, 'Chemistry', null, START);
    await moveActivities(db, [a.id], chemistry.id, LATER);
    expect((await db.activities.get(a.id))?.topicId).toBe(chemistry.id);
    expect((await loadReviewQueue(db, LATER))[0]?.topic).toBe('Chemistry');
    await expect(moveActivities(db, [a.id], 'missing', LATER)).rejects.toThrow(BankError);
  });

  it('deletes activities with their review logs and removes them from reviews', async () => {
    const a = await save('A?');
    const b = await save('B?', { videoId: 'v2' });
    await deleteActivities(db, [b.id]);
    expect(await queueIds()).toEqual([a.id]);
    expect(await db.reviewLogs.where('activityId').equals(b.id).count()).toBe(0);
    expect(await db.videos.get('v2')).toBeUndefined();
    expect(await db.videos.get('v1')).toBeDefined();
  });

  it('deletes all activities from one video', async () => {
    await save('A?');
    await save('B?');
    const other = await save('C?', { videoId: 'v2' });
    await deleteVideo(db, 'v1');
    expect(await queueIds()).toEqual([other.id]);
    expect((await db.videos.toArray()).map((v) => v.id)).toEqual(['v2']);
    expect(await db.reviewLogs.count()).toBe(1);
  });

  it('undoes every activity action', async () => {
    const a = await save('A?');
    const b = await save('B?', { videoId: 'v2' });
    const chemistry = await createTopic(db, 'Chemistry', null, START);
    await expectUndoRestores(() =>
      editActivity(db, a.id, { prompt: 'X?', answer: 'Y.', explanation: '', options: [] }, LATER),
    );
    await expectUndoRestores(() => setSuspended(db, [a.id, b.id], true, LATER));
    await expectUndoRestores(() => moveActivities(db, [a.id], chemistry.id, LATER));
    await expectUndoRestores(() => deleteActivities(db, [a.id, b.id]));
    await expectUndoRestores(() => deleteVideo(db, 'v1'));
    expect(await countDue(db, LATER)).toBe(2);
  });
});

describe('topics', () => {
  it('creates top-level topics and subtopics with unique names', async () => {
    const parent = await createTopic(db, ' Physics ', null, START);
    const child = await createTopic(db, 'Optics', parent.id, START);
    expect(parent).toMatchObject({ name: 'Physics', parentId: null });
    expect(child.parentId).toBe(parent.id);
    await expect(createTopic(db, 'physics', null, START)).rejects.toThrow('already exists');
    await expect(createTopic(db, 'Lenses', child.id, START)).rejects.toThrow('one level');
  });

  it('renames a topic and keeps the old name for suggestions', async () => {
    const a = await save('A?');
    await renameTopic(db, a.topicId, 'Life Science');
    expect(await db.topics.get(a.topicId)).toMatchObject({
      name: 'Life Science',
      aliases: ['Biology'],
    });
    expect((await loadReviewQueue(db, LATER))[0]?.topic).toBe('Life Science');

    const fromNewVideo = await save('B?', { videoId: 'v2', topic: 'Biology' });
    expect(fromNewVideo.topicId).toBe(a.topicId);

    await createTopic(db, 'Chemistry', null, START);
    await expect(renameTopic(db, a.topicId, 'chemistry')).rejects.toThrow('already exists');
  });

  it('nests a topic one level deep and moves it back to the top level', async () => {
    const bio = await createTopic(db, 'Biology', null, START);
    const gen = await createTopic(db, 'Genetics', null, START);
    const eco = await createTopic(db, 'Ecology', null, START);

    await setTopicParent(db, gen.id, bio.id);
    expect((await db.topics.get(gen.id))?.parentId).toBe(bio.id);
    await expect(setTopicParent(db, eco.id, gen.id)).rejects.toThrow('one level');
    await expect(setTopicParent(db, bio.id, eco.id)).rejects.toThrow('has subtopics');
    await expect(setTopicParent(db, eco.id, eco.id)).rejects.toThrow('itself');

    await setTopicParent(db, gen.id, null);
    expect((await db.topics.get(gen.id))?.parentId).toBeNull();
  });

  it('merges a topic into another, moving activities, subtopics, and names', async () => {
    const a = await save('A?', { topic: 'Genes' });
    const b = await save('B?', { videoId: 'v2', topic: 'Biology' });
    const genes = a.topicId;
    const biology = b.topicId;
    const child = await createTopic(db, 'Mutations', genes, START);
    await renameTopic(db, genes, 'Genetics');

    await mergeTopics(db, genes, biology, LATER);
    expect(await db.topics.get(genes)).toBeUndefined();
    expect((await db.activities.get(a.id))?.topicId).toBe(biology);
    expect((await db.topics.get(child.id))?.parentId).toBe(biology);
    expect((await db.topics.get(biology))?.aliases).toEqual(['Genetics', 'Genes']);
    expect((await loadReviewQueue(db, LATER)).map((item) => item.topic)).toEqual([
      'Biology',
      'Biology',
    ]);
    await expect(mergeTopics(db, biology, biology, LATER)).rejects.toThrow('different topic');
  });

  it('merges a parent into its own subtopic', async () => {
    const parent = await createTopic(db, 'Science', null, START);
    const target = await createTopic(db, 'Physics', parent.id, START);
    const sibling = await createTopic(db, 'Chemistry', parent.id, START);
    await mergeTopics(db, parent.id, target.id, LATER);
    expect((await db.topics.get(target.id))?.parentId).toBeNull();
    expect((await db.topics.get(sibling.id))?.parentId).toBe(target.id);
  });

  it('moves subtopics to the top level when merging into a subtopic', async () => {
    const source = await createTopic(db, 'Source', null, START);
    const child = await createTopic(db, 'Child', source.id, START);
    const parent = await createTopic(db, 'Parent', null, START);
    const target = await createTopic(db, 'Target', parent.id, START);
    await mergeTopics(db, source.id, target.id, LATER);
    expect((await db.topics.get(child.id))?.parentId).toBeNull();
  });

  it('deletes a topic with its activities and lifts its subtopics', async () => {
    const a = await save('A?');
    const other = await save('B?', { videoId: 'v2', topic: 'Genetics' });
    await setTopicParent(db, other.topicId, a.topicId);

    await deleteTopic(db, a.topicId);
    expect(await db.topics.get(a.topicId)).toBeUndefined();
    expect(await db.activities.get(a.id)).toBeUndefined();
    expect((await db.topics.get(other.topicId))?.parentId).toBeNull();
    expect(await queueIds()).toEqual([other.id]);
  });

  it('undoes every topic action', async () => {
    const a = await save('A?');
    const b = await save('B?', { videoId: 'v2', topic: 'Genetics' });
    await expectUndoRestores(() => renameTopic(db, a.topicId, 'Life'));
    await expectUndoRestores(() => setTopicParent(db, b.topicId, a.topicId));
    await expectUndoRestores(() => mergeTopics(db, b.topicId, a.topicId, LATER));
    await setTopicParent(db, b.topicId, a.topicId);
    await expectUndoRestores(() => deleteTopic(db, a.topicId));
    expect(await countDue(db, LATER)).toBe(2);
  });
});

describe('browsing', () => {
  it('lists topics with subtopics, counting activities and due ones', async () => {
    await save('A?');
    await save('B?', { videoId: 'v2', topic: 'Genetics' });
    await setTopicParent(db, await topicId('Genetics'), await topicId('Biology'));
    const empty = await createTopic(db, 'Art', null, START);

    const rows = topicRows(await loadBank(db), LATER);
    expect(rows.map((row) => [row.path, row.depth, row.count, row.due])).toEqual([
      ['Art', 0, 0, 0],
      ['Biology', 0, 2, 2],
      ['Biology > Genetics', 1, 1, 1],
    ]);
    expect(rows[0]?.topic.id).toBe(empty.id);
  });

  it('filters by topic, including subtopics, and searches all text', async () => {
    const a = await save('Cell division?', { answer: 'Mitosis' });
    const b = await save('Café?', { videoId: 'v2', topic: 'Genetics', options: [] });
    const c = await save('Bonds?', { videoId: 'v3', topic: 'Chemistry', explanation: 'Electrons' });
    await setTopicParent(db, b.topicId, a.topicId);
    const bank = await loadBank(db);
    const ids = (selected: string, query = '') =>
      filterActivities(bank, selected, query).map((x) => x.id);

    expect(new Set(ids(ALL_TOPICS))).toEqual(new Set([a.id, b.id, c.id]));
    expect(new Set(ids(a.topicId))).toEqual(new Set([a.id, b.id]));
    expect(ids(b.topicId)).toEqual([b.id]);
    expect(ids(ALL_TOPICS, 'MITOSIS')).toEqual([a.id]);
    expect(ids(ALL_TOPICS, 'cafe')).toEqual([b.id]);
    expect(ids(ALL_TOPICS, 'electrons bonds')).toEqual([c.id]);
    expect(ids(ALL_TOPICS, 'video v3')).toEqual([c.id]);
    expect(ids(a.topicId, 'electrons')).toEqual([]);
  });

  it('groups activities by video, newest video first, in video order', async () => {
    await save('Late?', { sourceStartSec: 90 });
    await save('Early?', { sourceStartSec: 10 });
    await save('Other?', { videoId: 'v2' });
    await db.videos.update('v2', { activitiesGeneratedAt: START + 1 });

    const bank = await loadBank(db);
    const groups = groupByVideo(filterActivities(bank, ALL_TOPICS, ''), bank.videos);
    expect(groups.map((g) => [g.videoId, g.activities.map((x) => x.prompt)])).toEqual([
      ['v2', ['Other?']],
      ['v1', ['Early?', 'Late?']],
    ]);
    expect(groups[0]?.video?.title).toBe('Video v2');
  });
});
