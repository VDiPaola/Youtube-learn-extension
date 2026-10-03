import type { ProviderConfig } from '@/lib/settings';
import { createAnthropicProvider } from './anthropic';
import { createOpenAICompatibleProvider } from './openai-compatible';
import type { FetchLike, QuizProvider } from './types';

export function createProvider(config: ProviderConfig, fetch?: FetchLike): QuizProvider {
  return config.preset.kind === 'anthropic'
    ? createAnthropicProvider(config, fetch)
    : createOpenAICompatibleProvider(config, fetch);
}

export type { QuizProvider, QuizRequest } from './types';
