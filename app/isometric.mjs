/** Small, dependency-free helpers for PixelWall's 2:1 isometric guides. */
export function isoProject(x, y, tileWidth = 16, origin = { x: 0, y: 0 }) {
  const half = tileWidth / 2;
  return { x: origin.x + (x - y) * half, y: origin.y + (x + y) * (half / 2) };
}

export function isoUnproject(screenX, screenY, tileWidth = 16, origin = { x: 0, y: 0 }) {
  const half = tileWidth / 2;
  const sx = (screenX - origin.x) / half;
  const sy = (screenY - origin.y) / (half / 2);
  return { x: (sx + sy) / 2, y: (sy - sx) / 2 };
}

export function snapIso(screenX, screenY, tileWidth = 16, origin = { x: 0, y: 0 }) {
  const point = isoUnproject(screenX, screenY, tileWidth, origin);
  return isoProject(Math.round(point.x), Math.round(point.y), tileWidth, origin);
}

export function isoDiamondPoints(cx, cy, tileWidth = 16) {
  const half = tileWidth / 2;
  return [
    [cx, cy - half / 2],
    [cx + half, cy],
    [cx, cy + half / 2],
    [cx - half, cy],
  ];
}

