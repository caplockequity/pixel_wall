#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { updateMetadataName, validateInstallInfo } from '../desktop/update-installer.mjs';

// Run after signing, notarization, stapling, re-zipping, and filename normalization.
// Each architecture has a separate feed file, so separate Mac jobs cannot overwrite each other.
export async function prepareDesktopUpdate({ root, platform, arch, version }) {
  const runtimePlatform = { mac: 'darwin', windows: 'win32', linux: 'linux' }[platform];
  const metadataName = updateMetadataName(runtimePlatform, arch);
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  const output = join(root, 'desktop/release');
  const extension = platform === 'mac' ? 'zip' : platform === 'windows' ? 'exe' : 'AppImage';
  const filename = `PixelWall-${version}-${platform}-${arch}.${extension}`;
  const path = join(output, filename);
  const file = await stat(path);
  assert.ok(file.isFile() && file.size > 1024 * 1024, 'Expected a complete release artifact.');
  const sha512 = createHash('sha512'), sha256 = createHash('sha256');
  for await (const chunk of createReadStream(path)) { sha512.update(chunk); sha256.update(chunk); }
  const checksum = sha256.digest('hex');
  const report = JSON.parse(await readFile(join(output, `validation-${platform}-${arch}.json`), 'utf8'));
  assert.equal(report.applicationVersion, version, 'Run release validation on this version first.');
  assert.equal(report.filename, filename);
  assert.equal(report.bytes, file.size);
  assert.equal(report.sha256, checksum, 'Artifact changed since validation; validate the final signed archive again.');
  const metadata = { version, files: [{ url: filename, sha512: sha512.digest('base64'), size: file.size }] };
  validateInstallInfo(metadata, { manifest: { version }, download: { filename, sha256: checksum, size: file.size }, currentVersion: '0.0.0' });
  // JSON is a YAML subset, understood by electron-updater without another serializer dependency.
  await writeFile(join(output, metadataName), `${JSON.stringify(metadata, null, 2)}\n`);
  return { metadataName, filename, sha256: checksum };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = { root: resolve(dirname(fileURLToPath(import.meta.url)), '..') };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace(/^--/, '');
    assert.ok(['root', 'platform', 'arch', 'version'].includes(key) && process.argv[i + 1], `Invalid option: ${process.argv[i]}`);
    options[key] = process.argv[i + 1];
  }
  const result = await prepareDesktopUpdate(options);
  console.log(`Prepared ${result.metadataName} for ${result.filename}`);
}
