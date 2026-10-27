import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, mkdtemp, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connect } from 'node:net';
import { createMcpBridge, MCP_TOOLS } from '../desktop/mcp-bridge.mjs';
import { MCP_SCHEMAS } from '../desktop/mcp-catalog.mjs';
import { createDocument } from '../app/editor-core.mjs';
import { encodeProjectContainer } from '../desktop/project-container.mjs';

const taskRoot = '/Volumes/DevStorage/Builds/pixelwall/studio-050/mcp-tests';

test('local bridge authenticates and exposes only fixed PixelWall operations', async () => {
  await mkdir(taskRoot, { recursive: true });
  const calls = [];
  const bridge = createMcpBridge({ configPath: join(taskRoot, 'mcp.json'), webContents: { executeJavaScript(source) { calls.push(source); return Promise.resolve({ revision: 4 }); } } });
  const unauthorized = await bridge.handle({ id: 1, token: 'wrong', method: 'tools/list' });
  assert.equal(unauthorized.error.code, -32001);
  const listed = await bridge.handle({ id: 2, token: bridge.token, method: 'tools/list' });
  assert.equal(listed.result.tools.length, MCP_TOOLS.length);
  const applied = await bridge.handle({ id: 3, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_apply', arguments: { commands: [{ type: 'draw.fill', color: '#fff' }] } } });
  assert.equal(applied.result.isError, false);
  assert.ok(calls.length >= 1);
  assert.match(calls[0], /window\.pixelwall/);
  assert.doesNotMatch(calls[0], /eval|Function\(/);
  const denied = await bridge.handle({ id: 4, token: bridge.token, method: 'tools/call', params: { name: 'arbitrary_js', arguments: {} } });
  assert.equal(denied.error.code, -32602);
  await bridge.stop();
});

test('bridge writes a mode-restricted connection file and removes it on disconnect', async () => {
  const configPath = join(taskRoot, 'lifecycle.json');
  const bridge = createMcpBridge({ configPath, webContents: { executeJavaScript: async () => null } });
  const address = await bridge.start();
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.port, address.port);
  assert.equal(config.token, bridge.token);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  assert.equal(bridge.connected, true);
  await bridge.stop();
  assert.equal(bridge.connected, false);
  await assert.rejects(readFile(configPath), error => error.code === 'ENOENT');
  await rm(taskRoot, { recursive: true, force: true });
});

test('bridge tears down a listening socket when connection-file setup fails', async () => {
  const configPath = join(taskRoot, 'failed-start.json');
  const bridge = createMcpBridge({ configPath, webContents: { executeJavaScript: async () => null }, fs: {
    mkdir: async () => {}, writeFile: async () => { throw new Error('disk unavailable'); }, chmod: async () => {},
  } });
  await assert.rejects(bridge.start(), /disk unavailable/);
  assert.equal(bridge.connected, false);
  assert.equal(bridge.address, null);
});

test('official MCP SDK client interoperates with the stdio launcher and desktop bridge', async () => {
  const configPath = join(taskRoot, 'stdio.json');
  const bridge = createMcpBridge({ configPath, webContents: { executeJavaScript: async source => source.includes('commands') ? [{ type: 'draw.fill' }] : { revision: 2 } } });
  await bridge.start();
  const transport = new StdioClientTransport({ command: process.execPath, args: ['app/mcp-server.mjs'], cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PIXELWALL_MCP_CONFIG: configPath } });
  const client = new Client({ name: 'pixelwall-test-client', version: '1' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'pixelwall_inspect'));
    const inspection = await client.callTool({ name: 'pixelwall_inspect', arguments: {} });
    assert.notEqual(inspection.isError, true);
    await new Promise(resolve => setTimeout(resolve, 15100));
    assert.ok((await client.listTools()).tools.length >= MCP_TOOLS.length);
  } finally {
    await client.close().catch(() => {});
    await bridge.stop();
  }
});

