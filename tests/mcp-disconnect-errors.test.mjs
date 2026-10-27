import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createMcpBridge } from '../desktop/mcp-bridge.mjs';

class FakeSocket extends EventEmitter {
  constructor({ writeMode = 'ok' } = {}) { super(); this.writeMode = writeMode; this.destroyed = false; this.writes = []; }
  setEncoding() {}
  write(value, callback) {
    this.writes.push(value);
    const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    if (this.writeMode === 'throw') throw error;
    if (this.writeMode === 'callback') { callback?.(error); return false; }
    callback?.(); return true;
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('close'); }
}

function fakeNet() {
  const server = new EventEmitter();
  server.listen = (_options, callback) => { server.bound = { address: '127.0.0.1', family: 'IPv4', port: 43127 }; callback(); };
  server.address = () => server.bound;
  server.close = callback => callback?.();
  return { server, net: { createServer(handler) { server.handler = handler; return server; } } };
}

async function harness({ executeJavaScript = async () => null } = {}) {
  const root = await mkdtemp('/Volumes/DevStorage/Builds/pixelwall/mcp-disconnect-');
  const fake = fakeNet();
  const bridge = createMcpBridge({ configPath: join(root, 'mcp.json'), net: fake.net, webContents: { executeJavaScript } });
  await bridge.start();
  return { root, bridge, server: fake.server };
}

const message = (bridge, id, method, params) => JSON.stringify({ id, token: bridge.token, method, ...(params ? { params } : {}) }) + '\n';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const writeMode of ['throw', 'callback']) test(`EPIPE during response writing is contained (${writeMode})`, async () => {
  const h = await harness();
  try {
    const socket = new FakeSocket({ writeMode }); h.server.handler(socket);
    socket.emit('data', message(h.bridge, 1, 'ping'));
    await wait(10);
    socket.emit('close');
    assert.equal(h.bridge.status().connected, false);
    const fresh = new FakeSocket(); h.server.handler(fresh);
    socket.writeMode = 'ok';
    fresh.emit('data', message(h.bridge, 2, 'ping'));
    await wait(10);
    assert.equal(fresh.writes.length, 1);
    assert.equal(JSON.parse(fresh.writes[0]).result.serverInfo.name, 'pixelwall-desktop');
  } finally { await h.bridge.stop(); await rm(h.root, { recursive: true, force: true }); }
});

test('late renderer responses after peer close never write to the dead socket', async () => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const h = await harness({ executeJavaScript: async source => source.includes('api["inspect"]') ? delayed : null });
  try {
    const socket = new FakeSocket(); h.server.handler(socket);
    socket.emit('data', message(h.bridge, 1, 'tools/call', { name: 'pixelwall_inspect', arguments: {} }));
    await wait(5); socket.destroy(); release({ id: 'late' }); await wait(10);
    assert.equal(socket.writes.length, 0);
  } finally { await h.bridge.stop(); await rm(h.root, { recursive: true, force: true }); }
});

test('disconnect cancels each owned pending operation once and permits a fresh client', async () => {
  const calls = [];
  const h = await harness({ executeJavaScript: async source => {
    calls.push(source);
    if (source.includes('api["apply"]')) return { operationId: 'owned-op', status: 'queued' };
    if (source.includes('api["cancel"]')) return { operationId: 'owned-op', status: 'cancelled' };
    return null;
  } });
  try {
    const socket = new FakeSocket(); h.server.handler(socket);
    socket.emit('data', message(h.bridge, 1, 'tools/call', { name: 'pixelwall_apply', arguments: { commands: [{ type: 'draw.line', from: { x: 1, y: 1 }, to: { x: 2, y: 2 }, color: '#ffffffff' }], wait: false } }));
    await wait(10); socket.destroy(); await wait(20);
    assert.equal(calls.filter(source => source.includes('api["cancel"]')).length, 1);
    const fresh = new FakeSocket(); h.server.handler(fresh); fresh.emit('data', message(h.bridge, 2, 'ping')); await wait(10);
    assert.equal(JSON.parse(fresh.writes[0]).result.protocolVersion, '2025-06-18');
  } finally { await h.bridge.stop(); await rm(h.root, { recursive: true, force: true }); }
});
