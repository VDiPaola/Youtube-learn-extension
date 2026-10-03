import { normalizeWhitespace, readText, type YouTubeText } from '@/lib/youtube/text';
import type { TranscriptSegment } from './types';

interface SegmentRenderer {
  startMs?: string;
  endMs?: string;
  snippet?: YouTubeText;
}

export function parseGetTranscriptResponse(body: string): TranscriptSegment[] {
  const renderers = findAllByKey<SegmentRenderer>(JSON.parse(body), 'transcriptSegmentRenderer');

  const segments: TranscriptSegment[] = [];
  for (const renderer of renderers) {
    const startMs = Number(renderer.startMs);
    const endMs = Number(renderer.endMs);
    const text = normalizeWhitespace(readText(renderer.snippet));
    if (!Number.isFinite(startMs) || !text) continue;
    segments.push({
      startMs,
      durationMs: Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0,
      text,
    });
  }
  return segments;
}

/** Depth-first search so wrapper changes in the response do not break parsing. */
function findAllByKey<T>(root: unknown, key: string): T[] {
  const found: T[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const record = node as Record<string, unknown>;
    if (key in record) {
      found.push(record[key] as T);
      continue;
    }
    for (const value of Object.values(record).reverse()) stack.push(value);
  }
  return found;
}
