import type { CachedActivities } from '@/lib/db';
import type { GenerateQuizResponse } from '@/lib/messages';
import {
  checkEligibility,
  enabledActivityTypes,
  prepareAtSec,
  type PromptSettings,
} from '@/lib/prompt-settings';
import { QuizError, toQuizError, type QuizErrorCode } from '@/lib/learn/errors';
import { ACTIVITY_TYPES, type Activity, type ActivityType } from '@/lib/learn/schema';
import type { TranscriptSegment } from '@/lib/transcript/types';
import type { VideoInfo } from '@/lib/youtube/player-response';

/** Minimal observable value for React's useSyncExternalStore. */
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private state: T) {}

  get = (): T => this.state;

  set(state: T): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export type OverlayState =
  | { view: 'hidden' }
  | { view: 'loading' }
  | { view: 'error'; code: QuizErrorCode; message: string }
  | { view: 'learn'; entry: CachedActivities; activities: Activity[] };

export type PrepareStep = 'cache' | 'transcript' | 'generating';

export type SessionStatus =
  | { state: 'loading' }
  | { state: 'not-eligible'; reason: string }
  | { state: 'waiting'; prepareAtSec: number }
  | { state: 'preparing'; step: PrepareStep }
  | { state: 'ready'; activityCount: number }
  | { state: 'failed'; code: QuizErrorCode; message: string };

export interface WatchDeps {
  loadVideo(videoId: string): Promise<VideoInfo>;
  loadPrefs(): Promise<PromptSettings>;
  getCachedQuiz(videoId: string): Promise<CachedActivities | null>;
  loadTranscript(video: VideoInfo): Promise<TranscriptSegment[] | null>;
  generateQuiz(video: VideoInfo, segments: TranscriptSegment[]): Promise<GenerateQuizResponse>;
  pauseVideo(): void;
  onStatus(status: SessionStatus): void;
  log(message: string): void;
}

/** Tracks one video: prepares learning activities at 50% and opens them on request. */
export class WatchSession {
  private video: VideoInfo | null = null;
  private eligible = false;
  private ineligibleReason = '';
  private autoAttempted = false;
  private preparing: Promise<CachedActivities> | null = null;
  private prepared: CachedActivities | null = null;
  private step: PrepareStep | null = null;
  private failure: QuizError | null = null;
  private enabledTypes: readonly ActivityType[] = ACTIVITY_TYPES;
  private disposed = false;

  constructor(
    readonly videoId: string,
    private readonly deps: WatchDeps,
    private readonly overlay: Store<OverlayState>,
  ) {}

  async start(): Promise<void> {
    this.emit();
    try {
      this.video = await this.deps.loadVideo(this.videoId);
      const prefs = await this.deps.loadPrefs();
      this.enabledTypes = enabledActivityTypes(prefs);
      const eligibility = checkEligibility(this.video, prefs);
      this.eligible = eligibility.eligible;
      this.ineligibleReason = eligibility.eligible ? '' : eligibility.reason;
    } catch (error) {
      this.eligible = false;
      this.ineligibleReason = toQuizError(error).message;
    }
    this.emit();
  }

  getStatus(): SessionStatus {
    if (this.step) return { state: 'preparing', step: this.step };
    if (this.prepared) {
      return { state: 'ready', activityCount: this.usableActivities(this.prepared).length };
    }
    if (this.failure) {
      return { state: 'failed', code: this.failure.code, message: this.failure.message };
    }
    if (!this.video && !this.ineligibleReason) return { state: 'loading' };
    if (!this.eligible) return { state: 'not-eligible', reason: this.ineligibleReason };
    return { state: 'waiting', prepareAtSec: prepareAtSec(this.video!.durationSec) };
  }

  onProgress(currentSec: number): void {
    if (this.disposed || !this.video || !this.eligible) return;
    // One automatic attempt per video; retrying on every playback tick would repeat paid requests.
    if (!this.autoAttempted && currentSec >= prepareAtSec(this.video.durationSec)) {
      this.autoAttempted = true;
      this.prepare().catch(() => {
        // Recorded in the status; the Learn button offers a retry.
      });
    }
  }

  /** Opens the activities, generating them first if needed. Used by the Learn button and the popup. */
  async openNow(): Promise<void> {
    if (this.overlay.get().view === 'learn') return;
    this.overlay.set({ view: 'loading' });
    // Closing the loading dialog cancels opening; generation still finishes and is cached.
    const stillWaiting = () => !this.disposed && this.overlay.get().view === 'loading';
    try {
      const entry = await this.prepare();
      this.enabledTypes = enabledActivityTypes(await this.deps.loadPrefs());
      if (!stillWaiting()) return;
      const activities = this.usableActivities(entry);
      if (activities.length === 0) {
        throw new QuizError('no-activities', 'The video has nothing worth learning.');
      }
      this.overlay.set({ view: 'learn', entry, activities });
      this.deps.pauseVideo();
    } catch (error) {
      if (!stillWaiting()) return;
      const { code, message } = toQuizError(error);
      this.overlay.set({ view: 'error', code, message });
    }
  }

  close(): void {
    this.overlay.set({ view: 'hidden' });
  }

  dispose(): void {
    this.disposed = true;
    this.overlay.set({ view: 'hidden' });
  }

  /** Activities of the types enabled in settings; saved sets may include others. */
  private usableActivities(entry: CachedActivities): Activity[] {
    return entry.set.activities.filter((activity) => this.enabledTypes.includes(activity.type));
  }

  private emit(): void {
    if (!this.disposed) this.deps.onStatus(this.getStatus());
  }

  private prepare(): Promise<CachedActivities> {
    this.preparing ??= this.generate().then(
      (entry) => {
        this.prepared = entry;
        this.failure = null;
        this.preparing = null;
        this.emit();
        return entry;
      },
      (error: unknown) => {
        this.failure = toQuizError(error);
        this.preparing = null;
        this.deps.log(
          `Activity preparation failed (${this.failure.code}): ${this.failure.message}`,
        );
        this.emit();
        throw this.failure;
      },
    );
    return this.preparing;
  }

  private setStep(step: PrepareStep): void {
    this.step = step;
    this.emit();
  }

  private async generate(): Promise<CachedActivities> {
    try {
      this.setStep('cache');
      const video = this.video ?? (await this.deps.loadVideo(this.videoId));
      const cached = await this.deps.getCachedQuiz(this.videoId);
      if (cached) return cached;

      this.setStep('transcript');
      const segments = await this.deps.loadTranscript(video);
      if (!segments) {
        throw new QuizError('no-transcript', 'No transcript is available for this video.');
      }
      this.setStep('generating');
      const response = await this.deps.generateQuiz(video, segments);
      if (!response.ok) throw new QuizError(response.code, response.error);
      return response.quiz;
    } finally {
      this.step = null;
    }
  }
}
