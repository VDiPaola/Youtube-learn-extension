import type { CapturedResponse } from '@/lib/transcript/types';

/**
 * Request/response channel between the isolated content script and the MAIN world script.
 * Payloads travel as JSON strings because Firefox blocks cross-world object access.
 */
const REQUEST_EVENT = 'ytl:bridge-request';
const RESPONSE_EVENT = 'ytl:bridge-response';

export interface BridgeMethods {
  getPlayerResponse: { params: undefined; result: unknown };
  getCaptured: { params: { videoId: string }; result: CapturedResponse[] };
  fetchText: { params: { url: string }; result: { status: number; text: string } };
}

export type BridgeMethod = keyof BridgeMethods;

export type BridgeHandlers = {
  [M in BridgeMethod]: (
    params: BridgeMethods[M]['params'],
  ) => BridgeMethods[M]['result'] | Promise<BridgeMethods[M]['result']>;
};

interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params: unknown;
}

interface BridgeResponse {
  id: string;
  result?: unknown;
  error?: string;
}

export function serveBridge(handlers: BridgeHandlers): void {
  window.addEventListener(REQUEST_EVENT, async (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;

    let request: BridgeRequest;
    try {
      request = JSON.parse(detail);
    } catch {
      return;
    }
    const handler = handlers[request.method] as ((params: unknown) => unknown) | undefined;
    if (!handler) return;

    let response: BridgeResponse;
    try {
      response = { id: request.id, result: await handler(request.params) };
    } catch (error) {
      response = { id: request.id, error: error instanceof Error ? error.message : String(error) };
    }
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify(response) }));
  });
}

export function callBridge<M extends BridgeMethod>(
  method: M,
  params: BridgeMethods[M]['params'],
  timeoutMs = 10_000,
): Promise<BridgeMethods[M]['result']> {
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener(RESPONSE_EVENT, onResponse);
      reject(new Error(`Bridge call "${method}" timed out`));
    }, timeoutMs);

    function onResponse(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string') return;
      let response: BridgeResponse;
      try {
        response = JSON.parse(detail);
      } catch {
        return;
      }
      if (response.id !== id) return;

      clearTimeout(timer);
      window.removeEventListener(RESPONSE_EVENT, onResponse);
      if (response.error) reject(new Error(response.error));
      else resolve(response.result as BridgeMethods[M]['result']);
    }

    window.addEventListener(RESPONSE_EVENT, onResponse);
    const request: BridgeRequest = { id, method, params };
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify(request) }));
  });
}