test('save_artifact writes verified bytes only beneath the approved root', async () => {
  const root = await mkdtemp('/Volumes/DevStorage/Builds/pixelwall/studio-050/artifact-');
  const bytes = [1, 2, 3, 4], metadata = { artifactId: 'a1', name: 'sprite.png', bytes: bytes.length, sha256: '9f64a747e1b97f131fabb6b447296c9b6f020a8a9a0d3b9c0b8f5f1f7b7f8f6f' };
  const crypto = await import('node:crypto'); metadata.sha256 = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  const bridge = createMcpBridge({ configPath: join(root, 'mcp.json'), exportRoot: root, webContents: { executeJavaScript: async source => source.includes('api["artifacts"]') ? [metadata] : { bytes } } });
  const call = (arguments_) => bridge.handle({ id: 1, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_save_artifact', arguments: arguments_ } });
  const saved = await call({ artifactId: 'a1' }); assert.equal(saved.result.structuredContent.saved, true); assert.deepEqual([...await readFile(join(root, 'sprite.png'))], bytes);
  assert.equal((await call({ artifactId: 'a1', filename: '../escape.png' })).result.isError, true);
  await symlink(join(root, 'sprite.png'), join(root, 'link.png')); assert.equal((await call({ artifactId: 'a1', filename: 'link.png' })).result.isError, true);
  const tampered = createMcpBridge({ configPath: join(root, 'tampered.json'), exportRoot: root, webContents: { executeJavaScript: async source => source.includes('api["artifacts"]') ? [metadata] : { bytes: [9, 9, 9, 9] } } });
  assert.equal((await tampered.handle({ id: 2, token: tampered.token, method: 'tools/call', params: { name: 'pixelwall_save_artifact', arguments: { artifactId: 'a1', filename: 'tampered.png' } } })).result.isError, true);
  await assert.rejects(access(join(root, 'tampered.png')));
  await access(join(root, 'sprite.png')); await rm(root, { recursive: true, force: true });
});

test('checkpoint persists the guarded artifact and verifies the written project', async () => {
  const root = await mkdtemp('/Volumes/DevStorage/Builds/pixelwall/studio-050/checkpoint-');
  const bytes = encodeProjectContainer(createDocument({ id: 'checkpoint-doc', name: 'Checkpoint fixture', width: 4, height: 4 }));
  const crypto = await import('node:crypto');
  const metadata = { artifactId: 'checkpoint-artifact', name: 'Checkpoint fixture.pixelwall', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  const prepared = { documentId: 'checkpoint-doc', revision: 7, filename: metadata.name, bytes: bytes.length, artifactId: metadata.artifactId, sha256: metadata.sha256, persistence: { status: 'persisted' } };
  const bridge = createMcpBridge({ configPath: join(root, 'mcp.json'), exportRoot: root, webContents: { executeJavaScript: async source => {
    if (source.includes('api["checkpoint"]')) return prepared;
    if (source.includes('api["artifacts"]')) return [metadata];
    if (source.includes('api["readArtifact"]')) return { bytes: Array.from(bytes), offset: 0, length: bytes.length, done: true, metadata };
    throw Error('unexpected renderer method');
  } } });
  const response = await bridge.handle({ id: 1, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_checkpoint', arguments: { expectedDocumentId: 'checkpoint-doc', expectedRevision: 7 } } });
  assert.equal(response.result.structuredContent.disk.status, 'persisted');
  assert.equal(response.result.structuredContent.reopenVerification.status, 'verified');
  assert.deepEqual([...await readFile(response.result.structuredContent.disk.path)], [...bytes]);
  await rm(root, { recursive: true, force: true });
});

test('dynamic current tool metadata is accepted while unknown names remain guarded', async () => {
  const bridge = createMcpBridge({ configPath: join(taskRoot, 'dynamic.json'), webContents: { executeJavaScript: async source => source.includes('api["tools"]') ? [{ name: 'pixelwall_dynamic_preview', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] : null } });
  const listed = await bridge.handle({ id: 1, token: bridge.token, method: 'tools/list' });
  assert.equal(listed.result.tools[0].name, 'pixelwall_dynamic_preview');
  const called = await bridge.handle({ id: 2, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_dynamic_preview', arguments: {} } });
  assert.equal(called.result.isError, true);
  const unknown = await bridge.handle({ id: 3, token: bridge.token, method: 'tools/call', params: { name: 'not_listed', arguments: {} } });
  assert.equal(unknown.error.code, -32602);
});

test('dynamic metadata keeps native delivery and bounded import while dispatching current tools', async () => {
  const calls = [];
  const dynamic = [
    { name: 'pixelwall_import_project', inputSchema: { type: 'object', properties: { bytes: { type: 'array', maxItems: 16 * 1024 * 1024 } }, required: ['bytes'], additionalProperties: false } },
    { name: 'pixelwall_lua', inputSchema: { type: 'object', properties: { source: { type: 'string' } }, required: ['source'], additionalProperties: false } },
    { name: 'pixelwall_color_profile', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  ];
  const bridge = createMcpBridge({ configPath: join(taskRoot, 'dynamic-current.json'), webContents: { executeJavaScript: async source => {
    calls.push(source);
    if (source.includes('api["tools"]')) return dynamic;
    return { ok: true };
  } } });
  const listed = await bridge.handle({ id: 1, token: bridge.token, method: 'tools/list' });
  assert.ok(listed.result.tools.some(tool => tool.name === 'pixelwall_save_artifact'));
  assert.equal(listed.result.tools.find(tool => tool.name === 'pixelwall_import_project').inputSchema.properties.bytes.maxItems, 1024 * 1024);
  for (const [id, name, args] of [[2, 'pixelwall_lua', { source: 'return 1' }], [3, 'pixelwall_color_profile', {}], [4, 'pixelwall_download_artifact', { artifactId: 'a1' }]]) {
    const result = await bridge.handle({ id, token: bridge.token, method: 'tools/call', params: { name, arguments: args } });
    assert.equal(result.result.isError, false);
  }
  assert.ok(calls.some(source => source.includes('api["runLua"]')));
  assert.ok(calls.some(source => source.includes('api["colorProfile"]')));
  assert.ok(calls.some(source => source.includes('api["downloadArtifact"]("a1")')));
});

test('disconnect cancellation is scoped to authenticated operations', async () => {
  const calls = [];
  const bridge = createMcpBridge({ configPath: join(taskRoot, 'scoped-disconnect.json'), webContents: { executeJavaScript: async source => {
    calls.push(source);
    if (source.includes('api["apply"]')) return { operationId: 'owned-op', status: 'queued' };
    if (source.includes('api["operation"]')) return { id: 'owned-op', status: 'running' };
    return null;
  } } });
  const address = await bridge.start();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const unauthorized = connect(address.port, address.host);
  unauthorized.write(JSON.stringify({ id: 1, token: 'wrong', method: 'ping' }) + '\n');
  await wait(10); unauthorized.destroy(); await wait(20);
  assert.equal(calls.some(source => source.includes('api["cancel"]')), false);
  const authorized = connect(address.port, address.host);
  authorized.write(JSON.stringify({ id: 2, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_apply', arguments: { commands: [{}], wait: true } } }) + '\n');
  await wait(30); authorized.destroy(); await wait(30);
  assert.ok(calls.some(source => source.includes('api["cancel"]("owned-op")')));
  await bridge.stop();
});

test('static fallback keeps current preview and agent schema fields', async () => {
  const { automationTools } = await import('../app/editor-automation.mjs');
  const current = new Map(automationTools({}).map(tool => [tool.name, tool.inputSchema]));
  for (const name of ['pixelwall_preview', 'pixelwall_import_project', 'pixelwall_lua', 'pixelwall_color_profile']) {
    assert.deepEqual(Object.keys(MCP_SCHEMAS[name].properties), Object.keys(current.get(name).properties));
  }
  assert.equal(MCP_SCHEMAS.pixelwall_preview.properties.kind.enum.join(','), 'frame,contact-sheet,comparison');
  assert.equal(MCP_SCHEMAS.pixelwall_import_project.properties.bytes.maxItems, 1024 * 1024);
});
