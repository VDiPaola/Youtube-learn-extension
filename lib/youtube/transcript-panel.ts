import { SEGMENT_SELECTOR, scrapeTranscriptSegments } from '@/lib/transcript/panel-dom';
import type { PanelReadResult } from '@/lib/transcript/pipeline';
import type { CapturedResponse } from '@/lib/transcript/types';

const PANEL_SELECTOR = [
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
  'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
].join(', ');
const SHOW_TRANSCRIPT_BUTTON_SELECTOR = 'ytd-video-description-transcript-section-renderer button';
const VISIBILITY_EXPANDED = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
const VISIBILITY_HIDDEN = 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';
const HIDE_STYLE_ID = 'ytl-hide-transcript-panel';
const POLL_INTERVAL_MS = 250;
const DOM_SETTLE_MS = 1_500;
const FAILED_SETTLE_MS = 4_000;

/**
 * Opens the transcript panel invisibly so YouTube sends its own attested request,
 * then returns the first response captured after opening plus any rendered segments.
 */
export async function readTranscriptPanel(
  videoId: string,
  getCaptured: (videoId: string) => Promise<CapturedResponse[]>,
  timeoutMs = 10_000,
): Promise<PanelReadResult> {
  const expandedBefore = new Set(transcriptPanels().filter(isExpanded));
  const wasOpen = expandedBefore.size > 0;
  const staleSegments = new Set(wasOpen ? [] : document.querySelectorAll(SEGMENT_SELECTOR));
  const openedAt = Date.now();

  if (!wasOpen) {
    hidePanelsVisually();
    if (!openPanel()) {
      restorePanelVisibility();
      throw new Error('Transcript panel not found on the page');
    }
  }

  try {
    const deadline = openedAt + timeoutMs;
    let captured: CapturedResponse | null = null;
    let capturedSeenAt = 0;

    while (Date.now() < deadline) {
      captured = pickFreshCapture(await getCaptured(videoId), openedAt) ?? captured;
      if (captured && !capturedSeenAt) capturedSeenAt = Date.now();

      const segments = scrapeTranscriptSegments(freshSegmentElements(staleSegments));
      if (segments.length > 0) return { captured, segments };
      const settleMs = isUsable(captured) ? DOM_SETTLE_MS : FAILED_SETTLE_MS;
      if (captured && Date.now() - capturedSeenAt > settleMs) return { captured, segments };

      await sleep(POLL_INTERVAL_MS);
    }
    return { captured, segments: [] };
  } finally {
    if (!wasOpen) {
      for (const panel of transcriptPanels()) {
        if (isExpanded(panel) && !expandedBefore.has(panel)) {
          panel.setAttribute('visibility', VISIBILITY_HIDDEN);
        }
      }
      restorePanelVisibility();
    }
  }
}

/** The player may also fetch captions while the panel opens, so prefer a usable get_transcript. */
function pickFreshCapture(
  captures: CapturedResponse[],
  since: number,
): CapturedResponse | undefined {
  const fresh = captures.filter((capture) => capture.capturedAt >= since);
  const usable = fresh.filter(isUsable);
  return (
    usable.findLast((capture) => capture.kind === 'get_transcript') ?? usable.at(-1) ?? fresh.at(-1)
  );
}

function isUsable(capture: CapturedResponse | null): capture is CapturedResponse {
  return capture?.status === 200 && capture.body.length > 0;
}

function transcriptPanels(): Element[] {
  return [...document.querySelectorAll(PANEL_SELECTOR)];
}

function isExpanded(panel: Element): boolean {
  return panel.getAttribute('visibility') === VISIBILITY_EXPANDED;
}

function openPanel(): boolean {
  const button = document.querySelector<HTMLElement>(SHOW_TRANSCRIPT_BUTTON_SELECTOR);
  if (button) {
    button.click();
    return true;
  }
  const panel = transcriptPanels()[0];
  if (panel) {
    panel.setAttribute('visibility', VISIBILITY_EXPANDED);
    return true;
  }
  return false;
}

function freshSegmentElements(stale: Set<Element>): Element[] {
  const elements = transcriptPanels().flatMap((panel) => [
    ...panel.querySelectorAll(SEGMENT_SELECTOR),
  ]);
  return elements.some((element) => stale.has(element)) ? [] : elements;
}

/** The panel only loads while inside the viewport, so make it transparent instead of moving it. */
function hidePanelsVisually(): void {
  if (document.getElementById(HIDE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIDE_STYLE_ID;
  style.textContent = `${PANEL_SELECTOR} {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 400px !important;
    height: 600px !important;
    opacity: 0 !important;
    pointer-events: none !important;
    z-index: -1 !important;
  }`;
  document.head.append(style);
}

function restorePanelVisibility(): void {
  document.getElementById(HIDE_STYLE_ID)?.remove();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
