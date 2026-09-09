import test from 'node:test';
import assert from 'node:assert/strict';
import { runLuaScript } from '../app/lua-runner-browser.mjs';
import { runLuaScript as runNode } from '../app/lua-runner-node.mjs';

function location(t, href) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href, origin: new URL(href).origin } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'location', previous) : delete globalThis.location);
}

test('browser wrapper validates replay and terminates a successful isolated worker', async t => {
  location(t, 'https://pixelwall.example/editor');
  const result = await runNode({ source: 'Sprite(2,2)' });
  let terminated = 0, message;
  const worker = { terminate: () => terminated++, postMessage(value) { message = value; queueMicrotask(() => this.onmessage({ data: { ok: true, result } })); } };
  const r = await runLuaScript({ source: 'Sprite(2,2)' }, { wasmUri: '/runtimes/lua.wasm', createWorker: () => worker });
  assert.equal(r.document.width, 2); assert.equal(terminated, 1);
  assert.equal(message.wasmUri, 'https://pixelwall.example/runtimes/lua.wasm');
});

test('browser wrapper accepts the matching secure desktop protocol and rejects other hosts', async t => {
  location(t, 'pixelwall://app/editor');
  let terminated = 0;
  const worker = { terminate: () => terminated++, postMessage() { queueMicrotask(() => this.onmessage({ data: { ok: false, error: 'test stopped' } })); } };
  await assert.rejects(runLuaScript({ source: '' }, { wasmUri: 'pixelwall://app/runtimes/lua.wasm', createWorker: () => worker }), /test stopped/);
  assert.equal(terminated, 1);
  await assert.rejects(runLuaScript({ source: '' }, { wasmUri: 'https://evil.example/lua.wasm' }), /hosted with this editor/);
});

test('browser wrapper kills hung workers and cancels without receiving output', async t => {
  location(t, 'https://pixelwall.example/editor');
  let terminated = 0;
  const createWorker = () => ({ terminate: () => terminated++, postMessage() {} });
  await assert.rejects(runLuaScript({ source: '', timeoutMs: 50 }, { wasmUri: '/runtimes/lua.wasm', createWorker }), /time limit/);
  const abort = new AbortController();
  const run = runLuaScript({ source: '', signal: abort.signal }, { wasmUri: '/runtimes/lua.wasm', createWorker });
  abort.abort(); await assert.rejects(run, /cancelled/); assert.equal(terminated, 2);
});
