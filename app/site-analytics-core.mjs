// Analytics sees a fixed vocabulary, never a visited URL, arbitrary link or text.
const PAGE_GROUPS = new Map([
  ['/', 'home'],
  ['/editor', 'editor'],
  ['/editor/classic', 'classic_editor'],
  ['/downloads', 'downloads'],
  ['/guides', 'guides'],
  ['/pricing', 'pricing'],
  ['/support', 'support'],
  ['/about', 'about'],
  ['/privacy', 'privacy'],
  ['/terms', 'terms'],
  ['/sprite-sheet-maker', 'workflow'],
  ['/pixel-art-animation', 'workflow'],
  ['/pixel-art-tracing', 'workflow'],
  ['/tileset-maker', 'workflow'],
]);

const DESKTOP_PACKAGES = {
  'darwin-arm64': { suffix: 'mac-arm64.zip', package_type: 'zip' },
  'darwin-x64': { suffix: 'mac-x64.zip', package_type: 'zip' },
  'win32-x64': { suffix: 'windows-x64.exe', package_type: 'exe' },
  'linux-x64': { suffix: 'linux-x64.AppImage', package_type: 'appimage' },
};
const PUBLIC_ORIGINS = new Set(['https://www.pixelwall.dev', 'https://pixelwall.dev']);
const GUIDE_PATHS = new Set([
  '/guides/getting-started', '/guides/export-formats', '/guides/phaser-sprite-sheets',
  '/guides/pixijs-animated-sprites', '/guides/tiled-tilemaps', '/guides/desert-signal',
  '/guides/scripting', '/guides/command-api', '/guides/command-line',
  '/guides/offline-and-downloads', '/guides/aseprite-compatibility',
]);

export function sitePageGroup(pathname) {
  if (typeof pathname !== 'string') return 'other';
  const path = pathname.replace(/\/+$/, '') || '/';
  if (GUIDE_PATHS.has(path)) return 'guides';
  return PAGE_GROUPS.get(path) ?? 'other';
}

/**
 * Return only fixed event properties for a recognized public link.
 * @returns {{event: 'desktop_download_clicked', properties: {platform: string, version: string, package_type: string}} | {event: 'site_cta_clicked', properties: {destination: string}} | null}
 */
export function publicLinkEvent(href, currentOrigin, release) {
  if (typeof href !== 'string' || !PUBLIC_ORIGINS.has(currentOrigin)) return null;
  let url;
  try { url = new URL(href, currentOrigin); } catch { return null; }
  if (!PUBLIC_ORIGINS.has(url.origin) || url.username || url.password || url.search || url.hash) return null;

  // A download counts only when it is one of the four published current files.
  const version = release?.version;
  if (typeof version === 'string' && /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(version)) {
    for (const [platform, info] of Object.entries(DESKTOP_PACKAGES)) {
      const filename = `PixelWall-${version}-${info.suffix}`;
      const path = `/downloads/desktop/${version}/${filename}`;
      const artifact = release.downloads?.[platform];
      if (url.pathname !== path || artifact?.filename !== filename) continue;
      if (!['https://www.pixelwall.dev', 'https://pixelwall.dev'].some(origin => artifact.url === `${origin}${path}`)) continue;
      return { event: 'desktop_download_clicked', properties: { platform, version, package_type: info.package_type } };
    }
  }

  const destination = url.pathname === '/downloads/pixelwall-standalone.zip' ? 'browser_download'
    : url.pathname === '/downloads/pixelwall-cli.zip' ? 'cli_download'
      : sitePageGroup(url.pathname);
  if (destination === 'other') return null;
  return { event: 'site_cta_clicked', properties: { destination } };
}
