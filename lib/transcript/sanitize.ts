import type { CapturedKind, CapturedResponse } from './types';

export interface TranscriptFixture {
  videoId: string;
  kind: CapturedKind;
  languageCode?: string;
  capturedAt: string;
  /** Video details used by the activity evaluation. Missing in fixtures saved before Phase 2. */
  video?: { title: string; channelName: string; durationSec: number };
  body: unknown;
}

const SENSITIVE_KEYS = new Set([
  'responseContext',
  'trackingParams',
  'clickTrackingParams',
  'visitorData',
  'loggingContext',
]);
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** Builds a test fixture without URLs, tokens, visitor data, or IP addresses. */
export function toFixture(
  captured: CapturedResponse,
  video?: TranscriptFixture['video'],
): TranscriptFixture {
  return {
    videoId: captured.videoId,
    kind: captured.kind,
    languageCode: captured.languageCode,
    capturedAt: new Date(captured.capturedAt).toISOString(),
    video,
    body: scrub(JSON.parse(captured.body)),
  };
}

function scrub(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(IPV4_PATTERN, '0.0.0.0');
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEYS.has(key))
        .map(([key, child]) => [key, scrub(child)]),
    );
  }
  return value;
}
