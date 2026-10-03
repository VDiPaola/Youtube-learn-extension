export interface ContentScriptEntry {
  matches?: string[];
  js?: string[];
  world?: string;
}

export interface ReinjectDeps {
  contentScripts: readonly ContentScriptEntry[];
  queryTabIds(matches: string[]): Promise<number[]>;
  inject(tabId: number, files: string[], world: 'MAIN' | 'ISOLATED'): Promise<unknown>;
  log(message: string): void;
}

/**
 * Browsers do not update content scripts in tabs that were already open when the extension was
 * installed or updated; those tabs keep a disconnected old copy. This injects the current ones.
 */
export async function reinjectContentScripts(deps: ReinjectDeps): Promise<void> {
  for (const script of deps.contentScripts) {
    if (!script.matches?.length || !script.js?.length) continue;
    const world = script.world === 'MAIN' ? 'MAIN' : 'ISOLATED';
    for (const tabId of await deps.queryTabIds(script.matches)) {
      try {
        await deps.inject(tabId, script.js, world);
      } catch (error) {
        deps.log(
          `Could not update tab ${tabId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }
}
