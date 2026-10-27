#!/usr/bin/env node
/** Official MCP stdio server for an opted-in local PixelWall desktop session. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connect } from 'node:net';
import { homedir, platform } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toolDefinitions } from '../desktop/mcp-catalog.mjs';

const configPath = process.env.PIXELWALL_MCP_CONFIG || join(homedir(), '.pixelwall', 'mcp.json');
const candidates = () => process.env.PIXELWALL_MCP_CONFIG ? [configPath] : platform() === 'darwin' ? [configPath, join(homedir(), 'Library', 'Application Support', 'PixelWall', 'mcp.json')] : platform() === 'win32' ? [configPath, join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'PixelWall', 'mcp.json')] : [configPath, join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'PixelWall', 'mcp.json')];
async function readConfig() {
  for (const path of candidates()) try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.host !== '127.0.0.1' || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.token !== 'string' || value.token.length < 32) throw Error('PixelWall desktop connection is invalid.');
    return value;
  } catch (error) { if (error.message === 'PixelWall desktop connection is invalid.') throw error; }
  throw Error('PixelWall desktop is not connected. Enable the local agent connection in PixelWall first.');
}
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BUFFER_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
async function bridgeClient() {
  let socket = null;
  let connecting = null;
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  function disconnect(error, candidate = socket) {
    if (candidate && socket === candidate) socket = null;
    for (const [id, waiter] of pending) if (waiter.socket === candidate) { clearTimeout(waiter.timer); pending.delete(id); waiter.reject(error); }
  }
  function open() {
    return readConfig().then(config => new Promise((resolve, reject) => {
      const candidate = connect({ host: '127.0.0.1', port: config.port });
      let buffer = '';
      const failConnection = error => { disconnect(error, candidate); reject(error); };
      candidate.setEncoding('utf8');
      candidate.on('data', chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > MAX_RESPONSE_BUFFER_BYTES) { failConnection(Error('PixelWall desktop response exceeded the safe limit.')); candidate.destroy(); return; }
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          if (Buffer.byteLength(line) > MAX_FRAME_BYTES) { failConnection(Error('PixelWall desktop response frame exceeded the safe limit.')); candidate.destroy(); return; }
          try {
            const message = JSON.parse(line), waiter = pending.get(message.id);
            if (!waiter || waiter.socket !== candidate) continue;
            pending.delete(message.id); clearTimeout(waiter.timer);
            if (message.error) waiter.reject(Error(message.error.message || 'PixelWall desktop request failed.'));
            else waiter.resolve(message.result);
          } catch { failConnection(Error('PixelWall desktop returned invalid JSON.')); candidate.destroy(); return; }
        }
      });
      candidate.once('error', failConnection);
      candidate.once('close', () => disconnect(Error('PixelWall desktop connection closed.'), candidate));
      candidate.once('connect', () => { socket = candidate; resolve({ candidate, config }); });
    }));
  }
  async function ensureConnection() {
    if (closed) throw Error('PixelWall desktop connection closed.');
    if (socket && !socket.destroyed) return { candidate: socket, config: await readConfig() };
    connecting ??= open().finally(() => { connecting = null; });
    return connecting;
  }
  return {
    async request(method, params, { signal } = {}) {
      const { candidate, config } = await ensureConnection();
      const id = `mcp-${++sequence}`;
      const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params, token: config.token }) + '\n';
      if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) throw Error('PixelWall MCP request exceeds the safe transport limit.');
      return new Promise((resolve, reject) => {
        const abort = () => { const waiter = pending.get(id); if (!waiter) return; pending.delete(id); clearTimeout(waiter.timer); reject(Error('PixelWall MCP request was cancelled.')); };
        const timer = setTimeout(() => { pending.delete(id); signal?.removeEventListener('abort', abort); reject(Error('PixelWall desktop request timed out.')); }, REQUEST_TIMEOUT_MS); timer.unref?.();
        pending.set(id, { resolve: value => { signal?.removeEventListener('abort', abort); resolve(value); }, reject: error => { signal?.removeEventListener('abort', abort); reject(error); }, timer, socket: candidate });
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        candidate.write(frame, error => { if (error) { pending.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); } });
      });
    },
    close: () => {
      closed = true;
      const activeSocket = socket;
      disconnect(Error('PixelWall desktop connection closed.'), activeSocket);
      activeSocket?.destroy();
      socket = null;
    },
  };
}
const bridge = await bridgeClient();
const server = new Server({ name: 'pixelwall-desktop', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try { const listed = await bridge.request('tools/list'); if (Array.isArray(listed?.tools)) return listed; }
  catch { /* Keep the static catalog available while the desktop reconnects. */ }
  return { tools: toolDefinitions() };
});
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const name = request.params.name;
  let result;
  try { result = await bridge.request('tools/call', request.params, { signal: extra?.signal }); }
  catch (error) { return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }; }
  if (result?.isError) return result;
  let value;
  try { value = result?.structuredContent ?? JSON.parse(result?.content?.[0]?.text || 'null'); }
  catch { return { content: [{ type: 'text', text: 'PixelWall desktop returned invalid tool data.' }], isError: true }; }
  if (value?.kind === 'comparison' && value && typeof value === 'object') {
    const content = [];
    for (const label of ['before', 'after', 'diff']) {
      const image = label === 'diff' && !value.diff && value.dataUrl ? { dataUrl: value.dataUrl } : value[label];
      const match = typeof image?.dataUrl === 'string' && /^data:(image\/png);base64,(.+)$/.exec(image.dataUrl);
      if (match) content.push({ type: 'text', text: label }, { type: 'image', data: match[2], mimeType: match[1] });
    }
    if (content.length) return { content, structuredContent: { kind: 'comparison', changedPixels: value.changedPixels, totalPixels: value.totalPixels, ...(value.before ? { before: { width: value.before.width, height: value.before.height } } : {}), ...(value.after ? { after: { width: value.after.width, height: value.after.height } } : {}), ...(value.diff || value.dataUrl ? { diff: { width: value.diff?.width ?? value.width, height: value.diff?.height ?? value.height } } : {}) } };
  }
  if (name === 'pixelwall_preview' && value?.dataUrl) {
    const match = /^data:(image\/png);base64,(.+)$/.exec(value.dataUrl);
    if (match) {
      const metadata = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'dataUrl'));
      return { content: [{ type: 'image', data: match[2], mimeType: match[1] }, { type: 'text', text: JSON.stringify(metadata) }], structuredContent: metadata };
    }
  }
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(value && typeof value === 'object' && !Array.isArray(value) ? { structuredContent: value } : {}) };
});
const transport = new StdioServerTransport();
process.once('SIGINT', () => bridge.close()); process.once('SIGTERM', () => bridge.close());
server.onclose = () => bridge.close();
// StdioServerTransport delegates ownership to Server.connect(), so attach EOF
// to the process stream as well. This releases a connected desktop socket
// when an MCP client closes its input without sending a shutdown notification.
process.stdin.once('end', () => { void server.close().catch(() => bridge.close()); });
await server.connect(transport);
