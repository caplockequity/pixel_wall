/** Renderer-side close handshake. A successful save alone cannot authorize closing
 * if a newer document edit or an unfinished operation exists. No Electron APIs. */
export function createDesktopSession(host) {
  let active = null;
  let sequence = 0;
  const blocked = (attemptId, reason) => ({ status: 'blocked', attemptId, reason });
  const session = {
    get locked() { return active !== null; },
    assertEditable() {
      if (active) throw new Error('Finish the close dialog before editing this project.');
    },
    prepareClose(attemptId = `close-${++sequence}`) {
      if (typeof attemptId !== 'string' || !attemptId || attemptId.length > 200)
        return Promise.resolve(blocked(attemptId, 'Invalid close request.'));
      if (active) return active.id === attemptId ? active.promise : Promise.resolve(blocked(attemptId, 'Another close request is still pending.'));
      const attempt = { id: attemptId, promise: null };
      active = attempt;
      attempt.promise = (async () => {
        const before = host.desktopState();
        if (!before?.loaded || !before.id)
          return blocked(attemptId, 'The editor has not finished opening. Keep it open until your project is ready.');
        if (before.busy)
          return blocked(attemptId, 'Finish the current edit, import or recovery before closing.');
        if (!before.canSave)
          return blocked(attemptId, 'Device storage is unavailable. Keep the editor open and save a project backup.');
        const result = await (host.saveForClose ? host.saveForClose() : host.save());
        if (active !== attempt) return blocked(attemptId, 'This close request was cancelled.');
        if (!result || result.saved === false || result.document?.id !== before.id || !Number.isSafeInteger(result.revision))
          return blocked(attemptId, result?.reason || 'The project was not saved. Keep the editor open and save a project backup.');
        const after = host.desktopState();
        if (!after?.canSave || after.busy || before.id !== after.id || before.revision !== after.revision)
          return blocked(attemptId, 'The project changed while saving. Keep the editor open and try closing again.');
        return { status: 'ready', attemptId, id: after.id, revision: after.revision, ...(host.saveForClose ? {nativeDocuments:result.nativeDocuments} : {}) };
      })();
      return attempt.promise;
    },
    cancelClose(attemptId) {
      if (!active || active.id !== attemptId) return false;
      active = null;
      return true;
    },
    async action(name) {
      session.assertEditable();
      if (!['new', 'open', 'save', 'saveAs', 'export', 'cut', 'copy', 'paste'].includes(name)) throw new Error('Unknown desktop action.');
      return host.desktopAction(name);
    },
  };
  return Object.freeze(session);
}
