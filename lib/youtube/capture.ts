import type { CapturedKind } from '@/lib/transcript/types';

const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const GET_TRANSCRIPT_PATH = '/youtubei/v1/get_transcript';
const TIMEDTEXT_PATH = '/api/timedtext';

export interface CaptureTarget {
  kind: CapturedKind;
  videoId: string;
  languageCode?: string;
}

export function isTrackedUrl(url: string): boolean {
  return url.includes(GET_TRANSCRIPT_PATH) || url.includes(TIMEDTEXT_PATH);
}

export function classifyRequest(
  url: string,
  requestBody: string | undefined,
  pageVideoId: string | null,
): CaptureTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url, YOUTUBE_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.pathname === GET_TRANSCRIPT_PATH) {
    const videoId = videoIdFromTranscriptBody(requestBody) ?? pageVideoId;
    return videoId ? { kind: 'get_transcript', videoId } : null;
  }

  if (parsed.pathname === TIMEDTEXT_PATH) {
    const videoId = parsed.searchParams.get('v');
    if (!videoId) return null;
    const languageCode =
      parsed.searchParams.get('tlang') ?? parsed.searchParams.get('lang') ?? undefined;
    return { kind: 'timedtext', videoId, languageCode };
  }

  return null;
}

function videoIdFromTranscriptBody(body: string | undefined): string | null {
  if (!body) return null;
  try {
    const data = JSON.parse(body) as { externalVideoId?: string; params?: string };
    return data.externalVideoId ?? videoIdFromTranscriptParams(data.params);
  } catch {
    return null;
  }
}

/** `params` is base64 protobuf; field 1 (tag 0x0a) holds the video ID. */
export function videoIdFromTranscriptParams(params: string | undefined): string | null {
  if (!params) return null;
  try {
    const bytes = atob(decodeURIComponent(params).replace(/-/g, '+').replace(/_/g, '/'));
    if (bytes.charCodeAt(0) !== 0x0a) return null;
    const length = bytes.charCodeAt(1);
    const videoId = bytes.slice(2, 2 + length);
    return /^[\w-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}
