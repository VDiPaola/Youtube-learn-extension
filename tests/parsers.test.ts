import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGetTranscriptResponse } from '@/lib/transcript/get-transcript';
import { parseJson3 } from '@/lib/transcript/json3';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/synthetic/${name}`, import.meta.url), 'utf8');

describe('parseJson3', () => {
  it('parses manual captions and skips events without text', () => {
    expect(parseJson3(fixture('json3-manual.json'))).toEqual([
      { startMs: 0, durationMs: 4320, text: 'This is a 3.' },
      {
        startMs: 4320,
        durationMs: 4780,
        text: "It's sloppily written and rendered at a low resolution.",
      },
      { startMs: 10100, durationMs: 2000, text: '& still readable' },
    ]);
  });

  it('joins word-level auto-generated segments and drops newline-only events', () => {
    expect(parseJson3(fixture('json3-asr.json'))).toEqual([
      { startMs: 160, durationMs: 4000, text: 'today we stretch' },
      { startMs: 2960, durationMs: 3000, text: 'your hamstrings' },
    ]);
  });

  it('rejects documents that are not json3', () => {
    expect(() => parseJson3('{"foo":1}')).toThrow('Not a json3 caption document');
    expect(() => parseJson3('')).toThrow();
  });
});

describe('parseGetTranscriptResponse', () => {
  it('extracts segments, skipping section headers and blank snippets', () => {
    expect(parseGetTranscriptResponse(fixture('get-transcript.json'))).toEqual([
      { startMs: 0, durationMs: 4320, text: 'This is a 3.' },
      {
        startMs: 4320,
        durationMs: 4780,
        text: "It's sloppily written and rendered at a low resolution.",
      },
      { startMs: 3725000, durationMs: 0, text: '[Music]' },
    ]);
  });

  it('finds segments even when wrapper objects change', () => {
    const body = JSON.stringify({
      newWrapper: [
        {
          deeper: {
            transcriptSegmentRenderer: {
              startMs: '1500',
              endMs: '2500',
              snippet: { simpleText: 'Hi' },
            },
          },
        },
      ],
    });
    expect(parseGetTranscriptResponse(body)).toEqual([
      { startMs: 1500, durationMs: 1000, text: 'Hi' },
    ]);
  });

  it('returns no segments for an error response', () => {
    expect(parseGetTranscriptResponse(fixture('get-transcript-error.json'))).toEqual([]);
  });
});
