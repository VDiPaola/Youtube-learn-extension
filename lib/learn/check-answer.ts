import { normalize } from './clean';
import type { Activity } from './schema';

const ARTICLES = new Set(['a', 'an', 'the']);

/** Accepts the answer or an alternative, ignoring case, punctuation, articles, and small typos. */
export function checkCloze(input: string, activity: Activity): boolean {
  const given = clozeKey(input);
  if (!given) return false;
  return [activity.answer, ...activity.options].some((accepted) => {
    const expected = clozeKey(accepted);
    return given === expected || editDistance(given, expected) <= typoAllowance(expected);
  });
}

function clozeKey(text: string): string {
  return normalize(text)
    .filter((word, i, words) => !(ARTICLES.has(word) && words.length > 1 && i === 0))
    .join(' ');
}

function typoAllowance(expected: string): number {
  if (expected.length >= 8) return 2;
  if (expected.length >= 4) return 1;
  return 0;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length]!;
}

export interface ChoiceSet {
  options: string[];
  answerIndex: number;
}

/** The correct option shuffled among the wrong ones. */
export function multipleChoiceOptions(
  activity: Activity,
  random: () => number = Math.random,
): ChoiceSet {
  const options = shuffle([activity.answer, ...activity.options], random);
  return { options, answerIndex: options.indexOf(activity.answer) };
}

export function checkTrueFalse(choice: boolean, activity: Activity): boolean {
  return (activity.answer === 'true') === choice;
}

/** Ordering items shuffled so they never start in the correct order. */
export function shuffledOrder(activity: Activity, random: () => number = Math.random): string[] {
  const items = shuffle(activity.options, random);
  const unchanged = items.every((item, i) => item === activity.options[i]);
  return unchanged ? [...items.slice(1), items[0]!] : items;
}

export function checkOrder(order: readonly string[], activity: Activity): boolean {
  return (
    order.length === activity.options.length &&
    order.every((item, i) => item === activity.options[i])
  );
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items];
  const result = [...items];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item!);
  return result;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
