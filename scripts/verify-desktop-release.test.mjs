import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { verifyDesktopRelease, assertExecutableArchitecture } from './verify-desktop-release.mjs';

const dependencyRoot = resolve(process.env.PIXELWALL_TEST_SOURCE_ROOT ?? process.cwd());
const asar = createRequire(join(dependencyRoot, 'desktop/package.json'))('@electron/asar');
function executable(platform, arch) {
  const bytes = Buffer.alloc(512);
  if (platform === 'windows') { bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132); }
  else if (platform === 'linux') { Buffer.from('7f454c460201', 'hex').copy(bytes); bytes.writeUInt16LE(62, 18); }
  else { bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4); }
  return bytes;
}
async function fixture(platform, arch, { version = '0.2.0', missingAsset = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pixelwall-release-check-'));
  const output = join(root, 'desktop/release');
  const source = join(root, 'asar-source');
  const appRoot = platform === 'windows' ? join(output, 'win-unpacked') : platform === 'linux' ? join(output, 'linux-unpacked') : join(output, arch === 'arm64' ? 'mac-arm64' : 'mac', 'PixelWall.app/Contents');
  const resourceDir = join(appRoot, platform === 'mac' ? 'Resources' : 'resources');
  await mkdir(resourceDir, { recursive: true });
  await mkdir(join(source, 'app/assets'), { recursive: true });
  const metadata = { version, main: 'main.mjs', build: { files: ['main.mjs', 'update-checker.mjs', 'app/**/*'] } };
  await writeFile(join(root, 'desktop/package.json'), JSON.stringify(metadata));
  await symlink(join(dependencyRoot, 'desktop/node_modules'), join(root, 'desktop/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(source, 'package.json'), JSON.stringify(metadata));
  for (const path of ['main.mjs', 'update-checker.mjs', 'app/sw.js']) await writeFile(join(source, path), '// fixture');
  await writeFile(join(source, 'app/build-info.json'), JSON.stringify({ format: 'pixelwall-standalone', buildId: '0123456789abcdef' }));
  await writeFile(join(source, 'app/index.html'), '<script type="module" src="./assets/editor.js"></script>');
  if (!missingAsset) await writeFile(join(source, 'app/assets/editor.js'), 'globalThis.fixture = true;');
  await asar.createPackage(source, join(resourceDir, 'app.asar'));
  const binary = platform === 'windows' ? join(appRoot, 'PixelWall.exe') : platform === 'linux' ? join(appRoot, 'pixelwall-desktop') : join(appRoot, 'MacOS/PixelWall');
  await mkdir(join(binary, '..'), { recursive: true });
  await writeFile(binary, executable(platform, arch));
  const extension = platform === 'windows' ? 'exe' : platform === 'linux' ? 'AppImage' : 'zip';
  const artifact = Buffer.alloc(1024 * 1024 + 1);
  Buffer.from(platform === 'windows' ? '4d5a' : platform === 'linux' ? '7f454c46' : '504b0304', 'hex').copy(artifact);
  await writeFile(join(output, `PixelWall-0.2.0-${platform}-${arch}.${extension}`), artifact);
  return root;
}

for (const [platform, arch] of [['windows', 'x64'], ['linux', 'x64'], ['mac', 'arm64'], ['mac', 'x64']]) {
  test(`validates ${platform}/${arch} structure and writes an honest report`, async () => {
    const root = await fixture(platform, arch);
    try {
      const report = await verifyDesktopRelease({ root, platform, arch, commit: 'test-commit' });
      assert.equal(report.applicationVersion, '0.2.0');
      assert.equal(report.launchSmokeTest, 'not-run');
      assert.equal(report.signatureVerification, 'not-run');
      assert.match(report.sha256, /^[a-f0-9]{64}$/);
      assert.equal(await readFile(join(root, 'desktop/release', `${report.filename}.sha256`), 'utf8'), `${report.sha256}  ${report.filename}\n`);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
test('rejects an omitted renderer asset even when the installer exists', async () => {
  const root = await fixture('windows', 'x64', { missingAsset: true });
  try { await assert.rejects(verifyDesktopRelease({ root, platform: 'windows', arch: 'x64' }), /missing asset/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test('rejects a version mismatch hidden behind a correct artifact filename', async () => {
  const root = await fixture('mac', 'arm64', { version: '0.1.0' });
  try { await assert.rejects(verifyDesktopRelease({ root, platform: 'mac', arch: 'arm64' }), /version differs/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test('rejects a Mac Intel executable in an Apple Silicon package', () => {
  assert.throws(() => assertExecutableArchitecture(executable('mac', 'x64'), 'mac', 'arm64'), /not arm64/);
});
