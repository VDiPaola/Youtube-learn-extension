// Command-line version of the extension's evaluation page, for automation.
// Costs money: run only with `pnpm eval:activities`. See docs/EVALUATION.md.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateFixture, renderReport } from '@/lib/learn/evaluate';
import { createProvider } from '@/lib/learn/providers';
import { configProblem, resolveProviderConfig, type ProviderId } from '@/lib/settings';
import type { TranscriptFixture } from '@/lib/transcript/sanitize';

const FIXTURE_DIR = new URL('../fixtures/transcripts/', import.meta.url);
const OUTPUT_ROOT = new URL('../../eval/output/', import.meta.url);

const providerId = (process.env.YTL_EVAL_PROVIDER ?? 'anthropic') as ProviderId;
const config = resolveProviderConfig(
  {
    providerId,
    models: { [providerId]: process.env.YTL_EVAL_MODEL },
    baseUrls: { [providerId]: process.env.YTL_EVAL_BASE_URL },
  },
  { [providerId]: process.env.YTL_EVAL_API_KEY },
);
const problem = configProblem(config);
const runDir = new URL(
  `${new Date().toISOString().replace(/[:.]/g, '-')}-${providerId}-${config.model.replace(/[^\w.-]/g, '_')}/`,
  OUTPUT_ROOT,
);

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(new URL(file, FIXTURE_DIR), 'utf8')) as TranscriptFixture);

describe.skipIf(problem !== null)(`activity evaluation (${providerId}, ${config.model})`, () => {
  it.each(fixtures.map((f) => [f.videoId, f] as const))(
    '%s',
    async (_, fixture) => {
      const evaluation = await evaluateFixture(fixture, createProvider(config));
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        new URL(`${fixture.videoId}.md`, runDir),
        renderReport(evaluation, config.preset.label, config.model),
      );
      expect(evaluation.checks.filter((c) => !c.passed)).toEqual([]);
    },
    600_000,
  );
});

if (problem) console.warn(`Activity evaluation skipped: ${problem}`);
