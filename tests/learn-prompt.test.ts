import { describe, expect, it } from 'vitest';
import { cleanActivities, normalizeActivity, similarity } from '@/lib/learn/clean';
import {
  buildUserPrompt,
  chunkLines,
  formatLines,
  groupIntoLines,
  SYSTEM_PROMPT,
  targetActivityCount,
} from '@/lib/learn/prompt';
import { ACTIVITY_TYPES, type Activity, type ActivityType } from '@/lib/learn/schema';

const segment = (startSec: number, text: string) => ({
  startMs: startSec * 1000,
  durationMs: 0,
  text,
});

const activity = (overrides: Partial<Activity> = {}): Activity => ({
  type: 'recall',
  prompt: 'Why do neural networks need hidden layers?',
  answer: 'To combine simple features into complex ones.',
  explanation: '',
  options: [],
  sourceStartSec: 10,
  ...overrides,
});

const ALL = new Set<ActivityType>(ACTIVITY_TYPES);

describe('groupIntoLines', () => {
  it('merges segments into lines spanning about 20 seconds', () => {
    const lines = groupIntoLines([
      segment(0, 'one'),
      segment(5, 'two'),
      segment(19, 'three'),
      segment(20, 'four'),
      segment(65, 'five'),
    ]);
    expect(lines).toEqual([
      { startMs: 0, text: 'one two three' },
      { startMs: 20_000, text: 'four' },
      { startMs: 65_000, text: 'five' },
    ]);
  });
});

describe('formatLines and chunkLines', () => {
  it('prefixes each line with its timestamp', () => {
    expect(
      formatLines([
        { startMs: 0, text: 'Hello' },
        { startMs: 3_725_000, text: 'Later' },
      ]),
    ).toBe('[0:00] Hello\n[1:02:05] Later');
  });

  it('splits on line boundaries without exceeding the limit', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({
      startMs: i * 1000,
      text: 'x'.repeat(90),
    }));
    expect(chunkLines(lines, 300).map((chunk) => chunk.length)).toEqual([3, 3, 3, 1]);
    expect(chunkLines(lines, 10_000)).toHaveLength(1);
  });
});

describe('targetActivityCount', () => {
  it.each([
    [60, 5],
    [21 * 60, 7],
    [35 * 60, 12],
    [3 * 60 * 60, 15],
  ])('%d seconds gives %d activities', (durationSec, expected) => {
    expect(targetActivityCount(durationSec)).toBe(expected);
  });
});

describe('prompts', () => {
  it('describes every activity type in the system prompt', () => {
    for (const type of ACTIVITY_TYPES) expect(SYSTEM_PROMPT).toContain(`- ${type}:`);
  });

  it('lists the allowed types, topics, count, and transcript', () => {
    const prompt = buildUserPrompt({
      title: 'Neural networks',
      channelName: '3Blue1Brown',
      transcript: '[0:00] Hello',
      activityCount: 7,
      allowedTypes: ['recall', 'cloze'],
      existingTopics: ['Machine Learning'],
      part: { index: 2, total: 3 },
    });
    expect(prompt).toContain('Existing topics: Machine Learning');
    expect(prompt).toContain('Activity types to use: recall, cloze');
    expect(prompt).toContain('Write up to 7 activities');
    expect(prompt).toContain('This is part 2 of 3 of the transcript.');
    expect(prompt).toContain('<transcript>\n[0:00] Hello\n</transcript>');
  });
});

describe('normalizeActivity', () => {
  it('keeps self-graded activities with a prompt and answer, dropping options', () => {
    expect(normalizeActivity(activity({ options: ['stray'] }), 600)).toEqual(activity());
    expect(normalizeActivity(activity({ type: 'flashcard', answer: ' ' }), 600)).toBeNull();
  });

  it('requires exactly one blank in fill-in-the-blank prompts and accepts any underscore run', () => {
    const cloze = activity({
      type: 'cloze',
      prompt: 'Each neuron holds a number called its _______.',
      answer: 'activation',
      options: ['Activation', 'activation value'],
    });
    expect(normalizeActivity(cloze, 600)).toEqual({
      ...cloze,
      prompt: 'Each neuron holds a number called its ____.',
      options: ['activation value'],
    });
    expect(normalizeActivity({ ...cloze, prompt: 'No blank here.' }, 600)).toBeNull();
    expect(normalizeActivity({ ...cloze, prompt: '___ and ___' }, 600)).toBeNull();
  });

  it('keeps up to three distinct wrong options for multiple choice', () => {
    const choice = activity({
      type: 'multiple_choice',
      answer: 'Sigmoid',
      options: ['ReLU', 'sigmoid', 'Tanh', 'ReLU', 'Softmax', 'Linear'],
    });
    expect(normalizeActivity(choice, 600)?.options).toEqual(['ReLU', 'Tanh', 'Softmax']);
    expect(normalizeActivity({ ...choice, options: ['ReLU'] }, 600)).toBeNull();
  });

  it('normalizes true or false answers', () => {
    const statement = activity({ type: 'true_false', answer: 'False', explanation: 'It is 784.' });
    expect(normalizeActivity(statement, 600)?.answer).toBe('false');
    expect(normalizeActivity({ ...statement, answer: 'maybe' }, 600)).toBeNull();
  });

  it('requires three to eight ordering items and clears the answer', () => {
    const ordering = activity({ type: 'ordering', answer: 'x', options: ['a', 'b', 'c'] });
    expect(normalizeActivity(ordering, 600)).toMatchObject({
      answer: '',
      options: ['a', 'b', 'c'],
    });
    expect(normalizeActivity({ ...ordering, options: ['a', 'b'] }, 600)).toBeNull();
  });

  it('clamps timestamps into the video', () => {
    expect(normalizeActivity(activity({ sourceStartSec: -5 }), 600)?.sourceStartSec).toBe(0);
    expect(normalizeActivity(activity({ sourceStartSec: 999.6 }), 600)?.sourceStartSec).toBe(600);
  });
});

describe('cleanActivities', () => {
  it('drops disallowed types, malformed items, and near-duplicates, then sorts by time', () => {
    const result = cleanActivities(
      [
        activity({ sourceStartSec: 50 }),
        activity({ prompt: 'Why do neural networks need hidden layers', sourceStartSec: 60 }),
        activity({ type: 'apply', prompt: 'A new image arrives...', sourceStartSec: 5 }),
        activity({ type: 'ordering', prompt: 'Order these', options: ['only one'] }),
        activity({ type: 'flashcard', prompt: 'Neuron', answer: 'A unit holding a number' }),
      ],
      600,
      10,
      new Set<ActivityType>(['recall', 'apply', 'ordering']),
    );
    expect(result.map((a) => [a.type, a.sourceStartSec])).toEqual([
      ['apply', 5],
      ['recall', 50],
    ]);
  });

  it('caps the count', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      activity({ prompt: `Distinct question number ${i} about topic ${i * 7}?` }),
    );
    expect(cleanActivities(many, 600, 4, ALL)).toHaveLength(4);
  });
});

describe('similarity', () => {
  it('ignores case and punctuation', () => {
    expect(similarity('What is X?', 'what is x')).toBe(1);
    expect(similarity('alpha beta', 'gamma delta')).toBe(0);
  });
});
