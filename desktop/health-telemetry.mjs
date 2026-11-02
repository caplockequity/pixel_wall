/** Bounded, anonymous packaged-app health; the shared reporting choice is authoritative. */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OPERATIONS = new Set(['launch', 'update_download', 'update_install_attempt', 'update_failure']);
const OUTCOMES = new Set(['success', 'failure', 'cancelled']);
const FAILURE_CATEGORIES = new Set(['download', 'install', 'restart', 'unknown']);
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const PLATFORM = new Set(['darwin', 'win32', 'linux', 'other']);
const ARCH = new Set(['arm64', 'x64', 'ia32', 'other']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const version = value => typeof value === 'string' && VERSION.test(value) ? value : '0.0.0';
function clean(value) {
  return { schemaVersion: 1, enabled: value?.enabled === true,
    ...(DAY.test(value?.usageDay) ? { usageDay: value.usageDay } : {}),
    ...(VERSION.test(value?.lastVersion) ? { lastVersion: value.lastVersion } : {}),
    ...(VERSION.test(value?.pendingVersion) ? { pendingVersion: value.pendingVersion } : {}) };
}

export function createDesktopHealthTelemetry({ version: appVersion, packaged = false,
  endpoint = 'https://www.pixelwall.dev/api/desktop-health', fetchImpl = globalThis.fetch,
  readSettings = async () => ({}), writeSettings = async () => {}, isReportingEnabled,
  platform = process.platform, arch = process.arch, env = process.env, now = () => new Date(),
} = {}) {
  const forcedOff = env?.PIXELWALL_TELEMETRY_DISABLED === '1' || env?.DO_NOT_TRACK === '1';
  let settings = clean({}), initialized = false, disposed = false;
  const pending = new Map(), reported = new Set();
  const enabled = () => initialized && packaged && !disposed && !forcedOff && settings.enabled && (typeof isReportingEnabled !== 'function' || isReportingEnabled() === true);
  async function start() {
    if (initialized) return { ...settings };
    try { settings = clean(await readSettings()); } catch { settings = clean({}); }
    if (forcedOff) settings.enabled = false;
    initialized = true;
    return { ...settings };
  }
  async function persist() { try { await writeSettings({ ...settings }); return true; } catch { return false; } }
  function abortPending() { for (const controller of pending.values()) controller.abort(); }
  function report(input = {}) {
    if (!enabled() || typeof fetchImpl !== 'function' || pending.size >= 4) return false;
    if (!OPERATIONS.has(input.operation) || !OUTCOMES.has(input.outcome)) return false;
    if (input.operation === 'update_failure' ? !['failure', 'cancelled'].includes(input.outcome) || !FAILURE_CATEGORIES.has(input.failure_category) : input.outcome !== 'success' || input.failure_category !== undefined) return false;
    // Updater callbacks already correspond to distinct attempts. Only a launch
    // or an explicitly supplied process-local key is deduplicated here.
    const key = input.dedupeKey ?? (input.operation === 'launch' ? 'launch' : null);
    if (key && reported.has(key)) return false;
    const v = version(appVersion), date = new Date(typeof now === 'function' ? now() : now);
    if (!Number.isFinite(date.getTime())) return false;
    const today = date.toISOString().slice(0, 10);
    const usageDay = !DAY.test(settings.usageDay) ? 'first' : settings.usageDay < today ? 'returning' : null;
    const launchKind = input.operation === 'launch'
      ? settings.pendingVersion === v ? 'after_update' : !settings.lastVersion ? 'first' : settings.lastVersion === v ? 'same_version' : 'version_changed'
      : null;
    const payload = { event: 'desktop_app_health', operation: input.operation, outcome: input.outcome, version: v,
      platform: PLATFORM.has(platform) ? platform : 'other', arch: ARCH.has(arch) ? arch : 'other',
      ...(usageDay ? { usage_day: usageDay } : {}), ...(launchKind ? { launch_kind: launchKind } : {}),
      ...(input.operation !== 'launch' && VERSION.test(input.target_version) ? { target_version: input.target_version } : {}),
      ...(input.operation === 'update_failure' ? { failure_category: input.failure_category } : {}) };
    if (key) { reported.add(key); if (reported.size > 128) reported.delete(reported.values().next().value); }
    settings.usageDay = today;
    if (input.operation === 'launch') { settings.lastVersion = v; delete settings.pendingVersion; }
    void persist();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500); timer.unref?.();
    const request = Promise.resolve().then(() => {
      if (!enabled() || controller.signal.aborted) return;
      return fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), redirect: 'error', signal: controller.signal });
    }).catch(() => {}).finally(() => { clearTimeout(timer); pending.delete(request); });
    pending.set(request, controller);
    return true;
  }
  return {
    start, report, isEnabled: enabled, getSettings: () => ({ ...settings }),
    async setPendingVersion(value) { if (!enabled() || !VERSION.test(value)) return false; settings.pendingVersion = value; return persist(); },
    async clearPendingVersion() { delete settings.pendingVersion; return persist(); },
    async setEnabled(value) {
      if (!initialized) await start();
      settings.enabled = Boolean(value) && !forcedOff;
      if (!settings.enabled) abortPending();
      if (!await persist()) { settings.enabled = false; abortPending(); }
      return { ...settings };
    },
    async flush(timeoutMs = 300) {
      let timer;
      try { await Promise.race([Promise.allSettled([...pending.keys()]), new Promise(resolve => { timer = setTimeout(resolve, Math.min(500, Math.max(0, timeoutMs))); })]); }
      finally { clearTimeout(timer); }
    },
    dispose() { disposed = true; abortPending(); },
  };
}

export function createDesktopHealthSettingsStore(file) {
  let writing = Promise.resolve();
  return {
    async readSettings() {
      try { if ((await stat(file)).size > 4096) return {}; return JSON.parse(await readFile(file, 'utf8')); }
      catch { return {}; }
    },
    writeSettings(value) {
      const snapshot = JSON.stringify(clean(value));
      writing = writing.catch(() => {}).then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
      return writing;
    },
  };
}
export { ARCH, DAY, FAILURE_CATEGORIES, OPERATIONS, OUTCOMES, PLATFORM, VERSION };
