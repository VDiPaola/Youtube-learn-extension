import { storage } from 'wxt/utils/storage';

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom';
export type ProviderKind = 'anthropic' | 'openai-compatible';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  requiresKey: boolean;
  editableBaseUrl: boolean;
  keyUrl?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
    requiresKey: true,
    editableBaseUrl: false,
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.1-sol',
    suggestedModels: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'],
    requiresKey: true,
    editableBaseUrl: false,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    suggestedModels: ['gemini-3.8-flash', 'gemini-3.1-pro-preview'],
    requiresKey: true,
    editableBaseUrl: false,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    suggestedModels: [],
    requiresKey: true,
    editableBaseUrl: false,
    keyUrl: 'https://openrouter.ai/keys',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
    suggestedModels: [],
    requiresKey: false,
    editableBaseUrl: true,
  },
  custom: {
    id: 'custom',
    label: 'Other OpenAI-compatible server',
    kind: 'openai-compatible',
    baseUrl: '',
    defaultModel: '',
    suggestedModels: [],
    requiresKey: false,
    editableBaseUrl: true,
  },
};

export interface Settings {
  providerId: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  baseUrls: Partial<Record<ProviderId, string>>;
}

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: { providerId: 'anthropic', models: {}, baseUrls: {} },
});

/** Kept apart from settings so keys are never included in backups or exports. */
export const apiKeysItem = storage.defineItem<Partial<Record<ProviderId, string>>>(
  'local:apiKeys',
  { fallback: {} },
);

export interface ProviderConfig {
  preset: ProviderPreset;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export function resolveProviderConfig(
  settings: Settings,
  apiKeys: Partial<Record<ProviderId, string>>,
  providerId: ProviderId = settings.providerId,
): ProviderConfig {
  const preset = PROVIDERS[providerId];
  return {
    preset,
    model: settings.models[providerId]?.trim() || preset.defaultModel,
    baseUrl: (preset.editableBaseUrl && settings.baseUrls[providerId]?.trim()) || preset.baseUrl,
    apiKey: apiKeys[providerId]?.trim() ?? '',
  };
}

/** Returns a reason the configuration cannot be used, or null when it is complete. */
export function configProblem(config: ProviderConfig): string | null {
  if (config.preset.requiresKey && !config.apiKey) {
    return `Add an API key for ${config.preset.label}.`;
  }
  if (!config.model) return `Choose a model for ${config.preset.label}.`;
  if (!config.baseUrl) return 'Enter the server URL.';
  try {
    new URL(config.baseUrl);
  } catch {
    return 'The server URL is not valid.';
  }
  return null;
}

export function originPattern(baseUrl: string): string {
  return `${new URL(baseUrl).origin}/*`;
}
