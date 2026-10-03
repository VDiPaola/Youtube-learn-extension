import { z } from 'zod';
import type { ProviderConfig } from '@/lib/settings';
import { errorFromStatus, QuizError } from '../errors';
import { parseActivitySetJson } from '../parse';
import { ActivitySetSchema } from '../schema';
import type { FetchLike, QuizProvider } from './types';

const { $schema: _unused, ...ACTIVITY_JSON_SCHEMA } = z.toJSONSchema(ActivitySetSchema);

interface ChatCompletionResponse {
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }[];
}

export function createOpenAICompatibleProvider(
  config: ProviderConfig,
  fetch: FetchLike = globalThis.fetch.bind(globalThis),
): QuizProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new QuizError('network', `Could not reach ${config.preset.label}: ${reason}`);
    }
    if (!response.ok) {
      throw errorFromStatus(response.status, await readErrorMessage(response));
    }
    return (await response.json()) as T;
  }

  return {
    async generate({ system, prompt }) {
      const data = await request<ChatCompletionResponse>('/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'activities', strict: true, schema: ACTIVITY_JSON_SCHEMA },
          },
        }),
      });

      const choice = data.choices?.[0];
      if (choice?.message?.refusal) {
        throw new QuizError(
          'refusal',
          `The model declined to write a quiz: ${choice.message.refusal}`,
        );
      }
      if (choice?.finish_reason === 'length') {
        throw new QuizError('truncated', 'The response was cut off before the quiz finished.');
      }
      return parseActivitySetJson(choice?.message?.content);
    },

    async listModels() {
      const data = await request<{ data?: { id: string }[] }>('/models', { method: 'GET' });
      return (data.data ?? []).map((model) => model.id);
    },
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as unknown;
    const error = (Array.isArray(body) ? body[0] : body)?.error;
    if (typeof error === 'string') return error;
    if (typeof error?.message === 'string') return error.message;
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return text.slice(0, 200);
}
