import { describe, expect, it, vi } from 'vitest';
import { QuizError } from '@/lib/learn/errors';
import { generateActivities, MAX_CHUNK_CHARS, type ActivityInput } from '@/lib/learn/generate';
import { SYSTEM_PROMPT } from '@/lib/learn/prompt';
import type { QuizProvider } from '@/lib/learn/providers';
import type { ActivitySet } from '@/lib/learn/schema';

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');

const input = (overrides: Partial<ActivityInput> = {}): ActivityInput => ({
  title: 'How vaccines work',
  channelName: 'Science Channel',
  durationSec: 600,
  segments: Array.from({ length: 30 }, (_, i) => ({
    startMs: i * 20_000,
    durationMs: 20_000,
    text: words(10),
  })),
  existingTopics: ['Immunology'],
  ...overrides,
});

const quiz = (topic: string, questions: string[], start = 0): ActivitySet => ({
  topic,
  activities: questions.map((prompt, i) => ({
    type: 'recall' as const,
    prompt,
    answer: `Answer to ${prompt}`,
    explanation: '',
    options: [],
    sourceStartSec: start + i * 10,
  })),
});

const provider = (
  ...results: (ActivitySet | Error)[]
): QuizProvider & { generate: ReturnType<typeof vi.fn> } => {
  const generate = vi.fn();
  for (const result of results) {
    if (result instanceof Error) generate.mockRejectedValueOnce(result);
    else generate.mockResolvedValueOnce(result);
  }
  return { generate, listModels: vi.fn() };
};

describe('generateActivities', () => {
  it('sends one request with the system prompt for a normal-length video', async () => {
    const p = provider(quiz('Immunology', ['What do vaccines train?', 'What are antibodies?']));
    const result = await generateActivities(input(), p);

    expect(p.generate).toHaveBeenCalledOnce();
    const request = p.generate.mock.calls[0]![0];
    expect(request.system).toBe(SYSTEM_PROMPT);
    expect(request.prompt).toContain('Existing topics: Immunology');
    expect(request.prompt).toContain('Write up to 5 activities');
    expect(request.prompt).toContain('[0:20] word0');
    expect(request.prompt).toContain(
      'Activity types to use: recall, flashcard, cloze, multiple_choice, true_false, ordering, apply',
    );
    expect(result).toEqual({
      topic: 'Immunology',
      activities: quiz('Immunology', ['What do vaccines train?', 'What are antibodies?'])
        .activities,
    });
  });

  it('splits long transcripts, shares the first topic, and merges the activities', async () => {
    const longText = 'word '.repeat(MAX_CHUNK_CHARS / 10).trim();
    const p = provider(
      quiz('Virology', ['Question one?', 'Question two?'], 0),
      quiz('Virology', ['Question three?', 'Question one?'], 1000),
      quiz('Viruses', ['Question four?'], 2000),
    );
    const result = await generateActivities(
      input({
        durationSec: 3 * 3600,
        existingTopics: [],
        segments: [0, 1, 2].map((i) => ({ startMs: i * 3_600_000, durationMs: 0, text: longText })),
      }),
      p,
    );

    expect(p.generate).toHaveBeenCalledTimes(3);
    const prompts = p.generate.mock.calls.map((call) => call[0].prompt as string);
    expect(prompts[0]).toContain('part 1 of 3');
    expect(prompts[0]).toContain('Existing topics: None yet');
    expect(prompts[1]).toContain('Existing topics: Virology');
    expect(prompts[2]).toContain('Write up to 5 activities');
    expect(result.topic).toBe('Virology');
    expect(result.activities.map((a) => a.prompt)).toEqual([
      'Question one?',
      'Question two?',
      'Question three?',
      'Question four?',
    ]);
  });

  it('retries once when the output is invalid', async () => {
    const p = provider(new QuizError('invalid-output', 'bad'), quiz('T', ['Q?']));
    await expect(generateActivities(input(), p)).resolves.toMatchObject({ topic: 'T' });
    expect(p.generate).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    const p = provider(new QuizError('auth', 'Bad key'));
    await expect(generateActivities(input(), p)).rejects.toMatchObject({ code: 'auth' });
    expect(p.generate).toHaveBeenCalledOnce();
  });

  it('rejects transcripts that are too short without calling the provider', async () => {
    const p = provider();
    await expect(
      generateActivities(input({ segments: [{ startMs: 0, durationMs: 0, text: 'Hi there' }] }), p),
    ).rejects.toMatchObject({ code: 'transcript-too-short' });
    expect(p.generate).not.toHaveBeenCalled();
  });

  it('falls back to the video title when the model gives no topic', async () => {
    const result = await generateActivities(input(), provider(quiz('  ', [])));
    expect(result).toEqual({ topic: 'How vaccines work', activities: [] });
  });

  it('asks only for allowed types and drops any others the model returns', async () => {
    const set = quiz('T', ['Keep me?', 'Drop me?']);
    set.activities[1] = { ...set.activities[1]!, type: 'flashcard' };
    const p = provider(set);
    const result = await generateActivities(input({ allowedTypes: ['recall'] }), p);
    expect(p.generate.mock.calls[0]![0].prompt).toContain('Activity types to use: recall\n');
    expect(result.activities.map((a) => a.prompt)).toEqual(['Keep me?']);
  });
});
