/** Explicitly opted-in, anonymous telemetry for packaged desktop automation. */
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

function cleanSettings(value) {
  return { schemaVersion: 1, enabled: value?.enabled === true };
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
} = {}) {
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
    try { settings = cleanSettings(await readSettings()); } catch { settings = cleanSettings({}); }
    return { ...settings };
  }

  async function persist(value = settings) {
    try { await writeSettings({ ...value }); return true; } catch { return false; }
  }

  function payloadFor(input = {}) {
    const payload = {
      event: 'desktop_automation_operation',
      operation: input.operation,
      outcome: input.outcome,
      version: cleanVersion(version),
    };
    if (typeof input.changed === 'boolean' && ['apply', 'lua', 'color_profile', 'undo', 'redo'].includes(input.operation) && input.outcome === 'success') payload.changed = input.changed;
    if (PREVIEW_KINDS.has(input.preview_kind)) payload.preview_kind = input.preview_kind;
    if (ARTIFACT_PERSISTENCE.has(input.artifact_persistence)) payload.artifact_persistence = input.artifact_persistence;
    return payload;
  }

  function send(input) {
    if (disposed || !settings.enabled || !packaged || typeof fetchImpl !== 'function' || inFlight >= MAX_IN_FLIGHT) return false;
    if (!OPERATIONS.has(input?.operation) || !OUTCOMES.has(input?.outcome)) return false;
    const payload = payloadFor(input);
    const controller = new AbortController();
    const timer = timers.setTimeout(() => controller.abort(), TIMEOUT_MS);
    timer?.unref?.();
    inFlight += 1;
    const request = Promise.resolve().then(() => fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal,
    })).catch(() => {}).finally(() => {
      timers.clearTimeout(timer); inFlight -= 1; pending.delete(request);
    });
    pending.set(request, controller);
    return true;
  }

  return {
    async start() { return initialize(); },
    async setEnabled(enabled) {
      await initialize();
      const generation = ++preferenceGeneration;
      const next = { ...settings, enabled: Boolean(enabled) };
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

export function createAutomationTelemetrySettingsStore(file) {
  let writing = Promise.resolve();
  return {
    async readSettings() {
      try {
        if ((await stat(file)).size > 4096) return {};
        return JSON.parse(await readFile(file, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
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
