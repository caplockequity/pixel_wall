import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export const UPDATE_FEED_URL = 'https://www.pixelwall.dev/desktop/latest.json';
export const UPDATE_ORIGIN = 'https://www.pixelwall.dev';
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STARTUP_DELAY_MS = 20 * 1000;
const TARGET_FILENAMES = Object.freeze({ 'darwin-arm64': 'mac-arm64.zip', 'darwin-x64': 'mac-x64.zip', 'win32-x64': 'windows-x64.exe', 'linux-x64': 'linux-x64.AppImage' });
export const SUPPORTED_TARGETS = Object.freeze(Object.keys(TARGET_FILENAMES));

export function isStableVersion(value) {
  return typeof value === 'string' && value.length <= 48 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}
export function compareVersions(a, b) {
  if (!isStableVersion(a) || !isStableVersion(b)) throw new Error('Invalid stable release version.');
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function exactUrl(value, expected) {
  if (typeof value !== 'string' || value !== expected) throw new Error('Release URL is outside the approved PixelWall location.');
  const url = new URL(value);
  if (url.origin !== UPDATE_ORIGIN || url.username || url.password) throw new Error('Invalid release URL.');
  return url.href;
}
export function validateManifest(value) {
  if (!record(value) || value.schemaVersion !== 1 || !isStableVersion(value.version)) throw new Error('Invalid desktop release manifest.');
  const version = value.version;
  const releaseNotesUrl = exactUrl(value.releaseNotesUrl, `${UPDATE_ORIGIN}/downloads#release-${version.replaceAll('.', '-')}`);
  if (!Array.isArray(value.releaseNotes) || value.releaseNotes.length > 20 || value.releaseNotes.reduce((total, note) => total + (typeof note === 'string' ? note.length : 0), 0) > 8000 || value.releaseNotes.some(note => typeof note !== 'string' || note.length > 1000 || [...note].some(char => { const code = char.codePointAt(0); return code < 32 && ![9, 10, 13].includes(code); }))) throw new Error('Invalid release notes.');
  if (!record(value.downloads) || !Object.keys(value.downloads).length || Object.keys(value.downloads).length > 16) throw new Error('Invalid desktop downloads.');
  const downloads = Object.create(null);
  for (const [target, item] of Object.entries(value.downloads)) {
    if (!/^[a-z0-9]{1,16}-[a-z0-9_]{1,16}$/.test(target) || !record(item)) throw new Error('Invalid desktop download target.');
    if (typeof item.filename !== 'string' || item.filename.length > 200 || !/^PixelWall-[A-Za-z0-9._-]+$/.test(item.filename)) throw new Error('Invalid desktop download filename.');
    const expectedSuffix = TARGET_FILENAMES[target];
    if (expectedSuffix && item.filename !== `PixelWall-${version}-${expectedSuffix}`) throw new Error('Download filename does not match its platform and version.');
    const url = exactUrl(item.url, `${UPDATE_ORIGIN}/downloads/desktop/${version}/${item.filename}`);
    if (item.sha256 !== undefined && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256))) throw new Error('Invalid download checksum.');
    if (item.size !== undefined && (!Number.isSafeInteger(item.size) || item.size <= 0 || item.size > 16 * 1024 ** 3)) throw new Error('Invalid download size.');
    downloads[target] = Object.freeze({ url, filename: item.filename, ...(item.sha256 === undefined ? {} : { sha256: item.sha256.toLowerCase() }), ...(item.size === undefined ? {} : { size: item.size }) });
  }
  return Object.freeze({ schemaVersion: 1, version, releaseNotesUrl, releaseNotes: Object.freeze([...value.releaseNotes]), downloads: Object.freeze(downloads) });
}

