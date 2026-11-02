import { app, BrowserWindow } from 'electron';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDesktopAutomationTelemetry } from '../desktop/automation-telemetry.mjs';
import { handleDesktopTrafficRequest } from '../app/desktop-traffic-core.mjs';
import { createMcpBridge } from '../desktop/mcp-bridge.mjs';
import { readPng } from '../app/formats.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(process.env.PIXELWALL_FIXTURE_OUTPUT);
const appAsar = resolve(process.env.PIXELWALL_FIXTURE_ASAR);
const marker = process.env.PIXELWALL_TELEMETRY_TEST_RUN;
const live = process.env.PIXELWALL_FIXTURE_LIVE === '1';
const endpoint = 'https://www.pixelwall.dev/api/desktop-traffic';
assert.match(marker || '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
if (live && (process.env.PIXELWALL_TELEMETRY_DISABLED === '1' || process.env.DO_NOT_TRACK === '1')) throw new Error('Existing telemetry opt-out prevents live validation.');
const receipts = [];
const fetchImpl = async (url, init) => {
  const payload = JSON.parse(init.body);
  assert.equal(url, endpoint);
  assert.equal(payload.test_run, marker, 'Refuse unmarked requests before any network access');
  const receipt = { ...payload, http_status: null };
  receipts.push(receipt);
  try {
    const response = live ? await globalThis.fetch(url, init) : await handleDesktopTrafficRequest(new Request(url, init), {
      env: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'local-validation-only', NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com' },
      fetchImpl: async (_upstream, request) => {
        const event = JSON.parse(request.body);
        assert.equal(event.properties.environment, 'test'); assert.equal(event.properties.test_run, marker);
        return new Response(null, { status: 200 });
      },
    });
    receipt.http_status = response.status;
    assert.equal(response.status, 204);
    return response;
  } catch (error) { receipt.failed = true; throw error; }
};
let bridge, window, client, telemetry;
const profile = join(root, 'profile');
for (const [key, path] of Object.entries({ userData: profile, sessionData: join(profile, 'session'), cache: join(profile, 'cache'), logs: join(profile, 'logs') })) { mkdirSync(path, { recursive: true }); app.setPath(key, path); }
app.setName('PixelWall telemetry validation');
const delay = ms => new Promise(done => setTimeout(done, ms));
const bounded = async (promise, ms, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), ms); })]); }
  finally { clearTimeout(timer); }
};

void app.whenReady().then(async () => {
  let status = 'failed', detail = {};
  try {
    window = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { preload: fileURLToPath(new URL('../desktop/native-preload.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await bounded(window.loadURL(pathToFileURL(join(appAsar, 'app/index.html')).href), 10000, 'Editor load');
    await bounded(window.webContents.executeJavaScript('new Promise(resolve => { const check = () => window.pixelwall ? resolve(true) : setTimeout(check, 50); check(); })'), 10000, 'Editor API readiness');
    telemetry = createDesktopAutomationTelemetry({ version: '0.6.4', packaged: true, env: process.env, readSettings: async () => ({ enabled: true }), fetchImpl });
    await telemetry.start();
    assert.equal(telemetry.isEnabled(), true);
    bridge = createMcpBridge({ webContents: window.webContents, appVersion: '0.6.4', configPath: join(root, 'mcp.json'), exportRoot: root, telemetry });
    await bridge.start();
    const transport = new StdioClientTransport({ command: process.env.PIXELWALL_FIXTURE_NODE, args: [fileURLToPath(new URL('../app/mcp-server.mjs', import.meta.url))], env: { ...process.env, PIXELWALL_MCP_CONFIG: join(root, 'mcp.json') } });
    client = new Client({ name: 'pixelwall-telemetry-validation', version: '0.6.4' });
    await bounded(client.connect(transport), 5000, 'MCP connect');
    const call = async (name, args) => {
      const result = await bounded(client.callTool({ name, arguments: args }), 5000, name);
      assert.notEqual(result?.isError, true, name + ' returned an MCP error');
      return result.structuredContent ?? JSON.parse(result.content.find(x => x.type === 'text').text);
    };
    await call('pixelwall_new_document', { width: 8, height: 8, mode: 'temporary' });
    const applied = await call('pixelwall_apply', { commands: [{ type: 'draw.stroke', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }], color: '#ff00ff', size: 1 }], wait: true, requestKey: 'telemetry-' + marker });
    assert.equal(applied.operation.status, 'completed'); assert.equal(applied.operation.changed, true);
    const exported = await call('pixelwall_export', { format: 'png', download: false });
    const generated = exported.exportResult.generated.files[0];
    assert.ok(generated.artifactId); assert.equal(exported.exportResult.persistence.status, 'persisted');
    const saved = await call('pixelwall_save_artifact', { artifactId: generated.artifactId, filename: 'mcp-telemetry-test.png' });
    assert.equal(saved.saved, true);
    const bytes = await readFile(join(root, 'mcp-telemetry-test.png'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256, generated.sha256); assert.equal(sha256, saved.sha256);
    const png = readPng(bytes), painted = (png.width + 1) * 4;
    assert.equal(png.width, 8); assert.equal(png.height, 8);
    assert.deepEqual(Array.from(png.rgba.slice(painted, painted + 4)), [255, 0, 255, 255]); assert.equal(png.rgba[3], 0);
    const deadline = Date.now() + 5000;
    while (telemetry.pendingCount && Date.now() < deadline) await delay(50);
    assert.equal(telemetry.pendingCount, 0, 'All telemetry requests must finish');
    const expected = ['connect', 'new_document', 'apply', 'export', 'save_artifact'];
    assert.deepEqual(receipts.map(x => x.operation), expected);
    for (const receipt of receipts) { assert.equal(receipt.http_status, 204); assert.equal(receipt.outcome, 'success'); assert.equal(receipt.test_run, marker); assert.notEqual(receipt.failed, true); }
    assert.equal(receipts.find(x => x.operation === 'apply').changed, true);
    assert.equal(receipts.find(x => x.operation === 'export').artifact_persistence, 'persisted');
    status = 'passed'; detail = { png: { width: png.width, height: png.height, bytes: bytes.length, sha256, edited_pixel: Array.from(png.rgba.slice(painted, painted + 4)) } };
  } catch (error) { detail = { error: error instanceof Error ? error.message : String(error) }; }
  finally {
    await bounded(client?.close?.() ?? Promise.resolve(), 2000, 'MCP cleanup').catch(() => {});
    await bounded(bridge?.stop?.() ?? Promise.resolve(), 2000, 'Bridge cleanup').catch(() => {});
    telemetry?.dispose();
    if (window && !window.isDestroyed()) window.destroy();
    await writeFile(join(root, 'receipts.json'), JSON.stringify({ status, live, marker, ...detail, telemetry: receipts }, null, 2));
    app.exit(status === 'passed' ? 0 : 1);
  }
});
