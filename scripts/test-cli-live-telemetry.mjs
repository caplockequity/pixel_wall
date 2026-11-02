#!/usr/bin/env node
/**
 * Run a real packaged CLI edit/export smoke test.
 *
 * Dry mode (the default) disables network telemetry and is safe to run while
 * developing. Pass --live only after the production ingestion route accepts
 * test_run; the UUID marker keeps these events out of production dashboards.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { readPng } from '../app/formats.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const usage = () => { throw new Error('Usage: node scripts/test-cli-live-telemetry.mjs --run-id UUID --artifacts DIR [--cli FILE] [--live]'); };
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const runId = value('--run-id');
const artifactRoot = value('--artifacts');
if (!runId || !UUID.test(runId) || !artifactRoot) usage();
const live = args.includes('--live');
const cli = resolve(value('--cli') || join(artifactRoot, 'cli', 'pixelwall.mjs'));
const root = resolve(artifactRoot);
if (existsSync(root)) throw new Error(`Artifact directory already exists; choose a new path: ${root}`);
await mkdir(root, { recursive: true });
if (!existsSync(cli)) throw new Error(`Packaged CLI not found: ${cli}`);

if (live && (process.env.PIXELWALL_TELEMETRY_DISABLED === '1' || process.env.DO_NOT_TRACK === '1')) throw new Error('Live mode refused because a telemetry opt-out is already set in the parent environment.');

const project = join(root, 'smoke.pixelwall');
const commands = join(root, 'smoke-commands.json');
const output = join(root, 'smoke.png');
const log = join(root, 'cli-smoke.log');

const environment = {
  ...process.env,
  PIXELWALL_TELEMETRY_TEST_RUN: runId,
  PIXELWALL_TELEMETRY_TEST_LOG: '1',
  PIXELWALL_CLI_TELEMETRY_PATH: join(root, 'cli-telemetry.json'),
};
if (!live) environment.PIXELWALL_TELEMETRY_DISABLED = '1';

const run = (operation, cliArgs) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [cli, ...cliArgs], { env: environment, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`CLI ${operation} timed out after 30 seconds.`)); }, 30000);
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => { clearTimeout(timeout); resolveRun({ operation, code, stdout, stderr }); });
});

const preflight = await run('telemetry-status', ['--telemetry-status']);
if (preflight.code !== 0) throw new Error(`CLI telemetry status failed: ${preflight.stderr}`);
let status;
try { status = JSON.parse(preflight.stdout); } catch { throw new Error('CLI telemetry status was not valid JSON.'); }
if (status.testReportingVersion !== 1 || status.testRun !== runId || status.packaged !== true) throw new Error('CLI preflight did not recognize the requested test run marker. No smoke operations were started.');
if (live && status.enabled !== true) throw new Error('CLI preflight says reporting is disabled; no live operations were started.');
await writeFile(commands, JSON.stringify([{ type: 'draw.rect', x: 1, y: 1, width: 6, height: 6, color: '#ff00ffff', filled: true }]) + '\n');

const records = [];
records.push(await run('new', ['new', '--width', '8', '--height', '8', '--name', 'Telemetry smoke', '--out', project]));
records.push(await run('apply', ['apply', project, '--commands', commands, '--out', project]));
records.push(await run('export', ['export', project, '--format', 'png', '--out', output, '--verify']));
const verify = await run('verify', ['verify', output]);
records.push(verify);
if (records.some(item => item.code !== 0)) throw new Error(`CLI smoke command failed: ${records.find(item => item.code !== 0).operation}`);
const verification = JSON.parse(verify.stdout);
if (verification.valid !== true || verification.kind !== 'image' || verification.width !== 8 || verification.height !== 8) throw new Error('CLI smoke output did not pass image verification.');
const bytes = await readFile(output);
const image = readPng(bytes);
if (bytes.length < 70 || image.width !== 8 || image.height !== 8 || image.rgba[0] !== 0 || image.rgba[3] !== 0) throw new Error('CLI smoke output failed corner-pixel validation.');
const center = (4 * image.width + 4) * 4;
if (image.rgba[center] !== 255 || image.rgba[center + 1] !== 0 || image.rgba[center + 2] !== 255 || image.rgba[center + 3] !== 255) throw new Error('CLI smoke output failed edited-pixel validation.');
if (live) {
  for (const item of records) {
    const matches = item.stderr.split('\n').filter(line => line.includes(`PixelWall telemetry test: operation=${item.operation} status=`));
    if (matches.length !== 1 || !matches[0].endsWith('status=204')) throw new Error(`Expected exactly one HTTP 204 telemetry receipt for ${item.operation}.`);
  }
}
const text = records.map(item => `--- ${item.operation} exit=${item.code} ---\n${item.stdout}${item.stderr}`).join('\n');
const transport = live ? 'live' : 'dry-run (telemetry disabled; no production requests)';
await writeFile(log, `run_id=${runId}\nmode=${transport}\ncli=${cli}\noutput=${output}\npreflight=${JSON.stringify(status)}\n${text}`);
process.stdout.write(JSON.stringify({ run_id: runId, mode: transport, cli, artifact_dir: root, preflight: status, operations: records.map(item => ({ operation: item.operation, exit_code: item.code, telemetry_status_lines: item.stderr.split('\n').filter(line => line.includes('PixelWall telemetry test:')) })), output: { file: output, bytes: bytes.length, valid: verification.valid, width: image.width, height: image.height, corner_alpha: image.rgba[3], edited_pixel: image.rgba.slice(center, center + 4) }, log }, null, 2) + '\n');
