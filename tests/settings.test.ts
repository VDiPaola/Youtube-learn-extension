import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  apiKeysItem,
  configProblem,
  originPattern,
  resolveProviderConfig,
  settingsItem,
  type Settings,
} from '@/lib/settings';

const settings = (overrides: Partial<Settings> = {}): Settings => ({
  providerId: 'anthropic',
  models: {},
  baseUrls: {},
  ...overrides,
});

describe('resolveProviderConfig', () => {
  it('uses preset defaults when nothing is customized', () => {
    expect(resolveProviderConfig(settings(), { anthropic: ' key ' })).toMatchObject({
      model: 'claude-opus-5-5',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'key',
    });
  });

  it('applies custom models, and base URLs only where they are editable', () => {
    const s = settings({
      providerId: 'ollama',
      models: { ollama: 'llama4' },
      baseUrls: { ollama: 'http://192.168.1.5:11434/v1', openai: 'https://evil.example' },
    });
    expect(resolveProviderConfig(s, {})).toMatchObject({
      model: 'llama4',
      baseUrl: 'http://192.168.1.5:11434/v1',
      apiKey: '',
    });
    expect(resolveProviderConfig(s, {}, 'openai').baseUrl).toBe('https://api.openai.com/v1');
  });
});

describe('configProblem', () => {
  it('requires a key only for providers that need one', () => {
    expect(configProblem(resolveProviderConfig(settings(), {}))).toBe(
      'Add an API key for Anthropic (Claude).',
    );
    expect(
      configProblem(
        resolveProviderConfig(settings({ providerId: 'ollama', models: { ollama: 'm' } }), {}),
      ),
    ).toBeNull();
  });

  it('requires a model and a valid URL', () => {
    expect(configProblem(resolveProviderConfig(settings({ providerId: 'ollama' }), {}))).toBe(
      'Choose a model for Ollama (local).',
    );
    const custom = settings({ providerId: 'custom', models: { custom: 'm' } });
    expect(configProblem(resolveProviderConfig(custom, {}))).toBe('Enter the server URL.');
    expect(
      configProblem(resolveProviderConfig({ ...custom, baseUrls: { custom: 'not a url' } }, {})),
    ).toBe('The server URL is not valid.');
  });
});

describe('originPattern', () => {
  it('builds a host permission pattern from a base URL', () => {
    expect(originPattern('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/*');
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost:11434/*');
  });
});

describe('storage items', () => {
  beforeEach(() => fakeBrowser.reset());

  it('stores settings and keys separately with defaults', async () => {
    expect(await settingsItem.getValue()).toEqual(settings());
    expect(await apiKeysItem.getValue()).toEqual({});

    await apiKeysItem.setValue({ openai: 'sk' });
    await settingsItem.setValue(settings({ providerId: 'openai' }));
    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      apiKeys: { openai: 'sk' },
      settings: settings({ providerId: 'openai' }),
    });
  });
});
