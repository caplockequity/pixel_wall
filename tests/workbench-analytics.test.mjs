import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchAnalytics, workbenchShape, analyticsFormat } from '../app/workbench-analytics.mjs';

function setup(options = {}) {
  let consent = options.consent ?? true, time = 10;
  const events = [];
  const doc = {
    width: 64, height: 32, colorMode: 'indexed', name: 'Secret project', id: 'private-id',
    frames: [{ name: 'Secret frame', cels: { pixels: 'private artwork' } }],
    layers: [{ name: 'Secret layer', type: 'reference' }], clips: [{ name: 'Secret animation' }], slices: [],
    metadata: { license: 'PW2.private', url: 'https://private.example/?secret=1' },
  };
  const analytics = createWorkbenchAnalytics({
    capture: (event, properties) => events.push({ event, properties }),
    consented: () => consent,
    getDocument: () => doc,
    now: () => time,
    ...options,
  });
  return { analytics, events, consent: value => { consent = value; }, time: value => { time = value; }, doc };
}

test('activation counts changed artwork once; repeated strokes do not generate repeated usage', () => {
  const { analytics, events } = setup();
  analytics.committed({ type: 'draw.stroke' }, false);
  analytics.committed({ type: 'document.update', patch: { name: 'Private name' } }, true);
  analytics.committed({ type: 'layer.update', patch: { name: 'Private layer' } }, true);
  assert.equal(events.length, 0);
  for (let i = 0; i < 1000; i++) analytics.committed({ type: 'draw.stroke', points: [{ x: i, color: '#fff' }] }, true);
  analytics.committed({ type: 'draw.stroke', erase: true }, true);
  assert.deepEqual(events.map(({ event }) => event), ['editor_activated', 'editor_tool_used', 'editor_tool_used']);
  assert.deepEqual(events.filter(({ event }) => event === 'editor_tool_used').map(({ properties }) => properties.tool_family), ['drawing', 'erase']);
});

test('visits and tool deduplication are not consumed before consent; no backfill occurs', () => {
  const { analytics, events, consent } = setup({ consent: false });
  analytics.loaded('library');
  analytics.committed({ type: 'draw.stroke' }, true);
  assert.deepEqual(events, []);
  consent(true);
  assert.deepEqual(events, []);
  analytics.committed({ type: 'draw.fill' }, true);
  assert.deepEqual(events.map(({ event }) => event), ['editor_activated', 'editor_tool_used']);
  analytics.committed({ type: 'draw.stroke' }, true);
  assert.equal(events.at(-1).properties.tool_family, 'drawing');
});

test('large scripted batches emit one activation and only finite used families', () => {
  const { analytics, events } = setup();
  const commands = Array.from({ length: 2000 }, () => ({ type: 'draw.stroke', secret: 'Private drawing data' }));
  analytics.committed(commands, true);
  analytics.automation('apply', commands.length);
  assert.equal(events.length, 3);
  assert.equal(events.at(-1).properties.command_count, 2000);
  analytics.automation('inspect');
  analytics.automation('preview');
  assert.equal(events.length, 3);
});

test('unknown commands and user metadata cannot enter capture properties', () => {
  const { analytics, events } = setup();
  analytics.committed({ type: 'Private project.name', label: 'private', code: 'private' }, true);
  assert.deepEqual(events, []);
  analytics.committed({ type: 'batch', commands: [{ type: 'draw.text', text: 'Secret text', color: '#badbad' }] }, true);
  analytics.imported('Private kind', 'private.filename', 1);
  analytics.recovery('restore', 'failed', { code: 'PW2.private', message: 'my private file was missing' });
  const encoded = JSON.stringify(events);
  for (const secret of ['Secret', 'Private', 'PW2', '#badbad', 'private.example', 'private-id', 'filename']) assert.ok(!encoded.includes(secret), secret);
  assert.equal(events.at(-1).properties.reason, 'storage_failed');
  assert.equal(events.find(({ event }) => event === 'import_completed').properties.format, 'other');
});

