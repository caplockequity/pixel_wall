#!/usr/bin/env node
/** Explicit, isolated MCP reporting validation; never targets the user's app. */
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (['--run-id', '--artifacts', '--asar', '--electron'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
  else throw new Error('Usage: test-mcp-live-telemetry.mjs --run-id UUID --artifacts NEW_DIR --asar APP_ASAR --electron ELECTRON [--live]');
}
const marker = options['run-id'];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(marker || '') || !options.artifacts || !options.asar || !options.electron) throw new Error('A valid run ID, new artifact directory, released app.asar, and Electron executable are required.');
const out = resolve(options.artifacts), repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asar = resolve(options.asar), electron = resolve(options.electron), live = !!options.live;
const drive = '/Volumes/DevStorage';
if (!out.startsWith(drive + '/Builds/')) throw new Error('Place validation artifacts under mounted DevStorage/Builds.');
if ((await stat(drive)).dev === (await stat('/Volumes')).dev) throw new Error('DevStorage must be mounted.');
await access(drive, constants.W_OK);
await access(asar, constants.R_OK);
await access(electron, constants.X_OK);
if (live && (process.env.PIXELWALL_TELEMETRY_DISABLED === '1' || process.env.DO_NOT_TRACK === '1')) throw new Error('Live validation refused: an existing environment opt-out is active.');
await mkdir(dirname(out), { recursive: true });
await mkdir(out); // Deliberately reject an existing run directory.
const fixture = join(out, 'fixture'), profile = join(out, 'profile');
await mkdir(fixture);
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'pixelwall-telemetry-validation', main: join(repo, 'scripts/mcp-electron-fixture-main.mjs'), type: 'module' }));
let child, timer, forceTimer;
const stop = () => {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  forceTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }, 1000);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
let code = 1;
try {
  const env = { ...process.env, PIXELWALL_FIXTURE_OUTPUT: out, PIXELWALL_FIXTURE_ASAR: asar, PIXELWALL_FIXTURE_NODE: process.execPath, PIXELWALL_TELEMETRY_TEST_RUN: marker, PIXELWALL_FIXTURE_LIVE: live ? '1' : '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, ['.'], { cwd: fixture, env, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
  code = await new Promise((done, reject) => {
    timer = setTimeout(stop, 45000);
    child.once('error', reject);
    child.once('exit', (status, signal) => done(status ?? (signal ? 1 : 0)));
  });
  const receipt = JSON.parse(await readFile(join(out, 'receipts.json'), 'utf8'));
  if (code !== 0 || receipt.status !== 'passed' || receipt.marker !== marker) throw new Error('MCP validation failed; inspect its local receipts.');
  process.stdout.write(JSON.stringify({ status: 'passed', live, marker, output: join(out, 'receipts.json'), operations: receipt.telemetry.map(x => ({ operation: x.operation, status: x.http_status })), png: receipt.png }) + '\n');
} finally {
  clearTimeout(timer); clearTimeout(forceTimer);
  // Only this detached process group belongs to the fixture.
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* No task-owned children remain. */ } }
  await rm(profile, { recursive: true, force: true });
  await rm(join(out, 'mcp.json'), { force: true });
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
process.exitCode = code;
