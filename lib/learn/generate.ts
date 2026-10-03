import type { TranscriptSegment } from '@/lib/transcript/types';
import { cleanActivities } from './clean';
import { QuizError } from './errors';
import {
  buildUserPrompt,
  chunkLines,
  formatLines,
  groupIntoLines,
  SYSTEM_PROMPT,
  targetActivityCount,
} from './prompt';
import type { QuizProvider } from './providers';
import { ACTIVITY_TYPES, type ActivitySet, type ActivityType } from './schema';

/** About 37k tokens. Covers roughly three hours of speech in one request. */
export const MAX_CHUNK_CHARS = 150_000;
const MIN_WORDS = 80;
const MIN_ACTIVITIES_PER_CHUNK = 2;

export interface ActivityInput {
  title: string;
  channelName: string;
  durationSec: number;
  segments: readonly TranscriptSegment[];
  existingTopics: readonly string[];
  /** Defaults to every type. */
  allowedTypes?: readonly ActivityType[];
}

export async function generateActivities(
  input: ActivityInput,
  provider: QuizProvider,
): Promise<ActivitySet> {
  const wordCount = input.segments.reduce((total, s) => total + s.text.split(/\s+/).length, 0);
  if (wordCount < MIN_WORDS) {
    throw new QuizError(
      'transcript-too-short',
      'The transcript is too short to make learning activities.',
    );
  }
  const allowedTypes = input.allowedTypes?.length ? input.allowedTypes : ACTIVITY_TYPES;

  const chunks = chunkLines(groupIntoLines(input.segments), MAX_CHUNK_CHARS).map(formatLines);
  const totalChars = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const target = targetActivityCount(input.durationSec);

  const sets: ActivitySet[] = [];
  for (const [index, transcript] of chunks.entries()) {
    const activityCount =
      chunks.length === 1
        ? target
        : Math.max(MIN_ACTIVITIES_PER_CHUNK, Math.round((target * transcript.length) / totalChars));
    const prompt = buildUserPrompt({
      title: input.title,
      channelName: input.channelName,
      transcript,
      activityCount,
      allowedTypes,
      // Later parts see the first part's topic so the whole video lands in one topic.
      existingTopics: unique([...input.existingTopics, ...sets.map((set) => set.topic)]),
      part: chunks.length > 1 ? { index: index + 1, total: chunks.length } : undefined,
    });
    sets.push(await generateWithRetry(provider, prompt));
  }

  return {
    topic: mostCommon(sets.map((set) => set.topic.trim()).filter(Boolean)) ?? input.title,
    activities: cleanActivities(
      sets.flatMap((set) => set.activities),
      input.durationSec,
      target,
      new Set(allowedTypes),
    ),
  };
}

async function generateWithRetry(provider: QuizProvider, prompt: string): Promise<ActivitySet> {
  try {
    return await provider.generate({ system: SYSTEM_PROMPT, prompt });
  } catch (error) {
    if (!(error instanceof QuizError && error.code === 'invalid-output')) throw error;
    return provider.generate({ system: SYSTEM_PROMPT, prompt });
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined;
  for (const [value, count] of counts) if (!best || count > counts.get(best)!) best = value;
  return best;
}
