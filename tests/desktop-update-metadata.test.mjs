import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareDesktopUpdate } from '../scripts/prepare-desktop-update.mjs';

for (const [platform, arch, suffix, metadataName] of [
  ['mac', 'arm64', 'zip', 'latest-arm64-mac.yml'], ['mac', 'x64', 'zip', 'latest-x64-mac.yml'],
  ['windows', 'x64', 'exe', 'latest-x64.yml'], ['linux', 'x64', 'AppImage', 'latest-x64-linux.yml'],
]) test(`final ${platform}/${arch} metadata matches the validated bytes and rejects post-validation changes`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pixelwall-update-metadata-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'desktop/release'); await mkdir(output, { recursive: true });
  const version = '0.3.2', filename = `PixelWall-${version}-${platform}-${arch}.${suffix}`;
  const bytes = Buffer.alloc(1024 * 1024 + 1, 42), sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(output, filename), bytes);
  await writeFile(join(output, `validation-${platform}-${arch}.json`), JSON.stringify({ applicationVersion: version, filename, bytes: bytes.length, sha256 }));
  const result = await prepareDesktopUpdate({ root, platform, arch, version });
  assert.equal(result.metadataName, metadataName);
  const metadata = JSON.parse(await readFile(join(output, metadataName), 'utf8'));
  assert.deepEqual(metadata, { version, files: [{ url: filename, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length }] });
  bytes[0] = 0; await writeFile(join(output, filename), bytes);
  await assert.rejects(prepareDesktopUpdate({ root, platform, arch, version }), /changed since validation/);
});
