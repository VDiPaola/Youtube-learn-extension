import { describe, expect, it } from 'vitest';
import { runChecks } from '@/lib/learn/checks';
import type { Activity, ActivitySet } from '@/lib/learn/schema';

const activity = (overrides: Partial<Activity> = {}): Activity => ({
  type: 'recall',
  prompt: 'What does each neuron in the first layer represent?',
  answer: 'The brightness of one pixel.',
  explanation: '',
  options: [],
  sourceStartSec: 120,
  ...overrides,
});

const set = (activities: Activity[], topic = 'Neural Networks'): ActivitySet => ({
  topic,
  activities,
});

const failures = (value: ActivitySet) =>
  runChecks(value, 600, 5)
    .filter((c) => !c.passed)
    .map((c) => `${c.name}: ${c.detail}`);

describe('runChecks', () => {
  it('passes a well-formed, varied set', () => {
    expect(
      failures(
        set([
          activity(),
          activity({ type: 'cloze', prompt: 'A ____ B', answer: 'x' }),
          activity({ type: 'flashcard' }),
          activity(),
        ]),
      ),
    ).toEqual([]);
  });

  it('flags each problem with the affected activities', () => {
    const bad = set(
      [
        activity({
          prompt: 'What does the speaker say about layers?',
          answer: 'x'.repeat(301),
          sourceStartSec: 601,
        }),
      ],
      'A Topic Name That Is Far Too Long',
    );
    expect(failures(bad)).toEqual([
      'Topic has 1 to 5 words: "A Topic Name That Is Far Too Long"',
      'Timestamps inside the video: activity 1 at 601s',
      'Prompts do not refer to the video or speaker: activity 1',
      'Answers under 300 characters: activity 1',
    ]);
  });

  it('requires variety once there are four or more activities', () => {
    expect(failures(set(Array(4).fill(activity())))).toEqual([
      'Uses at least two activity types: recall',
    ]);
    expect(failures(set(Array(3).fill(activity())))).toEqual([]);
  });

  it('flags empty and oversized sets', () => {
    expect(failures(set([]))).toEqual(['Activity count between 1 and 5: 0 activities']);
    expect(failures(set(Array(6).fill(activity({ type: 'apply' }))))).toEqual([
      'Activity count between 1 and 5: 6 activities',
      'Uses at least two activity types: apply',
    ]);
  });
});
