import assert from 'node:assert/strict';
import test from 'node:test';
import { publicLinkEvent, sitePageGroup } from '../app/site-analytics-core.mjs';

const origin = 'https://www.pixelwall.dev';
const packages = {
  'darwin-arm64': ['mac-arm64.zip', 'zip'],
  'darwin-x64': ['mac-x64.zip', 'zip'],
  'win32-x64': ['windows-x64.exe', 'exe'],
  'linux-x64': ['linux-x64.AppImage', 'appimage'],
};
const release = { version: '0.2.1', downloads: Object.fromEntries(Object.entries(packages).map(([platform, [suffix]]) => {
  const filename = `PixelWall-0.2.1-${suffix}`;
  return [platform, { filename, url: `${origin}/downloads/desktop/0.2.1/${filename}` }];
})) };

test('page grouping emits only fixed categories, never a route or a URL', () => {
  for (const [path, expected] of [
    ['/', 'home'], ['/editor', 'editor'], ['/editor/classic', 'classic_editor'],
    ['/downloads/', 'downloads'], ['/guides', 'guides'], ['/guides/scripting', 'guides'],
    ['/sprite-sheet-maker', 'workflow'], ['/pricing', 'pricing'], ['/privacy', 'privacy'],
    ['/guides/my-private-project', 'other'], ['/private/name', 'other'],
    ['/editor?license=secret', 'other'], ['https://private.example/project', 'other'],
  ]) assert.equal(sitePageGroup(path), expected);
});

test('public links use known destination categories and exclude nonproduction contexts', () => {
  for (const [href, destination] of [
    ['/editor', 'editor'], [`${origin}/pricing`, 'pricing'],
    ['https://pixelwall.dev/downloads', 'downloads'], ['/guides/command-api', 'guides'],
    ['/downloads/pixelwall-standalone.zip', 'browser_download'],
    ['/downloads/pixelwall-cli.zip', 'cli_download'],
  ]) assert.deepEqual(publicLinkEvent(href, origin, release), { event: 'site_cta_clicked', properties: { destination } });
  for (const currentOrigin of ['http://localhost:5173', 'pixelwall://app', 'https://pixelwall-maker.ben-zavadil.chatgpt.site']) {
    assert.equal(publicLinkEvent('/editor', currentOrigin, release), null);
  }
});

test('desktop clicks match the current published platform filenames and emit no download URL', () => {
  for (const [platform, [, package_type]] of Object.entries(packages)) {
    assert.deepEqual(publicLinkEvent(release.downloads[platform].url, origin, release), {
      event: 'desktop_download_clicked', properties: { platform, version: '0.2.1', package_type },
    });
  }
  const missing = { ...release, downloads: {} };
  assert.equal(publicLinkEvent(release.downloads['darwin-arm64'].url, origin, missing), null);
  const changed = { ...release, downloads: { 'darwin-arm64': { filename: 'private.zip', url: release.downloads['darwin-arm64'].url } } };
  assert.equal(publicLinkEvent(release.downloads['darwin-arm64'].url, origin, changed), null);
});

test('arbitrary, credential-bearing, fragment, and unpublished links are not tracked', () => {
  for (const href of [
    'https://evil.example/editor', 'https://pixelwall.dev.evil.example/editor',
    'https://private:password@www.pixelwall.dev/editor', 'https://www.pixelwall.dev:444/editor',
    'https://pixelwall-maker.ben-zavadil.chatgpt.site/editor', 'http://www.pixelwall.dev/editor',
    '/editor?license=secret', '/editor#private-project', '/private-project',
    '/guides/unpublished-note', 'mailto:contact@caplock.ai', 'javascript:alert(1)',
    '/downloads/desktop/0.2.0/PixelWall-0.2.0-mac-arm64.zip',
    '/downloads/desktop/0.2.1/private-project.zip', '/downloads/other.zip',
  ]) assert.equal(publicLinkEvent(href, origin, release), null, href);
});
