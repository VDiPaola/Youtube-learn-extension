import { describe, expect, it } from 'vitest';
import { classifyRequest, isTrackedUrl, videoIdFromTranscriptParams } from '@/lib/youtube/capture';
import { decodeRequestBody } from '@/lib/youtube/request-body';

// `params` copied from a real get_transcript request for video QaKuVOhikaY.
const REAL_PARAMS =
  'CgtRYUt1Vk9oaWthWRISQ2dOaGMzSVNBbVZ1R2dBJTNEGAEqM2VuZ2FnZW1lbnQtcGFuZWwtc2VhcmNoYWJsZS10cmFuc2NyaXB0LXNlYXJjaC1wYW5lbDAAOAFAAQ%3D%3D';
const TRANSCRIPT_URL = 'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false';

describe('isTrackedUrl', () => {
  it('matches transcript and caption endpoints only', () => {
    expect(isTrackedUrl(TRANSCRIPT_URL)).toBe(true);
    expect(isTrackedUrl('/api/timedtext?v=a')).toBe(true);
    expect(isTrackedUrl('https://www.youtube.com/youtubei/v1/next')).toBe(false);
  });
});

describe('videoIdFromTranscriptParams', () => {
  it('decodes the video ID from real protobuf params', () => {
    expect(videoIdFromTranscriptParams(REAL_PARAMS)).toBe('QaKuVOhikaY');
  });

  it('returns null for malformed params', () => {
    expect(videoIdFromTranscriptParams('not base64!')).toBeNull();
    expect(videoIdFromTranscriptParams(btoa('\x12\x0bQaKuVOhikaY'))).toBeNull();
    expect(videoIdFromTranscriptParams(undefined)).toBeNull();
  });
});

describe('classifyRequest', () => {
  it('reads the video ID from externalVideoId first', () => {
    const body = JSON.stringify({ externalVideoId: 'aircAruvnKk', params: REAL_PARAMS });
    expect(classifyRequest(TRANSCRIPT_URL, body, 'pageVideo11')).toEqual({
      kind: 'get_transcript',
      videoId: 'aircAruvnKk',
    });
  });

  it('falls back to params, then to the page video ID', () => {
    const paramsOnly = JSON.stringify({ params: REAL_PARAMS });
    expect(classifyRequest(TRANSCRIPT_URL, paramsOnly, null)?.videoId).toBe('QaKuVOhikaY');
    expect(classifyRequest(TRANSCRIPT_URL, undefined, 'pageVideo11')?.videoId).toBe('pageVideo11');
    expect(classifyRequest(TRANSCRIPT_URL, undefined, null)).toBeNull();
  });

  it('records the caption language, preferring the translated language', () => {
    expect(classifyRequest('/api/timedtext?v=abc&lang=en&fmt=json3', undefined, null)).toEqual({
      kind: 'timedtext',
      videoId: 'abc',
      languageCode: 'en',
    });
    expect(
      classifyRequest('/api/timedtext?v=abc&lang=en&tlang=de', undefined, null)?.languageCode,
    ).toBe('de');
    expect(classifyRequest('/api/timedtext?lang=en', undefined, 'x')).toBeNull();
  });

  it('ignores other endpoints', () => {
    expect(classifyRequest('https://www.youtube.com/youtubei/v1/next', '{}', 'abc')).toBeNull();
  });
});

describe('decodeRequestBody', () => {
  const json = JSON.stringify({ externalVideoId: 'QaKuVOhikaY' });

  it('passes strings through', async () => {
    expect(await decodeRequestBody(json)).toBe(json);
  });

  it('decompresses gzip bodies like the ones YouTube sends', async () => {
    const gzipped = await new Response(
      new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
    expect(await decodeRequestBody(new Uint8Array(gzipped))).toBe(json);
    expect(await decodeRequestBody(gzipped)).toBe(json);
  });

  it('decodes uncompressed binary bodies as UTF-8', async () => {
    expect(await decodeRequestBody(new TextEncoder().encode(json))).toBe(json);
  });

  it('returns undefined for missing or streamed bodies', async () => {
    expect(await decodeRequestBody(undefined)).toBeUndefined();
    expect(await decodeRequestBody(null)).toBeUndefined();
    expect(await decodeRequestBody(new Blob([json]).stream())).toBeUndefined();
  });
});
