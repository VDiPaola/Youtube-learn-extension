import { z } from 'zod';

// Extension pages forbid eval; skip Zod's `new Function` probe and its CSP violation report.
z.config({ jitless: true });

export const ACTIVITY_TYPES = [
  'recall',
  'flashcard',
  'cloze',
  'multiple_choice',
  'true_false',
  'ordering',
  'apply',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  recall: 'Recall question',
  flashcard: 'Flashcard',
  cloze: 'Fill in the blank',
  multiple_choice: 'Multiple choice',
  true_false: 'True or false',
  ordering: 'Put in order',
  apply: 'Apply it',
};

/** Marks the gap in a fill-in-the-blank prompt. */
export const BLANK = '____';

/**
 * One flat shape for every activity type, with unused fields left empty. Strict JSON schema
 * modes (OpenAI, local servers) handle this more reliably than a union of shapes.
 */
export const ActivitySchema = z.strictObject({
  type: z.enum(ACTIVITY_TYPES),
  prompt: z
    .string()
    .describe(
      `recall/apply: the question or scenario. flashcard: the term or front side. cloze: one sentence with the missing part replaced by ${BLANK}. multiple_choice: the question. true_false: the statement. ordering: the instruction, for example "Put these steps in order".`,
    ),
  answer: z
    .string()
    .describe(
      'recall/apply: the expected answer. flashcard: the definition or back side. cloze: the missing word or phrase. multiple_choice: the correct option. true_false: "true" or "false". ordering: empty.',
    ),
  explanation: z
    .string()
    .describe(
      'Why the answer is right, in one or two sentences. Required for true_false (correct a false statement) and apply. Optional elsewhere: use an empty string.',
    ),
  options: z
    .array(z.string())
    .describe(
      'multiple_choice: three plausible wrong options. ordering: three to six items in the correct order. cloze: other accepted answers such as synonyms or plurals. Otherwise empty.',
    ),
  sourceStartSec: z
    .number()
    .describe('Start time in seconds of the transcript line where the idea is explained.'),
});

export const ActivitySetSchema = z.strictObject({
  topic: z.string().describe('Subject area in two to four words, in Title Case.'),
  activities: z.array(ActivitySchema),
});

export type Activity = z.infer<typeof ActivitySchema>;
export type ActivitySet = z.infer<typeof ActivitySetSchema>;

/** Activities graded by the learner's own judgement rather than an automatic check. */
export function isSelfGraded(type: ActivityType): boolean {
  return type === 'recall' || type === 'flashcard' || type === 'apply';
}
