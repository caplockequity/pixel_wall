import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopHealthTelemetry } from '../desktop/health-telemetry.mjs';

test('health respects saved refusal and malformed settings stay disabled', async () => {
  for (const readSettings of [async () => ({ enabled: false }), async () => { throw Error('unreadable'); }]) {
    let calls = 0;
    const telemetry = createDesktopHealthTelemetry({ packaged: true, readSettings, fetchImpl: async () => { calls += 1; } });
    await telemetry.start();
    assert.equal(telemetry.isEnabled(), false);
    assert.equal(telemetry.report({ operation: 'launch', outcome: 'success' }), false);
    assert.equal(calls, 0);
  }
});

test('health emits one safe report per lifecycle transition and marks a verified pending update', async () => {
  const reports = [];
  const telemetry = createDesktopHealthTelemetry({ packaged: true, version: '0.6.4', readSettings: async () => ({ enabled: true }), writeSettings: async () => {}, now: () => new Date('2026-11-02T00:00:00Z'), fetchImpl: async (_url, init) => reports.push(JSON.parse(init.body)) });
  await telemetry.start();
  telemetry.setPendingVersion('0.6.4');
  assert.equal(telemetry.report({ operation: 'launch', outcome: 'success' }), true);
  assert.equal(telemetry.report({ operation: 'launch', outcome: 'success' }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reports[0].launch_kind, 'after_update');
  assert.equal(JSON.stringify(reports).includes('path'), false);
  assert.equal(JSON.stringify(reports).includes('email'), false);
});

test('health rejects unsupported lifecycle categories and tolerates transport failure', async () => {
  const telemetry = createDesktopHealthTelemetry({ packaged: true, readSettings: async () => ({ enabled: true }), fetchImpl: async () => { throw Error('private transport detail'); } });
  await telemetry.start();
  assert.equal(telemetry.report({ operation: 'update_failure', outcome: 'failure', failure_category: 'private' }), false);
  assert.equal(telemetry.report({ operation: 'update_failure', outcome: 'failure', failure_category: 'install' }), true);
});

test('health follows shared refusal and privacy environment even when its own file is missing', async () => {
  for (const env of [{ PIXELWALL_TELEMETRY_DISABLED: '1' }, { DO_NOT_TRACK: '1' }]) {
    let calls = 0;
    const telemetry = createDesktopHealthTelemetry({ packaged: true, env, readSettings: async () => ({ __missing: true, enabled: true }), fetchImpl: () => { calls += 1; throw Error('sync failure'); } });
    await telemetry.start();
    assert.equal(telemetry.isEnabled(), false);
    assert.equal(telemetry.report({ operation: 'launch', outcome: 'success' }), false);
    assert.equal(calls, 0);
  }
  const sharedOff = createDesktopHealthTelemetry({ packaged: true, readSettings: async () => ({ enabled: false }), fetchImpl: async () => {} });
  await sharedOff.start(); assert.equal(sharedOff.report({ operation: 'launch', outcome: 'success' }), false);
});

test('health dedupe is process-local and later launches report returning activity', async () => {
  let saved = { enabled: true }, calls = [];
  const first = createDesktopHealthTelemetry({ packaged: true, version: '0.6.4', readSettings: async () => saved, writeSettings: async value => { saved = value; }, now: () => new Date('2026-11-02T00:00:00Z'), fetchImpl: async (_url, init) => calls.push(JSON.parse(init.body)) });
  await first.start(); assert.equal(first.report({ operation: 'launch', outcome: 'success' }), true); assert.equal(first.report({ operation: 'launch', outcome: 'success' }), false);
  await new Promise(resolve => setImmediate(resolve));
  const second = createDesktopHealthTelemetry({ packaged: true, version: '0.6.4', readSettings: async () => saved, writeSettings: async value => { saved = value; }, now: () => new Date('2026-11-03T00:00:00Z'), fetchImpl: async (_url, init) => calls.push(JSON.parse(init.body)) });
  await second.start(); assert.equal(second.report({ operation: 'launch', outcome: 'success' }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2); assert.equal(calls[1].usage_day, 'returning');
});

test('health tolerates a failed preference write and synchronous transport throw', async () => {
  let calls = 0;
  const telemetry = createDesktopHealthTelemetry({ packaged: true, readSettings: async () => ({ enabled: true }), writeSettings: async () => { throw Error('disk full'); }, fetchImpl: () => { calls += 1; throw Error('offline'); } });
  await telemetry.start();
  assert.equal(telemetry.report({ operation: 'launch', outcome: 'success' }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('health disables immediately, aborts pending requests, and honors a shared reporting getter', async () => {
  let release, shared = true, aborted = false;
  const telemetry = createDesktopHealthTelemetry({ packaged: true, readSettings: async () => ({ enabled: true }), isReportingEnabled: () => shared, fetchImpl: async (_url, init) => { init.signal.addEventListener('abort', () => { aborted = true; }); await new Promise(resolve => { release = resolve; }); } });
  await telemetry.start();
  assert.equal(telemetry.report({ operation: 'launch', outcome: 'success' }), true);
  await new Promise(resolve => setImmediate(resolve));
  shared = false;
  assert.equal(telemetry.isEnabled(), false);
  await telemetry.setEnabled(false);
  assert.equal(aborted, true);
  release?.();
});

test('launch classification distinguishes first, manual version change, and verified update', async () => {
  let saved = { enabled: true }, reports = [];
  const make = (v, pending, day) => createDesktopHealthTelemetry({ packaged: true, version: v, readSettings: async () => ({ ...saved, ...(pending ? { pendingVersion: pending } : {}) }), writeSettings: async value => { saved = value; }, now: () => new Date(`${day}T00:00:00Z`), fetchImpl: async (_url, init) => reports.push(JSON.parse(init.body)) });
  const first = make('0.6.4', null, '2026-11-02'); await first.start(); first.report({ operation: 'launch', outcome: 'success' }); await new Promise(resolve => setImmediate(resolve));
  const changed = make('0.6.5', null, '2026-11-03'); await changed.start(); changed.report({ operation: 'launch', outcome: 'success' }); await new Promise(resolve => setImmediate(resolve));
  const updated = make('0.6.6', '0.6.6', '2026-11-04'); await updated.start(); updated.report({ operation: 'launch', outcome: 'success' }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports.map(x => x.launch_kind), ['first', 'version_changed', 'after_update']);
});
