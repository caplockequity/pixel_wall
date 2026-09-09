import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { writePng } from '../app/formats.mjs';
import { encodeClipboardImage, decodeClipboardImage } from '../app/native-clipboard-payload.mjs';
import { CLIPBOARD_MAX_BYTES, CLIPBOARD_MAX_PIXELS, clipboardBytes, inspectClipboardPng } from '../desktop/clipboard-payload.mjs';
import { createNativeClipboardIpc } from '../desktop/native-clipboard-ipc.mjs';
const imagePayload = () => encodeClipboardImage({ width: 2, height: 1, rgba: Uint8Array.of(255, 0, 0, 128, 1, 2, 3, 255) });
function harness() {
  const owner = new EventEmitter(), contents = new EventEmitter(), ipcMain = new EventEmitter(), handlers = new Map(), calls = [];
  let clock = 100, png = imagePayload().bytes, formats = ['image/png'], nativeSize = { width: 2, height: 1 }, empty = false, rawPng = null;
  contents.id = 7; contents.mainFrame = { url: 'pixelwall://app/editor' }; owner.webContents = contents; owner.isDestroyed = () => false;
  ipcMain.handle = (name, fn) => handlers.set(name, fn); ipcMain.removeHandler = name => handlers.delete(name);
  const native = { isEmpty: () => empty, getSize: () => nativeSize, toPNG: options => { calls.push(['toPNG', options]); return png; } };
  const clipboard = {
    availableFormats: () => formats,
    readBuffer: format => { calls.push(['readBuffer', format]); return rawPng ?? png; },
    readImage: () => { calls.push(['readImage']); return native; },
    writeImage: image => calls.push(['writeImage', image]),
  };
  const nativeImage = { createFromBuffer: (bytes, options) => { calls.push(['createFromBuffer', bytes, options]); return native; } };
  const api = createNativeClipboardIpc({ ipcMain, clipboard, nativeImage, now: () => clock }); api.attach(owner);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const invoke = (method, payload, from = event) => handlers.get('pixelwall:clipboard:' + method)(from, payload);
  return { owner, contents, ipcMain, handlers, api, calls, event, invoke, authorize: action => api.authorize(owner, action), set: values => { if ('clock' in values) clock = values.clock; if ('png' in values) png = values.png; if ('formats' in values) formats = values.formats; if ('nativeSize' in values) nativeSize = values.nativeSize; if ('empty' in values) empty = values.empty; if ('rawPng' in values) rawPng = values.rawPng; } };
}
test('selection masks create a transparent sRGB PNG without mutating RGBA or losing partial alpha', () => {
  const rgba = new Uint8ClampedArray([20, 30, 40, 127, 200, 201, 202, 255]), original = new Uint8ClampedArray(rgba);
  const payload = encodeClipboardImage({ width: 2, height: 1, rgba, mask: Uint8Array.of(1, 0) });
  const decoded = decodeClipboardImage(payload);
  assert.deepEqual([...decoded.rgba], [20, 30, 40, 127, 0, 0, 0, 0]); assert.deepEqual(rgba, original);
  assert.equal(inspectClipboardPng(payload.bytes, { requireSrgb: true }).hasSrgb, true);
});
test('source ICC is preserved by the PNG decode helper and is rejected for native copy until converted', () => {
  const icc = new Uint8Array(132); icc[0] = 22; icc[131] = 100;
  const bytes = writePng(1, 1, Uint8Array.of(1, 2, 3, 4), { colorProfile: { type: 2, icc } });
  const decoded = decodeClipboardImage({ format: 'png', bytes, source: 'png' });
  assert.deepEqual(decoded.colorProfile.icc, [...icc]); assert.equal(decoded.profilePreserved, true);
  assert.throws(() => inspectClipboardPng(bytes, { requireSrgb: true }), /sRGB/);
});
test('bounds are checked before decode and reject malformed, shared, or mismatched payloads', () => {
  const good = imagePayload(), large = new Uint8Array(good.bytes);
  new DataView(large.buffer).setUint32(16, CLIPBOARD_MAX_PIXELS + 1);
  assert.throws(() => inspectClipboardPng(large), /4 million/);
  assert.throws(() => clipboardBytes(new Uint8Array(CLIPBOARD_MAX_BYTES + 1)), /size limit/);
  assert.throws(() => clipboardBytes(new Uint8Array(new SharedArrayBuffer(8))), /shared/);
  assert.throws(() => clipboardBytes([1, 2, 3]), /bytes/);
  assert.throws(() => encodeClipboardImage({ width: 2, height: 1, rgba: Uint8Array.of(1), mask: null }), /length/);
  assert.throws(() => encodeClipboardImage({ width: 2, height: 1, rgba: new Uint8Array(8), mask: new Uint8Array(1) }), /mask length/);
  assert.throws(() => decodeClipboardImage({ ...good, width: 3 }), /dimensions/);
  const broken = good.bytes.slice(); broken[40] ^= 1;
  assert.throws(() => decodeClipboardImage({ ...good, bytes: broken }), /checksum/);
  assert.throws(() => inspectClipboardPng(good.bytes.subarray(0, good.bytes.length - 1)), /Truncated|incomplete/);
  assert.throws(() => inspectClipboardPng(new Uint8Array([...good.bytes, 0])), /after/);
});
test('the full four-million-pixel selection budget remains supported', () => {
  const payload = encodeClipboardImage({ width: 2048, height: 2048, rgba: new Uint8Array(CLIPBOARD_MAX_PIXELS * 4) });
  assert.equal(decodeClipboardImage(payload).rgba.length, CLIPBOARD_MAX_PIXELS * 4);
});
test('image operations require the matching, single-use, unexpired user gesture', () => {
  const run = harness();
  assert.throws(() => run.invoke('readImage'), /Use Copy or Paste/); assert.equal(run.calls.length, 0);
  run.authorize('copy'); assert.throws(() => run.invoke('readImage'), /Use Copy or Paste/);
  run.authorize('paste'); assert.equal(run.invoke('readImage').status, 'image');
  assert.throws(() => run.invoke('readImage'), /Use Copy or Paste/);
  run.authorize('paste'); run.set({ clock: 4100 }); assert.throws(() => run.invoke('readImage'), /Use Copy or Paste/);
  assert.equal(run.authorize('readText'), false); run.api.dispose();
});
test('an owning top frame is required even if a grant exists; navigation and blur cancel grants', () => {
  const run = harness();
  for (const from of [{ sender: { id: 7 }, senderFrame: run.contents.mainFrame }, { sender: run.contents, senderFrame: { url: 'pixelwall://app/editor' } }]) {
    run.authorize('paste'); assert.throws(() => run.invoke('readImage', null, from), /restricted/);
  }
  run.authorize('paste'); run.contents.mainFrame.url = 'https://www.pixelwall.dev/editor'; assert.throws(() => run.invoke('readImage'), /restricted/);
  run.contents.mainFrame.url = 'pixelwall://app/editor';
  run.authorize('paste'); run.contents.emit('did-start-navigation', {}, '', false, true); assert.throws(() => run.invoke('readImage'), /Use Copy or Paste/);
  run.authorize('paste'); run.owner.emit('blur'); assert.throws(() => run.invoke('readImage'), /Use Copy or Paste/);
  run.owner.emit('closed'); assert.equal(run.authorize('paste'), false); run.api.dispose();
});
test('raw PNG reads preserve exact profile-bearing bytes and ignore unrelated clipboard formats', () => {
  const run = harness(), icc = new Uint8Array(132); icc[130] = 42;
  const png = writePng(2, 1, new Uint8Array(8), { colorProfile: { type: 2, icc } });
  run.set({ png, formats: ['text/plain', 'text/uri-list', 'public.png'] }); run.authorize('paste');
  const result = run.invoke('readImage'); assert.equal(result.status, 'image'); assert.equal(result.source, 'png'); assert.equal(result.profilePreserved, true);
  assert.deepEqual(result.bytes, png); assert.notEqual(result.bytes, png); assert.deepEqual(decodeClipboardImage(result).colorProfile.icc, [...icc]);
  assert.deepEqual(run.calls, [['readBuffer', 'public.png']]); run.api.dispose();
});
test('oversized PNG is rejected before native decoding, and does not fall back to an unbounded decode', () => {
  const run = harness(), png = imagePayload().bytes; new DataView(png.buffer).setUint32(20, CLIPBOARD_MAX_PIXELS + 1);
  run.set({ png }); run.authorize('paste'); assert.match(run.invoke('readImage').reason, /4 million/);
  assert.deepEqual(run.calls.map(call => call[0]), ['readBuffer']);
  run.authorize('copy'); assert.match(run.invoke('writeImage', { format: 'png', bytes: png }).reason, /4 million/);
  assert.equal(run.calls.some(call => call[0] === 'createFromBuffer'), false); run.api.dispose();
});
test('native-image fallback reports its profile limitation, rejects large dimensions before encoding, and supports empty clipboard', () => {
  const run = harness(); run.set({ formats: ['image/tiff'] }); run.authorize('paste');
  const result = run.invoke('readImage'); assert.equal(result.status, 'image'); assert.equal(result.source, 'native-image'); assert.equal(result.profilePreserved, false);
  assert.deepEqual(run.calls.map(call => call[0]), ['readImage', 'toPNG']);
  run.calls.length = 0; run.set({ nativeSize: { width: CLIPBOARD_MAX_PIXELS + 1, height: 1 } }); run.authorize('paste');
  assert.match(run.invoke('readImage').reason, /4 million/); assert.deepEqual(run.calls.map(call => call[0]), ['readImage']);
  run.set({ empty: true }); run.authorize('paste'); assert.deepEqual(run.invoke('readImage'), { status: 'empty' }); run.api.dispose();
});
test('native copy writes exactly one image, preserves alpha input, and denies non-image/working-profile writes', () => {
  const run = harness(), payload = imagePayload(); run.authorize('copy');
  assert.deepEqual(run.invoke('writeImage', payload), { status: 'written', width: 2, height: 1 });
  assert.deepEqual(run.calls.map(call => call[0]), ['createFromBuffer', 'writeImage']);
  assert.deepEqual([...decodeClipboardImage({ format: 'png', bytes: run.calls[0][1] }).rgba], [255, 0, 0, 128, 1, 2, 3, 255]);
  run.authorize('cut'); assert.equal(run.invoke('writeImage', { format: 'text', text: 'secret' }).status, 'error');
  run.authorize('copy'); assert.match(run.invoke('writeImage', { format: 'png', bytes: writePng(1, 1, new Uint8Array(4), { colorProfile: { type: 2, icc: new Uint8Array(132) } }) }).reason, /sRGB/);
  run.api.dispose(); assert.equal(run.handlers.size, 0); assert.equal(run.ipcMain.listenerCount('pixelwall:clipboard:gesture'), 0);
});
test('isolated preload ignores synthetic gestures and revokes text actions without granting image access', async () => {
  const source = await readFile(new URL('../desktop/native-preload.cjs', import.meta.url), 'utf8'), bridges = {}, listeners = {}, sent = [], invoked = [];
  vm.runInNewContext(source, { window: { addEventListener: (type, fn) => { listeners[type] = fn; } }, require: () => ({
    contextBridge: { exposeInMainWorld: (name, api) => { bridges[name] = api; } },
    ipcRenderer: { invoke: (...args) => invoked.push(args), send: (...args) => sent.push(args) },
  }) });
  const canvas = { closest: () => null }, text = { closest: selector => selector.startsWith('input') ? {} : null };
  const key = { type: 'keydown', isTrusted: true, ctrlKey: true, key: 'v', target: canvas };
  listeners.keydown({ ...key, isTrusted: false }); listeners.keydown({ ...key, target: text }); listeners.keydown({ ...key, composedPath: () => [text, canvas] });
  listeners.keydown({ ...key, repeat: true }); listeners.keydown({ ...key, shiftKey: true }); listeners.keydown({ ...key, key: 'a' });
  listeners.click({ type: 'click', isTrusted: true, button: 0, target: canvas }); assert.deepEqual(sent.map(item => Array.from(item)), [['pixelwall:clipboard:revoke'], ['pixelwall:clipboard:revoke']]); sent.length = 0;
  listeners.keydown(key); listeners.keydown({ ...key, ctrlKey: false, metaKey: true, key: 'c' });
  const button = { closest: selector => selector.startsWith('[data') ? { getAttribute: () => 'paste' } : null };
  listeners.click({ type: 'click', isTrusted: true, button: 0, target: button });
  assert.deepEqual(sent.map(item => Array.from(item)), [['pixelwall:clipboard:gesture', 'paste'], ['pixelwall:clipboard:gesture', 'copy'], ['pixelwall:clipboard:gesture', 'paste']]);
  assert.deepEqual(Object.keys(bridges.pixelwallNativeClipboard).sort(), ['beginWrite', 'cancelWrite', 'readImage', 'writeImage']);
  bridges.pixelwallNativeClipboard.readImage(); bridges.pixelwallNativeClipboard.writeImage({ format: 'png', bytes: [1] });
  assert.deepEqual(invoked.map(item => item[0]), ['pixelwall:clipboard:readImage', 'pixelwall:clipboard:writeImage']);
});
test('only the isolated preload private channel can grant real gesture operations, under the same frame guard', () => {
  const run = harness();
  run.ipcMain.emit('pixelwall:clipboard:gesture', { sender: run.contents, senderFrame: { url: 'pixelwall://app/editor' } }, 'paste');
  assert.throws(() => run.invoke('readImage'), /Use Copy or Paste/);
  run.ipcMain.emit('pixelwall:clipboard:gesture', run.event, 'paste'); assert.equal(run.invoke('readImage').status, 'image'); run.api.dispose();
});

test('advertised synthesized PNG with no raw buffer uses the native image fallback', () => {
  const run = harness(); run.set({ rawPng: new Uint8Array(0) }); run.authorize('paste');
  const result = run.invoke('readImage'); assert.equal(result.status, 'image'); assert.equal(result.profilePreserved, false);
  assert.deepEqual(run.calls.map(call => call[0]), ['readBuffer', 'readImage', 'toPNG']); run.api.dispose();
});

 test('window destruction revokes clipboard grants without reading destroyed BrowserWindow properties', () => {
  const run = harness();
  run.authorize('copy');
  const token = run.invoke('beginWrite').token;
  Object.defineProperty(run.owner, 'webContents', { get() { throw new Error('Object has been destroyed'); } });
  run.owner.isDestroyed = () => true;
  assert.doesNotThrow(() => run.owner.emit('closed'));
  assert.equal(run.contents.listenerCount('did-start-navigation'), 0);
  assert.equal(run.contents.listenerCount('destroyed'), 0);
  assert.throws(() => run.invoke('writeImage', { ...imagePayload(), token }), /restricted/);
  assert.doesNotThrow(() => run.api.dispose());
});
