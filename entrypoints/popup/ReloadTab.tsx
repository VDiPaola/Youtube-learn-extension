const RELOAD_MESSAGE =
  'This tab is not connected to the extension, usually because it was open during an update.';

/** Shown when the YouTube tab does not answer, with a one-click fix. */
export function ReloadTab({
  tabId,
  message = RELOAD_MESSAGE,
}: {
  tabId: number;
  message?: string;
}) {
  return (
    <div className="status" role="alert">
      <p className="error">{message}</p>
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            void browser.tabs.reload(tabId);
            window.close();
          }}
        >
          Reload tab
        </button>
      </div>
    </div>
  );
}
