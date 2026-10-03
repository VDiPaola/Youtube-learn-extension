import { normalizeWhitespace } from '@/lib/youtube/text';
import type { TranscriptSegment } from './types';

/** Legacy renderer and the newer view-model element. */
export const SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer, transcript-segment-view-model';

const TIMESTAMP_PATTERN = /^\d{1,2}(?::\d{2}){1,2}$/;

/**
 * Reads each segment's leaf text: the first timestamp-shaped leaf is the start time,
 * the rest is the caption. This avoids depending on class names that change often.
 */
export function scrapeTranscriptSegments(segmentElements: Iterable<Element>): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const element of segmentElements) {
    const leaves = leafTexts(element);
    const timestampIndex = leaves.findIndex((text) => TIMESTAMP_PATTERN.test(text));
    if (timestampIndex === -1) continue;

    const startMs = parseTimestamp(leaves[timestampIndex]!);
    const text = normalizeWhitespace(leaves.filter((_, i) => i !== timestampIndex).join(' '));
    if (startMs === null || !text) continue;
    segments.push({ startMs, durationMs: 0, text });
  }

  return segments.map((segment, i) => {
    const nextStartMs = segments[i + 1]?.startMs ?? segment.startMs;
    return { ...segment, durationMs: Math.max(0, nextStartMs - segment.startMs) };
  });
}

function leafTexts(element: Element): string[] {
  const texts: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = normalizeWhitespace(node.textContent ?? '');
    if (text) texts.push(text);
  }
  return texts;
}

/** Parses `m:ss` or `h:mm:ss` into milliseconds. */
export function parseTimestamp(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part)))
    return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return seconds * 1000;
}
