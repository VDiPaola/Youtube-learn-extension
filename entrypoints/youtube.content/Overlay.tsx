import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { QuizErrorCode } from '@/lib/learn/errors';
import type { VideoResult } from '@/lib/knowledge/bank';
import type { OverlayState, Store } from '@/lib/watch/session';
import { AskPanel } from './AskPanel';
import { LearnPanel } from './LearnPanel';

export interface OverlayActions {
  close(): void;
  openSettings(): void;
  seekAndPlay(seconds: number): void;
  resume(): void;
  /** Saves one answer to the knowledge bank. */
  record(result: VideoResult): void;
  /** Sends a question. Resolves false when it was not answered. */
  ask(question: string): Promise<boolean>;
}

export const SETTINGS_ERRORS: QuizErrorCode[] = ['not-configured', 'permission', 'auth'];

export function Overlay({
  store,
  actions,
}: {
  store: Store<OverlayState>;
  actions: OverlayActions;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);

  switch (state.view) {
    case 'hidden':
      return null;
    case 'loading':
      return (
        <Dialog title="Preparing activities" onClose={actions.close}>
          <p className="ytl-muted" role="status">
            Reading the transcript and writing learning activities. This can take up to a minute.
          </p>
        </Dialog>
      );
    case 'error':
      return (
        <Dialog title="Nothing to learn yet" onClose={actions.close}>
          <p role="alert">{state.message}</p>
          <div className="ytl-actions">
            {SETTINGS_ERRORS.includes(state.code) && (
              <button type="button" className="ytl-primary" onClick={actions.openSettings}>
                Open settings
              </button>
            )}
            <button type="button" onClick={actions.close}>
              Close
            </button>
          </div>
        </Dialog>
      );
    case 'learn':
      return (
        <LearnPanel
          key={state.entry.videoId}
          topic={state.entry.set.topic}
          activities={state.activities}
          actions={actions}
          onResult={(activity, correct) =>
            actions.record({
              video: state.video,
              topic: state.entry.set.topic,
              generatedAt: state.entry.createdAt,
              activity,
              correct,
            })
          }
        />
      );
    case 'ask':
      return <AskPanel conversation={state.conversation} actions={actions} />;
  }
}

export function Dialog({
  title,
  onClose,
  onKeyDown,
  children,
}: {
  title: string;
  onClose: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Child views move focus to their main control afterwards; this covers dialogs without one.
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="ytl-scrim">
      <div
        ref={ref}
        className="ytl-dialog ytl-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ytl-dialog-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          onKeyDown?.(event);
        }}
      >
        <div className="ytl-dialog-header">
          <h2 id="ytl-dialog-title">{title}</h2>
          <button type="button" className="ytl-icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
