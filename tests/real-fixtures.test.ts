import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGetTranscriptResponse } from '@/lib/transcript/get-transcript';
import { parseJson3 } from '@/lib/transcript/json3';
import type { TranscriptFixture } from '@/lib/transcript/sanitize';

// Fixtures saved from real videos with the popup's "Download fixture" button.
const FIXTURE_DIR = new URL('./fixtures/transcripts/', import.meta.url);
const files = readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.json'));

describe.skipIf(files.length === 0)('real transcript fixtures', () => {
  it.each(files)('%s parses into ordered, non-empty segments', (file) => {
    const fixture = JSON.parse(
      readFileSync(new URL(file, FIXTURE_DIR), 'utf8'),
    ) as TranscriptFixture;
    const body = JSON.stringify(fixture.body);
    const segments =
      fixture.kind === 'timedtext' ? parseJson3(body) : parseGetTranscriptResponse(body);

    expect(segments.length).toBeGreaterThan(0);
    for (const [i, segment] of segments.entries()) {
      expect(segment.text.trim()).not.toBe('');
      expect(segment.durationMs).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(segment.startMs).toBeGreaterThanOrEqual(segments[i - 1]!.startMs);
    }
  });
});
