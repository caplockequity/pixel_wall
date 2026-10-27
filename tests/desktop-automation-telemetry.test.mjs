import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopAutomationTelemetry, createAutomationTelemetrySettingsStore } from '../desktop/automation-telemetry.mjs';
import { createMcpBridge } from '../desktop/mcp-bridge.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('desktop reporting is disabled by default and sanitizes payloads', async () => {
  const calls = [];
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => { calls.push(JSON.parse(options.body)); }, now: () => 1 });
  await telemetry.start();
  assert.equal(telemetry.report({ operation: 'apply', outcome: 'success', changed: true, dedupeKey: 'a' }), false);
  assert.equal(calls.length, 0);
  await telemetry.setEnabled(true);
  assert.equal(telemetry.report({ operation: 'apply', outcome: 'success', changed: true, dedupeKey: 'a', path: '/secret', source: 'agent' }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0], { event: 'desktop_automation_operation', operation: 'apply', outcome: 'success', version: '0.5.0', changed: true });
  assert.equal(telemetry.report({ operation: 'apply', outcome: 'success', changed: true, dedupeKey: 'a' }), false);
});

test('withdrawal clears persisted choice and aborts pending requests', async () => {
  let aborted = false;
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }); }) });
  await telemetry.start(); await telemetry.setEnabled(true);
  telemetry.report({ operation: 'connect', outcome: 'success' });
  await telemetry.setEnabled(false);
  assert.equal(telemetry.isEnabled(), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(aborted, true);
});

test('withdrawal disables reporting before a slow preference write finishes', async () => {
  let release;
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', writeSettings: () => new Promise(resolve => { release = resolve; }) });
  await telemetry.start();
  // The failed write keeps the test focused on the synchronous in-memory withdrawal.
  const enabling = telemetry.setEnabled(true);
  await new Promise(resolve => setImmediate(resolve));
  release();
  await enabling;
  const disabling = telemetry.setEnabled(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(telemetry.isEnabled(), false);
  release();
  await disabling;
});

test('failed preference writes stay disabled', async () => {
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', writeSettings: async () => { throw new Error('disk unavailable'); } });
  await telemetry.start();
  await assert.rejects(() => telemetry.setEnabled(true), /preference could not be saved/);
  assert.equal(telemetry.isEnabled(), false);
});

test('settings store writes only the opt-in flag', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pixelwall-telemetry-'));
  test.after(() => rm(root, { recursive: true, force: true }));
  const store = createAutomationTelemetrySettingsStore(join(root, 'automation-telemetry.json'));
  await store.writeSettings({ enabled: true, artwork: 'secret', token: 'secret' });
  assert.deepEqual(await store.readSettings(), { schemaVersion: 1, enabled: true });
});

test('bridge reports completed MCP edits once across wait and polling retries', async () => {
  const reports = [];
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => { reports.push(JSON.parse(options.body)); } });
  await telemetry.start(); await telemetry.setEnabled(true);
  const bridge = createMcpBridge({
    configPath: join('/tmp', `pixelwall-mcp-test-${Date.now()}.json`), telemetry,
    webContents: { executeJavaScript: async source => {
      if (source.includes('api["apply"]')) return { operationId: 'op-1', status: 'completed', revision: 2, changed: true };
      if (source.includes('api["operation"]')) return { operationId: 'op-1', id: 'op-1', status: 'completed', revision: 2, changed: true };
      return [];
    } },
  });
  const call = params => bridge.handle({ id: 1, token: bridge.token, method: 'tools/call', params });
  await call({ name: 'pixelwall_apply', arguments: { commands: [{}] } });
  await call({ name: 'pixelwall_operation', arguments: { operationId: 'op-1' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reports.filter(item => item.operation === 'apply').length, 1);
  assert.equal(reports[0].changed, true);
});

test('bridge reports artifact persistence separately from export generation', async () => {
  const reports = [];
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => { reports.push(JSON.parse(options.body)); } });
  await telemetry.start(); await telemetry.setEnabled(true);
  const bridge = createMcpBridge({ configPath: join('/tmp', `pixelwall-mcp-test-${Date.now()}-2.json`), telemetry, webContents: { executeJavaScript: async source => source.includes('api["export"]') ? { filename: 'sprite.png', bytes: 1, exportResult: { persistence: { status: 'not_requested' } } } : { status: 'requested', artifactId: 'a1' } } });
  const call = params => bridge.handle({ id: Math.random(), token: bridge.token, method: 'tools/call', params });
  await call({ name: 'pixelwall_export', arguments: { format: 'png', download: false } });
  await call({ name: 'pixelwall_download_artifact', arguments: { artifactId: 'a1' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports.map(item => [item.operation, item.outcome]), [['export', 'success'], ['download_artifact', 'success']]);
});

