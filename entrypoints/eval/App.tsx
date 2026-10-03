import { useEffect, useState } from 'react';
import { ActivityList } from '@/components/ActivityList';
import { toQuizError } from '@/lib/learn/errors';
import { evaluateFixture, renderReport, type Evaluation } from '@/lib/learn/evaluate';
import { createProvider } from '@/lib/learn/providers';
import {
  apiKeysItem,
  configProblem,
  originPattern,
  resolveProviderConfig,
  settingsItem,
  type ProviderConfig,
} from '@/lib/settings';
import type { TranscriptFixture } from '@/lib/transcript/sanitize';

const FIXTURES = import.meta.glob<TranscriptFixture>('../../tests/fixtures/transcripts/*.json', {
  import: 'default',
});

type Row =
  | { path: string; status: 'pending' }
  | { path: string; status: 'running' }
  | { path: string; status: 'done'; evaluation: Evaluation }
  | { path: string; status: 'error'; error: string };

const initialRows = (): Row[] => Object.keys(FIXTURES).map((path) => ({ path, status: 'pending' }));
const videoIdOf = (path: string) => path.split('/').pop()!.split('.')[0]!;

export default function App() {
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([settingsItem.getValue(), apiKeysItem.getValue()]).then(([s, keys]) =>
      setConfig(resolveProviderConfig(s, keys)),
    );
  }, []);

  if (!config) return <main aria-busy="true" />;
  const problem = configProblem(config);

  async function run() {
    setError('');
    if (!(await browser.permissions.contains({ origins: [originPattern(config!.baseUrl)] }))) {
      setError(`Open settings and select Save to allow requests to ${config!.preset.label}.`);
      return;
    }
    setRunning(true);
    setRows(initialRows());
    const provider = createProvider(config!);
    const update = (row: Row) => setRows((all) => all.map((r) => (r.path === row.path ? row : r)));

    for (const [path, load] of Object.entries(FIXTURES)) {
      update({ path, status: 'running' });
      try {
        update({ path, status: 'done', evaluation: await evaluateFixture(await load(), provider) });
      } catch (e) {
        update({ path, status: 'error', error: toQuizError(e).message });
      }
    }
    setRunning(false);
  }

  function download() {
    const reports = rows
      .filter((row) => row.status === 'done')
      .map((row) => renderReport(row.evaluation, config!.preset.label, config!.model));
    const blob = new Blob([reports.join('\n\n---\n\n')], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `activity-evaluation-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const finished = rows.filter((row) => row.status === 'done').length;

  return (
    <main>
      <h1>Activity evaluation</h1>
      <p>
        Generates learning activities for each saved test transcript with your current settings (
        {config.preset.label}, {config.model || 'no model'}) and checks the result. Each video is
        one request to your provider.
      </p>
      {problem && (
        <p className="error">
          {problem}{' '}
          <button
            type="button"
            className="secondary"
            onClick={() => browser.runtime.openOptionsPage()}
          >
            Open settings
          </button>
        </p>
      )}

      <div className="actions">
        <button type="button" onClick={run} disabled={running || Boolean(problem)}>
          {running ? 'Running...' : `Run evaluation (${rows.length} videos)`}
        </button>
        {!running && finished > 0 && (
          <button type="button" className="secondary" onClick={download}>
            Download report
          </button>
        )}
      </div>
      <p className="error" role="alert">
        {error}
      </p>

      <ol className="results" aria-live="polite">
        {rows.map((row) => (
          <li key={row.path}>
            <ResultRow row={row} />
          </li>
        ))}
      </ol>
    </main>
  );
}

function ResultRow({ row }: { row: Row }) {
  const videoId = videoIdOf(row.path);
  if (row.status === 'pending') return <span className="muted">{videoId}: waiting</span>;
  if (row.status === 'running') return <span>{videoId}: generating...</span>;
  if (row.status === 'error')
    return (
      <span className="failed">
        {videoId}: {row.error}
      </span>
    );

  const { evaluation } = row;
  const failed = evaluation.checks.filter((c) => !c.passed);
  return (
    <details>
      <summary>
        <strong>{evaluation.title}</strong> · {evaluation.set.activities.length} activities ·{' '}
        {evaluation.seconds.toFixed(0)} s ·{' '}
        <span className={failed.length ? 'failed' : 'passed'}>
          {failed.length ? `${failed.length} checks failed` : 'all checks passed'}
        </span>
      </summary>
      <p>Topic: {evaluation.set.topic}</p>
      {failed.length > 0 && (
        <ul className="failed">
          {failed.map((c) => (
            <li key={c.name}>
              {c.name}: {c.detail}
            </li>
          ))}
        </ul>
      )}
      <ActivityList activities={evaluation.set.activities} videoId={evaluation.videoId} />
    </details>
  );
}
