import { useEffect, useState, type FormEvent } from 'react';
import type { TestProviderMessage, TestProviderResponse } from '@/lib/messages';
import {
  apiKeysItem,
  configProblem,
  originPattern,
  PROVIDERS,
  resolveProviderConfig,
  settingsItem,
  type ProviderId,
  type Settings,
} from '@/lib/settings';
import { PromptSection } from './PromptSection';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

type ApiKeys = Partial<Record<ProviderId, string>>;

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [models, setModels] = useState<string[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    void Promise.all([settingsItem.getValue(), apiKeysItem.getValue()]).then(([s, keys]) => {
      setSettings(s);
      setApiKeys(keys);
    });
  }, []);

  if (!settings) return <main aria-busy="true" />;

  const providerId = settings.providerId;
  const preset = PROVIDERS[providerId];
  const config = resolveProviderConfig(settings, apiKeys);
  const modelOptions = [...new Set([...preset.suggestedModels, ...models])];

  const update = (patch: (current: Settings) => Settings) => {
    setSettings((current) => current && patch(current));
    setStatus({ kind: 'idle' });
  };

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const testAfterSave =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'test';
    const problem = configProblem(config);
    if (problem) {
      setStatus({ kind: 'error', message: problem });
      return;
    }
    // Firefox only allows permission prompts synchronously inside the click handler.
    const permission = browser.permissions.request({ origins: [originPattern(config.baseUrl)] });

    void (async () => {
      if (!(await permission)) {
        setStatus({
          kind: 'error',
          message: `Access to ${new URL(config.baseUrl).host} is required to generate learning activities.`,
        });
        return;
      }
      await settingsItem.setValue(settings!);
      await apiKeysItem.setValue(apiKeys);
      if (!testAfterSave) {
        setStatus({ kind: 'ok', message: 'Settings saved.' });
        return;
      }

      setStatus({ kind: 'working', message: 'Testing connection...' });
      const message: TestProviderMessage = { type: 'provider:test' };
      const response: TestProviderResponse = await browser.runtime.sendMessage(message);
      if (!response.ok) {
        setStatus({ kind: 'error', message: response.error });
        return;
      }
      setModels(response.models);
      const modelListed = response.models.length === 0 || response.models.includes(config.model);
      setStatus({
        kind: modelListed ? 'ok' : 'error',
        message: modelListed
          ? `Connected. ${response.models.length} models available.`
          : `Connected, but the model "${config.model}" is not in the provider's list.`,
      });
    })();
  }

  return (
    <main>
      <h1>Settings</h1>
      <h2>AI provider</h2>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={providerId}
            onChange={(e) => {
              setModels([]);
              update((s) => ({ ...s, providerId: e.target.value as ProviderId }));
            }}
          >
            {Object.values(PROVIDERS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="api-key">API key{preset.requiresKey ? '' : ' (optional)'}</label>
          <div className="key-row">
            <input
              id="api-key"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={apiKeys[providerId] ?? ''}
              onChange={(e) => {
                setApiKeys((keys) => ({ ...keys, [providerId]: e.target.value }));
                setStatus({ kind: 'idle' });
              }}
              aria-describedby="api-key-hint"
            />
            <button type="button" className="secondary" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p id="api-key-hint" className="hint muted">
            Stored unencrypted in this browser's extension storage and sent only to {preset.label}.{' '}
            {preset.keyUrl && (
              <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                Get an API key
              </a>
            )}
          </p>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            list="model-options"
            spellCheck={false}
            placeholder={preset.defaultModel || 'Model name'}
            value={settings.models[providerId] ?? ''}
            onChange={(e) =>
              update((s) => ({ ...s, models: { ...s.models, [providerId]: e.target.value } }))
            }
            aria-describedby="model-hint"
          />
          <datalist id="model-options">
            {modelOptions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <p id="model-hint" className="hint muted">
            {preset.defaultModel
              ? `Leave empty to use ${preset.defaultModel}.`
              : 'Required. Test the connection to list available models.'}
          </p>
        </div>

        {preset.editableBaseUrl && (
          <div className="field">
            <label htmlFor="base-url">Server URL</label>
            <input
              id="base-url"
              type="url"
              spellCheck={false}
              placeholder={preset.baseUrl || 'https://example.com/v1'}
              value={settings.baseUrls[providerId] ?? ''}
              onChange={(e) =>
                update((s) => ({
                  ...s,
                  baseUrls: { ...s.baseUrls, [providerId]: e.target.value },
                }))
              }
            />
          </div>
        )}

        <div className="actions">
          <button type="submit" value="save" disabled={status.kind === 'working'}>
            Save
          </button>
          <button
            type="submit"
            value="test"
            className="secondary"
            disabled={status.kind === 'working'}
          >
            Save and test connection
          </button>
        </div>

        <p role="status" className={status.kind === 'error' ? 'error' : status.kind}>
          {status.kind !== 'idle' && status.message}
        </p>
      </form>

      <PromptSection />

      {__EVAL_PAGE__ && (
        <p className="muted">
          <a href="/eval.html" target="_blank">
            Activity evaluation
          </a>
          : generate learning activities for the saved test transcripts with these settings and
          check their quality.
        </p>
      )}
    </main>
  );
}
