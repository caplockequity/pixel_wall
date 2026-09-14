import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compareVersions, SUPPORTED_TARGETS } from './update-checker.mjs';

export const RELEASE_BASE = 'https://github.com/caplockequity/pixel_wall/releases/download/';
export function updateMetadataName(platform, arch) {
  if (!SUPPORTED_TARGETS.includes(`${platform}-${arch}`)) throw new Error('Unsupported update target.');
  return `latest-${arch}${platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux' : ''}.yml`;
}

// The website selects a reviewed version; metadata may only name that exact artifact.
export function validateInstallInfo(info, { manifest, download, currentVersion }) {
  if (!info || info.version !== manifest.version || compareVersions(info.version, currentVersion) <= 0 ||
      !Array.isArray(info.files) || info.files.length !== 1 || info.packages || info.stagingPercentage !== undefined) {
    throw new Error('Update metadata does not match the approved release.');
  }
  const file = info.files[0];
  if (file.url !== download.filename || file.size !== download.size || !Number.isSafeInteger(file.size) || file.size <= 0 ||
      typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
      typeof download.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(download.sha256) ||
      (info.path !== undefined && info.path !== file.url) || (info.sha512 !== undefined && info.sha512 !== file.sha512)) {
    throw new Error('Update artifact or checksum does not match the approved release.');
  }
  return info;
}

async function verifyDownload(path, expected) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('Downloaded update failed verification.');
}

function waitForEvent(emitter, event, operation, timeoutMs = 120000, errorSource = emitter) {
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); emitter.removeListener(event, done); errorSource.removeListener('error', fail); };
    const done = () => { clean(); resolve(); };
    const fail = error => { clean(); reject(error); };
    const timer = setTimeout(() => fail(new Error('Preparing the update took too long. Please try again.')), timeoutMs);
    emitter.once(event, done);
    errorSource.once('error', fail);
    try { operation(); } catch (error) { fail(error); }
  });
}

export function createUpdateInstaller({ engine, nativeUpdater, CancellationToken, currentVersion, platform, arch, packaged,
  appImagePath, installTimeoutMs = 120000, verify = verifyDownload, checkWritable = async path => { await access(path, constants.W_OK); await access(dirname(path), constants.W_OK); } }) {
  engine.autoDownload = false;
  engine.autoInstallOnAppQuit = false;
  engine.autoRunAppAfterInstall = true;
  engine.allowPrerelease = false;
  engine.allowDowngrade = false;
  // Full downloads keep the initial rollout independent of old blockmaps and renamed artifacts.
  engine.disableDifferentialDownload = true;
  engine.disableWebInstaller = true;
  engine.logger = null;
  let ready = false, downloadedFile, expectedChecksum, disposed = false;
  const onDownloaded = event => { downloadedFile = event.downloadedFile; };
  // The same errors reject operations below; EventEmitter must also always have a listener.
  const onError = () => {};
  engine.on('error', onError);
  engine.on('update-downloaded', onDownloaded);
  return {
    async download({ manifest, download, signal, onProgress }) {
      if (!packaged || disposed) throw new Error('Updates can only be installed by the packaged app.');
      updateMetadataName(platform, arch);
      if (platform === 'linux') {
        if (!appImagePath) throw new Error('Run the installed AppImage to update PixelWall.');
        await checkWritable(appImagePath);
      }
      ready = false; downloadedFile = undefined;
      const token = new CancellationToken();
      const cancel = () => token.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      const progress = value => onProgress(value.percent);
      engine.on('download-progress', progress);
      try {
        if (signal.aborted) throw new Error('Update download cancelled.');
        engine.setFeedURL({ provider: 'generic', url: `${RELEASE_BASE}desktop-v${manifest.version}/`, channel: `latest-${arch}`, useMultipleRangeRequest: false });
        const result = await engine.checkForUpdates();
        if (signal.aborted || disposed) throw new Error('Update download cancelled.');
        if (result?.isUpdateAvailable !== true) throw new Error('This update is not supported on this computer.');
        validateInstallInfo(result?.updateInfo, { manifest, download, currentVersion });
        await engine.downloadUpdate(token);
        if (signal.aborted || disposed) throw new Error('Update download cancelled.');
        if (!downloadedFile) throw new Error('The downloaded update is unavailable.');
        // Check both the updater's SHA-512 and the independently published website SHA-256.
        await verify(downloadedFile, download.sha256);
        if (signal.aborted || disposed) throw new Error('Update download cancelled.');
        expectedChecksum = download.sha256;
        ready = true;
      } finally {
        signal.removeEventListener('abort', cancel);
        engine.removeListener('download-progress', progress);
      }
    },
    async install() {
      if (!ready || disposed) throw new Error('Download and verify the update before restarting.');
      await verify(downloadedFile, expectedChecksum);
      // Stage and verify the Mac signature BEFORE registering any automatic relaunch callback.
      // A failed or timed-out staging attempt must never trigger a delayed forced quit.
      if (platform === 'darwin' && !engine.squirrelDownloadedUpdate) {
        await waitForEvent(nativeUpdater, 'update-downloaded', () => nativeUpdater.checkForUpdates(), installTimeoutMs);
      }
      if (disposed) throw new Error('Update installation cancelled.');
      await waitForEvent(nativeUpdater, 'before-quit-for-update', () => engine.quitAndInstall(true, true), installTimeoutMs, platform === 'darwin' ? nativeUpdater : engine);
    },
    dispose() { disposed = true; engine.removeListener('update-downloaded', onDownloaded); engine.closeServerIfExists?.(); },
  };
}
