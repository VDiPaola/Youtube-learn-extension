import { useEffect, useState } from 'react';
import { reviewSettingsItem, type ReviewSettings } from '@/lib/review-settings';

const RETENTION_CHOICES = [0.8, 0.85, 0.9, 0.95];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour));

export function ReviewSection() {
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void reviewSettingsItem.getValue().then(setSettings);
    return reviewSettingsItem.watch((value) => setSettings(value));
  }, []);

  if (!settings) return null;

  const save = (next: ReviewSettings) => {
    setSettings(next);
    void reviewSettingsItem.setValue(next);
  };

  const toggleReminder = (on: boolean) => {
    setError('');
    if (!on) return save({ ...settings, reminderEnabled: false });
    // Firefox only allows permission prompts synchronously inside the event handler.
    void browser.permissions.request({ permissions: ['notifications'] }).then((granted) => {
      if (granted) save({ ...settings, reminderEnabled: true });
      else setError('Allow notifications to get a daily reminder.');
    });
  };

  return (
    <section aria-labelledby="reviews-heading" className="section">
      <h2 id="reviews-heading">Reviews</h2>
      <div className="field">
        <label htmlFor="retention">Desired retention</label>
        <select
          id="retention"
          value={settings.desiredRetention}
          onChange={(e) => save({ ...settings, desiredRetention: Number(e.target.value) })}
        >
          {RETENTION_CHOICES.map((value) => (
            <option key={value} value={value}>
              {Math.round(value * 100)}%{value === 0.9 ? ' (recommended)' : ''}
            </option>
          ))}
        </select>
        <p className="hint muted">
          How likely you are to remember an activity when it comes due. Higher means more frequent
          reviews.
        </p>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.reminderEnabled}
          onChange={(e) => toggleReminder(e.target.checked)}
        />
        Show a daily notification when activities are due
      </label>
      {settings.reminderEnabled && (
        <div className="field">
          <label htmlFor="reminder-hour">Remind me after</label>
          <select
            id="reminder-hour"
            value={settings.reminderHour}
            onChange={(e) => save({ ...settings, reminderHour: Number(e.target.value) })}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="hint muted">The toolbar icon always shows how many activities are due.</p>
    </section>
  );
}
