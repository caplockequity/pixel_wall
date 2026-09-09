import { createNativeFileService } from './native-files.mjs';
import { randomUUID } from 'node:crypto';

export const NATIVE_METHODS = ['open', 'reopen', 'ready', 'bindOpen', 'cancelOpen', 'ackOpen', 'list', 'info', 'chooseSave', 'writeSave', 'cancelSave'];
export function trustedNativeSender(event, owner) {
  if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'pixelwall:' && url.host === 'app' && (url.pathname === '/editor' || url.pathname === '/index.html' || url.pathname === '/');
  } catch { return false; }
}

/** One handler set per app; one grant namespace and document table per window. */
export function createNativeFileIpc({ ipcMain, dialog, createService = createNativeFileService, store }) {
  const owners = new Map();
  function retain(entry, result, sentGeneration = -1) {
    if (!result?.files?.length && !result?.errors?.length) return result;
    const deliveryId = randomUUID(), payload = { ...result, files: [...(result.files || [])], deliveryId };
    entry.deliveries.set(deliveryId, { payload, sentGeneration });
    return payload;
  }
  function consumeToken(entry, token) {
    for (const [id, delivery] of entry.deliveries) {
      delivery.payload.files = delivery.payload.files.filter(file => file.token !== token);
      if (!delivery.payload.files.length && !delivery.payload.errors?.length) entry.deliveries.delete(id);
    }
  }
  function deliver(entry) {
    if (!entry.ready || entry.owner.isDestroyed()) return;
    for (const delivery of entry.deliveries.values()) {
      if (delivery.sentGeneration === entry.generation) continue;
      entry.owner.webContents.send('pixelwall:native:opened', delivery.payload);
      delivery.sentGeneration = entry.generation;
    }
  }
  const hasPending = entry => entry.paths.length || entry.draining || entry.opening || entry.deliveries.size;
  async function drain(entry) {
    if (!entry.ready || entry.draining || entry.owner.isDestroyed()) return;
    entry.draining = true;
    try {
      while (entry.ready && !entry.owner.isDestroyed()) {
        deliver(entry);
        if (!entry.paths.length) break;
        const generation = entry.generation, paths = entry.paths.splice(0, 32);
        let result;
        try { result = await entry.service.openPaths(paths); }
        catch (error) { result = { status: 'error', files: [], errors: [{ name: 'Open file', reason: error.message }] }; }
        if (entry.owner.isDestroyed()) return;
        retain(entry, result);
        // Retain the grants if navigation occurred while reading. Only a ready
        // renderer in the current generation may receive the retained batch.
        if (entry.ready && generation === entry.generation) deliver(entry);
      }
    } finally { entry.draining = false; }
  }
  for (const method of NATIVE_METHODS) ipcMain.handle(`pixelwall:native:${method}`, async (event, payload) => {
    const entry = owners.get(event.sender.id);
    if (!entry || !trustedNativeSender(event, entry.owner)) throw new Error('Native file access is restricted to the owning editor.');
    if (method === 'ready') { entry.ready = true; void drain(entry).catch(() => {}); return { status: 'ready' }; }
    if (method === 'ackOpen') {
      const delivery = entry.deliveries.get(payload?.deliveryId);
      if (!delivery) return { status: 'missing' };
      if (delivery.payload.files.some(file => file.token)) return { status: 'busy', reason: 'Finish or cancel every file import before acknowledging it.' };
      entry.deliveries.delete(payload.deliveryId); return { status: 'acknowledged' };
    }
    if (method === 'open' || method === 'reopen') {
      const generation = entry.generation; entry.opening++;
      try {
        const result = retain(entry, await entry.service[method](payload), generation);
        if (generation !== entry.generation && entry.ready) void drain(entry).catch(() => {});
        return result;
      } finally { entry.opening--; }
    }
    const result = await entry.service[method](payload);
    if (method === 'bindOpen' && result?.status === 'bound' || method === 'cancelOpen' && ['cancelled', 'missing'].includes(result?.status)) consumeToken(entry, payload?.token);
    return result;
  });
  return {
    attach(owner) {
      const entry = { owner, service: createService({ dialog, owner, store }), ready: false, draining: false, opening: 0, generation: 0, paths: [], deliveries: new Map() };
      const contentsId = owner.webContents.id;
      owners.set(contentsId, entry);
      owner.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) { entry.ready = false; entry.generation++; } });
      owner.once('closed', () => { entry.service.dispose(); entry.deliveries.clear(); owners.delete(contentsId); });
      return {
        service: entry.service,
        async verifyClose(result) {
          const generation = entry.generation;
          const block = () => ({ status: 'blocked', attemptId: result?.attemptId, reason: 'Finish opening the requested files before closing.' });
          if (hasPending(entry)) return block();
          const checked = await entry.service.verifyClose(result);
          if (hasPending(entry) || generation !== entry.generation) return block();
          return checked;
        },
      };
    },
    enqueue(owner, paths) {
      const entry = owners.get(owner.webContents.id);
      if (!entry) return;
      entry.paths.push(...paths.filter(path => !entry.paths.includes(path)));
      void drain(entry).catch(() => {});
    },
    dispose() { for (const method of NATIVE_METHODS) ipcMain.removeHandler(`pixelwall:native:${method}`); for (const entry of owners.values()) entry.service.dispose(); owners.clear(); },
  };
}
