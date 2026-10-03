import { QuizError } from './errors';
import { ActivitySetSchema, type ActivitySet } from './schema';

/** Some local models wrap JSON in Markdown fences even with a schema, so strip them. */
export function parseActivitySetJson(content: string | null | undefined): ActivitySet {
  if (!content) throw new QuizError('invalid-output', 'The model returned an empty response.');
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new QuizError('invalid-output', 'The model returned a quiz in the wrong format.');
  }
  const result = ActivitySetSchema.safeParse(parsed);
  if (!result.success) {
    throw new QuizError('invalid-output', 'The model returned a quiz with missing fields.');
  }
  return result.data;
}
