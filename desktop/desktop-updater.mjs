import { createUpdateController } from './update-checker.mjs';

/** UI state and explicit user actions; scheduling/legacy feed validation stay in the checker. */
export function createDesktopUpdater({ installer, restart, onState = () => {}, onHealth = async () => {}, show = () => {}, ...options }) {
  let state = { status: 'idle', currentVersion: options.currentVersion }, candidate, transfer, restarting, abort, disposed = false;
  const busy = () => ['downloading', 'ready', 'installing'].includes(state.status);
  const set = patch => { if (!disposed) { state = { ...state, ...patch }; onState(state); } };
  // Reporting must never prevent or indefinitely delay an update.
  const health = async event => {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => onHealth({ ...event, target_version: state.version })),
        new Promise(resolve => { timer = setTimeout(resolve, 500); }),
      ]);
    } catch { /* Optional diagnostics are best effort. */ }
    finally { clearTimeout(timer); }
  };
  const checker = createUpdateController({ ...options, shouldNotify: () => !busy(), notify: async event => {
    if (disposed || busy()) return 'later';
    if (event.kind === 'available') {
      candidate = event;
      set({ status: 'available', version: event.manifest.version, notes: event.manifest.releaseNotes, message: '', progress: 0 });
    } else if (event.kind === 'current') set({ status: 'current', message: '' });
    else if (event.kind === 'unsupported') set({ status: 'unsupported', message: 'No update is available for this computer.' });
    else if (event.kind === 'error') set({ status: 'error', message: event.message, retry: 'check' });
    show();
    return 'later';
  } });
  async function check({ manual = false } = {}) {
    if (disposed) return;
    if (manual) show();
    if (busy() || transfer || restarting) return;
    if (manual) set({ status: 'checking', message: '' });
    return checker.check({ manual });
  }
  function download() {
    if (disposed || transfer || restarting || !candidate || !(state.status === 'available' || (state.status === 'error' && state.retry === 'download'))) return transfer;
    abort = new AbortController();
    const signal = abort.signal;
    set({ status: 'downloading', progress: 0, message: '' });
    transfer = (async () => {
      try {
        await installer.download({ ...candidate, signal, onProgress: percent => {
          if (!signal.aborted && Number.isFinite(percent)) set({ progress: Math.max(0, Math.min(100, percent)) });
        } });
        if (signal.aborted) throw new Error('Cancelled');
        if (disposed) return;
        await health({ operation: 'update_download', outcome: 'success' });
        set({ status: 'ready', progress: 100, message: '' });
        show();
      } catch {
        if (signal.aborted) set({ status: 'available', progress: 0, message: 'Download cancelled. You can try again whenever you’re ready.' });
        else { await health({ operation: 'update_failure', outcome: 'failure', failure_category: 'download' }); set({ status: 'error', retry: 'download', message: 'PixelWall could not download or verify the update. Check your connection and available disk space, then retry.' }); show(); }
      } finally { transfer = undefined; abort = undefined; }
    })();
    return transfer;
  }
  function install() {
    if (disposed || restarting || state.status !== 'ready') return restarting;
    set({ status: 'installing', message: 'Saving your artwork and preparing the update…' });
    restarting = (async () => {
      try {
        const result = await restart(async () => { await health({ operation: 'update_install_attempt', outcome: 'success', version: state.version }); await installer.install(); });
        if (result !== true) { await health({ operation: 'update_failure', outcome: 'cancelled', failure_category: 'restart' }); set({ status: 'ready', message: 'Restart cancelled. Your artwork remains open. Save your work and try again.' }); }
      } catch {
        await health({ operation: 'update_failure', outcome: 'failure', failure_category: 'install' });
        set({ status: 'ready', message: 'PixelWall could not install the update. Your artwork remains open. Please try restarting again.' });
      } finally { restarting = undefined; }
    })();
    return restarting;
  }
  return {
    start: () => checker.start(), check, download, install,
    cancel: () => { abort?.abort(); },
    notes: () => candidate ? options.openExternal(candidate.manifest.releaseNotesUrl) : undefined,
    getState: () => state,
    setAutomaticChecks: enabled => checker.setAutomaticChecks(enabled),
    dispose() { disposed = true; abort?.abort(); checker.dispose(); installer.dispose(); },
  };
}
