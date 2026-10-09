import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { answerParts } from '@/lib/learn/ask';
import type { Conversation, Store } from '@/lib/watch/session';
import { Dialog, SETTINGS_ERRORS, type OverlayActions } from './Overlay';

export function AskPanel({
  conversation: store,
  actions,
}: {
  conversation: Store<Conversation>;
  actions: OverlayActions;
}) {
  const { turns, pending, error } = useSyncExternalStore(store.subscribe, store.get);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);
  // Chromium's scrollIntoView returns a Promise, which React would treat as a cleanup function.
  useEffect(() => {
    void end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns.length, pending, error]);

  async function submit() {
    const question = draft.trim();
    if (!question || pending) return;
    setDraft('');
    const answered = await actions.ask(question);
    if (!answered) setDraft((current) => current || question);
    input.current?.focus();
  }

  const seek = (seconds: number) => {
    actions.close();
    actions.seekAndPlay(seconds);
  };

  return (
    <Dialog title="Ask about this video" onClose={actions.close}>
      {turns.length === 0 && !pending && (
        <p className="ytl-muted">
          Ask anything about the video. Answers come from the transcript and point to the moment
          where each idea is explained.
        </p>
      )}
      <ol className="ytl-chat" aria-label="Conversation" aria-live="polite">
        {turns.map((turn, i) => (
          <li key={i} className={`ytl-turn ytl-turn-${turn.role}`}>
            <span className="ytl-turn-author">{turn.role === 'user' ? 'You' : 'Coach'}</span>
            {turn.role === 'user' ? <p>{turn.text}</p> : <Answer text={turn.text} onSeek={seek} />}
          </li>
        ))}
      </ol>
      {pending && (
        <p className="ytl-muted" role="status">
          Thinking…
        </p>
      )}
      {error && (
        <div role="alert">
          <p>{error.message}</p>
          {SETTINGS_ERRORS.includes(error.code) && (
            <button type="button" onClick={actions.openSettings}>
              Open settings
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="ytl-visually-hidden" htmlFor="ytl-question">
          Your question
        </label>
        <textarea
          id="ytl-question"
          ref={input}
          className="ytl-question-input"
          rows={2}
          placeholder={
            turns.length === 0 ? 'What would you like to understand?' : 'Ask a follow-up'
          }
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="ytl-actions">
          <button type="submit" className="ytl-primary" disabled={pending || !draft.trim()}>
            Ask
          </button>
          <button
            type="button"
            onClick={() => {
              actions.close();
              actions.resume();
            }}
          >
            Resume video
          </button>
        </div>
        <p className="ytl-muted ytl-small">Enter sends, Shift+Enter adds a line, Esc closes.</p>
      </form>
      <div ref={end} />
    </Dialog>
  );
}

function Answer({ text, onSeek }: { text: string; onSeek: (seconds: number) => void }) {
  return (
    <p>
      {answerParts(text).map((part, i) =>
        'seconds' in part ? (
          <button
            key={i}
            type="button"
            className="ytl-link"
            aria-label={`Play from ${part.label}`}
            onClick={() => onSeek(part.seconds)}
          >
            {part.label}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
