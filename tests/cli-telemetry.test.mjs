import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('packaged CLI telemetry labels first operation, omits same-day repeat, and labels later days returning', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pixelwall-cli-telemetry-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(dir, { recursive: true, force: true }); });
  const previous = { packaged: process.env.PIXELWALL_PACKAGED_CLI, path: process.env.PIXELWALL_CLI_TELEMETRY_PATH, fetch: globalThis.fetch };
  t.after(() => { if (previous.packaged === undefined) delete process.env.PIXELWALL_PACKAGED_CLI; else process.env.PIXELWALL_PACKAGED_CLI = previous.packaged; if (previous.path === undefined) delete process.env.PIXELWALL_CLI_TELEMETRY_PATH; else process.env.PIXELWALL_CLI_TELEMETRY_PATH = previous.path; globalThis.fetch = previous.fetch; });
  process.env.PIXELWALL_PACKAGED_CLI = '1';
  process.env.PIXELWALL_CLI_TELEMETRY_PATH = join(dir, 'state.json');
  const payloads = [];
  globalThis.fetch = async (_url, init) => { payloads.push(JSON.parse(init.body)); return { ok: true }; };
  const telemetry = await import(`../app/cli-telemetry.mjs?test=${Date.now()}`);
  await telemetry.announceCliTelemetry();
  await telemetry.reportCliOperation({ operation: 'apply', outcome: 'success', changed: true, wrote_files: true, durationMs: 120 });
  await telemetry.reportCliOperation({ operation: 'render', outcome: 'success', wrote_files: true, durationMs: 120 });
  assert.equal(payloads[0].usage_day, 'first');
  assert.equal('usage_day' in payloads[1], false);
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  await writeFile(join(dir, 'state.json'), JSON.stringify({ ...state, lastUsageDay: '2000-01-01' }));
  await telemetry.reportCliOperation({ operation: 'verify', outcome: 'success', verified: true, durationMs: 120 });
  assert.equal(payloads[2].usage_day, 'returning');
  assert.equal(payloads[0].changed, true);
  assert.equal(payloads[0].wrote_files, true);
  assert.equal(payloads[2].verified, true);
});

test('telemetry control subcommands do not report', async () => {
  const { main } = await import('../app/cli.mjs');
  const previous = { packaged: process.env.PIXELWALL_PACKAGED_CLI, disabled: process.env.PIXELWALL_TELEMETRY_DISABLED, path: process.env.PIXELWALL_CLI_TELEMETRY_PATH };
  process.env.PIXELWALL_PACKAGED_CLI = '1';
  process.env.PIXELWALL_TELEMETRY_DISABLED = '1';
  process.env.PIXELWALL_CLI_TELEMETRY_PATH = join(tmpdir(), `pixelwall-cli-control-${Date.now()}.json`);
  try { await main(['telemetry', 'status']); } finally { if (previous.packaged === undefined) delete process.env.PIXELWALL_PACKAGED_CLI; else process.env.PIXELWALL_PACKAGED_CLI = previous.packaged; if (previous.disabled === undefined) delete process.env.PIXELWALL_TELEMETRY_DISABLED; else process.env.PIXELWALL_TELEMETRY_DISABLED = previous.disabled; if (previous.path === undefined) delete process.env.PIXELWALL_CLI_TELEMETRY_PATH; else process.env.PIXELWALL_CLI_TELEMETRY_PATH = previous.path; }
});

test('parallel reports reserve at most one daily marker', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pixelwall-cli-telemetry-parallel-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(dir, { recursive: true, force: true }); });
  const previous = { packaged: process.env.PIXELWALL_PACKAGED_CLI, path: process.env.PIXELWALL_CLI_TELEMETRY_PATH, fetch: globalThis.fetch };
  t.after(() => { if (previous.packaged === undefined) delete process.env.PIXELWALL_PACKAGED_CLI; else process.env.PIXELWALL_PACKAGED_CLI = previous.packaged; if (previous.path === undefined) delete process.env.PIXELWALL_CLI_TELEMETRY_PATH; else process.env.PIXELWALL_CLI_TELEMETRY_PATH = previous.path; globalThis.fetch = previous.fetch; });
  process.env.PIXELWALL_PACKAGED_CLI = '1'; process.env.PIXELWALL_CLI_TELEMETRY_PATH = join(dir, 'state.json');
  const payloads = []; globalThis.fetch = async (_url, init) => { payloads.push(JSON.parse(init.body)); await new Promise(resolve => setTimeout(resolve, 10)); return { ok: true }; };
  const telemetry = await import(`../app/cli-telemetry.mjs?parallel=${Date.now()}`);
  const results = await Promise.all([
    telemetry.reportCliOperation({ operation: 'new', outcome: 'success', wrote_files: true }),
    telemetry.reportCliOperation({ operation: 'render', outcome: 'success', wrote_files: true }),
  ]);
  assert.deepEqual(results.sort(), [true, true]);
  assert.equal(payloads.filter(item => item.usage_day === 'first').length, 1);
  assert.equal(payloads.filter(item => 'usage_day' in item).length, 1);
});