export async function fetchManifest(fetchImpl, { timeoutMs = 10000, maxBytes = 65536, signal } = {}) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (signal?.aborted) throw new Error('Update check cancelled.');
  signal?.addEventListener('abort', cancel, { once: true });
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('Update check timed out.')); }, timeoutMs); });
  async function receive() {
    const response = await fetchImpl(UPDATE_FEED_URL, { redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' }, signal: abort.signal });
    if (response.status !== 200 || response.redirected || response.url !== UPDATE_FEED_URL) throw new Error('Release feed is unavailable or redirected.');
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Release feed is not JSON.');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('Release feed exceeds its size limit.');
    if (!response.body?.getReader) throw new Error('Release feed body is unavailable.');
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { void reader.cancel().catch(() => {}); throw new Error('Release feed exceeds its size limit.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }
  try { return await Promise.race([receive(), deadline]); }
  catch (error) { abort.abort(); throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

function cleanSettings(value, now) {
  return {
    schemaVersion: 1,
    automaticChecks: value?.automaticChecks !== false,
    notifiedVersion: isStableVersion(value?.notifiedVersion) ? value.notifiedVersion : null,
    lastCheckedAt: Number.isSafeInteger(value?.lastCheckedAt) && value.lastCheckedAt >= 0 ? Math.min(value.lastCheckedAt, now) : 0,
  };
}

/** Checks and opens approved URLs only. No updater, installer or artwork APIs. */
export function createUpdateController({ currentVersion, platform, arch, packaged, fetch: fetchImpl, readSettings = async () => ({}), writeSettings = async () => {}, notify = async () => 'later', openExternal = async () => {}, now = Date.now, timers = globalThis, startupDelayMs = STARTUP_DELAY_MS, intervalMs = CHECK_INTERVAL_MS, fetchOptions = {} }) {
  if (!isStableVersion(currentVersion)) throw new Error('The app version must be a stable release version.');
  const target = `${platform}-${arch}`;
  let settings = cleanSettings({}, now()), loading, inFlight, manualRequested = false, requestAbort;
  let started = false, disposed = false, startupTimer;
  async function initialize() {
    loading ??= (async () => { let saved; try { saved = await readSettings(); } catch { saved = {}; } settings = cleanSettings(saved, now()); })();
    await loading;
  }
  async function inform(event) { try { return await notify(event); } catch { return 'later'; } }
  async function persist() { try { await writeSettings({ ...settings }); } catch { /* Keep useful session settings if the local disk is unavailable. */ } }
  function clearSchedule() { if (startupTimer !== undefined) timers.clearTimeout(startupTimer); startupTimer = undefined; }
  function schedule(minimumDelay = startupDelayMs) {
    clearSchedule();
    if (!started || disposed || !packaged || !settings.automaticChecks || !SUPPORTED_TARGETS.includes(target)) return;
    const dueIn = settings.lastCheckedAt ? Math.max(0, settings.lastCheckedAt + intervalMs - now()) : 0;
    startupTimer = timers.setTimeout(() => { startupTimer = undefined; if (!disposed && settings.automaticChecks) void check(); }, Math.max(minimumDelay, dueIn));
    startupTimer?.unref?.();
  }
  async function runCheck() {
    await initialize();
    if (disposed) return { status: 'stopped' };
    if (!manualRequested && !settings.automaticChecks) return { status: 'disabled' };
    if (!SUPPORTED_TARGETS.includes(target)) {
      if (manualRequested) await inform({ kind: 'unsupported', currentVersion, target });
      return { status: 'unsupported' };
    }
    settings.lastCheckedAt = now();
    await persist();
    if (disposed) return { status: 'stopped' };
    requestAbort = new AbortController();
    try {
      const manifest = await fetchManifest(fetchImpl, { ...fetchOptions, signal: requestAbort.signal });
      if (disposed) return { status: 'stopped' };
      if (!manualRequested && !settings.automaticChecks) return { status: 'disabled' };
      if (compareVersions(manifest.version, currentVersion) <= 0) {
        if (manualRequested) await inform({ kind: 'current', currentVersion });
        return { status: 'current', version: manifest.version };
      }
      const download = manifest.downloads[target];
      if (!download) {
        if (manualRequested) await inform({ kind: 'unsupported', currentVersion, target, version: manifest.version });
        return { status: 'unsupported', version: manifest.version };
      }
      if (!manualRequested && settings.notifiedVersion && compareVersions(manifest.version, settings.notifiedVersion) <= 0) return { status: 'already-notified', version: manifest.version };
      if (!settings.notifiedVersion || compareVersions(manifest.version, settings.notifiedVersion) > 0) settings.notifiedVersion = manifest.version;
      await persist();
      if (disposed) return { status: 'stopped' };
      const action = await inform({ kind: 'available', currentVersion, manifest, download, target });
      if (!disposed && (action === 'download' || action === 'notes')) {
        try { await openExternal(action === 'download' ? download.url : manifest.releaseNotesUrl); }
        catch { if (!disposed) await inform({ kind: 'error', message: 'PixelWall could not open your browser. Please try Check for Updates again.' }); }
      }
      return { status: 'available', version: manifest.version };
    } catch (error) {
      if (disposed) return { status: 'stopped' };
      if (manualRequested) await inform({ kind: 'error', message: 'PixelWall could not check for updates. Check your connection and try again.' });
      return { status: 'error', error };
    } finally { requestAbort = undefined; }
  }
  function check({ manual = false } = {}) {
    if (disposed) return Promise.resolve({ status: 'stopped' });
    manualRequested ||= manual;
    if (inFlight) return inFlight;
    inFlight = runCheck().finally(() => { inFlight = undefined; manualRequested = false; schedule(0); });
    return inFlight;
  }
  return {
    async start() { await initialize(); if (!disposed) { started = true; schedule(); } return { ...settings }; },
    check,
    async setAutomaticChecks(enabled) { await initialize(); if (disposed) return; settings.automaticChecks = Boolean(enabled); await persist(); schedule(); },
    getSettings: () => ({ ...settings }),
    dispose() { disposed = true; clearSchedule(); requestAbort?.abort(); },
  };
}

/** A small atomic settings file, separate from the editor's IndexedDB storage. */
export function createFileSettingsStore(file) {
  let writing = Promise.resolve();
  return {
    async readSettings() {
      try {
        if ((await stat(file)).size > 16384) return {};
        return JSON.parse(await readFile(file, 'utf8'));
      } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
    },
    writeSettings(value) {
      const snapshot = JSON.stringify(cleanSettings(value, Date.now()));
      writing = writing.catch(() => {}).then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
      return writing;
    },
  };
}

export function createDesktopMenuTemplate({ platform, appName = 'PixelWall', automaticChecks, packaged, onCheck, onToggle, onDocumentation }) {
  const updateItems = [
    { label: 'Check for Updates…', click: onCheck },
    { label: 'Check for updates automatically', type: 'checkbox', checked: automaticChecks, enabled: packaged, click: item => onToggle(item.checked) },
  ];
  const mac = platform === 'darwin';
  return [
    ...(mac ? [{ label: appName, submenu: [{ role: 'about' }, { type: 'separator' }, ...updateItems, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'PixelWall Documentation', click: onDocumentation }, ...(!mac ? [{ type: 'separator' }, ...updateItems, { type: 'separator' }, { role: 'about' }] : [])] },
  ];
}
