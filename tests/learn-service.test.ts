import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dexie } from 'dexie';
import { LearnDatabase } from '@/lib/db';
import type { AskQuestionMessage, GenerateQuizMessage } from '@/lib/messages';
import { QuizError } from '@/lib/learn/errors';
import type { QuizProvider } from '@/lib/learn/providers';
import type { ActivitySet } from '@/lib/learn/schema';
import { createQuizService, type QuizServiceDeps } from '@/lib/learn/service';
import { PROVIDERS, type ProviderConfig } from '@/lib/settings';

const CONFIG: ProviderConfig = {
  preset: PROVIDERS.anthropic,
  model: 'claude-opus-5-5',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'key',
};

const message = (videoId = 'vid', force = false): GenerateQuizMessage => ({
  type: 'quiz:generate',
  video: { videoId, title: 'Title', channelName: 'Channel', durationSec: 600 },
  segments: Array.from({ length: 20 }, (_, i) => ({
    startMs: i * 30_000,
    durationMs: 30_000,
    text: 'word '.repeat(10),
  })),
  force,
});

const quiz = (topic = 'Biology'): ActivitySet => ({
  topic,
  activities: [
    {
      type: 'recall',
      prompt: 'Q?',
      answer: 'A.',
      explanation: '',
      options: [],
      sourceStartSec: 5,
    },
  ],
});

let db: LearnDatabase;
let provider: QuizProvider & {
  generate: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
};

function service(overrides: Partial<QuizServiceDeps> = {}) {
  return createQuizService({
    db,
    loadConfig: async () => CONFIG,
    hasPermission: async () => true,
    createProvider: () => provider,
    loadAllowedTypes: async () => ['recall', 'cloze'],
    now: () => 1000,
    ...overrides,
  });
}

beforeEach(() => {
  db = new LearnDatabase(`test-${crypto.randomUUID()}`);
  provider = {
    generate: vi.fn(async () => quiz()),
    chat: vi.fn(async () => 'Because of X. See [0:30].'),
    listModels: vi.fn(async () => ['b', 'a']),
  };
});

afterEach(async () => {
  await db.delete();
});