test('corrupt preference state fails closed without sending', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pixelwall-cli-telemetry-corrupt-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(dir, { recursive: true, force: true }); });
  const previous = { packaged: process.env.PIXELWALL_PACKAGED_CLI, path: process.env.PIXELWALL_CLI_TELEMETRY_PATH, fetch: globalThis.fetch };
  t.after(() => { if (previous.packaged === undefined) delete process.env.PIXELWALL_PACKAGED_CLI; else process.env.PIXELWALL_PACKAGED_CLI = previous.packaged; if (previous.path === undefined) delete process.env.PIXELWALL_CLI_TELEMETRY_PATH; else process.env.PIXELWALL_CLI_TELEMETRY_PATH = previous.path; globalThis.fetch = previous.fetch; });
  process.env.PIXELWALL_PACKAGED_CLI = '1'; process.env.PIXELWALL_CLI_TELEMETRY_PATH = join(dir, 'state.json');
  await writeFile(process.env.PIXELWALL_CLI_TELEMETRY_PATH, '{not-json');
  let sends = 0; globalThis.fetch = async () => { sends += 1; return { ok: true }; };
  const telemetry = await import(`../app/cli-telemetry.mjs?corrupt=${Date.now()}`);
  assert.equal((await telemetry.telemetryStatus()).enabled, false);
  assert.equal(await telemetry.reportCliOperation({ operation: 'new', outcome: 'success', wrote_files: true }), false);
  assert.equal(sends, 0);
});

test('valid UUID test-run marker is forwarded without changing normal payload fields', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pixelwall-cli-telemetry-test-marker-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(dir, { recursive: true, force: true }); });
  const previous = { packaged: process.env.PIXELWALL_PACKAGED_CLI, path: process.env.PIXELWALL_CLI_TELEMETRY_PATH, marker: process.env.PIXELWALL_TELEMETRY_TEST_RUN, fetch: globalThis.fetch };
  t.after(() => {
    if (previous.packaged === undefined) delete process.env.PIXELWALL_PACKAGED_CLI; else process.env.PIXELWALL_PACKAGED_CLI = previous.packaged;
    if (previous.path === undefined) delete process.env.PIXELWALL_CLI_TELEMETRY_PATH; else process.env.PIXELWALL_CLI_TELEMETRY_PATH = previous.path;
    if (previous.marker === undefined) delete process.env.PIXELWALL_TELEMETRY_TEST_RUN; else process.env.PIXELWALL_TELEMETRY_TEST_RUN = previous.marker;
    globalThis.fetch = previous.fetch;
  });
  process.env.PIXELWALL_PACKAGED_CLI = '1';
  process.env.PIXELWALL_CLI_TELEMETRY_PATH = join(dir, 'state.json');
  process.env.PIXELWALL_TELEMETRY_TEST_RUN = '123e4567-e89b-42d3-a456-426614174000';
  const payloads = [];
  globalThis.fetch = async (_url, init) => { payloads.push(JSON.parse(init.body)); return { ok: true }; };
  const telemetry = await import(`../app/cli-telemetry.mjs?marker=${Date.now()}`);
  assert.equal(await telemetry.reportCliOperation({ operation: 'apply', outcome: 'success', changed: true, wrote_files: true }), true);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].test_run, process.env.PIXELWALL_TELEMETRY_TEST_RUN);
  assert.equal(payloads[0].changed, true);
  assert.equal(payloads[0].wrote_files, true);
});

test('invalid or empty test-run marker fails closed without sending', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pixelwall-cli-telemetry-invalid-marker-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(dir, { recursive: true, force: true }); });
  const previous = { packaged: process.env.PIXELWALL_PACKAGED_CLI, path: process.env.PIXELWALL_CLI_TELEMETRY_PATH, marker: process.env.PIXELWALL_TELEMETRY_TEST_RUN, fetch: globalThis.fetch };
  t.after(() => {
    if (previous.packaged === undefined) delete process.env.PIXELWALL_PACKAGED_CLI; else process.env.PIXELWALL_PACKAGED_CLI = previous.packaged;
    if (previous.path === undefined) delete process.env.PIXELWALL_CLI_TELEMETRY_PATH; else process.env.PIXELWALL_CLI_TELEMETRY_PATH = previous.path;
    if (previous.marker === undefined) delete process.env.PIXELWALL_TELEMETRY_TEST_RUN; else process.env.PIXELWALL_TELEMETRY_TEST_RUN = previous.marker;
    globalThis.fetch = previous.fetch;
  });
  process.env.PIXELWALL_PACKAGED_CLI = '1';
  process.env.PIXELWALL_CLI_TELEMETRY_PATH = join(dir, 'state.json');
  let sends = 0;
  globalThis.fetch = async () => { sends += 1; return { ok: true }; };
  const telemetry = await import(`../app/cli-telemetry.mjs?invalid-marker=${Date.now()}`);
  for (const marker of ['not-a-uuid', '']) {
    process.env.PIXELWALL_TELEMETRY_TEST_RUN = marker;
    assert.equal(await telemetry.reportCliOperation({ operation: 'export', outcome: 'success', format: 'png', wrote_files: true }), false);
  }
  assert.equal(sends, 0);
});
