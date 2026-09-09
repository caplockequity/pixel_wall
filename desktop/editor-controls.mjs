/** Desktop lifecycle and menu integration. No Electron imports, so these paths are testable. */
export function createCloseController({ prepare, cancel, confirmDiscard, close, onKeepEditing = () => {}, onReleaseError = () => {}, isDestroyed = () => false, isWaitingForUser = () => false, timeoutMs = 15000, timers = globalThis }) {
  let pending, state = 'idle', sequence = 0;
  function deadline(operation, delay, message, pauseForUser = false) {
    let timer;
    return Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        let expires = Date.now() + delay;
        const check = () => {
          if (pauseForUser && isWaitingForUser()) expires = Date.now() + delay;
          const remaining = expires - Date.now();
          if (remaining <= 0) reject(new Error(message));
          else timer = timers.setTimeout(check, Math.min(250, remaining));
        };
        timer = timers.setTimeout(check, Math.min(250, delay));
      }),
    ]).finally(() => timers.clearTimeout(timer));
  }
  async function run(attemptId) {
    state = 'preparing';
    let failure;
    try {
      const result = await deadline(() => prepare(attemptId), timeoutMs, 'Saving took too long. Your window has been kept open.', true);
      if (isDestroyed()) { state = 'closed'; return; }
      if (result?.status === 'ready' && result.attemptId === attemptId && typeof result.id === 'string' && result.id.length > 0 && Number.isSafeInteger(result.revision) && result.revision >= 0) {
        // prepare retains its renderer edit lock until this window is destroyed.
        state = 'closed';
        close();
        return;
      }
      failure = new Error(result?.reason || 'The editor has not confirmed that the current project was saved.');
    } catch (error) { failure = error; }
    if (isDestroyed()) { state = 'closed'; return; }
    state = 'confirming';
    let discard = false;
    try { discard = await confirmDiscard(failure) === true; } catch { /* A failed dialog must not discard artwork. */ }
    if (isDestroyed()) { state = 'closed'; return; }
    if (discard) { state = 'closed'; close(); return; }
    // Cancel invalidates even a prepare operation that completes after its timeout.
    onKeepEditing();
    try { await deadline(() => cancel(attemptId), 2000, 'The editor could not leave its save state.'); }
    catch (error) { onReleaseError(error); }
    state = 'idle';
  }
  return {
    getState: () => state,
    request() {
      if (pending) return pending;
      if (state === 'closed' || isDestroyed()) return Promise.resolve();
      const attemptId = `desktop-close-${++sequence}`;
      pending = run(attemptId).finally(() => { pending = undefined; });
      return pending;
    },
  };
}

// This self-contained function is serialized into the sandboxed renderer.
// It exposes no Node/Electron capability and accepts only the actions below.
export async function rendererEditorAction(action, payload) {
  const api = window.pixelwall;
  if (action === 'prepareClose') {
    if (typeof api?.desktop?.prepareClose !== 'function') return { status: 'blocked', reason: 'The editor is still opening. Keep this window open and try again.' };
    return api.desktop.prepareClose(payload);
  }
  if (action === 'cancelClose') return api?.desktop?.cancelClose?.(payload);
  if (['undo', 'redo', 'clipboardTarget', 'cut', 'copy', 'paste'].includes(action)) {
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    const textInput = focused?.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(focused.type);
    if (focused?.isContentEditable || focused?.tagName === 'TEXTAREA' || textInput) return { textEditing: true };
    if (action === 'clipboardTarget') return { artwork: true };
    if (['cut', 'copy', 'paste'].includes(action)) return api?.desktop?.action(action);
    if (typeof api?.[action] !== 'function') throw new Error('The editor is still opening.');
    await api[action]();
    return { handled: true };
  }
  if (!api) throw new Error('The editor is still opening.');
  if (action === 'backup') return api.export({ format: 'project' });
  if (['new', 'open', 'save', 'saveAs', 'export'].includes(action)) {
    if (typeof api.desktop?.action !== 'function') throw new Error('This editor is not ready for desktop commands.');
    return api.desktop.action(action);
  }
  throw new Error('Unknown desktop editor action.');
}

export async function runEditorAction(webContents, action, payload, {authorizeClipboard} = {}) {
  if (['cut', 'copy', 'paste'].includes(action)) {
    const focused = await webContents.executeJavaScript(`(${rendererEditorAction.toString()})('clipboardTarget')`, true);
    if (focused?.textEditing) { webContents[action](); return {textEditing:true}; }
    if (!authorizeClipboard?.(action)) throw Error('The image clipboard is not ready. Try Copy or Paste again.');
  }
  const source = `(${rendererEditorAction.toString()})(${JSON.stringify(action)}, ${JSON.stringify(payload) ?? 'undefined'})`;
  // Native menu selections supply the user gesture needed by file inputs/downloads.
  const result = await webContents.executeJavaScript(source, true);
  if (result?.textEditing === true && ['undo', 'redo', 'cut', 'copy', 'paste'].includes(action)) webContents[action]();
  return result;
}