test('bridge reports authoritative validation, artifact misses, and export persistence', async () => {
  const reports = [];
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => { reports.push(JSON.parse(options.body)); } });
  await telemetry.start(); await telemetry.setEnabled(true);
  const bridge = createMcpBridge({ configPath: join('/tmp', `pixelwall-mcp-test-${Date.now()}-3.json`), telemetry, webContents: { executeJavaScript: async source => {
    if (source.includes('api["validate"]')) return { valid: false, revision: 1 };
    if (source.includes('api["save"]')) return { saved: false };
    if (source.includes('api["downloadArtifact"]')) return { status: 'missing' };
    if (source.includes('api["removeArtifact"]')) return false;
    if (source.includes('api["export"]')) return { filename: 'a.png', bytes: 1, exportResult: { persistence: { status: 'persisted' } } };
    return null;
  } } });
  const call = params => bridge.handle({ id: Math.random(), token: bridge.token, method: 'tools/call', params });
  await call({ name: 'pixelwall_validate', arguments: { commands: [{}] } });
  await call({ name: 'pixelwall_save', arguments: {} });
  await call({ name: 'pixelwall_download_artifact', arguments: { artifactId: 'missing' } });
  await call({ name: 'pixelwall_remove_artifact', arguments: { artifactId: 'missing' } });
  await call({ name: 'pixelwall_export', arguments: { format: 'png' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports.map(item => [item.operation, item.outcome, item.artifact_persistence]), [
    ['validate', 'failure', undefined], ['save', 'failure', undefined], ['download_artifact', 'missing', undefined],
    ['remove_artifact', 'missing', undefined], ['export', 'success', 'persisted'],
  ]);
});

test('wait:false observes and reports a later terminal apply result', async () => {
  const reports = [];
  let polls = 0;
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => { reports.push(JSON.parse(options.body)); } });
  await telemetry.start(); await telemetry.setEnabled(true);
  const bridge = createMcpBridge({ configPath: join('/tmp', `pixelwall-mcp-test-${Date.now()}-4.json`), telemetry, webContents: { executeJavaScript: async source => {
    if (source.includes('api["apply"]')) return { operationId: 'async-1', status: 'queued' };
    if (source.includes('api["operation"]')) return ++polls > 1 ? { operationId: 'async-1', status: 'completed', changed: true } : { operationId: 'async-1', status: 'running' };
    return null;
  } } });
  await bridge.handle({ id: 1, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_apply', arguments: { commands: [{}], wait: false } } });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(reports.filter(item => item.operation === 'apply').length, 1);
  assert.equal(reports[0].changed, true);
});

test('wait:true reports the terminal failure once before returning the MCP error', async () => {
  const reports = [];
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => { reports.push(JSON.parse(options.body)); } });
  await telemetry.start(); await telemetry.setEnabled(true);
  const bridge = createMcpBridge({ configPath: join('/tmp', `pixelwall-mcp-test-${Date.now()}-5.json`), telemetry, webContents: { executeJavaScript: async source => {
    if (source.includes('api["apply"]')) return { operationId: 'failed-1', status: 'queued' };
    if (source.includes('api["operation"]')) return { operationId: 'failed-1', status: 'failed', changed: false };
    return null;
  } } });
  const result = await bridge.handle({ id: 1, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_apply', arguments: { commands: [{}] } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.result.isError, true);
  assert.deepEqual(reports.map(item => [item.operation, item.outcome]), [['apply', 'failure']]);
});

test('an apply started before consent is never counted after re-enabling', async () => {
  const reports = [];
  let resolveWrite;
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => { reports.push(JSON.parse(options.body)); }, writeSettings: async () => { if (resolveWrite) await new Promise(resolve => { resolveWrite = resolve; }); } });
  await telemetry.start(); await telemetry.setEnabled(true);
  let polls = 0;
  const bridge = createMcpBridge({ configPath: join('/tmp', `pixelwall-mcp-test-${Date.now()}-6.json`), telemetry, webContents: { executeJavaScript: async source => {
    if (source.includes('api["apply"]')) return { operationId: 'old-1', status: 'queued' };
    if (source.includes('api["operation"]')) return ++polls > 1 ? { operationId: 'old-1', status: 'completed', changed: true } : { operationId: 'old-1', status: 'running' };
    return null;
  } } });
  await bridge.handle({ id: 1, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_apply', arguments: { commands: [{}], wait: false } } });
  await telemetry.setEnabled(false);
  await telemetry.setEnabled(true);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(reports.filter(item => item.operation === 'apply').length, 0);
});

test('a completed old requestKey cannot backfill when retried after opt-in', async () => {
  const reports = [];
  const telemetry = createDesktopAutomationTelemetry({ packaged: true, version: '0.5.0', fetchImpl: async (_url, options) => { reports.push(JSON.parse(options.body)); } });
  await telemetry.start();
  let calls = 0;
  const bridge = createMcpBridge({ configPath: join('/tmp', `pixelwall-mcp-test-${Date.now()}-7.json`), telemetry, webContents: { executeJavaScript: async source => {
    if (source.includes('api["apply"]')) { calls += 1; return { operationId: 'same-1', status: 'completed', changed: true }; }
    return null;
  } } });
  await bridge.handle({ id: 1, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_apply', arguments: { commands: [{}], wait: false, requestKey: 'retry-1' } } });
  await telemetry.setEnabled(true);
  await bridge.handle({ id: 2, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_apply', arguments: { commands: [{}], wait: false, requestKey: 'retry-1' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(reports.filter(item => item.operation === 'apply').length, 0);
});
