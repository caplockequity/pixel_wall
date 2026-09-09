import { randomUUID } from 'node:crypto';
import { trustedNativeSender } from './native-file-ipc.mjs';
import { clipboardBytes, clipboardDimensions, inspectClipboardPng } from './clipboard-payload.mjs';

const prefix = 'pixelwall:clipboard:';
const pngFormats = ['image/png', 'public.png', 'PNG'];
const operation = action => ({ copy: 'write', cut: 'write', paste: 'read' })[action];

/** Main-process image-only capability. No renderer-selected format, path, or arbitrary IPC is exposed. */
export function createNativeClipboardIpc({ ipcMain, clipboard, nativeImage, now = Date.now, gestureMs = 4000 }) {
  const owners = new Map();
  let generationSequence = 0;
  function clear(entry) { entry.grant = null; entry.write = null; return entry.generation = ++generationSequence; }
  function owningEntry(owner) { const entry = owners.get(owner?.webContents?.id); return entry && entry.owner === owner && !owner.isDestroyed() ? entry : null; }
  function revoke(owner) { const entry = owningEntry(owner); return entry ? clear(entry) : null; }
  function authorize(owner, action, { generation } = {}) {
    const entry = owningEntry(owner), method = operation(action);
    // Native menu focus probes are asynchronous. A newer clipboard intent must
    // prevent an older probe from minting authorization after that newer intent.
    if (!entry || !method || generation !== undefined && generation !== entry.generation) return false;
    clear(entry);
    entry.grant = { method, expires: now() + gestureMs, frame: owner.webContents.mainFrame }; return true;
  }
  // This private channel is called only by the isolated preload after an isTrusted
  // clipboard key/click. It is deliberately absent from the renderer bridge.
  const gesture = (event, action) => {
    const entry = owners.get(event.sender.id);
    if (entry && trustedNativeSender(event, entry.owner)) authorize(entry.owner, action);
  };
  const revokeGesture = event => {
    const entry = owners.get(event.sender.id);
    if (entry && trustedNativeSender(event, entry.owner)) clear(entry);
  };
  ipcMain.on(prefix + 'gesture', gesture);
  ipcMain.on(prefix + 'revoke', revokeGesture);
  function fromEvent(event) {
    const entry = owners.get(event.sender.id);
    if (!entry || !trustedNativeSender(event, entry.owner)) throw new Error('Image clipboard access is restricted to the owning editor.');
    return entry;
  }
  function consume(event, method) {
    const entry = fromEvent(event), grant = entry.grant; entry.grant = null;
    if (!grant || grant.frame !== event.senderFrame || grant.method !== method || now() >= grant.expires) throw new Error('Use Copy or Paste to access the system image clipboard.');
    return entry;
  }
  ipcMain.handle(prefix + 'beginWrite', event => {
    const entry = consume(event, 'write'), token = randomUUID();
    // One tiny reservation per owner; no image data is held while the renderer
    // computes. Its lifetime is the accepted copy operation, not an arbitrary
    // encoding deadline. Every later clipboard intent revokes it.
    entry.write = { token, frame: event.senderFrame };
    return { status: 'reserved', token };
  });
  ipcMain.handle(prefix + 'cancelWrite', (event, payload) => {
    const entry = fromEvent(event);
    if (!entry.write || entry.write.frame !== event.senderFrame || entry.write.token !== payload?.token) return { status: 'missing' };
    entry.write = null; return { status: 'cancelled' };
  });
  function consumeWrite(event, payload) {
    if (payload?.token === undefined) { consume(event, 'write'); return; }
    const entry = fromEvent(event), reservation = entry.write;
    if (!reservation || typeof payload.token !== 'string' || reservation.token !== payload.token || reservation.frame !== event.senderFrame) throw new Error('This Copy operation was cancelled. Copy the selection again.');
    entry.write = null;
  }
  ipcMain.handle(prefix + 'readImage', event => {
    consume(event, 'read');
    try {
      const formats = clipboard.availableFormats();
      for (const format of pngFormats.filter(name => formats.includes(name))) {
        // Some operating systems advertise PNG synthesized from another native
        // image representation without exposing raw PNG bytes under this name.
        const raw = clipboard.readBuffer(format);
        if (raw?.byteLength === 0) continue;
        const bytes = clipboardBytes(raw, { copy: true }), info = inspectClipboardPng(bytes);
        return { status: 'image', format: 'png', width: info.width, height: info.height, bytes, source: 'png', profilePreserved: true };
      }
      const image = clipboard.readImage();
      if (image.isEmpty()) return { status: 'empty' };
      // Electron/OS decodes non-PNG clipboard representations before getSize().
      // Reject excessive dimensions before PNG encoding or renderer transfer.
      const nativeSize = image.getSize(1), size = clipboardDimensions(nativeSize.width, nativeSize.height);
      const bytes = clipboardBytes(image.toPNG({ scaleFactor: 1 }), { copy: true }), info = inspectClipboardPng(bytes);
      if (info.width !== size.width || info.height !== size.height) throw new Error('System clipboard image size changed during conversion.');
      return { status: 'image', format: 'png', ...size, bytes, source: 'native-image', profilePreserved: false };
    } catch (error) { return { status: 'error', reason: error.message }; }
  });
  ipcMain.handle(prefix + 'writeImage', (event, payload) => {
    consumeWrite(event, payload);
    try {
      if (!payload || payload.format !== 'png') throw new Error('Only PNG image clipboard writes are supported.');
      const bytes = clipboardBytes(payload.bytes, { copy: true }), info = inspectClipboardPng(bytes, { requireSrgb: true });
      const image = nativeImage.createFromBuffer(Buffer.from(bytes), { scaleFactor: 1 });
      if (image.isEmpty()) throw new Error('The clipboard PNG could not be decoded.');
      const size = image.getSize(1); clipboardDimensions(size.width, size.height);
      if (size.width !== info.width || size.height !== info.height) throw new Error('Decoded clipboard image dimensions do not match the PNG.');
      clipboard.writeImage(image);
      return { status: 'written', width: info.width, height: info.height };
    } catch (error) { return { status: 'error', reason: error.message }; }
  });
  return {
    attach(owner) {
      const contents = owner.webContents, id = contents.id;
      owners.get(id)?.detach();
      const entry = { owner, grant: null, write: null, generation: ++generationSequence };
      owners.set(id, entry);
      const navigation = (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) clear(entry); };
      const blur = () => { clear(entry); };
      const gone = () => { clear(entry); };
      const detach = () => {
        clear(entry);
        contents.removeListener('did-start-navigation', navigation);
        contents.removeListener('render-process-gone', gone);
        contents.removeListener('destroyed', detach);
        owner.removeListener('blur', blur); owner.removeListener('closed', detach);
        if (owners.get(id) === entry) owners.delete(id);
      };
      entry.detach = detach;
      contents.on('did-start-navigation', navigation); contents.on('render-process-gone', gone); contents.once('destroyed', detach);
      owner.on('blur', blur); owner.once('closed', detach);
      return { authorize: action => authorize(owner, action), dispose: detach };
    },
    authorize,
    revoke,
    dispose() {
      ipcMain.removeListener(prefix + 'gesture', gesture); ipcMain.removeListener(prefix + 'revoke', revokeGesture);
      for (const method of ['readImage', 'beginWrite', 'cancelWrite', 'writeImage']) ipcMain.removeHandler(prefix + method);
      for (const entry of owners.values()) entry.detach();
    },
  };
}
