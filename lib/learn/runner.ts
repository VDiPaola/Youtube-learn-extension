import { isSelfGraded, type Activity } from './schema';

export interface ActivityResult {
  correct: boolean;
}

export interface RunnerState {
  phase: 'start' | 'activity' | 'summary';
  activities: readonly Activity[];
  index: number;
  /** Self-graded: the answer is shown. Checked activities: the response was checked. */
  answered: boolean;
  /** Result of the automatic check for the current activity. */
  correct: boolean | null;
  results: ActivityResult[];
}

export type RunnerAction =
  | { type: 'start' }
  | { type: 'reveal' }
  | { type: 'grade'; correct: boolean }
  | { type: 'submit'; correct: boolean }
  | { type: 'override' }
  | { type: 'next' };

export function initialRunnerState(activities: readonly Activity[]): RunnerState {
  return { phase: 'start', activities, index: 0, answered: false, correct: null, results: [] };
}

export function currentActivity(state: RunnerState): Activity | undefined {
  return state.phase === 'activity' ? state.activities[state.index] : undefined;
}

export function runnerReducer(state: RunnerState, action: RunnerAction): RunnerState {
  if (action.type === 'start') {
    return state.phase === 'start' && state.activities.length > 0
      ? { ...state, phase: 'activity' }
      : state;
  }

  const activity = currentActivity(state);
  if (!activity) return state;
  const selfGraded = isSelfGraded(activity.type);

  switch (action.type) {
    case 'reveal':
      return selfGraded && !state.answered ? { ...state, answered: true } : state;

    case 'grade':
      return selfGraded && state.answered ? advance(state, { correct: action.correct }) : state;

    case 'submit':
      return !selfGraded && !state.answered
        ? { ...state, answered: true, correct: action.correct }
        : state;

    case 'override':
      return !selfGraded && state.answered && state.correct === false
        ? { ...state, correct: true }
        : state;

    case 'next':
      return !selfGraded && state.answered
        ? advance(state, { correct: state.correct === true })
        : state;
  }
}

function advance(state: RunnerState, result: ActivityResult): RunnerState {
  const results = [...state.results, result];
  const next = { ...state, results, answered: false, correct: null };
  return state.index + 1 < state.activities.length
    ? { ...next, index: state.index + 1 }
    : { ...next, phase: 'summary' };
}
