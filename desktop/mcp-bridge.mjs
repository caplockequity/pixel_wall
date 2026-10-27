/**
 * Authenticated loopback bridge for the local MCP launcher.
 *
 * The renderer remains the source of truth: requests are dispatched only to
 * named window.pixelwall methods. No JavaScript supplied by a client is ever
 * evaluated. The bridge is opt-in and its short-lived token is written only to
 * a mode-0600 file consumed by the local stdio launcher.
 */
import { createServer } from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rm, writeFile, readFile, lstat, realpath, open, unlink, link } from 'node:fs/promises';
import { dirname, basename, resolve, relative } from 'node:path';
import { MCP_PROTOCOL_VERSION, MCP_SCHEMAS, toolDefinitions } from './mcp-catalog.mjs';
export { MCP_TOOLS } from './mcp-catalog.mjs';

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const fail = message => { throw new Error(message); };
const IMPORT_BYTES_LIMIT = 1024 * 1024;

function boundedSchema(name, schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const copy = structuredClone(schema);
  if (name === 'pixelwall_import_project' && copy.properties?.bytes) {
    copy.properties.bytes.maxItems = Math.min(copy.properties.bytes.maxItems ?? IMPORT_BYTES_LIMIT, IMPORT_BYTES_LIMIT);
  }
  return copy;
}


function tokenMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBytes = Buffer.from(actual), expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function response(id, result) { return { jsonrpc: '2.0', id, result }; }
function errorResponse(id, code, message) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }
function validateInput(schema, value, path = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  for (const key of schema.required || []) if (!(key in value)) fail(`${path}.${key} is required.`);
  if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!schema.properties[key]) fail(`${path}.${key} is not supported.`);
  for (const [key, rule] of Object.entries(schema.properties || {})) if (key in value) {
    const item = value[key], itemPath = `${path}.${key}`;
    if (rule.type === 'string' && typeof item !== 'string') fail(`${itemPath} must be a string.`);
    if (rule.type === 'array' && !Array.isArray(item)) fail(`${itemPath} must be an array.`);
    if (rule.type === 'integer' && (!Number.isSafeInteger(item))) fail(`${itemPath} must be an integer.`);
    if (rule.type === 'number' && (typeof item !== 'number' || !Number.isFinite(item))) fail(`${itemPath} must be a number.`);
    if (rule.minLength != null && item.length < rule.minLength || rule.maxLength != null && item.length > rule.maxLength) fail(`${itemPath} has an invalid length.`);
    if (rule.minItems != null && item.length < rule.minItems || rule.maxItems != null && item.length > rule.maxItems) fail(`${itemPath} has an invalid item count.`);
    if (rule.minimum != null && item < rule.minimum || rule.maximum != null && item > rule.maximum) fail(`${itemPath} is out of range.`);
    if (rule.exclusiveMinimum != null && item <= rule.exclusiveMinimum) fail(`${itemPath} is out of range.`);
    if (rule.enum && !rule.enum.includes(item)) fail(`${itemPath} is unsupported.`);
    if (rule.items) for (const entry of item) validateInput({ properties: { value: rule.items }, additionalProperties: true }, { value: entry }, itemPath);
  }
}

