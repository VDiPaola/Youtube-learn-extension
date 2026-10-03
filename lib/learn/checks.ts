import type { ActivitySet } from '@/lib/learn/schema';

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const VIDEO_REFERENCE = /\b(the|this) (video|speaker|narrator|presenter|lecturer|host)\b/i;
const MAX_ANSWER_CHARS = 300;
const MIN_FOR_VARIETY = 4;

export function runChecks(
  set: ActivitySet,
  durationSec: number,
  maxActivities: number,
): CheckResult[] {
  const check = (name: string, failures: string[]): CheckResult => ({
    name,
    passed: failures.length === 0,
    detail: failures.length > 0 ? failures.join('; ') : undefined,
  });
  const activities = set.activities.map((a, i) => ({ ...a, label: `activity ${i + 1}` }));
  const topicWords = set.topic.trim().split(/\s+/).length;
  const types = new Set(activities.map((a) => a.type));

  return [
    check(
      `Activity count between 1 and ${maxActivities}`,
      activities.length >= 1 && activities.length <= maxActivities
        ? []
        : [`${activities.length} activities`],
    ),
    check('Topic has 1 to 5 words', set.topic.trim() && topicWords <= 5 ? [] : [`"${set.topic}"`]),
    check(
      'Uses at least two activity types',
      activities.length < MIN_FOR_VARIETY || types.size >= 2 ? [] : [[...types].join(', ')],
    ),
    check(
      'Timestamps inside the video',
      activities
        .filter((a) => a.sourceStartSec < 0 || a.sourceStartSec > durationSec)
        .map((a) => `${a.label} at ${a.sourceStartSec}s`),
    ),
    check(
      'Prompts do not refer to the video or speaker',
      activities.filter((a) => VIDEO_REFERENCE.test(a.prompt)).map((a) => a.label),
    ),
    check(
      `Answers under ${MAX_ANSWER_CHARS} characters`,
      activities.filter((a) => a.answer.length > MAX_ANSWER_CHARS).map((a) => a.label),
    ),
  ];
}
