import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createNativeClipboardIpc } from '../desktop/native-clipboard-ipc.mjs';
import { runEditorAction } from '../desktop/editor-controls.mjs';
import { encodeClipboardImage } from '../app/native-clipboard-payload.mjs';
const png = encodeClipboardImage({ width: 1, height: 1, rgba: Uint8Array.of(128, 64, 32, 127) });
function harness() {
  const ipcMain = new EventEmitter(), handlers = new Map(), writes = [];
  let clock = 0, decodes = 0;
  ipcMain.handle = (channel, fn) => handlers.set(channel, fn); ipcMain.removeHandler = channel => handlers.delete(channel);
  const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) };
  const clipboard = { availableFormats: () => ['image/png'], readBuffer: () => png.bytes, writeImage: value => writes.push(value) };
  const api = createNativeClipboardIpc({ ipcMain, clipboard, nativeImage: { createFromBuffer: () => { decodes++; return image; } }, now: () => clock });
  function owner(id) {
    const window = new EventEmitter(), contents = new EventEmitter();
    contents.id = id; contents.mainFrame = { url: 'pixelwall://app/editor' }; window.webContents = contents; window.isDestroyed = () => false;
    api.attach(window); const event = () => ({ sender: contents, senderFrame: contents.mainFrame });
    return { window, contents, event, invoke: (method, payload, from = event()) => handlers.get(`pixelwall:clipboard:${method}`)(from, payload), authorize: action => api.authorize(window, action) };
  }
  return { api, ipcMain, handlers, writes, owner, advance: ms => { clock += ms; }, decodes: () => decodes };
}
function reserve(owner) { owner.authorize('copy'); const result = owner.invoke('beginWrite'); assert.equal(result.status, 'reserved'); assert.match(result.token, /^[0-9a-f-]{36}$/); return result.token; }
test('a reservation admits one slow copy after its original gesture expires, without reading or changing the clipboard early', () => {
  const h = harness(), owner = h.owner(1), token = reserve(owner);
  assert.equal(h.decodes(), 0); assert.equal(h.writes.length, 0); h.advance(60 * 60 * 1000);
  assert.equal(owner.invoke('writeImage', { ...png, token }).status, 'written'); assert.equal(h.writes.length, 1);
  assert.throws(() => owner.invoke('writeImage', { ...png, token }), /cancelled/); assert.equal(h.writes.length, 1); h.api.dispose();
});
test('reservation itself needs a current matching gesture and cannot mint a second write', () => {
  const h = harness(), owner = h.owner(1);
  assert.throws(() => owner.invoke('beginWrite'), /Use Copy or Paste/);
  owner.authorize('paste'); assert.throws(() => owner.invoke('beginWrite'), /Use Copy or Paste/);
  owner.authorize('copy'); h.advance(4000); assert.throws(() => owner.invoke('beginWrite'), /Use Copy or Paste/);
  const token = reserve(owner); assert.throws(() => owner.invoke('beginWrite'), /Use Copy or Paste/);
  assert.equal(owner.invoke('writeImage', { ...png, token }).status, 'written'); h.api.dispose();
});
test('invalid payload consumes only its reservation, and a cancelled token cannot fall back to a newer gesture', () => {
  const h = harness(), owner = h.owner(1), token = reserve(owner);
  assert.equal(owner.invoke('writeImage', { token, format: 'text' }).status, 'error');
  assert.throws(() => owner.invoke('writeImage', { ...png, token }), /cancelled/);
  const current = reserve(owner); owner.authorize('copy');
  assert.throws(() => owner.invoke('writeImage', { ...png, token: current }), /cancelled/);
  const newer = owner.invoke('beginWrite').token;
  assert.throws(() => owner.invoke('writeImage', { ...png, token: null }), /cancelled/);
  assert.equal(owner.invoke('writeImage', { ...png, token: newer }).status, 'written'); h.api.dispose();
});
test('late cancellation or completion from old copy cannot clear a newer reservation', () => {
  const h = harness(), owner = h.owner(1), old = reserve(owner), latest = reserve(owner);
  assert.deepEqual(owner.invoke('cancelWrite', { token: old }), { status: 'missing' });
  assert.throws(() => owner.invoke('writeImage', { ...png, token: old }), /cancelled/);
  assert.equal(owner.invoke('writeImage', { ...png, token: latest }).status, 'written');
  const cancelled = reserve(owner); assert.deepEqual(owner.invoke('cancelWrite', { token: cancelled }), { status: 'cancelled' });
  assert.deepEqual(owner.invoke('cancelWrite', { token: cancelled }), { status: 'missing' });
  assert.throws(() => owner.invoke('writeImage', { ...png, token: cancelled }), /cancelled/); h.api.dispose();
});
test('reservations are bound to their exact owner and frame, including frame replacement without a navigation event', () => {
  const h = harness(), one = h.owner(1), two = h.owner(2), token = reserve(one);
  assert.throws(() => two.invoke('writeImage', { ...png, token }), /cancelled/);
  assert.deepEqual(two.invoke('cancelWrite', { token }), { status: 'missing' });
  const forged = { sender: one.contents, senderFrame: { url: 'pixelwall://app/editor' } };
  assert.throws(() => one.invoke('writeImage', { ...png, token }, forged), /restricted/);
  one.contents.mainFrame = { url: 'pixelwall://app/editor' };
  assert.throws(() => one.invoke('writeImage', { ...png, token }), /cancelled/); assert.equal(h.writes.length, 0); h.api.dispose();
});
for (const event of ['blur', 'navigation', 'render-process-gone', 'closed', 'destroyed']) test(`owner ${event} revokes a reserved write and teardown removes all listeners`, () => {
  const h = harness(), owner = h.owner(1), token = reserve(owner);
  if (event === 'navigation') owner.contents.emit('did-start-navigation', {}, 'pixelwall://app/editor', false, true);
  else if (event === 'closed' || event === 'blur') owner.window.emit(event);
  else owner.contents.emit(event);
  assert.throws(() => owner.invoke('writeImage', { ...png, token }), /cancelled|restricted/); assert.equal(h.writes.length, 0);
  h.api.dispose(); assert.equal(h.handlers.size, 0); assert.equal(h.ipcMain.eventNames().length, 0); assert.equal(owner.contents.eventNames().length, 0); assert.equal(owner.window.eventNames().length, 0);
});
test('newer native or preload text intent cancels the pending image without reading text or granting image access', () => {
  const h = harness(), owner = h.owner(1), token = reserve(owner);
  h.ipcMain.emit('pixelwall:clipboard:revoke', owner.event());
  assert.throws(() => owner.invoke('writeImage', { ...png, token }), /cancelled/);
  assert.throws(() => owner.invoke('readImage'), /Use Copy or Paste/);
  const again = reserve(owner); h.api.revoke(owner.window);
  assert.throws(() => owner.invoke('writeImage', { ...png, token: again }), /cancelled/); assert.equal(h.writes.length, 0); h.api.dispose();
});
test('newer paste revokes pending copy, while unrelated UI input and same-document navigation do not', () => {
  const h = harness(), owner = h.owner(1), token = reserve(owner);
  owner.contents.emit('did-start-navigation', {}, '#panel', true, true); owner.window.emit('focus');
  assert.equal(owner.invoke('writeImage', { ...png, token }).status, 'written');
  const cancelled = reserve(owner); h.ipcMain.emit('pixelwall:clipboard:gesture', owner.event(), 'paste');
  assert.throws(() => owner.invoke('writeImage', { ...png, token: cancelled }), /cancelled/);
  assert.equal(owner.invoke('readImage').status, 'image'); h.api.dispose();
});
test('a late native menu focus probe cannot authorize an earlier copy after newer clipboard intent or owner reattach', () => {
  const h = harness(), owner = h.owner(1), generation = h.api.revoke(owner.window);
  h.api.revoke(owner.window); assert.equal(h.api.authorize(owner.window, 'copy', { generation }), false);
  const valid = h.api.revoke(owner.window); assert.equal(h.api.authorize(owner.window, 'copy', { generation: valid }), true);
  const token = owner.invoke('beginWrite').token, prior = h.api.revoke(owner.window);
  h.api.attach(owner.window); assert.equal(h.api.authorize(owner.window, 'copy', { generation: prior }), false);
  assert.throws(() => owner.invoke('writeImage', { ...png, token }), /cancelled/); h.api.dispose();
});
test('native text menu cancels a pending image and routes to the native text action', async () => {
  const h = harness(), owner = h.owner(1), token = reserve(owner), actions = [];
  const context = vm.createContext({ window: {}, document: { activeElement: { tagName: 'TEXTAREA' } } });
  owner.contents.executeJavaScript = async source => vm.runInContext(source, context);
  owner.contents.copy = () => actions.push('text copy');
  const generation = h.api.revoke(owner.window);
  await runEditorAction(owner.contents, 'copy', undefined, { authorizeClipboard: action => h.api.authorize(owner.window, action, { generation }) });
  assert.deepEqual(actions, ['text copy']); assert.throws(() => owner.invoke('writeImage', { ...png, token }), /cancelled/);
  assert.throws(() => owner.invoke('beginWrite'), /Use Copy or Paste/); h.api.dispose();
});
test('preload exposes only fixed begin/cancel calls and strips cancellation payload to its token', async () => {
  const source = await readFile(new URL('../desktop/native-preload.cjs', import.meta.url), 'utf8'), bridges = {}, invoked = [];
  vm.runInNewContext(source, { require: () => ({ contextBridge: { exposeInMainWorld: (name, api) => { bridges[name] = api; } }, ipcRenderer: { invoke: (...args) => invoked.push(args) } }) });
  bridges.pixelwallNativeClipboard.beginWrite(); bridges.pixelwallNativeClipboard.cancelWrite({ token: 'one', format: 'text', channel: 'arbitrary' });
  assert.equal(invoked[0][0], 'pixelwall:clipboard:beginWrite'); assert.equal(invoked[1][0], 'pixelwall:clipboard:cancelWrite');
  assert.deepEqual(Object.keys(invoked[1][1]), ['token']); assert.equal(invoked[1][1].token, 'one');
  assert.equal(bridges.pixelwallNativeClipboard.revoke, undefined); assert.equal(bridges.pixelwallNativeClipboard.authorize, undefined);
});

