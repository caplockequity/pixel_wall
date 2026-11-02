/** Anonymous telemetry for packaged desktop automation; enabled by default on first launch. */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OPERATIONS = new Set([
  'connect', 'apply', 'lua', 'color_profile', 'undo', 'redo', 'new_document',
  'open_project', 'import_project', 'save', 'export', 'validate',
  'capture_preview', 'preview', 'read_artifact', 'download_artifact',
  'remove_artifact', 'save_artifact',
]);
const OUTCOMES = new Set(['success', 'failure', 'cancelled', 'blocked', 'missing']);
const PREVIEW_KINDS = new Set(['frame', 'contact-sheet', 'comparison']);
const ARTIFACT_PERSISTENCE = new Set(['persisted', 'failed', 'not_requested']);
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MAX_IN_FLIGHT = 8;
const TIMEOUT_MS = 2500;
const SUPPORTED_FORMATS = new Set(['png', 'bmp', 'tga', 'project', 'aseprite', 'gif', 'sheet', 'zip']);
const PLATFORMS = new Set(['darwin', 'win32', 'linux', 'other']);
const ARCHITECTURES = new Set(['arm64', 'x64', 'ia32', 'other']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// A test run is an explicit, server-filterable classification. Treat any
// present but malformed value (including an empty string) as a privacy failure
// and disable reporting rather than risking a test event in production totals.
const TEST_RUN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function cleanSettings(value) {
  return { schemaVersion: 1, enabled: value?.enabled === true, ...(DAY.test(value?.usageDay) ? { usageDay: value.usageDay } : {}) };
}

function cleanVersion(value) {
  const version = typeof value === 'string' ? value.trim() : '';
  return VERSION.test(version) ? version : '0.0.0';
}

export function createDesktopAutomationTelemetry({
  version,
  packaged = false,
  endpoint = 'https://www.pixelwall.dev/api/desktop-traffic',
  fetchImpl = globalThis.fetch,
  readSettings = async () => ({}),
  writeSettings = async () => {},
  timers = globalThis,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  now = () => new Date(),
} = {}) {
  const testRunPresent = Object.prototype.hasOwnProperty.call(env || {}, 'PIXELWALL_TELEMETRY_TEST_RUN');
  const testRun = env?.PIXELWALL_TELEMETRY_TEST_RUN;
  const invalidTestRun = testRunPresent && (typeof testRun !== 'string' || !TEST_RUN.test(testRun));
  const forcedOff = env?.PIXELWALL_TELEMETRY_DISABLED === '1' || env?.DO_NOT_TRACK === '1' || invalidTestRun;
  const defaultPlatform = PLATFORMS.has(platform) ? platform : 'other';
  const defaultArch = ARCHITECTURES.has(arch) ? arch : 'other';
  let settings = cleanSettings({});
  let initialized = false;
  let disposed = false;
  let inFlight = 0;
  let consentEpoch = 0;
  let preferenceGeneration = 0;
  const pending = new Map();
  const reported = new Set();

  async function initialize() {
    if (initialized) return { ...settings };
    initialized = true;
    try {
      const stored = await readSettings();
      const missing = stored?.__missing === true;
      settings = cleanSettings(missing ? { enabled: packaged && !forcedOff } : stored);
      if (forcedOff) settings.enabled = false;
    } catch { settings = cleanSettings({}); }
    return { ...settings };
  }

  async function persist(value = settings) {
    try { await writeSettings({ ...value }); return true; } catch { return false; }
  }

  function payloadFor(input = {}, usageDay) {
    const payload = {
      event: 'desktop_automation_operation',
      operation: input.operation,
      outcome: input.outcome,
      version: cleanVersion(version),
      platform: defaultPlatform,
      arch: defaultArch,
    };
    if (TEST_RUN.test(testRun)) payload.test_run = testRun;
    if (typeof input.changed === 'boolean' && ['apply', 'lua', 'color_profile', 'undo', 'redo'].includes(input.operation) && input.outcome === 'success') payload.changed = input.changed;
    if (PREVIEW_KINDS.has(input.preview_kind)) payload.preview_kind = input.preview_kind;
    if (ARTIFACT_PERSISTENCE.has(input.artifact_persistence)) payload.artifact_persistence = input.artifact_persistence;
    if (SUPPORTED_FORMATS.has(input.format)) payload.format = input.format;
    const durationBucket = input.duration_bucket || (Number.isFinite(input.durationMs) ? input.durationMs < 100 ? 'under_100ms' : input.durationMs < 1000 ? '100ms_1s' : input.durationMs < 10000 ? '1s_10s' : 'over_10s' : null);
    if (['under_100ms', '100ms_1s', '1s_10s', 'over_10s'].includes(durationBucket)) payload.duration_bucket = durationBucket;
    if (usageDay) payload.usage_day = usageDay;
    return payload;
  }

  function send(input) {
    if (disposed || forcedOff || !settings.enabled || !packaged || typeof fetchImpl !== 'function' || inFlight >= MAX_IN_FLIGHT) return false;
    if (!OPERATIONS.has(input?.operation) || !OUTCOMES.has(input?.outcome)) return false;
    const clock = now instanceof Function ? now() : now;
    const today = new Date(clock).toISOString().slice(0, 10);
    const priorDay = settings.usageDay;
    const usageDay = !DAY.test(priorDay) ? 'first' : priorDay < today ? 'returning' : null;
    const payload = payloadFor(input, usageDay);
    if (usageDay) {
      settings.usageDay = today;
      void persist(settings);
    }
    const controller = new AbortController();
    const timer = timers.setTimeout(() => controller.abort(), TIMEOUT_MS);
    timer?.unref?.();
    inFlight += 1;
    const request = Promise.resolve().then(() => {
      if (disposed || forcedOff || !settings.enabled) return undefined;
      return fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal,
      });
    }).catch(() => {}).finally(() => {
      timers.clearTimeout(timer); inFlight -= 1; pending.delete(request);
    });
    pending.set(request, controller);
    return true;
  }

  return {
    async start() { return initialize(); },
    async setEnabled(enabled) {
      if (!initialized) await initialize();
      const generation = ++preferenceGeneration;
      const next = { ...settings, enabled: Boolean(enabled) };
      if (forcedOff && next.enabled) return { ...settings, enabled: false };
      consentEpoch += 1;
      if (!next.enabled) {
        // Withdraw immediately, before the settings write completes. A slow or
        // unavailable disk must never leave the current process reporting.
        settings.enabled = false;
        reported.clear();
        for (const controller of pending.values()) controller.abort();
        pending.clear();
      }
      if (!await persist(next)) {
        if (generation === preferenceGeneration) settings.enabled = false;
        throw new Error('The anonymous MCP usage preference could not be saved.');
      }
      if (generation !== preferenceGeneration) return { ...settings };
      settings = cleanSettings(next);
      return { ...settings };
    },
    isEnabled: () => settings.enabled === true && packaged && !disposed,
    getConsentEpoch: () => consentEpoch,
    getSettings: () => ({ ...settings }),
    report(input = {}) {
      const key = input.dedupeKey == null ? null : String(input.dedupeKey);
      if (key && reported.has(key)) return false;
      const accepted = send(input);
      if (accepted && key) { reported.add(key); if (reported.size > 1024) reported.delete(reported.values().next().value); }
      return accepted;
    },
    dispose() { disposed = true; for (const controller of pending.values()) controller.abort(); pending.clear(); },
    get pendingCount() { return pending.size; },
  };
}

export function cleanAutomationTelemetrySettings(value) { return cleanSettings(value); }

export { TEST_RUN };

export function createAutomationTelemetrySettingsStore(file) {
  let writing = Promise.resolve();
  return {
    async readSettings() {
      try {
        if ((await stat(file)).size > 4096) return {};
        return JSON.parse(await readFile(file, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return { __missing: true };
        if (error instanceof SyntaxError) return { __corrupt: true };
        throw error;
      }
    },
    writeSettings(value) {
      const snapshot = JSON.stringify(cleanSettings(value));
      writing = writing.catch(() => {}).then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
      return writing;
    },
  };
}
