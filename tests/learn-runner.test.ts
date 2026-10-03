import { describe, expect, it } from 'vitest';
import {
  checkCloze,
  checkOrder,
  checkTrueFalse,
  moveItem,
  multipleChoiceOptions,
  shuffledOrder,
} from '@/lib/learn/check-answer';
import { activityFields } from '@/lib/learn/describe';
import {
  initialRunnerState,
  runnerReducer,
  type RunnerAction,
  type RunnerState,
} from '@/lib/learn/runner';
import type { Activity } from '@/lib/learn/schema';

const activity = (overrides: Partial<Activity> = {}): Activity => ({
  type: 'recall',
  prompt: 'Why?',
  answer: 'Because.',
  explanation: '',
  options: [],
  sourceStartSec: 0,
  ...overrides,
});

const run = (state: RunnerState, ...actions: RunnerAction[]) =>
  actions.reduce(runnerReducer, state);

describe('runnerReducer', () => {
  const activities = [
    activity({ type: 'flashcard' }),
    activity({ type: 'cloze', prompt: 'A ____ B', answer: 'x' }),
    activity({ type: 'true_false', answer: 'true' }),
  ];

  it('runs self-graded and checked activities through to the summary', () => {
    let state = run(initialRunnerState(activities), { type: 'start' });
    expect(state).toMatchObject({ phase: 'activity', index: 0, answered: false });

    state = run(state, { type: 'reveal' }, { type: 'grade', correct: true });
    expect(state).toMatchObject({ index: 1, results: [{ correct: true }] });

    state = run(state, { type: 'submit', correct: false });
    expect(state).toMatchObject({ index: 1, answered: true, correct: false });
    state = run(state, { type: 'next' });
    expect(state.results[1]).toEqual({ correct: false });

    state = run(state, { type: 'submit', correct: true }, { type: 'next' });
    expect(state).toMatchObject({ phase: 'summary' });
    expect(state.results[2]).toEqual({ correct: true });
  });

  it('lets a wrong checked answer be overridden as correct', () => {
    const state = run(
      initialRunnerState([activity({ type: 'cloze', prompt: 'A ____', answer: 'x' })]),
      { type: 'start' },
      { type: 'submit', correct: false },
      { type: 'override' },
      { type: 'next' },
    );
    expect(state.results).toEqual([{ correct: true }]);
  });

  it('ignores actions that do not fit the activity or step', () => {
    const start = initialRunnerState(activities);
    expect(run(start, { type: 'reveal' }, { type: 'next' })).toBe(start);

    const selfGraded = run(start, { type: 'start' });
    expect(run(selfGraded, { type: 'grade', correct: true })).toBe(selfGraded);
    expect(run(selfGraded, { type: 'submit', correct: true })).toBe(selfGraded);
    expect(run(selfGraded, { type: 'next' })).toBe(selfGraded);

    const checked = run(selfGraded, { type: 'reveal' }, { type: 'grade', correct: true });
    expect(run(checked, { type: 'reveal' })).toBe(checked);
    expect(run(checked, { type: 'next' })).toBe(checked);
    const answered = run(checked, { type: 'submit', correct: true });
    expect(run(answered, { type: 'submit', correct: false })).toBe(answered);
    expect(run(answered, { type: 'override' })).toBe(answered);
  });

  it('does not start an empty session', () => {
    const empty = initialRunnerState([]);
    expect(run(empty, { type: 'start' })).toBe(empty);
  });

  it('records a self-graded activity marked incorrect', () => {
    const state = run(
      initialRunnerState([activity({ type: 'apply' })]),
      { type: 'start' },
      { type: 'reveal' },
      { type: 'grade', correct: false },
    );
    expect(state).toMatchObject({ phase: 'summary', results: [{ correct: false }] });
  });
});

describe('checkCloze', () => {
  const cloze = activity({
    type: 'cloze',
    prompt: 'Each neuron holds its ____.',
    answer: 'activation',
    options: ['activation value'],
  });

  it.each([
    ['activation', true],
    ['  Activation. ', true],
    ['the activation', true],
    ['activaton', true],
    ['activation value', true],
    ['weight', false],
    ['', false],
  ])('%j is %s', (input, expected) => {
    expect(checkCloze(input, cloze)).toBe(expected);
  });

  it('allows no typos in very short answers', () => {
    const short = activity({ type: 'cloze', prompt: '____', answer: 'DNA' });
    expect(checkCloze('dna', short)).toBe(true);
    expect(checkCloze('dnb', short)).toBe(false);
  });
});

describe('multiple choice, true or false, and ordering helpers', () => {
  it('shuffles the answer in among the wrong options', () => {
    const choice = activity({ type: 'multiple_choice', answer: 'A', options: ['B', 'C', 'D'] });
    const { options, answerIndex } = multipleChoiceOptions(choice, () => 0);
    expect([...options].sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(options[answerIndex]).toBe('A');
  });

  it('checks true or false choices', () => {
    expect(checkTrueFalse(true, activity({ answer: 'true' }))).toBe(true);
    expect(checkTrueFalse(true, activity({ answer: 'false' }))).toBe(false);
  });

  it('never starts ordering items in the correct order', () => {
    const ordering = activity({ type: 'ordering', options: ['1', '2', '3'] });
    for (const value of [0, 0.5, 0.99]) {
      const order = shuffledOrder(ordering, () => value);
      expect([...order].sort()).toEqual(['1', '2', '3']);
      expect(checkOrder(order, ordering)).toBe(false);
    }
    expect(checkOrder(['1', '2', '3'], ordering)).toBe(true);
  });

  it('moves items within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
});

describe('activityFields', () => {
  it('describes answers per type', () => {
    expect(
      activityFields(activity({ type: 'multiple_choice', answer: 'A', options: ['B', 'C'] })),
    ).toEqual([
      { label: 'Answer', value: 'A' },
      { label: 'Wrong options', value: 'B | C' },
    ]);
    expect(activityFields(activity({ type: 'ordering', options: ['x', 'y'] }))).toEqual([
      { label: 'Correct order', value: '1. x  2. y' },
    ]);
    expect(
      activityFields(activity({ type: 'true_false', answer: 'false', explanation: 'It is not.' })),
    ).toEqual([
      { label: 'Answer', value: 'False' },
      { label: 'Why', value: 'It is not.' },
    ]);
    expect(activityFields(activity({ type: 'cloze', answer: 'x', options: ['y'] }))).toEqual([
      { label: 'Answer', value: 'x' },
      { label: 'Also accepted', value: 'y' },
    ]);
  });
});
