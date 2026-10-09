import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from '@/lib/learn/providers/anthropic';
import { parseActivitySetJson } from '@/lib/learn/parse';
import { createOpenAICompatibleProvider } from '@/lib/learn/providers/openai-compatible';
import type { ActivitySet } from '@/lib/learn/schema';
import { PROVIDERS, type ProviderConfig, type ProviderId } from '@/lib/settings';

const QUIZ: ActivitySet = {
  topic: 'Neural Networks',
  activities: [
    {
      type: 'multiple_choice',
      prompt: 'What does a neuron hold?',
      answer: 'A number between 0 and 1.',
      explanation: '',
      options: ['A weight', 'A bias', 'An image'],
      sourceStartSec: 42,
    },
  ],
};

const config = (id: ProviderId, overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  preset: PROVIDERS[id],
  model: PROVIDERS[id].defaultModel || 'local-model',
  baseUrl: PROVIDERS[id].baseUrl || 'http://localhost:1234/v1',
  apiKey: 'test-key',
  ...overrides,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function mockFetch(...responses: (Response | Error)[]) {
  const fn = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fn.mockRejectedValueOnce(response);
    else fn.mockResolvedValueOnce(response);
  }
  return fn;
}

const requestBody = (fn: ReturnType<typeof mockFetch>, call = 0) =>
  JSON.parse(String(fn.mock.calls[call]![1]!.body));
const requestHeaders = (fn: ReturnType<typeof mockFetch>, call = 0) =>
  new Headers(fn.mock.calls[call]![1]!.headers);

