const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const TARGETS = ['mac-arm64.zip', 'mac-x64.zip', 'windows-x64.exe', 'linux-x64.AppImage'];

/** Only first-party release assets can be reached through this download route. */
export function desktopDownloadTarget(version, filename) {
  if (typeof version !== 'string' || !VERSION.test(version) ||
      !TARGETS.some(target => filename === `PixelWall-${version}-${target}`)) return null;
  return `https://github.com/caplockequity/pixel_wall/releases/download/desktop-v${version}/${filename}`;
}
