// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivityRunner, type RunnerOptions } from '@/components/activities/ActivityView';
import type { RunnerAction } from '@/lib/learn/runner';
import type { Activity } from '@/lib/learn/schema';

const activity = (type: Activity['type'], prompt: string): Activity => ({
  type,
  prompt,
  answer: 'a',
  explanation: '',
  options: [],
  sourceStartSec: 0,
});

const ACTIVITIES = [
  activity('recall', 'R?'),
  activity('cloze', 'C ____.'),
  activity('apply', 'A?'),
];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let dispatch: (action: RunnerAction) => void;
let phase: string;

function Harness(props: RunnerOptions) {
  const runner = useActivityRunner(ACTIVITIES, props);
  dispatch = runner.dispatch;
  phase = runner.state.phase;
  return null;
}

const mount = (options: RunnerOptions) => act(() => root.render(createElement(Harness, options)));
const send = (action: RunnerAction) => act(() => dispatch(action));

beforeEach(() => {
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
});

describe('activity runner hook', () => {
  it('reports each finished activity once', () => {
    const onResult = vi.fn();
    mount({ onResult });
    send({ type: 'start' });
    send({ type: 'reveal' });
    send({ type: 'grade', correct: false });
    send({ type: 'submit', correct: false });
    send({ type: 'override' });
    send({ type: 'next' });
    mount({ onResult });

    expect(onResult.mock.calls).toEqual([
      [ACTIVITIES[0], false],
      [ACTIVITIES[1], true],
    ]);
  });

  it('starts on the first activity when asked', () => {
    mount({ autoStart: true });
    expect(phase).toBe('activity');
  });

  it('saves a checked answer when the session closes before Continue', () => {
    const onResult = vi.fn();
    mount({ onResult, autoStart: true });
    send({ type: 'reveal' });
    send({ type: 'grade', correct: true });
    send({ type: 'submit', correct: false });
    act(() => root.render(null));

    expect(onResult.mock.calls).toEqual([
      [ACTIVITIES[0], true],
      [ACTIVITIES[1], false],
    ]);
  });

  it('does not save a self-graded answer that was shown but not graded', () => {
    const onResult = vi.fn();
    mount({ onResult, autoStart: true });
    send({ type: 'reveal' });
    act(() => root.render(null));
    expect(onResult).not.toHaveBeenCalled();
  });
});
