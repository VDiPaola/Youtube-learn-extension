import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ProviderConfig } from '@/lib/settings';
import { errorFromStatus, QuizError } from '../errors';
import { parseActivitySetJson } from '../parse';
import { ActivitySetSchema } from '../schema';
import type { FetchLike, QuizProvider } from './types';

const MAX_TOKENS = 16_000;
// Only the schema is sent: the SDK's parse() throws before stop_reason can be checked.
const { type: FORMAT_TYPE, schema: QUIZ_SCHEMA } = betaZodOutputFormat(ActivitySetSchema);
/** Models that accept server-side refusal fallbacks in the `"default"` form. */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

export function createAnthropicProvider(config: ProviderConfig, fetch?: FetchLike): QuizProvider {
  const client = new Anthropic({
    apiKey: config.apiKey,
    // The key belongs to the user and never leaves their browser except to Anthropic.
    dangerouslyAllowBrowser: true,
    fetch,
  });

  return {
    async generate({ system, prompt }) {
      try {
        const response = await client.beta.messages.create({
          model: config.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: { type: FORMAT_TYPE, schema: QUIZ_SCHEMA } },
          ...(FALLBACK_MODELS.has(config.model) && {
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default' as const,
          }),
        });

        if (response.stop_reason === 'refusal') {
          const reason = response.stop_details?.explanation;
          throw new QuizError(
            'refusal',
            `The model declined to write activities for this video${reason ? `: ${reason}` : '.'}`,
          );
        }
        if (response.stop_reason === 'max_tokens') {
          throw new QuizError('truncated', 'The response was cut off before the quiz finished.');
        }
        const text = response.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('');
        return parseActivitySetJson(text);
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async listModels() {
      try {
        const ids: string[] = [];
        for await (const model of client.models.list()) ids.push(model.id);
        return ids;
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}

function toProviderError(error: unknown): unknown {
  if (error instanceof QuizError) return error;
  if (error instanceof Anthropic.APIConnectionError) {
    return new QuizError('network', `Could not reach Anthropic: ${error.message}`);
  }
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    return errorFromStatus(error.status, error.message);
  }
  return error;
}
