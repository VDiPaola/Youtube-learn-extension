import { useEffect, useState } from 'react';
import { ACTIVITY_LABELS, ACTIVITY_TYPES, type ActivityType } from '@/lib/learn/schema';
import {
  enabledActivityTypes,
  promptSettingsItem,
  withChannelRule,
  type ChannelRef,
  type PromptSettings,
} from '@/lib/prompt-settings';

export function PromptSection() {
  const [settings, setSettings] = useState<PromptSettings | null>(null);

  useEffect(() => {
    void promptSettingsItem.getValue().then(setSettings);
    return promptSettingsItem.watch((value) => setSettings(value));
  }, []);

  if (!settings) return null;

  const save = (next: PromptSettings) => {
    setSettings(next);
    void promptSettingsItem.setValue(next);
  };
  const remove = (channel: ChannelRef) => save(withChannelRule(settings, channel, 'auto'));
  const enabled = enabledActivityTypes(settings);
  const disabled = new Set(settings.disabledActivityTypes ?? []);
  const toggleType = (type: ActivityType, on: boolean) => {
    const next = new Set(disabled);
    if (on) next.delete(type);
    else next.add(type);
    save({ ...settings, disabledActivityTypes: [...next] });
  };

  return (
    <section aria-labelledby="prompts-heading" className="section">
      <h2 id="prompts-heading">Learning on YouTube</h2>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.autoPrompt}
          onChange={(e) => save({ ...settings, autoPrompt: e.target.checked })}
        />
        Show the Learn button on Education videos and prepare activities halfway through
      </label>
      <p className="hint muted">
        Change the rule for a channel from the toolbar popup while watching one of its videos. Use{' '}
        <strong>Learn from this video</strong> in the popup for any other video.
      </p>
      <ChannelList
        title="Always show the Learn button"
        empty="No channels."
        channels={settings.allowedChannels}
        onRemove={remove}
      />
      <ChannelList
        title="Never show the Learn button"
        empty="No channels."
        channels={settings.blockedChannels}
        onRemove={remove}
      />
      <fieldset className="field">
        <legend>
          <h3>Activity types</h3>
        </legend>
        <p className="hint muted">
          The AI picks the type that fits each idea. Turn off types you do not want. At least one
          stays on.
        </p>
        <div className="type-grid">
          {ACTIVITY_TYPES.map((type) => {
            const on = !disabled.has(type);
            const lastOne = on && enabled.length === 1;
            return (
              <label key={type} className="checkbox">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={lastOne}
                  onChange={(e) => toggleType(type, e.target.checked)}
                />
                {ACTIVITY_LABELS[type]}
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

function ChannelList(props: {
  title: string;
  empty: string;
  channels: ChannelRef[];
  onRemove: (channel: ChannelRef) => void;
}) {
  return (
    <div className="field">
      <h3>{props.title}</h3>
      {props.channels.length === 0 ? (
        <p className="muted">{props.empty}</p>
      ) : (
        <ul className="channels">
          {props.channels.map((channel) => (
            <li key={channel.id}>
              {channel.name}
              <button
                type="button"
                className="secondary"
                aria-label={`Remove ${channel.name}`}
                onClick={() => props.onRemove(channel)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