export function createMcpBridge({ webContents, configPath, exportRoot, host = '127.0.0.1', port = 0, net = { createServer }, fs = { mkdir, writeFile, readFile, chmod, rm, lstat, realpath, open, unlink, link }, now = Date.now, onStatus, telemetry } = {}) {
  if (!webContents?.executeJavaScript) fail('An editor window is required for the local agent bridge.');
  if (!configPath) fail('A local agent configuration path is required.');
  if (host !== '127.0.0.1') fail('The local agent bridge only permits loopback connections.');
  let token = randomBytes(32).toString('base64url');
  let server;
  let address;
  let closed = false;
  let configWritten = false;
  const sockets = new Set();
  let controller;
  let connectionSequence = 0;
  const dynamicSchemas = new Map(Object.entries(MCP_SCHEMAS));
  const statusSnapshot = () => ({ enabled: !!server && !closed, connected: !!controller && !controller.destroyed, telemetryEnabled: telemetry?.isEnabled?.() === true, configPath, exportRoot: exportRoot || null, host: address?.host || null, port: address?.port || null });
  const reportStatus = () => { try { onStatus?.(statusSnapshot()); } catch { /* status observers are best effort */ } };
  const report = input => { try { telemetry?.report?.(input); } catch { /* telemetry never affects the local editor */ } };
  const activeObservers = new Set();
  const operationEpochs = new Map();
  const reportTool = (name, args, result, outcome = 'success') => {
    const normalizedOutcome = outcome === 'failed' ? 'failure' : outcome;
    const terminal = result?.operation || result;
    if (name === 'pixelwall_apply') {
      if (!terminal || !['completed', 'failed', 'cancelled'].includes(terminal.status)) {
        if (normalizedOutcome !== 'success') report({ operation: 'apply', outcome: normalizedOutcome, dedupeKey: args?.requestKey ? `apply-request:${args.requestKey}` : undefined });
        return;
      }
      const operationId = terminal.operationId || result.operationId;
      if (operationId && operationEpochs.has(operationId) && operationEpochs.get(operationId) !== telemetry?.getConsentEpoch?.()) { operationEpochs.delete(operationId); return; }
      if (operationId) operationEpochs.delete(operationId);
      report({ operation: 'apply', outcome: terminal.status === 'completed' ? 'success' : (terminal.status === 'failed' ? 'failure' : terminal.status), changed: terminal.changed ?? result.changed, ...(operationId ? { dedupeKey: `apply:${operationId}` } : {}) });
      return;
    }
    if (name === 'pixelwall_operation') {
      if (!['completed', 'failed', 'cancelled'].includes(result?.status)) return;
      const operationId = result.operationId || result.id;
      if (!operationId || !operationEpochs.has(operationId) || operationEpochs.get(operationId) !== telemetry?.getConsentEpoch?.()) return;
      operationEpochs.delete(operationId);
      report({ operation: 'apply', outcome: result.status === 'completed' ? 'success' : (result.status === 'failed' ? 'failure' : result.status), changed: result.changed, ...(operationId ? { dedupeKey: `apply:${operationId}` } : {}) });
      return;
    }
    if (name === 'pixelwall_cancel') {
      if (result?.status === 'cancelled') {
        const operationId = result.operationId || result.id;
        if (!operationId || !operationEpochs.has(operationId) || operationEpochs.get(operationId) !== telemetry?.getConsentEpoch?.()) return;
        operationEpochs.delete(operationId);
        report({ operation: 'apply', outcome: 'cancelled', dedupeKey: `apply:${operationId}` });
      }
      return;
    }
    const operations = {
      pixelwall_lua: 'lua', pixelwall_color_profile: 'color_profile', pixelwall_undo: 'undo', pixelwall_redo: 'redo',
      pixelwall_new_document: 'new_document', pixelwall_open_project: 'open_project', pixelwall_import_project: 'import_project',
      pixelwall_save: 'save', pixelwall_export: 'export', pixelwall_validate: 'validate',
      pixelwall_capture_preview: 'capture_preview', pixelwall_preview: 'preview', pixelwall_read_artifact: 'read_artifact',
      pixelwall_download_artifact: 'download_artifact', pixelwall_remove_artifact: 'remove_artifact', pixelwall_save_artifact: 'save_artifact',
    };
    const operation = operations[name]; if (!operation) return;
    let operationOutcome = normalizedOutcome;
    if (operation === 'validate' && result?.valid === false) operationOutcome = 'failure';
    if (operation === 'download_artifact') operationOutcome = result?.status === 'missing' ? 'missing' : result?.status === 'requested' ? 'success' : normalizedOutcome === 'success' ? 'failure' : normalizedOutcome;
    if (operation === 'read_artifact' && result == null && normalizedOutcome === 'success') operationOutcome = 'missing';
    if (operation === 'remove_artifact' && result === false && normalizedOutcome === 'success') operationOutcome = 'missing';
    const input = { operation, outcome: operationOutcome };
    if (['lua', 'color_profile', 'undo', 'redo'].includes(operation)) input.changed = result?.changed;
    if (operation === 'preview') input.preview_kind = args?.kind || (args?.compare ? 'comparison' : args?.contactSheet ? 'contact-sheet' : 'frame');
    if (operation === 'save_artifact') {
      input.artifact_persistence = normalizedOutcome === 'success' && result?.saved === true ? 'persisted' : 'failed';
      if (result?.saved === false && normalizedOutcome === 'success') input.outcome = 'failure';
    }
    if (operation === 'export') input.artifact_persistence = result?.exportResult?.persistence?.status === 'persisted'
      ? 'persisted' : result?.exportResult?.persistence?.status === 'failed' ? 'failed' : 'not_requested';
    report(input);
  };
  const saveArtifact = async ({ artifactId, filename } = {}) => {
    if (!exportRoot) fail('Choose an export folder in PixelWall first.');
    const rootStat = await fs.lstat(exportRoot); if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('The approved export folder is unavailable.');
    const canonicalRoot = await fs.realpath(exportRoot);
    const info = await invoke('pixelwall_artifacts');
    const metadata = (Array.isArray(info) ? info : info?.artifacts)?.find(item => item.artifactId === artifactId);
    if (!metadata) fail('Artifact not found or expired.');
    if (!Number.isSafeInteger(metadata.bytes) || metadata.bytes < 1 || metadata.bytes > MAX_ARTIFACT_BYTES) fail('Artifact exceeds the safe delivery limit.');
    const requestedName = String(filename || metadata.name); const leaf = basename(requestedName); if (!leaf || leaf === '.' || leaf === '..' || requestedName !== leaf || /[\\/]/.test(requestedName)) fail('Artifact filename must be a single file name.');
    const target = resolve(canonicalRoot, leaf); const targetRelative = relative(canonicalRoot, target); if (!targetRelative || targetRelative.startsWith('..') || targetRelative.includes('/') || targetRelative.includes('\\')) fail('Artifact filename escapes the approved export folder.');
    const targetStat = await fs.lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)); if (targetStat) fail('A file with that name already exists.');
    const temporary = resolve(canonicalRoot, `.${leaf}.${randomBytes(12).toString('hex')}.tmp`);
    const handle = await fs.open(temporary, 'wx'); const hash = createHash('sha256'); let offset = 0; let bytes = 0;
    try {
      while (offset < metadata.bytes) {
        const chunk = await invoke('pixelwall_read_artifact', { artifactId, offset, length: Math.min(1024 * 1024, metadata.bytes - offset) });
        const raw = chunk?.bytes instanceof Uint8Array ? chunk.bytes : Uint8Array.from(chunk?.bytes || []);
        if (!raw.length || raw.length > metadata.bytes - offset) fail('Artifact chunk was invalid.');
        const written = await handle.write(raw); if (written.bytesWritten !== raw.length) fail('Artifact write was incomplete.'); hash.update(raw); offset += raw.length; bytes += raw.length;
      }
      if (bytes !== metadata.bytes || hash.digest('hex') !== metadata.sha256) fail('Artifact verification failed.');
      const beforeLink = await fs.lstat(exportRoot); if (beforeLink.isSymbolicLink() || await fs.realpath(exportRoot) !== canonicalRoot) fail('The approved export folder changed while saving.');
      await handle.sync(); await handle.close();
      const disk = await fs.readFile(temporary); const diskHash = createHash('sha256').update(disk).digest('hex');
      if (disk.length !== metadata.bytes || diskHash !== metadata.sha256) fail('Artifact durability verification failed.');
      await fs.link(temporary, target); await fs.unlink(temporary);
      return { saved: true, path: target, bytes: disk.length, sha256: diskHash };
    } catch (error) { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); throw error; }
  };
  const invoke = async (name, args, hooks = {}) => {
    const call = async (method, payload) => {
      const source = `(async()=>{const api=window.pixelwall;if(!api||typeof api[${JSON.stringify(method)}]!=="function")throw new Error("PixelWall editor is not ready.");return await api[${JSON.stringify(method)}](${payload === undefined ? '' : JSON.stringify(payload)});})()`;
      return webContents.executeJavaScript(source, true);
    };
    switch (name) {
      case 'pixelwall_inspect': return call('inspect');
      case 'pixelwall_tools': return call('tools');
      case 'pixelwall_commands': return call('commands');
      case 'pixelwall_apply': {
        if (args?.wait === false) {
          const started = await call('apply', args);
          if (started?.operationId) {
            hooks.onOperation?.(started.operationId);
            operationEpochs.set(started.operationId, telemetry?.getConsentEpoch?.());
            if (hooks.cancelled?.()) void call('cancel', started.operationId).catch(() => {});
            // Continue observing a fire-and-forget apply so its terminal
            // outcome is recorded even when the caller never polls.
            const observer = { stopped: false };
            activeObservers.add(observer);
            void (async () => {
              let current = started;
              for (let attempt = 0; attempt < 3000 && !observer.stopped && !['completed', 'failed', 'cancelled'].includes(current?.status); attempt += 1) {
                await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
                try { current = await call('operation', started.operationId); } catch { activeObservers.delete(observer); return; }
              }
              if (!observer.stopped && ['completed', 'failed', 'cancelled'].includes(current?.status)) reportTool('pixelwall_operation', {}, current);
              activeObservers.delete(observer);
            })();
          }
          return started;
        }
        // Start in polling mode so the owning socket learns the operation ID
        // before a long wait. Disconnect cleanup can then cancel only it.
        const started = await call('apply', { ...(args || {}), wait: false });
        const operationId = started?.operationId;
        if (!operationId) return started;
        operationEpochs.set(operationId, telemetry?.getConsentEpoch?.());
        hooks.onOperation?.(operationId);
        if (hooks.cancelled?.()) { await call('cancel', operationId).catch(() => {}); throw Error('Local PixelWall connection closed.'); }
        let current = started;
        while (!['completed', 'failed', 'cancelled'].includes(current?.status)) {
          if (hooks.cancelled?.()) throw Error('Local PixelWall connection closed.');
          await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
          current = await call('operation', operationId);
        }
        if (current.status !== 'completed') {
          const error = Error(current.error || `PixelWall operation ${current.status}.`);
          error.pixelwallOperation = current;
          throw error;
        }
        // Keep the completion payload tied to this operation. A later
        // inspect could observe another editor action and misrepresent the
        // result of this request.
        return { revision: current.revision, operation: current, operationId };
      }
      case 'pixelwall_operation': return call('operation', args?.operationId);
      case 'pixelwall_new_document': return call('newDocument', args || {});
      case 'pixelwall_preview': return call('preview', args || {});
      case 'pixelwall_capture_preview': return call('capturePreview');
      case 'pixelwall_lua': return call('runLua', args || {});
      case 'pixelwall_color_profile': return call('colorProfile', args || {});
      case 'pixelwall_save': return call('save');
      case 'pixelwall_export': return call('export', args || {});
      case 'pixelwall_export_result': return call('exportResult');
      case 'pixelwall_undo': return call('undo');
      case 'pixelwall_redo': return call('redo');
      case 'pixelwall_projects': return call('projects');
      case 'pixelwall_open_project': return call('openProject', args || {});
      case 'pixelwall_import_project': return call('importProject', args || {});
      case 'pixelwall_validate': return call('validate', args || {});
      case 'pixelwall_cancel': return call('cancel', args?.operationId);
      case 'pixelwall_artifacts': return call('artifacts');
      case 'pixelwall_read_artifact': return call('readArtifact', args || {});
      case 'pixelwall_remove_artifact': return call('removeArtifact', args?.artifactId);
      case 'pixelwall_download_artifact': return call('downloadArtifact', args?.artifactId);
      case 'pixelwall_save_artifact': return saveArtifact(args);
      default: fail('Unknown PixelWall tool.');
    }
  };
  async function handle(message, hooks = {}) {
    if (!message || typeof message !== 'object' || typeof message.method !== 'string') return errorResponse(message?.id, -32600, 'Invalid request.');
    if (!tokenMatches(message.token, token)) return errorResponse(message.id, -32001, 'Local PixelWall connection is not authorized.');
    if (message.method === 'ping') return response(message.id, { protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name: 'pixelwall-desktop', version: '1' } });
    if (message.method === 'tools/list') {
      try {
        const dynamic = await invoke('pixelwall_tools');
        if (Array.isArray(dynamic)) {
          const listed = dynamic.filter(tool => typeof tool?.name === 'string' && tool.inputSchema).map(tool => ({ ...tool, inputSchema: boundedSchema(tool.name, tool.inputSchema) }));
          for (const tool of listed) dynamicSchemas.set(tool.name, tool.inputSchema);
          const names = new Set(listed.map(tool => tool.name));
          for (const nativeTool of toolDefinitions()) if (!names.has(nativeTool.name)) listed.push(nativeTool);
          return response(message.id, { tools: listed });
        }
      } catch { /* Older desktop builds use the shared catalog. */ }
      return response(message.id, { tools: toolDefinitions() });
    }
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      const schema = dynamicSchemas.get(name);
      if (!schema) return errorResponse(message.id, -32602, 'Unknown PixelWall tool.');
      try {
        validateInput(schema, message.params?.arguments || {});
        const arguments_ = message.params?.arguments || {};
        const result = await invoke(name, arguments_, hooks);
        reportTool(name, arguments_, result);
        return response(message.id, { content: [{ type: 'text', text: JSON.stringify(result ?? null) }], ...(result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result } : {}), isError: false });
      } catch (error) {
        const blocked = error?.name === 'ProExportRequired' || (name === 'pixelwall_export' && /^Pro access is required/i.test(String(error?.message || '')));
        if (error?.pixelwallOperation) reportTool(name, message.params?.arguments || {}, error.pixelwallOperation);
        else reportTool(name, message.params?.arguments || {}, null, blocked ? 'blocked' : 'failure');
        return response(message.id, { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
    }
    return errorResponse(message.id, -32601, 'Unknown local PixelWall method.');
  }
  function attach(socket) {
    if (controller && !controller.destroyed) { socket.destroy(); return; }
    const operations = new Set();
    let mutationChain = Promise.resolve();
    let disconnected = false;
    sockets.add(socket);
    socket.once('close', () => {
      disconnected = true;
      sockets.delete(socket);
      if (controller === socket) { controller = undefined; reportStatus(); }
      // Only operation IDs explicitly launched by this authenticated socket
      // are eligible for disconnect cancellation.
      for (const operationId of operations) void invoke('pixelwall_cancel', { operationId }).catch(() => {});
    });
    socket.setEncoding('utf8');
    let buffer = '';
    const readOnly = new Set(['pixelwall_inspect', 'pixelwall_commands', 'pixelwall_operation', 'pixelwall_preview', 'pixelwall_capture_preview', 'pixelwall_export_result', 'pixelwall_projects', 'pixelwall_artifacts', 'pixelwall_read_artifact', 'pixelwall_tools', 'pixelwall_validate', 'pixelwall_cancel']);
    socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) { socket.destroy(); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) { socket.destroy(); return; }
        let message;
        try { message = JSON.parse(line); } catch { socket.write(JSON.stringify(errorResponse(null, -32700, 'Invalid JSON.')) + '\n'); continue; }
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          if (!socket.destroyed) socket.write(JSON.stringify(errorResponse(null, -32600, 'Invalid request.')) + '\n');
          continue;
        }
        if (!tokenMatches(message.token, token)) {
          if (!socket.destroyed) socket.write(JSON.stringify(errorResponse(message.id, -32001, 'Local PixelWall connection is not authorized.')) + '\n');
          continue;
        }
        if (!controller) { controller = socket; report({ operation: 'connect', outcome: 'success', dedupeKey: `connect:${++connectionSequence}` }); reportStatus(); }
        if (controller !== socket) { socket.destroy(); continue; }
        const name = message.method === 'tools/call' ? message.params?.name : null;
        const dispatch = () => { if (socket.destroyed || controller !== socket) throw Error('Local PixelWall connection closed.'); return handle(message, { onOperation: operationId => operations.add(operationId), cancelled: () => disconnected }); };
        const task = name && !readOnly.has(name) ? (mutationChain = mutationChain.catch(() => {}).then(dispatch)) : Promise.resolve().then(dispatch);
        task.then(result => { const operationId = result?.result?.structuredContent?.operationId; if (operationId) operations.add(operationId); if (!socket.destroyed) socket.write(JSON.stringify(result) + '\n'); else if (operationId) void invoke('pixelwall_cancel', { operationId }).catch(() => {}); }).catch(error => { if (!socket.destroyed) socket.write(JSON.stringify(errorResponse(message.id, -32603, error.message)) + '\n'); });
      }
    });
  }
  return {
    get token() { return token; },
    async start() {
      if (server) return { ...address, configPath };
      closed = false;
      token = randomBytes(32).toString('base64url');
      const candidate = net.createServer(attach);
      try {
        await new Promise((resolveStart, reject) => { candidate.once('error', reject); candidate.listen({ host, port }, resolveStart); });
      } catch (error) {
        await new Promise(resolveClose => candidate.close(resolveClose)).catch(() => {});
        closed = true; reportStatus();
        throw error;
      }
      server = candidate;
      const bound = server.address(); address = { host, port: typeof bound === 'object' ? bound.port : port };
      try {
        await fs.mkdir(dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify({ version: 1, host, port: address.port, token, exportRoot, createdAt: new Date(now()).toISOString() }) + '\n', { mode: 0o600 });
        await fs.chmod(configPath, 0o600); configWritten = true;
      } catch (error) {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolveClose => candidate.close(resolveClose)).catch(() => {});
        server = undefined; address = undefined; closed = true; reportStatus();
        throw error;
      }
      reportStatus();
      return { ...address, configPath };
    },
    async stop() {
      closed = true;
      for (const observer of activeObservers) observer.stopped = true;
      activeObservers.clear();
      for (const socket of sockets) socket.destroy();
      if (server) await new Promise(resolveStop => server.close(() => resolveStop()));
      server = undefined; address = undefined;
      if (configWritten) { const current = await fs.readFile(configPath, 'utf8').catch(() => ''); if (current.includes(`"token":"${token}"`)) await fs.rm(configPath, { force: true }).catch(() => {}); }
      configWritten = false; reportStatus();
    },
    get connected() { return !!server && !closed; },
    get address() { return address ? { ...address, configPath } : null; },
    status: statusSnapshot,
    handle,
  };
}
