import { useSyncExternalStore } from 'react';
import type { SessionStatus, Store } from '@/lib/watch/session';

/** Button in YouTube's player controls. Its label shows the activity state; a click opens them. */
export function LearnButton({
  status: store,
  onOpen,
}: {
  status: Store<SessionStatus | null>;
  onOpen: () => void;
}) {
  const status = useSyncExternalStore(store.subscribe, store.get);
  if (!status || status.state === 'loading' || status.state === 'not-eligible') return null;

  const { label, title, tone } = describe(status);
  return (
    <button
      type="button"
      className={`ytl-learn-button ytl-${tone}`}
      title={title}
      aria-busy={status.state === 'preparing'}
      onClick={onOpen}
    >
      {label}
    </button>
  );
}

/** Opens the question dialog. Shown beside the Learn button, under the same rules. */
export function AskButton({
  status: store,
  onOpen,
}: {
  status: Store<SessionStatus | null>;
  onOpen: () => void;
}) {
  const status = useSyncExternalStore(store.subscribe, store.get);
  if (!status || status.state === 'loading' || status.state === 'not-eligible') return null;

  return (
    <button
      type="button"
      className="ytl-ask-button"
      title="Ask a question about this video"
      onClick={onOpen}
    >
      Ask
    </button>
  );
}

function describe(status: SessionStatus): { label: string; title: string; tone: string } {
  switch (status.state) {
    case 'preparing':
      return {
        label: 'Preparing…',
        title: 'Writing learning activities in the background. Click to wait for them.',
        tone: 'busy',
      };
    case 'ready':
      if (status.activityCount === 0) {
        return {
          label: 'Nothing to learn',
          title: 'The video has nothing worth learning.',
          tone: 'idle',
        };
      }
      return {
        label: `Learn (${status.activityCount})`,
        title: `Start ${status.activityCount} learning activities`,
        tone: 'ready',
      };
    case 'failed':
      return { label: 'Learn failed, retry', title: status.message, tone: 'failed' };
    default:
      return {
        label: 'Learn',
        title: 'Make learning activities from this video. They are also prepared halfway through.',
        tone: 'idle',
      };
  }
}
