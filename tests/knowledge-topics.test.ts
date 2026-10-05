import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LearnDatabase, type Topic } from '@/lib/db';
import {
  findTopic,
  resolveTopicId,
  splitTopicPath,
  topicNameProblem,
  topicNamesForPrompt,
} from '@/lib/knowledge/topics';

const topic = (id: string, name: string, parentId: string | null = null, extra = {}): Topic => ({
  id,
  name,
  parentId,
  createdAt: 0,
  ...extra,
});

const TOPICS = [
  topic('bio', 'Biology', null, { createdAt: 1 }),
  topic('gen', 'Genetics', 'bio', { createdAt: 3, aliases: ['Heredity'] }),
  topic('chem', 'Chemistry', null, { createdAt: 2, aliases: ['Genetics'] }),
];

describe('topic names', () => {
  it('splits paths and keeps only one level of nesting', () => {
    expect(splitTopicPath('  Biology  >  Cell   Biology ')).toEqual(['Biology', 'Cell Biology']);
    expect(splitTopicPath('A > B > C')).toEqual(['A', 'C']);
    expect(splitTopicPath(' > ')).toEqual([]);
  });

  it('finds topics by name, path, or alias, preferring current names', () => {
    expect(findTopic(TOPICS, 'biology')?.id).toBe('bio');
    expect(findTopic(TOPICS, 'Biology > Genetics')?.id).toBe('gen');
    expect(findTopic(TOPICS, 'genetics')?.id).toBe('gen');
    expect(findTopic(TOPICS, 'Heredity')?.id).toBe('gen');
    expect(findTopic(TOPICS, 'Physics')).toBeUndefined();
  });

  it('lists paths for the prompt, newest first', () => {
    expect(topicNamesForPrompt(TOPICS)).toEqual(['Biology > Genetics', 'Chemistry', 'Biology']);
  });

  it('rejects empty, nested, and duplicate names', () => {
    expect(topicNameProblem('  ', TOPICS)).toBe('Enter a topic name.');
    expect(topicNameProblem('A > B', TOPICS)).toMatch(/cannot contain/);
    expect(topicNameProblem('biology', TOPICS)).toMatch(/already exists/);
    expect(topicNameProblem('biology', TOPICS, 'bio')).toBeNull();
    expect(topicNameProblem('Physics', TOPICS)).toBeNull();
  });
});

describe('resolving suggested topics', () => {
  let db: LearnDatabase;
  let counter = 0;
  const newId = () => `t${++counter}`;

  beforeEach(async () => {
    db = new LearnDatabase(`topics-${crypto.randomUUID()}`);
    await db.topics.bulkAdd(TOPICS);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('reuses a matching topic', async () => {
    expect(await resolveTopicId(db, 'Heredity', 1, newId)).toBe('gen');
    expect(await db.topics.count()).toBe(3);
  });

  it('creates a subtopic under an existing parent', async () => {
    const id = await resolveTopicId(db, 'Biology > Ecology', 5, newId);
    expect(await db.topics.get(id)).toMatchObject({ name: 'Ecology', parentId: 'bio' });
  });

  it('creates a missing parent and keeps one level of nesting', async () => {
    const id = await resolveTopicId(db, 'Physics > Optics', 5, newId);
    const created = await db.topics.get(id);
    expect(await db.topics.get(created!.parentId!)).toMatchObject({
      name: 'Physics',
      parentId: null,
    });

    const sibling = await resolveTopicId(db, 'Genetics > Epigenetics', 5, newId);
    expect((await db.topics.get(sibling))?.parentId).toBe('bio');
  });

  it('falls back to General for an empty name', async () => {
    const id = await resolveTopicId(db, '  ', 5, newId);
    expect((await db.topics.get(id))?.name).toBe('General');
  });
});
