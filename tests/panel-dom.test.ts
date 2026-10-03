// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  parseTimestamp,
  scrapeTranscriptSegments,
  SEGMENT_SELECTOR,
} from '@/lib/transcript/panel-dom';

function segmentsFrom(html: string) {
  document.body.innerHTML = html;
  return scrapeTranscriptSegments(document.querySelectorAll(SEGMENT_SELECTOR));
}

describe('scrapeTranscriptSegments', () => {
  it('reads the legacy renderer markup', () => {
    const html = `
      <ytd-transcript-segment-renderer>
        <div class="segment" role="button" aria-label="0 seconds This is a 3.">
          <div class="segment-start-offset" aria-hidden="true">
            <div class="segment-timestamp"> 0:00 </div>
          </div>
          <yt-formatted-string class="segment-text">This is a 3.</yt-formatted-string>
        </div>
      </ytd-transcript-segment-renderer>
      <ytd-transcript-segment-renderer>
        <div class="segment-timestamp">1:02:05</div>
        <yt-formatted-string class="segment-text">It's sloppily
          written</yt-formatted-string>
      </ytd-transcript-segment-renderer>`;

    expect(segmentsFrom(html)).toEqual([
      { startMs: 0, durationMs: 3_725_000, text: 'This is a 3.' },
      { startMs: 3_725_000, durationMs: 0, text: "It's sloppily written" },
    ]);
  });

  it('reads view-model markup without relying on class names', () => {
    const html = `
      <transcript-segment-view-model>
        <div><span>0:04</span></div>
        <span><span>Hello</span> <b>world</b></span>
      </transcript-segment-view-model>
      <transcript-segment-view-model>
        <span>0:09</span><span>Next line</span>
      </transcript-segment-view-model>`;

    expect(segmentsFrom(html)).toEqual([
      { startMs: 4000, durationMs: 5000, text: 'Hello world' },
      { startMs: 9000, durationMs: 0, text: 'Next line' },
    ]);
  });

  it('skips segments without a timestamp or text', () => {
    const html = `
      <ytd-transcript-segment-renderer><span>No time here</span></ytd-transcript-segment-renderer>
      <ytd-transcript-segment-renderer><span>0:10</span></ytd-transcript-segment-renderer>`;
    expect(segmentsFrom(html)).toEqual([]);
  });
});

describe('parseTimestamp', () => {
  it.each([
    ['0:00', 0],
    ['1:05', 65_000],
    ['12:34', 754_000],
    ['1:02:03', 3_723_000],
  ])('parses %s', (input, expected) => {
    expect(parseTimestamp(input)).toBe(expected);
  });

  it.each(['', '5', 'a:bc', '1:2:3:4', '1:-5'])('rejects %j', (input) => {
    expect(parseTimestamp(input)).toBeNull();
  });
});