test('forged revoke/cancel events cannot invalidate the owning frame reservation', () => {
  const h = harness(), owner = h.owner(1), token = reserve(owner);
  const foreign = { sender: owner.contents, senderFrame: { url: 'pixelwall://app/editor' } };
  h.ipcMain.emit('pixelwall:clipboard:revoke', foreign);
  assert.throws(() => owner.invoke('cancelWrite', { token }, foreign), /restricted/);
  assert.throws(() => owner.invoke('beginWrite', undefined, foreign), /restricted/);
  assert.equal(owner.invoke('writeImage', { ...png, token }).status, 'written'); h.api.dispose();
});
test('an older delayed native canvas focus result cannot override a later completed text copy', async () => {
  const h = harness(), owner = h.owner(1), actions = [];
  let resolveFirst, probes = 0;
  owner.contents.executeJavaScript = async () => {
    if (++probes === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return { textEditing: true };
  };
  owner.contents.copy = () => actions.push('text copy');
  const dispatch = () => {
    const generation = h.api.revoke(owner.window);
    return runEditorAction(owner.contents, 'copy', undefined, { authorizeClipboard: action => h.api.authorize(owner.window, action, { generation }) });
  };
  const previous = dispatch(); await dispatch();
  assert.deepEqual(actions, ['text copy']); resolveFirst({ artwork: true });
  await assert.rejects(previous, /not ready/); assert.equal(h.writes.length, 0);
  assert.throws(() => owner.invoke('beginWrite'), /Use Copy or Paste/); h.api.dispose();
});
