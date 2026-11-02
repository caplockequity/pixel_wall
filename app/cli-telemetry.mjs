/** Best-effort, anonymous usage reporting for the packaged CLI only. */
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, platform, arch } from 'node:os';

const ENDPOINT = 'https://www.pixelwall.dev/api/cli-traffic';
const VERSION = process.env.PIXELWALL_CLI_VERSION || '0.0.0';
const OPERATIONS = new Set(['new', 'inspect', 'commands', 'capabilities', 'doctor', 'plan', 'verify', 'apply', 'script', 'profile', 'render', 'export', 'import', 'import_sequence']);
const FORMATS = new Set(['png', 'bmp', 'tga', 'gif', 'sheet', 'atlas', 'zip', 'ase', 'aseprite', 'pixelwall', 'json']);
const PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const ARCHES = new Set(['arm64', 'x64', 'ia32']);
const WRITE_OPERATIONS = new Set(['new', 'apply', 'script', 'profile', 'render', 'export', 'import', 'import_sequence']);
const VERIFY_OPERATIONS = new Set(['verify', 'render', 'export']);

const packaged = () => process.env.PIXELWALL_PACKAGED_CLI === '1';
const disabledByEnvironment = () => process.env.PIXELWALL_TELEMETRY_DISABLED === '1' || process.env.DO_NOT_TRACK === '1';
const preferencePath = () => process.env.PIXELWALL_CLI_TELEMETRY_PATH || join(homedir(), '.pixelwall', 'cli-telemetry.json');
const day = () => new Date().toISOString().slice(0, 10);
const bucket = ms => ms < 100 ? 'under_100ms' : ms < 1000 ? '100ms_1s' : ms < 10000 ? '1s_10s' : 'over_10s';
const safePlatform = () => PLATFORMS.has(platform()) ? platform() : 'other';
const safeArch = () => ARCHES.has(arch()) ? arch() : 'other';

async function readPreference() {
  try {
    if ((await stat(preferencePath())).size > 4096) return { unavailable: true };
    const value = JSON.parse(await readFile(preferencePath(), 'utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') return { unavailable: true };
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return { unavailable: true };
    if (value.disclosed !== undefined && typeof value.disclosed !== 'boolean') return { unavailable: true };
    if (value.lastUsageDay !== undefined && (typeof value.lastUsageDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.lastUsageDay))) return { unavailable: true };
    return value;
  } catch (error) { return error?.code === 'ENOENT' ? {} : { unavailable: true }; }
}
async function writePreference(value) {
  const path = preferencePath(), temp = `${path}.${process.pid}.tmp`;
  try { await mkdir(dirname(path), { recursive: true }); await writeFile(temp, JSON.stringify(value) + '\n', { mode: 0o600 }); await rename(temp, path); return true; } catch { await unlink(temp).catch(() => {}); return false; }
}
async function withPreferenceLock(callback) {
  const path = preferencePath(), lockPath = `${path}.lock`;
  let lock;
  try { await mkdir(dirname(path), { recursive: true }); } catch { return null; }
  for (let attempt = 0; attempt < 20 && !lock; attempt += 1) {
    try { lock = await open(lockPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') return null;
      try { if (Date.now() - (await stat(lockPath)).mtimeMs > 10000) await unlink(lockPath); } catch { /* another process may own or remove it */ }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  if (!lock) return null;
  try {
    return await callback();
  } finally {
    await lock?.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}
async function reserveUsageDay() {
  return withPreferenceLock(async () => {
    const pref = await readPreference(), today = day();
    if (pref.unavailable || pref.enabled === false) return null;
    const usageDay = !pref.lastUsageDay ? 'first' : pref.lastUsageDay >= today ? undefined : 'returning';
    if (usageDay && !await writePreference({ ...pref, lastUsageDay: today })) return null;
    return { usageDay };
  });
}

export async function telemetryStatus() {
  const pref = await readPreference();
  return { packaged: packaged(), enabled: packaged() && !disabledByEnvironment() && !pref.unavailable && pref.enabled !== false, disabledByEnvironment: disabledByEnvironment(), storageAvailable: !pref.unavailable };
}

export function isReportableOperation(operation) { return OPERATIONS.has(operation); }

export async function announceCliTelemetry() {
  if (!packaged() || disabledByEnvironment()) return false;
  return withPreferenceLock(async () => {
    const pref = await readPreference();
    if (pref.unavailable || pref.enabled === false || pref.disclosed) return false;
    process.stderr.write('PixelWall: anonymous CLI usage reporting is enabled by default for this packaged build. Use --no-telemetry or PIXELWALL_TELEMETRY_DISABLED=1 to disable.\n');
    return writePreference({ ...pref, disclosed: true });
  });
}

export async function setTelemetryEnabled(enabled) {
  const saved = await withPreferenceLock(async () => {
    const pref = await readPreference();
    return writePreference({ ...(pref.unavailable ? {} : pref), enabled: Boolean(enabled) });
  });
  if (!saved) return { packaged: packaged(), enabled: false, disabledByEnvironment: disabledByEnvironment(), storageAvailable: false };
  return telemetryStatus();
}

export async function reportCliOperation({ operation, outcome, format, changed, wrote_files, verified, durationMs = 0 } = {}) {
  if (!packaged() || disabledByEnvironment()) return false;
  const pref = await readPreference();
  if (pref.unavailable || pref.enabled === false) return false;
  if (!OPERATIONS.has(operation) || !['success', 'failure', 'blocked'].includes(outcome)) return false;
  const payload = { event: 'cli_usage_operation', version: VERSION, operation, outcome, platform: safePlatform(), arch: safeArch(), duration_bucket: bucket(durationMs) };
  if (['export', 'render', 'plan'].includes(operation) && FORMATS.has(format)) payload.format = format;
  if (outcome === 'success' && typeof changed === 'boolean' && ['apply', 'script', 'profile'].includes(operation)) payload.changed = changed;
  if (outcome === 'success' && WRITE_OPERATIONS.has(operation) && typeof wrote_files === 'boolean') payload.wrote_files = wrote_files;
  if (outcome === 'success' && VERIFY_OPERATIONS.has(operation) && typeof verified === 'boolean') payload.verified = verified;
  const reservation = await reserveUsageDay();
  if (!reservation) return false;
  if (reservation.usageDay) payload.usage_day = reservation.usageDay;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  timer.unref?.();
  try {
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: controller.signal });
    if (!response.ok) return false;
    return true;
  } catch { return false; } finally { clearTimeout(timer); }
}

export function isTelemetryPackaged() { return packaged(); }
