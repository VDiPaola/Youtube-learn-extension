import { describe, expect, it, vi } from 'vitest';
import { reinjectContentScripts, type ReinjectDeps } from '@/lib/reinject';

const deps = (
  overrides: Partial<ReinjectDeps> = {},
): ReinjectDeps & {
  inject: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
} =>
  ({
    contentScripts: [
      {
        matches: ['*://www.youtube.com/*'],
        js: ['content-scripts/youtube-hook.js'],
        world: 'MAIN',
      },
      { matches: ['*://www.youtube.com/*'], js: ['content-scripts/youtube.js'] },
      { matches: [], js: ['ignored.js'] },
    ],
    queryTabIds: vi.fn(async () => [1, 2]),
    inject: vi.fn(async () => undefined),
    log: vi.fn(),
    ...overrides,
  }) as never;

describe('reinjectContentScripts', () => {
  it('injects every content script into open matching tabs, in manifest order and world', async () => {
    const d = deps();
    await reinjectContentScripts(d);
    expect(d.inject.mock.calls).toEqual([
      [1, ['content-scripts/youtube-hook.js'], 'MAIN'],
      [2, ['content-scripts/youtube-hook.js'], 'MAIN'],
      [1, ['content-scripts/youtube.js'], 'ISOLATED'],
      [2, ['content-scripts/youtube.js'], 'ISOLATED'],
    ]);
  });

  it('keeps going when one tab cannot be updated', async () => {
    const d = deps();
    d.inject.mockRejectedValueOnce(new Error('Tab is discarded'));
    await reinjectContentScripts(d);
    expect(d.inject).toHaveBeenCalledTimes(4);
    expect(d.log).toHaveBeenCalledWith('Could not update tab 1: Tab is discarded');
  });
});
