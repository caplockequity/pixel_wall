#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const supported = new Set(['windows:x64', 'linux:x64', 'mac:arm64', 'mac:x64']);

async function firstBytes(path, length = 4096) {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
}

export function assertExecutableArchitecture(bytes, platform, arch) {
  assert.ok(bytes.length >= 64, 'Packaged executable header is truncated.');
  if (platform === 'windows') {
    assert.equal(bytes.toString('ascii', 0, 2), 'MZ', 'Packaged Windows executable is not PE.');
    const pe = bytes.readUInt32LE(0x3c);
    assert.ok(pe + 6 <= bytes.length, 'PE header is missing or beyond the inspected header.');
    assert.equal(bytes.toString('ascii', pe, pe + 4), 'PE\0\0', 'Invalid PE signature.');
    assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Packaged Windows executable is not x64.');
  } else if (platform === 'linux') {
    assert.equal(bytes.toString('hex', 0, 4), '7f454c46', 'Packaged Linux executable is not ELF.');
    assert.equal(bytes[4], 2, 'Packaged Linux executable is not 64-bit.');
    assert.equal(bytes[5], 1, 'Unsupported ELF byte order.');
    assert.equal(bytes.readUInt16LE(18), 62, 'Packaged Linux executable is not x64.');
  } else {
    assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, 'Expected a thin 64-bit Mach-O executable.');
    assert.equal(bytes.readUInt32LE(4), arch === 'arm64' ? 0x0100000c : 0x01000007, `Packaged Mac executable is not ${arch}.`);
  }
}

export async function verifyDesktopRelease({ root, platform, arch, version = '0.2.0', commit = process.env.GITHUB_SHA ?? null }) {
  assert.ok(supported.has(`${platform}:${arch}`), 'Supported targets: windows x64, linux x64, mac arm64, mac x64.');
  assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, 'Invalid release version.');
  root = resolve(root);
  const output = join(root, 'desktop/release');
  const extension = platform === 'windows' ? 'exe' : platform === 'linux' ? 'AppImage' : 'zip';
  const filename = `PixelWall-${version}-${platform}-${arch}.${extension}`;
  const artifact = join(output, filename);
  const artifactInfo = await stat(artifact);
  assert.ok(artifactInfo.isFile() && artifactInfo.size > 1024 * 1024, 'Release artifact is absent, empty, or implausibly small.');
  const header = await firstBytes(artifact);
  assert.equal(header.toString('hex', 0, platform === 'windows' ? 2 : 4), platform === 'windows' ? '4d5a' : platform === 'linux' ? '7f454c46' : '504b0304', 'Release artifact does not match its expected file format.');

  const appRoot = platform === 'windows' ? join(output, 'win-unpacked') : platform === 'linux' ? join(output, 'linux-unpacked') : join(output, arch === 'arm64' ? 'mac-arm64' : 'mac', 'PixelWall.app/Contents');
  const resources = join(appRoot, platform === 'mac' ? 'Resources' : 'resources');
  const executable = platform === 'windows' ? join(appRoot, 'PixelWall.exe') : platform === 'linux' ? join(appRoot, 'pixelwall-desktop') : join(appRoot, 'MacOS/PixelWall');
  assertExecutableArchitecture(await firstBytes(executable, 65536), platform, arch);

  const require = createRequire(join(root, 'desktop/package.json'));
  const asar = require('@electron/asar');
  const archive = join(resources, 'app.asar');
  const entries = asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''));
  const files = new Set(entries);
  const required = ['package.json', 'main.mjs', 'app/index.html', 'app/build-info.json', 'app/sw.js'];
  for (const path of required) assert.ok(files.has(path), `Packaged application is missing ${path}.`);
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(metadata.version, version, 'Packaged application version differs from the artifact name.');
  assert.equal(metadata.main, 'main.mjs', 'Unexpected Electron entry point.');
  const sourceMetadata = require('./package.json');
  assert.equal(sourceMetadata.version, version, 'desktop/package.json must match the release version.');
  for (const file of sourceMetadata.build?.files ?? []) {
    if (typeof file === 'string' && /^[\w./-]+\.mjs$/.test(file)) assert.ok(files.has(file), `A configured desktop module is absent from app.asar: ${file}`);
  }
  const buildInfo = JSON.parse(asar.extractFile(archive, 'app/build-info.json').toString('utf8'));
  assert.equal(buildInfo.format, 'pixelwall-standalone', 'Packaged application is not the standalone editor.');
  assert.match(buildInfo.buildId, /^[a-f0-9]{16}$/);
  const index = asar.extractFile(archive, 'app/index.html').toString('utf8');
  const assets = [...index.matchAll(/(?:src|href)=["']\.\/(assets\/[^"'#?]+)(?:[?#][^"']*)?["']/g)].map((match) => `app/${match[1]}`);
  assert.ok(assets.some((path) => path.endsWith('.js')), 'Standalone index does not reference a bundled JavaScript asset.');
  for (const path of assets) assert.ok(files.has(path), `Standalone entry references a missing asset: ${path}`);

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  const report = {
    format: 'pixelwall-desktop-validation', version: 1, applicationVersion: version,
    platform, arch, filename, bytes: artifactInfo.size, sha256, commit,
    standaloneBuildId: buildInfo.buildId,
    checks: ['artifact-name-and-file-header', 'unpacked-executable-architecture', 'packaged-asar-entry-and-version', 'standalone-entry-and-referenced-assets'],
    launchSmokeTest: 'not-run', installationSmokeTest: 'not-run', signatureVerification: 'not-run',
    note: 'Structural validation of the candidate and its accompanying unpacked build; installer execution and signing/notarization require separate verification.',
  };
  await writeFile(`${artifact}.sha256`, `${sha256}  ${filename}\n`);
  await writeFile(join(output, `validation-${platform}-${arch}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = { root: resolve(dirname(fileURLToPath(import.meta.url)), '..') };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace(/^--/, '');
    assert.ok(['root', 'platform', 'arch', 'version'].includes(key) && process.argv[i].startsWith('--') && process.argv[i + 1], `Unknown or incomplete option: ${process.argv[i]}`);
    options[key] = process.argv[i + 1];
  }
  const report = await verifyDesktopRelease(options);
  console.log(`Validated ${report.filename}: ${report.bytes} bytes, SHA-256 ${report.sha256}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${report.filename}\n\nPackaged version, CPU architecture and standalone assets verified. SHA-256: \`${report.sha256}\`.\n\nDesktop launch, installation and signatures were not tested by this step.\n`);
  }
}
