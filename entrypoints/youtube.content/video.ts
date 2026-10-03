import { getTranscript, type TranscriptResult } from '@/lib/transcript/pipeline';
import { callBridge } from '@/lib/youtube/bridge';
import { extractVideoInfo, type VideoInfo } from '@/lib/youtube/player-response';
import { readTranscriptPanel } from '@/lib/youtube/transcript-panel';

const PLAYER_RESPONSE_TIMEOUT_MS = 5_000;

/** After SPA navigation the player can briefly report the previous video, so wait for a match. */
export async function loadVideoInfo(videoId: string): Promise<VideoInfo> {
  const deadline = Date.now() + PLAYER_RESPONSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const info = extractVideoInfo(await callBridge('getPlayerResponse', undefined));
    if (info?.videoId === videoId) return info;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Video details did not load. Reload the page and try again.');
}

export function loadTranscript(video: VideoInfo): Promise<TranscriptResult> {
  const getCaptured = (id: string) => callBridge('getCaptured', { videoId: id });
  return getTranscript(video, {
    preferredLanguages: navigator.languages,
    getCaptured,
    fetchText: (url) => callBridge('fetchText', { url }),
    readTranscriptPanel: (id) => readTranscriptPanel(id, getCaptured),
  });
}

export function moviePlayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#movie_player');
}

export function mainVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video');
}

export function isAdShowing(): boolean {
  return moviePlayer()?.classList.contains('ad-showing') ?? false;
}
