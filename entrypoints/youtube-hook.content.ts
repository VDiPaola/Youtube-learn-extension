import type { CapturedResponse } from '@/lib/transcript/types';
import { serveBridge } from '@/lib/youtube/bridge';
import { classifyRequest, isTrackedUrl } from '@/lib/youtube/capture';
import { videoIdFromUrl } from '@/lib/youtube/player-response';
import { decodeRequestBody } from '@/lib/youtube/request-body';

const MAX_CAPTURES = 20;

interface PlayerElement extends HTMLElement {
  getPlayerResponse?: () => unknown;
}

declare global {
  interface Window {
    ytInitialPlayerResponse?: unknown;
  }
}

/**
 * Runs in the page's MAIN world before YouTube's scripts. Records transcript and caption
 * responses that YouTube's own code requests, since those carry valid attestation.
 */
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const captures: CapturedResponse[] = [];
    const store = (capture: CapturedResponse) => {
      captures.push(capture);
      if (captures.length > MAX_CAPTURES) captures.shift();
    };

    const originalFetch = window.fetch.bind(window);
    hookFetch(originalFetch, store);
    hookXhr(store);

    serveBridge({
      getPlayerResponse: () =>
        document.querySelector<PlayerElement>('#movie_player')?.getPlayerResponse?.() ??
        window.ytInitialPlayerResponse ??
        null,
      getCaptured: ({ videoId }) => captures.filter((capture) => capture.videoId === videoId),
      fetchText: async ({ url }) => {
        const response = await originalFetch(url, { credentials: 'include' });
        return { status: response.status, text: await response.text() };
      },
    });
  },
});

function hookFetch(originalFetch: typeof fetch, store: (capture: CapturedResponse) => void): void {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isTrackedUrl(url)) return originalFetch(input, init);

    const rawBody: Promise<unknown> =
      init?.body != null
        ? Promise.resolve(init.body)
        : input instanceof Request
          ? input.clone().arrayBuffer()
          : Promise.resolve(undefined);
    const requestBody = rawBody.then(decodeRequestBody).catch(() => undefined);
    const videoId = pageVideoId();
    const response = await originalFetch(input, init);
    void record(url, requestBody, videoId, response.status, response.clone().text(), store);
    return response;
  };
}

function hookXhr(store: (capture: CapturedResponse) => void): void {
  const { open, send } = XMLHttpRequest.prototype;
  const urls = new WeakMap<XMLHttpRequest, string>();

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    urls.set(this, String(args[1]));
    return Reflect.apply(open, this, args);
  } as typeof open;

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body) {
    const url = urls.get(this);
    if (url && isTrackedUrl(url)) {
      const videoId = pageVideoId();
      this.addEventListener('load', () => {
        const text =
          this.responseType === '' || this.responseType === 'text'
            ? this.responseText
            : this.responseType === 'json'
              ? JSON.stringify(this.response)
              : null;
        if (text === null) return;
        const requestBody = decodeRequestBody(body).catch(() => undefined);
        void record(url, requestBody, videoId, this.status, Promise.resolve(text), store);
      });
    }
    return send.call(this, body);
  };
}

async function record(
  url: string,
  requestBody: Promise<string | undefined>,
  videoIdAtRequest: string | null,
  status: number,
  responseText: Promise<string>,
  store: (capture: CapturedResponse) => void,
): Promise<void> {
  try {
    const target = classifyRequest(url, await requestBody, videoIdAtRequest);
    const body = await responseText;
    if (!target) return;
    store({ ...target, url, status, body, capturedAt: Date.now() });
  } catch {
    // Capturing must never break YouTube's own requests.
  }
}

function pageVideoId(): string | null {
  return videoIdFromUrl(location.href);
}