describe('activity service', () => {
  it('generates, stores, and then serves the cached quiz', async () => {
    const s = service();
    const first = await s.generateQuiz(message());
    expect(first).toEqual({
      ok: true,
      cached: false,
      quiz: {
        videoId: 'vid',
        title: 'Title',
        set: quiz(),
        providerId: 'anthropic',
        model: 'claude-opus-5-5',
        createdAt: 1000,
      },
    });

    const second = await s.generateQuiz(message());
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it('regenerates when forced', async () => {
    const s = service();
    await s.generateQuiz(message());
    provider.generate.mockResolvedValueOnce(quiz('Genetics'));
    const result = await s.generateQuiz(message('vid', true));
    expect(result).toMatchObject({
      ok: true,
      cached: false,
      quiz: { set: { topic: 'Genetics' } },
    });
    expect(await db.quizCache.count()).toBe(1);
  });

  it('passes the enabled activity types to the prompt', async () => {
    await service().generateQuiz(message());
    expect(provider.generate.mock.calls[0]![0].prompt).toContain(
      'Activity types to use: recall, cloze',
    );
  });

  it('passes topics from earlier sets to the prompt', async () => {
    const s = service();
    await s.generateQuiz(message('first'));
    await s.generateQuiz(message('second'));
    expect(provider.generate.mock.calls[1]![0].prompt).toContain('Existing topics: Biology');
  });

  it('passes knowledge bank topics first and skips cached topics that were renamed', async () => {
    await db.topics.bulkAdd([
      { id: 'life', name: 'Life Science', parentId: null, createdAt: 1, aliases: ['Biology'] },
      { id: 'gen', name: 'Genetics', parentId: 'life', createdAt: 2 },
    ]);
    const s = service();
    await s.generateQuiz(message('first'));
    provider.generate.mockResolvedValueOnce(quiz('Chemistry'));
    await s.generateQuiz(message('second'));
    await s.generateQuiz(message('third'));
    expect(provider.generate.mock.calls[2]![0].prompt).toContain(
      'Existing topics: Life Science > Genetics; Life Science; Chemistry\n',
    );
  });

  it('shares one generation between concurrent requests for the same video', async () => {
    const s = service();
    const [a, b] = await Promise.all([s.generateQuiz(message()), s.generateQuiz(message())]);
    expect(a).toBe(b);
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it('reports missing configuration', async () => {
    const s = service({ loadConfig: async () => ({ ...CONFIG, apiKey: '' }) });
    expect(await s.generateQuiz(message())).toEqual({
      ok: false,
      code: 'not-configured',
      error: 'Add an API key for Anthropic (Claude).',
    });
  });

  it('reports a missing host permission for the provider origin', async () => {
    const hasPermission = vi.fn(async () => false);
    const result = await service({ hasPermission }).generateQuiz(message());
    expect(hasPermission).toHaveBeenCalledWith('https://api.anthropic.com/*');
    expect(result).toMatchObject({ ok: false, code: 'permission' });
  });

  it('returns provider errors without caching anything', async () => {
    provider.generate.mockRejectedValueOnce(new QuizError('rate-limit', 'Rate limit reached.'));
    expect(await service().generateQuiz(message())).toEqual({
      ok: false,
      code: 'rate-limit',
      error: 'Rate limit reached.',
    });
    expect(await db.quizCache.count()).toBe(0);
  });

  it('lists models sorted when testing the provider', async () => {
    expect(await service().testProvider()).toEqual({ ok: true, models: ['a', 'b'] });
  });

  it('reports test failures', async () => {
    provider.listModels.mockRejectedValueOnce(new QuizError('auth', 'Bad key.'));
    expect(await service().testProvider()).toEqual({ ok: false, code: 'auth', error: 'Bad key.' });
  });
});

describe('questions', () => {
  const ask = (segments = message().segments): AskQuestionMessage => ({
    type: 'video:ask',
    video: message().video,
    segments,
    turns: [{ role: 'user', text: 'Why?', atSec: 75 }],
  });

  it('answers with the transcript in the system prompt', async () => {
    expect(await service().ask(ask())).toEqual({ ok: true, answer: 'Because of X. See [0:30].' });
    const request = provider.chat.mock.calls[0]![0];
    expect(request.system).toContain('Video title: Title');
    expect(request.system).toContain('[0:30] word');
    expect(request.messages).toEqual([{ role: 'user', content: '[At 1:15] Why?' }]);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('reports a missing transcript without calling the provider', async () => {
    expect(await service().ask(ask([]))).toMatchObject({ ok: false, code: 'no-transcript' });
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('reports configuration and provider errors', async () => {
    const unconfigured = service({ loadConfig: async () => ({ ...CONFIG, apiKey: '' }) });
    expect(await unconfigured.ask(ask())).toMatchObject({ ok: false, code: 'not-configured' });

    provider.chat.mockRejectedValueOnce(new QuizError('rate-limit', 'Rate limit reached.'));
    expect(await service().ask(ask())).toEqual({
      ok: false,
      code: 'rate-limit',
      error: 'Rate limit reached.',
    });
  });
});

describe('database upgrade', () => {
  it('clears quizzes saved in the old flashcard format', async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ quizCache: 'videoId, createdAt' });
    await old
      .table('quizCache')
      .put({ videoId: 'v', quiz: { topic: 'T', cards: [] }, createdAt: 1 });
    old.close();

    const upgraded = new LearnDatabase(name);
    expect(await upgraded.quizCache.count()).toBe(0);
    await upgraded.quizCache.put({
      videoId: 'v',
      title: 'T',
      set: quiz(),
      providerId: 'custom',
      model: 'm',
      createdAt: 2,
    });
    expect(await upgraded.quizCache.count()).toBe(1);
    await upgraded.delete();
  });
});

describe('cache validation', () => {
  it('discards cached entries saved in an older format', async () => {
    await db.quizCache.put({
      videoId: 'vid',
      title: 'Old',
      quiz: { topic: 'Old', cards: [] },
      providerId: 'custom',
      model: 'm',
      createdAt: 1,
    } as never);
    const s = service();
    expect(await s.getCachedQuiz('vid')).toBeNull();
    expect(await db.quizCache.count()).toBe(0);
    expect(await s.generateQuiz(message())).toMatchObject({ ok: true, cached: false });
  });
});
