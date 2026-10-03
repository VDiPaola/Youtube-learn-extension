import { BLANK, type Activity, type ActivityType } from './schema';

const DUPLICATE_SIMILARITY = 0.8;
const WRONG_OPTIONS = 3;
const MIN_ORDER_ITEMS = 3;
const MAX_ORDER_ITEMS = 8;

/**
 * Drops disallowed and malformed activities, normalizes fields per type, removes near-duplicates,
 * caps the count, and sorts by timestamp.
 */
export function cleanActivities(
  activities: readonly Activity[],
  durationSec: number,
  maxCount: number,
  allowedTypes: ReadonlySet<ActivityType>,
): Activity[] {
  const cleaned: Activity[] = [];
  for (const activity of activities) {
    if (!allowedTypes.has(activity.type)) continue;
    const normalized = normalizeActivity(activity, durationSec);
    if (!normalized) continue;
    if (
      cleaned.some((kept) => similarity(kept.prompt, normalized.prompt) >= DUPLICATE_SIMILARITY)
    ) {
      continue;
    }
    cleaned.push(normalized);
    if (cleaned.length === maxCount) break;
  }
  return cleaned.sort((a, b) => a.sourceStartSec - b.sourceStartSec);
}

/** Returns the activity with fields fixed for its type, or null when it cannot be used. */
export function normalizeActivity(activity: Activity, durationSec: number): Activity | null {
  const prompt = activity.prompt.trim();
  const answer = activity.answer.trim();
  const explanation = activity.explanation.trim();
  const options = uniqueTexts(activity.options);
  const sourceStartSec = Math.min(
    Math.max(0, Math.round(activity.sourceStartSec) || 0),
    durationSec,
  );
  const base = { type: activity.type, prompt, answer, explanation, sourceStartSec };
  if (!prompt) return null;

  switch (activity.type) {
    case 'recall':
    case 'flashcard':
    case 'apply':
      return answer ? { ...base, options: [] } : null;

    case 'cloze': {
      const withBlank = prompt.replace(/_{3,}/g, BLANK);
      if (!answer || withBlank.split(BLANK).length !== 2) return null;
      return {
        ...base,
        prompt: withBlank,
        options: options.filter((option) => !sameText(option, answer)),
      };
    }

    case 'multiple_choice': {
      const wrong = options.filter((option) => !sameText(option, answer)).slice(0, WRONG_OPTIONS);
      return answer && wrong.length >= 2 ? { ...base, options: wrong } : null;
    }

    case 'true_false': {
      const value = answer.toLowerCase();
      return value === 'true' || value === 'false' ? { ...base, answer: value, options: [] } : null;
    }

    case 'ordering':
      return options.length >= MIN_ORDER_ITEMS && options.length <= MAX_ORDER_ITEMS
        ? { ...base, answer: '', options }
        : null;
  }
}

function uniqueTexts(texts: readonly string[]): string[] {
  const result: string[] = [];
  for (const text of texts.map((t) => t.trim())) {
    if (text && !result.some((kept) => sameText(kept, text))) result.push(text);
  }
  return result;
}

export function sameText(a: string, b: string): boolean {
  return normalize(a).join(' ') === normalize(b).join(' ');
}

/** Jaccard similarity of word sets. */
export function similarity(a: string, b: string): number {
  const wordsA = new Set(normalize(a));
  const wordsB = new Set(normalize(b));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return shared / (wordsA.size + wordsB.size - shared);
}

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
