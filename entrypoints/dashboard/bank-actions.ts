import { liveQuery } from 'dexie';
import { useEffect, useState, type KeyboardEvent } from 'react';
import type { Snapshot } from '@/lib/knowledge/manage';
import type { RefreshBadgeMessage } from '@/lib/messages';

/**
 * Applies a knowledge bank change and reports it in the undo toast. Resolves to an error message
 * when the change was rejected, or null when it was saved.
 */
export type RunAction = (
  message: string,
  action: () => Promise<Snapshot | void>,
) => Promise<string | null>;

/** Re-renders with the query result whenever the tables it read change, in any extension page. */
export function useLiveQuery<T>(query: () => Promise<T>): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (next) => setValue(() => next),
      error: (error) => console.warn('[YouTube Learn] Could not read the knowledge bank:', error),
    });
    return () => subscription.unsubscribe();
    // The query is fixed for the component's lifetime.
  }, []);
  return value;
}

export const onEscape = (handler: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  handler();
};

export async function refreshBadge(): Promise<void> {
  const message: RefreshBadgeMessage = { type: 'badge:refresh' };
  await browser.runtime.sendMessage(message).catch(() => undefined);
}
