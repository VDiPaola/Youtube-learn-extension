import type { CachedActivities, LearnDatabase } from '@/lib/db';
import type {
  AskQuestionMessage,
  AskQuestionResponse,
  GenerateQuizMessage,
  GenerateQuizResponse,
  TestProviderResponse,
} from '@/lib/messages';
import { findTopic, topicNamesForPrompt } from '@/lib/knowledge/topics';
import { configProblem, originPattern, type ProviderConfig } from '@/lib/settings';
import { buildAskRequest } from './ask';
import { QuizError, toQuizError } from './errors';
import { generateActivities } from './generate';
import type { QuizProvider } from './providers';
import { ActivitySetSchema, type ActivityType } from './schema';

const MAX_EXISTING_TOPICS = 50;

export interface QuizServiceDeps {
  db: LearnDatabase;
  loadConfig(): Promise<ProviderConfig>;
  hasPermission(originPattern: string): Promise<boolean>;
  createProvider(config: ProviderConfig): QuizProvider;
  loadAllowedTypes(): Promise<ActivityType[]>;
  now(): number;
}

export function createQuizService(deps: QuizServiceDeps) {
  const inFlight = new Map<string, Promise<GenerateQuizResponse>>();

  async function readyProvider(): Promise<{ config: ProviderConfig; provider: QuizProvider }> {
    const config = await deps.loadConfig();
    const problem = configProblem(config);
    if (problem) throw new QuizError('not-configured', problem);
    if (!(await deps.hasPermission(originPattern(config.baseUrl)))) {
      throw new QuizError(
        'permission',
        `Open settings and select Save to allow requests to ${config.preset.label}.`,
      );
    }
    return { config, provider: deps.createProvider(config) };
  }

  /** Returns a usable cached set, deleting entries saved in an older format. */
  async function readCache(videoId: string): Promise<CachedActivities | null> {
    const entry = await deps.db.quizCache.get(videoId);
    if (!entry) return null;
    if (ActivitySetSchema.safeParse(entry.set).success) return entry;
    await deps.db.quizCache.delete(videoId);
    return null;
  }

  /** Knowledge bank topics, then topics of cached sets not saved to the bank yet. */
  async function existingTopics(): Promise<string[]> {
    const [topics, recent] = await Promise.all([
      deps.db.topics.toArray(),
      deps.db.quizCache.orderBy('createdAt').reverse().toArray(),
    ]);
    const cached = recent
      .map((entry) => entry.set?.topic)
      .filter((topic) => topic && !findTopic(topics, topic));
    return [...new Set([...topicNamesForPrompt(topics), ...cached])].slice(0, MAX_EXISTING_TOPICS);
  }

  async function generate(message: GenerateQuizMessage): Promise<GenerateQuizResponse> {
    try {
      if (!message.force) {
        const cached = await readCache(message.video.videoId);
        if (cached) return { ok: true, quiz: cached, cached: true };
      }

      const { config, provider } = await readyProvider();
      const set = await generateActivities(
        {
          ...message.video,
          segments: message.segments,
          existingTopics: await existingTopics(),
          allowedTypes: await deps.loadAllowedTypes(),
        },
        provider,
      );
      const entry: CachedActivities = {
        videoId: message.video.videoId,
        title: message.video.title,
        set,
        providerId: config.preset.id,
        model: config.model,
        createdAt: deps.now(),
      };
      await deps.db.quizCache.put(entry);
      return { ok: true, quiz: entry, cached: false };
    } catch (error) {
      const quizError = toQuizError(error);
      return { ok: false, code: quizError.code, error: quizError.message };
    }
  }

  return {
    async getCachedQuiz(videoId: string): Promise<CachedActivities | null> {
      return readCache(videoId);
    },

    /** Concurrent requests for the same video share one generation. */
    generateQuiz(message: GenerateQuizMessage): Promise<GenerateQuizResponse> {
      const key = message.video.videoId;
      const pending = inFlight.get(key);
      if (pending) return pending;

      const request = generate(message).finally(() => inFlight.delete(key));
      inFlight.set(key, request);
      return request;
    },

    async ask(message: AskQuestionMessage): Promise<AskQuestionResponse> {
      try {
        if (message.segments.length === 0) {
          throw new QuizError('no-transcript', 'No transcript is available for this video.');
        }
        const { provider } = await readyProvider();
        const answer = await provider.chat(
          buildAskRequest({ ...message.video, segments: message.segments, turns: message.turns }),
        );
        return { ok: true, answer };
      } catch (error) {
        const quizError = toQuizError(error);
        return { ok: false, code: quizError.code, error: quizError.message };
      }
    },

    async testProvider(): Promise<TestProviderResponse> {
      try {
        const { provider } = await readyProvider();
        return { ok: true, models: (await provider.listModels()).sort() };
      } catch (error) {
        const quizError = toQuizError(error);
        return { ok: false, code: quizError.code, error: quizError.message };
      }
    },
  };
}
