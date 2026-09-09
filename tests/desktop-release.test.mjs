import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopDownloadTarget } from '../app/desktop-release-core.mjs';

test('desktop links resolve only to versioned PixelWall release files', () => {
  for (const platform of ['mac-arm64.zip', 'mac-x64.zip', 'windows-x64.exe', 'linux-x64.AppImage']) {
    assert.equal(desktopDownloadTarget('0.2.0', `PixelWall-0.2.0-${platform}`),
      `https://github.com/caplockequity/pixel_wall/releases/download/desktop-v0.2.0/PixelWall-0.2.0-${platform}`);
  }
});
test('download route rejects traversal, external destinations and mismatched versions', () => {
  for (const [version, filename] of [
    ['../main', 'PixelWall-0.2.0-mac-arm64.zip'], ['01.2.0', 'PixelWall-01.2.0-mac-arm64.zip'],
    ['0.2.0', 'https://example.com/malware.exe'], ['0.2.0', '../PixelWall-0.2.0-mac-arm64.zip'],
    ['0.2.0', 'PixelWall-0.3.0-mac-arm64.zip'], ['0.2.0', 'PixelWall-0.2.0-mac-arm64.zip?redirect=bad'],
    ['0.2.0', 'PixelWall-0.2.0-mac-arm64.zip#fragment'], ['0.2.0', 'PixelWall-0.2.0-mac-arm64.zip/extra'],
  ]) assert.equal(desktopDownloadTarget(version, filename), null);
});
