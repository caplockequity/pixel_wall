/** Renderer coordinator. Only the native bridge holds file paths; the host owns
 * document decoding, recovery storage, revisions and UI. */
export function createNativeDocumentSession(bridge, host) {
  let busy = false, running = Promise.resolve(), queued = 0;
  async function exclusive(operation) {
    if (busy) throw Error('Finish the current file operation first.');
    busy = true;
    const task = Promise.resolve().then(operation);
    running = task;
    try { return await task; } finally { busy = false; }
  }
  const failure = (result, fallback) => Error(result?.reason || (result?.status === 'cancelled' ? 'Saving was cancelled. Your artwork remains open.' : fallback));
  async function write(captured, saveAs = false) {
    if (!captured?.document || !Number.isSafeInteger(captured.revision)) throw Error('This project is unavailable. Recover it before closing.');
    const { document, revision } = captured;
    const info = await bridge.info({documentId:document.id});
    const chosen = await bridge.chooseSave({documentId:document.id, name:document.name, format:info?.format || 'pixelwall', saveAs});
    if (chosen?.status !== 'ready') throw failure(chosen, 'The save destination is unavailable. Use Save As.');
    let finished = false;
    try {
      const bytes = await host.encode(document, chosen.format);
      const result = await bridge.writeSave({token:chosen.token, documentId:document.id, revision, bytes});
      if (result?.status !== 'saved' || result.documentId !== document.id || result.lastSavedRevision !== revision)
        throw failure(result, 'The file was not saved. Keep the project open and use Save As.');
      finished = true;
      host.saved?.(result, captured);
      return {id:document.id, revision};
    } finally {
      if (!finished) await bridge.cancelSave({token:chosen.token}).catch(() => {});
    }
  }
  async function accept(result) {
    const files = [...(result?.files || [])];
    const deliveries = new Set(result?.deliveryId ? [result.deliveryId] : []);
    try {
      await host.flushRecovery();
      const problems = (result?.errors || []).map(item => `${item.name}: ${item.reason}`);
      for (const file of files) {
        let bound = false;
        try {
          if (file.existingDocumentId && !file.token) {
            const existing = await host.read(file.existingDocumentId);
            if (!existing) {
              const recovered = await bridge.reopen({documentId:file.existingDocumentId});
              if (recovered.deliveryId) deliveries.add(recovered.deliveryId);
              if (recovered.status !== 'opened' || !recovered.files?.length) throw Error(recovered.errors?.[0]?.reason || `${file.name} could not be recovered.`);
              files.push(...recovered.files);
              continue;
            }
            await host.activate(existing);
            continue;
          }
          if (!file.token) throw Error('The native file request is incomplete.');
          const decoded = await host.decode(file);
          const captured = await host.persistImported(decoded.document);
          const result = await bridge.bindOpen({token:file.token, documentId:captured.document.id, revision:captured.revision});
          if (result?.status !== 'bound' || result.documentId !== captured.document.id) throw Error('The file could not be linked to this project. Its recovery copy remains in the library.');
          bound = true;
          await host.activate(captured);
          host.imported?.(file, decoded.warnings || []);
        } catch (error) { problems.push(error.message); }
        finally { if (file.token && !bound) await bridge.cancelOpen({token:file.token}).catch(() => {}); }
      }
      if (problems.length) throw Error(problems.join('\n'));
      return {status:files.length ? 'opened' : result?.status || 'cancelled'};
    } catch (error) {
      // A failed initial recovery save must release every pending open grant.
      await Promise.all(files.filter(file => file.token).map(file => bridge.cancelOpen({token:file.token}).catch(() => {})));
      throw error;
    } finally {
      for (const deliveryId of deliveries) { try { await bridge.ackOpen?.({deliveryId}); } catch { /* A reload can redeliver an unacknowledged batch. */ } }
    }
  }
  return Object.freeze({
    get busy() { return busy || queued > 0; },
    saveCurrent: ({saveAs = false} = {}) => exclusive(async () => write(await host.read(), saveAs)),
    saveAll: () => exclusive(async () => {
      const bindings = await bridge.list(), nativeDocuments = [];
      for (const binding of bindings) nativeDocuments.push(await write(await host.read(binding.documentId)));
      return nativeDocuments;
    }),
    open: () => exclusive(async () => accept(await bridge.open())),
    acceptOpen: async result => {
      queued++;
      try {
        while (busy) await running.catch(() => {});
        return await exclusive(() => accept(result));
      } finally { queued--; }
    },
    recoverMissing: () => exclusive(async () => {
      const recovered = [], errors = [];
      let bindings;
      try { bindings = await bridge.list(); }
      catch (error) { return {status:'error', recovered, errors:[{documentId:null,name:'Saved file locations',reason:error.message,action:'Your device recovery copies remain available. Keep the editor open and save project backups; retry when local storage is available or contact support.'}]}; }
      for (const binding of bindings) {
        try {
          if (await host.read(binding.documentId)) continue;
          const result = await bridge.reopen({documentId:binding.documentId});
          await accept(result);
          if (result?.status !== 'opened' || !result.files?.length) throw Error('The original file could not be recovered.');
          recovered.push(binding.documentId);
        } catch (error) {
          errors.push({documentId:binding.documentId,name:binding.name || binding.documentId,reason:error.message,action:'Reconnect or locate the original file, then choose File → Open to recover it. Other projects remain available.'});
        }
      }
      return {status:errors.length ? recovered.length ? 'partial' : 'error' : recovered.length ? 'recovered' : 'current', recovered, errors};
    }),
  });
}
