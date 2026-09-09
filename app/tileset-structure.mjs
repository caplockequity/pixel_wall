import { tilesetSlots, assertTilesetEditable } from './tileset-access.mjs';
const copy = value => structuredClone(value);
const integer = (value, min, max, label) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`${label} must be an integer from ${min} to ${max}.`); return value; };
const find = (doc, id) => { const ts = doc.tilesets.find(item => item.id === id); if (!ts) throw Error('Tileset not found.'); return ts; };
const blank = doc => doc.colorMode === 'indexed' ? 0 : null;
function atlasSize(width, height, count, limits) {
  integer(width, 1, limits.imageEdge, 'Tile width'); integer(height, 1, limits.imageEdge, 'Tile height'); integer(count, 1, 65536, 'Tile count');
  integer(height * count, 1, limits.imageEdge, 'Tileset atlas height');
  if (width * height * count > limits.pixels) throw Error('Tileset exceeds the stored pixel budget.');
  return width * height * count;
}
function numericId(doc) { const used = new Set(doc.tilesets.map(ts => ts.asepriteId)); let value = 0; while (used.has(value)) value++; return value; }
function tileId(entries) { const used = new Set(entries.map(entry => entry.id)); let value = 1; while (used.has(`tile-created-${value}`)) value++; return `tile-created-${value}`; }
function raster(doc, ts, tile) {
  if (!tile) return Array(ts.tileWidth * ts.tileHeight).fill(doc.colorMode === 'indexed' ? doc.metadata?.aseprite?.transparentIndex ?? 0 : null);
  const image = doc.images[tile.imageId]; if (!image || image.tilemap) throw Error('Tileset artwork must be embedded before structural editing.');
  const r = tile.sourceRect ?? { x: 0, y: 0, width: image.width, height: image.height };
  return Array.from({ length: ts.tileWidth * ts.tileHeight }, (_, index) => { const x = index % ts.tileWidth, y = Math.floor(index / ts.tileWidth); return image.pixels[(r.y + Math.min(r.height - 1, Math.floor(y * r.height / ts.tileHeight))) * image.width + r.x + Math.min(r.width - 1, Math.floor(x * r.width / ts.tileWidth))]; });
}
function entriesFor(doc, ts, limits) {
  if (ts.flags & 1) throw Error('Embed external tileset artwork before structural editing.');
  const slots = tilesetSlots(doc, ts); atlasSize(ts.tileWidth, ts.tileHeight, slots.count, limits);
  const result = [];
  for (let index = 0; index < slots.count; index++) {
    const tile = slots.entries.get(index); if (!tile && (slots.native || index !== 0)) throw Error('Tileset has missing tile artwork.');
    result.push({ id: tile?.id ?? tileId(ts.tiles ?? []), pixels: raster(doc, ts, tile), userData: copy(tile?.userData ?? ts.tileUserData?.[index]) });
  }
  return result;
}
function installAtlas(doc, ts, entries, api) {
  const native = Number.isInteger(ts.asepriteId) && !!ts.imageId;
  const count = entries.length, size = atlasSize(ts.tileWidth, ts.tileHeight, count, api.limits);
  api.reserve(doc, size); const imageId = api.fresh(doc, 'image');
  doc.images[imageId] = { width: ts.tileWidth, height: ts.tileHeight * count, pixels: entries.flatMap(entry => entry.pixels) };
  ts.imageId = imageId; ts.tileCount = count; ts.asepriteId ??= numericId(doc); ts.flags = (ts.flags ?? 0) | 2 | (native ? 0 : 4);
  ts.tiles = entries.map((entry, index) => ({ id: entry.id, imageId, asepriteTileId: index, sourceRect: { x: 0, y: index * ts.tileHeight, width: ts.tileWidth, height: ts.tileHeight }, ...(entry.userData ? { userData: copy(entry.userData) } : {}) }));
  if (entries.some(entry => entry.userData)) ts.tileUserData = entries.map(entry => copy(entry.userData) ?? null); else delete ts.tileUserData;
}
function bits(cell, ids, flags) {
  if (cell == null) return flags & 4 ? 0 : 0xffffffff;
  const index = ids.get(cell.tileId); if (index == null) throw Error('Tilemap references an unknown tile.');
  let x = !!cell.flipX, y = !!cell.flipY, diagonal = false;
  const rotation = cell.rotate ?? 0;
  if (rotation === 90) { diagonal = true; [x, y] = [!y, x]; } else if (rotation === 180) { x = !x; y = !y; } else if (rotation === 270) { diagonal = true; [x, y] = [y, !x]; } else if (rotation !== 0) throw Error('Unsupported tile rotation.');
  return (index | (x ? 0x80000000 : 0) | (y ? 0x40000000 : 0) | (diagonal ? 0x20000000 : 0)) >>> 0;
}
/** Encode engine maps before changing resource slots. Native Lua leaves tile words unchanged. */
function nativeMaps(doc, layers, api) {
  const links = new Map();
  for (const layer of layers) {
    if (!layer.tilemaps) continue;
    for (const [frameId, map] of Object.entries(layer.tilemaps)) {
      const ts = find(doc, map.tilesetId), slots = tilesetSlots(doc, ts), ids = new Map([...slots.entries].map(([index, tile]) => [tile.id, index]));
      const frame = doc.frames.find(frame => frame.id === frameId); if (!frame) throw Error('Tilemap frame not found.');
      const tilemap = { bitsPerTile: 32, idMask: 0x1fffffff, xFlipMask: 0x80000000, yFlipMask: 0x40000000, diagonalFlipMask: 0x20000000, tiles: map.cells.map(cell => bits(cell, ids, slots.native ? ts.flags : 4)) };
      const previous = frame.cels[layer.id], sourceId = map.sourceImageId ?? previous?.imageId, source = doc.images[sourceId], key = sourceId ? `${sourceId}:${JSON.stringify([map.columns, map.rows, tilemap])}` : null;
      const unchanged = source?.tilemap && source.width === map.columns && source.height === map.rows && JSON.stringify(source.tilemap) === JSON.stringify(tilemap);
      let imageId = unchanged ? sourceId : key ? links.get(key) : null;
      if (!imageId) { api.reserve(doc, map.columns * map.rows); imageId = api.fresh(doc, 'image'); doc.images[imageId] = { width: map.columns, height: map.rows, pixels: [], tilemap }; if (key) links.set(key, imageId); }
      frame.cels[layer.id] = { ...previous, imageId, x: map.x ?? previous?.x ?? 0, y: map.y ?? previous?.y ?? 0, opacity: map.opacity ?? previous?.opacity ?? 1 };
    }
    delete layer.tilemaps;
  }
}
export function createNativeTileset(doc, command, api) {
  if (doc.tilesets.length >= 256) throw Error('Too many tilesets.');
  const source = command.copyTilesetId == null ? null : find(doc, command.copyTilesetId);
  const width = source?.tileWidth ?? command.tileWidth, height = source?.tileHeight ?? command.tileHeight, count = source ? tilesetSlots(doc, source).count : command.tileCount ?? 1;
  const size = atlasSize(width, height, count, api.limits); api.reserve(doc, size);
  const id = command.tilesetId ?? api.fresh(doc, 'tileset'); if (doc.tilesets.some(ts => ts.id === id)) throw Error('Tileset ID already exists.');
  const origin = command.gridOrigin ?? source?.gridOrigin ?? { x: 0, y: 0 }; integer(origin.x, -65535, 65535, 'Grid origin x'); integer(origin.y, -65535, 65535, 'Grid origin y');
  const ts = { id, name: source?.name ?? '', tileWidth: width, tileHeight: height, baseIndex: 1, flags: 6, asepriteId: numericId(doc), ...(source?.userData ? { userData: copy(source.userData) } : {}), ...((origin.x || origin.y) ? { gridOrigin: { ...origin } } : {}) };
  const entries = source ? entriesFor(doc, source, api.limits) : Array.from({ length: count }, (_, index) => ({ id: `tile-${index}`, pixels: Array(width * height).fill(blank(doc)) }));
  installAtlas(doc, ts, entries, api); doc.tilesets.push(ts); return ts;
}
export function changeTilesetSlots(doc, command, api) {
  const ts = find(doc, command.tilesetId); assertTilesetEditable(doc, ts.id);
  const entries = entriesFor(doc, ts, api.limits), insert = command.type === 'tileset.tileInsert', index = integer(command.tileIndex ?? entries.length, 1, insert ? entries.length : entries.length - 1, 'Tile index');
  atlasSize(ts.tileWidth, ts.tileHeight, entries.length + (insert ? 1 : -1), api.limits);
  const layers = doc.layers.filter(layer => layer.tilesetId === ts.id || Object.values(layer.tilemaps ?? {}).some(map => map.tilesetId === ts.id));
  if (layers.some(layer => [layer.tilesetId, ...Object.values(layer.tilemaps ?? {}).map(map => map.tilesetId)].filter(Boolean).some(id => id !== ts.id))) throw Error('Structural edits require each tilemap layer to use one tileset across frames.');
  nativeMaps(doc, layers, api); for (const layer of layers) layer.tilesetId = ts.id;
  if (insert && entries.some(entry => entry.id === command.tileId)) throw Error('Tile ID already exists.');
  if (insert) entries.splice(index, 0, { id: command.tileId ?? tileId(entries), pixels: Array(ts.tileWidth * ts.tileHeight).fill(blank(doc)) }); else entries.splice(index, 1);
  installAtlas(doc, ts, entries, api);
}
export function assignLayerTileset(doc, command, api) {
  const layer = api.layerFor(doc, command.layerId, true); if (layer.type !== 'tilemap') throw Error('Tileset assignment requires a tilemap layer.');
  const ts = find(doc, command.tilesetId); if (ts.flags & 1) throw Error('Embed external tileset artwork before assigning it to a layer.');
  // Build an atlas if the destination is currently represented by independent editor tiles.
  if (!ts.imageId || !Number.isInteger(ts.asepriteId) || ts.tiles?.some(tile => !Number.isInteger(tile.asepriteTileId))) installAtlas(doc, ts, entriesFor(doc, ts, api.limits), api);
  nativeMaps(doc, [layer], api); layer.tilesetId = ts.id;
}
