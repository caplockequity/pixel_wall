import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleCliTrafficRequest } from '../app/cli-traffic-core.mjs';

const cli = await import('../app/cli.mjs');

async function withTelemetry(t) {
  const root = await mkdtemp(join(tmpdir(), 'pixelwall-cli-main-'));
  const previous = {
    packaged: process.env.PIXELWALL_PACKAGED_CLI,
    state: process.env.PIXELWALL_CLI_TELEMETRY_PATH,
    disabled: process.env.PIXELWALL_TELEMETRY_DISABLED,
    dnt: process.env.DO_NOT_TRACK,
    fetch: globalThis.fetch,
    exitCode: process.exitCode,
  };
  const payloads = [];
  process.env.PIXELWALL_PACKAGED_CLI = '1';
  process.env.PIXELWALL_CLI_TELEMETRY_PATH = join(root, 'telemetry.json');
  delete process.env.PIXELWALL_TELEMETRY_DISABLED;
  delete process.env.DO_NOT_TRACK;
  globalThis.fetch = async (url, init) => {
    payloads.push(JSON.parse(init.body));
    const response = await handleCliTrafficRequest(new Request(url, init), {
      env: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'test-only-token', NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com' },
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    assert.equal(response.status, 204, 'the actual CLI payload must satisfy the production ingestion contract');
    return response;
  };
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (previous.packaged === undefined) delete process.env.PIXELWALL_PACKAGED_CLI; else process.env.PIXELWALL_PACKAGED_CLI = previous.packaged;
    if (previous.state === undefined) delete process.env.PIXELWALL_CLI_TELEMETRY_PATH; else process.env.PIXELWALL_CLI_TELEMETRY_PATH = previous.state;
    if (previous.disabled === undefined) delete process.env.PIXELWALL_TELEMETRY_DISABLED; else process.env.PIXELWALL_TELEMETRY_DISABLED = previous.disabled;
    if (previous.dnt === undefined) delete process.env.DO_NOT_TRACK; else process.env.DO_NOT_TRACK = previous.dnt;
    globalThis.fetch = previous.fetch;
    process.exitCode = previous.exitCode;
  });
  return { root, payloads };
}

test('main reports successful new, editable export, and verify with truthful file fields', async t => {
  const { root, payloads } = await withTelemetry(t);
  const project = join(root, 'sprite.pixelwall');
  const exported = join(root, 'sprite.json');
  await cli.main(['new', '--out', project]);
  await cli.main(['export', project, '--format', 'json', '--out', exported, '--verify']);
  await cli.main(['verify', exported]);
  assert.equal(payloads[0].operation, 'new');
  assert.equal(payloads[0].outcome, 'success');
  assert.equal(payloads[0].wrote_files, true);
  assert.equal(payloads[1].operation, 'export');
  assert.equal(payloads[1].format, 'json');
  assert.equal(payloads[1].wrote_files, true);
  assert.equal(payloads[1].verified, true);
  assert.equal(payloads[2].operation, 'verify');
  assert.equal(payloads[2].verified, true);
  assert.ok((await readFile(exported)).length > 0);
});

test('main reports failures but telemetry transport failures never change CLI result', async t => {
  const { root, payloads } = await withTelemetry(t);
  await assert.rejects(() => cli.main(['inspect', join(root, 'missing.pixelwall')]));
  assert.equal(payloads.at(-1).operation, 'inspect');
  assert.equal(payloads.at(-1).outcome, 'failure');

  globalThis.fetch = async () => { throw new Error('offline'); };
  const project = join(root, 'offline.pixelwall');
  await cli.main(['new', '--out', project]);
  assert.ok((await readFile(project)).length > 0);
});

test('help and explicit no-telemetry do not send reports', async t => {
  const { root, payloads } = await withTelemetry(t);
  await cli.main(['help']);
  await cli.main(['new', '--help']);
  await cli.main(['new', '--no-telemetry', '--out', join(root, 'quiet.pixelwall')]);
  assert.equal(payloads.length, 0);
});

test('environment switches, persisted opt-out, and source runs never report', async t => {
  const { root, payloads } = await withTelemetry(t);
  const run = () => cli.main(['commands']);
  process.env.DO_NOT_TRACK = '1'; await run(); delete process.env.DO_NOT_TRACK;
  process.env.PIXELWALL_TELEMETRY_DISABLED = '1'; await run(); delete process.env.PIXELWALL_TELEMETRY_DISABLED;
  delete process.env.PIXELWALL_PACKAGED_CLI; await run(); process.env.PIXELWALL_PACKAGED_CLI = '1';
  await writeFile(join(root, 'telemetry.json'), JSON.stringify({ enabled: false })); await run();
  assert.equal(payloads.length, 0);
});

test('actual edits and no-op edits differ, and doctor failures are counted as failures', async t => {
  const { root, payloads } = await withTelemetry(t);
  const project = join(root, 'sprite.pixelwall'), commands = join(root, 'commands.json');
  await cli.main(['new', '--out', project]);
  await writeFile(commands, '[]');
  await cli.main(['apply', project, '--commands', commands, '--out', project]);
  assert.equal(payloads.at(-1).changed, false);
  await writeFile(commands, JSON.stringify([{ type: 'document.resize', width: 16, height: 16 }]));
  await cli.main(['apply', project, '--commands', commands, '--out', project]);
  assert.equal(payloads.at(-1).changed, true);
  await cli.main(['doctor', '--export-folder', join(root, 'missing-folder')]);
  assert.equal(payloads.at(-1).operation, 'doctor');
  assert.equal(payloads.at(-1).outcome, 'failure');
});

test('skipping an empty export does not count a written or verified output', async t => {
  const { root, payloads } = await withTelemetry(t);
  const project = join(root, 'empty.pixelwall');
  await cli.main(['new', '--out', project]);
  await assert.rejects(cli.main(['export', project, '--format', 'png', '--out-dir', join(root, 'frames'), '--ignore-empty', '--verify']), /No frames matched/);
  assert.equal(payloads.at(-1).operation, 'export');
  assert.equal(payloads.at(-1).outcome, 'failure');
  assert.equal('wrote_files' in payloads.at(-1), false);
  assert.equal('verified' in payloads.at(-1), false);
});