test('repeated autosave errors are transition-deduplicated and recovery can repeat only after a new failure', () => {
  const { analytics, events } = setup();
  analytics.saveResult();
  for (let i = 0; i < 50; i++) analytics.saveResult({ code: 'CONFLICT', message: 'Secret window' });
  analytics.saveResult();
  analytics.saveResult();
  analytics.saveResult({ name: 'QuotaExceededError' });
  assert.deepEqual(events.map(({ event }) => event), ['autosave_failed', 'autosave_recovered', 'autosave_failed']);
  assert.deepEqual(events.map(({ properties }) => properties.reason), ['conflict', undefined, 'quota_exceeded']);
});

test('storage problems during denied consent are not reported retrospectively as recovered', () => {
  const { analytics, events, consent } = setup();
  analytics.saveResult({ code: 'CONFLICT' });
  consent(false);
  analytics.saveResult({ code: 'CONFLICT' });
  consent(true);
  analytics.saveResult();
  assert.equal(events.length, 1);
});

test('export outcomes distinguish Pro blocks, encoding failures, and generated artifacts without names', () => {
  const { analytics, events, time } = setup();
  const blocked = analytics.exportStarted('gif');
  time(51);
  analytics.exportFinished(blocked, { name: 'ProExportRequired', message: 'Private license' });
  analytics.exportFinished(analytics.exportStarted('png'), { message: 'my-private-file.png' });
  analytics.exportFinished(analytics.exportStarted('aseprite'));
  assert.deepEqual(events.map(({ event }) => event), [
    'export_started', 'export_blocked', 'export_started', 'export_failed', 'export_started', 'export_completed',
  ]);
  assert.equal(events[1].properties.duration_ms, 41);
  assert.equal(events[1].properties.reason, 'pro_required');
  assert.ok(!JSON.stringify(events).includes('Private'));
  assert.ok(!JSON.stringify(events).includes('my-private-file'));
});

test('an export that starts without permission cannot be backfilled after consent', () => {
  const { analytics, events, consent } = setup({ consent: false });
  const attempt = analytics.exportStarted('png');
  consent(true);
  analytics.exportFinished(attempt);
  assert.equal(events.length, 0);
  const next = analytics.exportStarted('png');
  consent(false);
  analytics.exportFinished(next);
  assert.deepEqual(events.map(({ event }) => event), ['export_started']);
});

test('sheet import has a separate explicit completion milestone and fixed safe format', () => {
  const { analytics, events } = setup();
  assert.equal(events.length, 0);
  analytics.imported('sheet', 'png', 1, 2);
  analytics.imported('sheet', 'png', 1, 0, true);
  assert.deepEqual(events.map(({ event }) => event), ['import_completed', 'import_failed']);
  assert.equal(events[0].properties.warning_count, 2);
  assert.equal(analyticsFormat('ase'), 'aseprite');
});

test('shape preserves rectangular canvas and known counters, never document data', () => {
  const { doc } = setup();
  assert.deepEqual(workbenchShape(doc), {
    editor_variant: 'workbench', canvas_width: 64, canvas_height: 32,
    frame_count: 1, layer_count: 1, clip_count: 1, slice_count: 0,
    color_mode: 'indexed', has_reference: true,
  });
});

test('all reporting methods tolerate failed capture or unavailable analytics', () => {
  for (const broken of [
    { capture: () => { throw Error('capture failed'); } },
    { consented: () => { throw Error('consent unavailable'); } },
    { getDocument: () => { throw Error('document unavailable'); } },
  ]) {
    const { analytics } = setup(broken);
    assert.doesNotThrow(() => {
      analytics.loaded('new');
      analytics.committed({ type: 'draw.fill' }, true);
      analytics.saveResult({ code: 'CONFLICT' });
      analytics.imported('document', 'png', 1);
      analytics.exportFinished(analytics.exportStarted('png'));
      analytics.project('new', 'completed');
      analytics.recovery('view', 'completed');
      analytics.automation('apply', 1);
    });
  }
});

test('granting consent can describe the ready editor without recovering earlier edits', () => {
  const { analytics, events, consent } = setup({ consent: false });
  analytics.loaded('library');
  analytics.committed({ type: 'draw.stroke' }, true);
  consent(true);
  analytics.consentChanged();
  analytics.consentChanged();
  assert.deepEqual(events.map(({ event }) => event), ['editor_loaded']);
  analytics.committed({ type: 'draw.fill' }, true);
  assert.deepEqual(events.map(({ event }) => event), ['editor_loaded', 'editor_activated', 'editor_tool_used']);
});