describe('OpenAI-compatible provider', () => {
  const completion = (content: string | null, extra: Record<string, unknown> = {}) =>
    json({ choices: [{ finish_reason: 'stop', message: { content, ...extra } }] });

  it('requests a strict JSON schema response and parses the activities', async () => {
    const fetch = mockFetch(completion(JSON.stringify(QUIZ)));
    const provider = createOpenAICompatibleProvider(config('gemini'), fetch);

    await expect(provider.generate({ system: 'S', prompt: 'P' })).resolves.toEqual(QUIZ);
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    expect(requestHeaders(fetch).get('authorization')).toBe('Bearer test-key');
    const body = requestBody(fetch);
    expect(body.model).toBe('gemini-3.8-flash');
    expect(body.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'P' },
    ]);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema).toMatchObject({ name: 'activities', strict: true });
    expect(body.response_format.json_schema.schema).not.toHaveProperty('$schema');
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it('omits the authorization header when there is no key', async () => {
    const fetch = mockFetch(completion(JSON.stringify(QUIZ)));
    await createOpenAICompatibleProvider(
      config('ollama', { apiKey: '', baseUrl: 'http://localhost:11434/v1/' }),
      fetch,
    ).generate({ system: 'S', prompt: 'P' });
    expect(fetch.mock.calls[0]![0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(requestHeaders(fetch).has('authorization')).toBe(false);
  });

  it('reports refusals and truncated responses', async () => {
    const refused = createOpenAICompatibleProvider(
      config('openai'),
      mockFetch(completion(null, { refusal: 'Not allowed' })),
    );
    await expect(refused.generate({ system: '', prompt: '' })).rejects.toMatchObject({
      code: 'refusal',
    });

    const truncated = createOpenAICompatibleProvider(
      config('openai'),
      mockFetch(json({ choices: [{ finish_reason: 'length', message: { content: '{"to' } }] })),
    );
    await expect(truncated.generate({ system: '', prompt: '' })).rejects.toMatchObject({
      code: 'truncated',
    });
  });

  it.each([
    [401, { error: { message: 'Incorrect API key' } }, 'auth', 'Incorrect API key'],
    [429, { error: { message: 'Slow down' } }, 'rate-limit', 'Slow down'],
    [400, [{ error: { code: 400, message: 'Model not found' } }], 'bad-request', 'Model not found'],
    [500, 'upstream exploded', 'unknown', 'upstream exploded'],
  ])('maps HTTP %d to %s', async (status, body, code, detail) => {
    const response = typeof body === 'string' ? new Response(body, { status }) : json(body, status);
    const provider = createOpenAICompatibleProvider(config('openai'), mockFetch(response));
    const error = await provider.generate({ system: '', prompt: '' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toContain(detail);
  });

  it('maps fetch failures to network errors', async () => {
    const provider = createOpenAICompatibleProvider(
      config('ollama'),
      mockFetch(new TypeError('Failed to fetch')),
    );
    await expect(provider.generate({ system: '', prompt: '' })).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('answers questions in plain text without a response format', async () => {
    const fetch = mockFetch(completion('  A plain answer. '));
    const provider = createOpenAICompatibleProvider(config('custom'), fetch);
    const messages = [
      { role: 'user' as const, content: 'Q1' },
      { role: 'assistant' as const, content: 'A1' },
      { role: 'user' as const, content: 'Q2' },
    ];

    await expect(provider.chat({ system: 'S', messages })).resolves.toBe('A plain answer.');
    const body = requestBody(fetch);
    expect(body.messages).toEqual([{ role: 'system', content: 'S' }, ...messages]);
    expect(body).not.toHaveProperty('response_format');
  });

  it('reports refused and empty answers', async () => {
    const refused = createOpenAICompatibleProvider(
      config('openai'),
      mockFetch(completion(null, { refusal: 'Not allowed' })),
    );
    await expect(refused.chat({ system: '', messages: [] })).rejects.toMatchObject({
      code: 'refusal',
    });
    const empty = createOpenAICompatibleProvider(config('openai'), mockFetch(completion('')));
    await expect(empty.chat({ system: '', messages: [] })).rejects.toMatchObject({
      code: 'invalid-output',
    });
  });

  it('lists model IDs', async () => {
    const fetch = mockFetch(json({ data: [{ id: 'b' }, { id: 'a' }] }));
    await expect(
      createOpenAICompatibleProvider(config('openai'), fetch).listModels(),
    ).resolves.toEqual(['b', 'a']);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.openai.com/v1/models');
    expect(fetch.mock.calls[0]![1]!.method).toBe('GET');
  });
});

describe('parseActivitySetJson', () => {
  it('accepts JSON wrapped in Markdown fences', () => {
    expect(parseActivitySetJson('```json\n' + JSON.stringify(QUIZ) + '\n```')).toEqual(QUIZ);
  });

  it.each([null, '', 'not json', '{"topic":"x"}', '{"topic":"x","activities":[],"extra":1}'])(
    'rejects %j',
    (content) => {
      expect(() => parseActivitySetJson(content)).toThrow(
        expect.objectContaining({ code: 'invalid-output' }),
      );
    },
  );
});

describe('Anthropic provider', () => {
  const message = (text: string, stopReason = 'end_turn', extra: Record<string, unknown> = {}) =>
    json({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
      ...extra,
    });

  it('sends a structured output request with refusal fallbacks and parses the quiz', async () => {
    const fetch = mockFetch(message(JSON.stringify(QUIZ)));
    const provider = createAnthropicProvider(config('anthropic'), fetch);

    await expect(provider.generate({ system: 'S', prompt: 'P' })).resolves.toEqual(QUIZ);
    expect(String(fetch.mock.calls[0]![0])).toContain('https://api.anthropic.com/v1/messages');
    const headers = requestHeaders(fetch);
    expect(headers.get('x-api-key')).toBe('test-key');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const body = requestBody(fetch);
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'S',
      messages: [{ role: 'user', content: 'P' }],
      fallbacks: 'default',
      output_config: { format: { type: 'json_schema' } },
    });
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('skips fallbacks for models that do not support the default form', async () => {
    const fetch = mockFetch(message(JSON.stringify(QUIZ)));
    await createAnthropicProvider(
      config('anthropic', { model: 'claude-haiku-4-5' }),
      fetch,
    ).generate({ system: 'S', prompt: 'P' });
    expect(requestBody(fetch)).not.toHaveProperty('fallbacks');
    expect(requestHeaders(fetch).get('anthropic-beta') ?? '').not.toContain('fallback');
  });

  it('reports refusals with the explanation', async () => {
    const fetch = mockFetch(
      message('', 'refusal', {
        stop_details: { type: 'refusal', category: null, explanation: 'Policy' },
      }),
    );
    const error = await createAnthropicProvider(config('anthropic'), fetch)
      .generate({ system: '', prompt: '' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'refusal' });
    expect((error as Error).message).toContain('Policy');
  });

  it('reports truncated output', async () => {
    const fetch = mockFetch(message('{"topic":', 'max_tokens'));
    await expect(
      createAnthropicProvider(config('anthropic'), fetch).generate({ system: '', prompt: '' }),
    ).rejects.toMatchObject({ code: 'truncated' });
  });

  it('answers questions with a cached system prompt and no output format', async () => {
    const fetch = mockFetch(message('An answer.'));
    const provider = createAnthropicProvider(config('anthropic'), fetch);
    const messages = [{ role: 'user' as const, content: 'Q' }];

    await expect(provider.chat({ system: 'S', messages })).resolves.toBe('An answer.');
    const body = requestBody(fetch);
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      messages,
      fallbacks: 'default',
    });
    expect(body).not.toHaveProperty('output_config');
  });

  it('reports refused answers', async () => {
    const fetch = mockFetch(message('', 'refusal'));
    await expect(
      createAnthropicProvider(config('anthropic'), fetch).chat({ system: '', messages: [] }),
    ).rejects.toMatchObject({ code: 'refusal' });
  });

  it('maps an invalid key to an auth error', async () => {
    const fetch = mockFetch(
      json(
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        401,
      ),
    );
    await expect(
      createAnthropicProvider(config('anthropic'), fetch).generate({ system: '', prompt: '' }),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('lists model IDs', async () => {
    const fetch = mockFetch(
      json({
        data: [
          { id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '' },
        ],
        has_more: false,
        first_id: 'claude-opus-5-5',
        last_id: 'claude-opus-5-5',
      }),
    );
    await expect(createAnthropicProvider(config('anthropic'), fetch).listModels()).resolves.toEqual(
      ['claude-opus-5-5'],
    );
  });
});
