import { normalizeWhitespace } from '@/lib/youtube/text';
import type { TranscriptSegment } from './types';

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

export function parseJson3(body: string): TranscriptSegment[] {
  const data = JSON.parse(body) as { events?: Json3Event[] };
  if (!Array.isArray(data?.events)) throw new Error('Not a json3 caption document');

  const segments: TranscriptSegment[] = [];
  for (const event of data.events) {
    if (!event.segs || typeof event.tStartMs !== 'number') continue;
    const text = normalizeWhitespace(event.segs.map((seg) => seg.utf8 ?? '').join(''));
    if (!text) continue;
    segments.push({ startMs: event.tStartMs, durationMs: event.dDurationMs ?? 0, text });
  }
  return segments;
}
