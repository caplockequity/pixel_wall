/** Resolve a user-selected source already loaded into memory. Never follows filenames or performs I/O. */
import { normalizeDocument, normalizeColor, getFramePalette, LIMITS } from './editor-core.mjs';
import { documentProfile, isSRGB } from './color-management.mjs';
const fail = message => { throw Error(`External tileset: ${message}`); };
const integer = (value, min, max, label) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`invalid ${label}.`); return value; };

function matchingProfiles(a, b) {
  if (isSRGB(a) && isSRGB(b)) return true;
  if (a?.type === 2 || b?.type === 2) return a?.type === 2 && b?.type === 2 && Array.isArray(a.icc) && Array.isArray(b.icc) && a.icc.length === b.icc.length && a.icc.every((v, i) => v === b.icc[i]);
  return !!(a?.flags & 1) && !!(b?.flags & 1) && a.gamma === b.gamma;
}
function transparentIndex(document) { return document.metadata?.aseprite?.transparentIndex ?? 0; }
function selectedTileset(document, id) {
  const target = document.tilesets.find(value => value.id === id);
  if (!target) fail('the selected tileset no longer exists.');
  integer(target.flags, 0, 0xffffffff, 'destination flags');
  if (!(target.flags & 1) || target.externalFileId == null || target.externalTilesetId == null) fail('the selected tileset has no unresolved external link.');
  integer(target.externalFileId, 0, 0xffffffff, 'external file ID'); integer(target.externalTilesetId, 0, 0xffffffff, 'external tileset ID');
  const entries = (document.metadata?.aseprite?.externalFiles ?? []).filter(value => value.id === target.externalFileId);
  if (entries.length !== 1 || entries[0].type !== 1) fail('the external file registry entry is missing, duplicated, or is not a tileset resource.');
  return { target, external: entries[0] };
}

/** Labels are informational only. The host must open its own file picker; never pass these to automatic file access. */
export function listExternalTilesets(input) {
  const document = normalizeDocument(input);
  return document.tilesets.filter(value => value.flags & 1).map(value => ({
    tilesetId: value.id, name: value.name, externalFileId: value.externalFileId,
    externalTilesetId: value.externalTilesetId,
    sourceLabel: document.metadata?.aseprite?.externalFiles?.find(file => file.id === value.externalFileId)?.name ?? '',
    hasEmbeddedFallback: !!value.imageId,
    tileWidth: value.tileWidth, tileHeight: value.tileHeight, tileCount: value.tileCount,
  }));
}

function checkLocks(document, target) {
  for (const layer of document.layers) if (layer.tilesetId === target.id || Object.values(layer.tilemaps ?? {}).some(map => map.tilesetId === target.id)) {
    let ancestor = layer;
    while (ancestor) { if (ancestor.locked) fail(`layer “${ancestor.name}” is locked; unlock it before replacing its shared tileset.`); ancestor = document.layers.find(value => value.id === ancestor.parentId); }
  }
}
function sourcePixels(document, tileset) {
  const count = integer(tileset.tileCount, 1, 65536, 'source tile count'), width = tileset.tileWidth, height = tileset.tileHeight;
  if (width * height * count > LIMITS.pixels || height * count > LIMITS.imageEdge) fail('the embedded source atlas exceeds the document pixel/dimension limit.');
  if (!tileset.imageId || !(tileset.flags & 2)) fail('the chosen source tileset has no embedded pixels; choose its actual embedded source file. Nested external links are not followed.');
  const atlas = document.images[tileset.imageId];
  if (!atlas || atlas.tilemap) fail('the source atlas is missing or is not a raster image.');
  if (!Array.isArray(tileset.tiles) || tileset.tiles.length !== count) fail('the source does not have a complete native tile-ID table; save it as an editable .ase file first.');
  const pixels = new Array(width * height * count), seen = new Set();
  for (const tile of tileset.tiles) {
    const index = integer(tile.asepriteTileId, 0, count - 1, 'source native tile ID'); if (seen.has(index)) fail('duplicate source native tile IDs.'); seen.add(index);
    const image = document.images[tile.imageId], rectangle = tile.sourceRect ?? { x: 0, y: 0, width: image?.width, height: image?.height };
    if (!image || image.tilemap || rectangle.width !== width || rectangle.height !== height) fail('source tile dimensions do not match the declared grid.');
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[(index * height + y) * width + x] = image.pixels[(rectangle.y + y) * image.width + rectangle.x + x];
  }
  return { width, height: height * count, pixels, count };
}
function nativeIndex(tile, label) {
  if (Number.isInteger(tile?.asepriteTileId)) return tile.asepriteTileId;
  fail(`${label} has an edited tile without a native ID; save/re-import it before resolving the link.`);
}
function validateReferences(document, target, count) {
  const existing = new Map((target.tiles ?? []).map(tile => [tile.id, tile]));
  for (const layer of document.layers) {
    for (const map of Object.values(layer.tilemaps ?? {})) if (map.tilesetId === target.id) for (const cell of map.cells) {
      if (!cell) continue;
      const index = nativeIndex(existing.get(cell.tileId), 'destination');
      if (index < 0 || index >= count) fail(`source is missing referenced tile ${index}.`);
    }
    if (layer.tilesetId !== target.id) continue;
    for (const frame of document.frames) {
      const cel = frame.cels[layer.id], map = document.images[cel?.imageId]?.tilemap;
      if (!map) continue;
      for (const raw of map.tiles) {
        const value = raw >>> 0, index = (value & (map.idMask ?? 0x1fffffff)) >>> 0;
        if (target.flags & 4 ? index === 0 : value === 0xffffffff) continue;
        if (index >= count) fail(`source is missing tile ${index}, referenced by frame “${frame.id}”.`);
      }
    }
  }
}
function freshImageId(document, tilesetId) {
  const prefix = `embedded-${tilesetId}`.slice(0, 110), used = new Set([document.id, ...Object.keys(document.images), ...document.layers.map(value => value.id), ...document.frames.map(value => value.id), ...document.tilesets.map(value => value.id), ...document.clips.map(value => value.id), ...document.slices.map(value => value.id)]);
  let n = 1; while (used.has(`${prefix}-${n}`)) n++; return `${prefix}-${n}`;
}
function retainedImages(document) {
  const used = new Set(document.frames.flatMap(frame => Object.values(frame.cels).map(cel => cel.imageId)));
  for (const tileset of document.tilesets) { if (tileset.imageId) used.add(tileset.imageId); for (const tile of tileset.tiles ?? []) used.add(tile.imageId); }
  return used;
}

/**
 * Embed exactly the external tileset ID declared by the destination.
 * Raster modes must match. Indexed pixels retain their raw indices and use destination frame palettes.
 * RGBA/gray pixels convert only when working profiles differ, using the caller's existing color manager.
 */
export function resolveExternalTileset(input, { tilesetId, sourceDocument, colorManager, intent = 1 } = {}) {
  const document = normalizeDocument(input), source = normalizeDocument(sourceDocument), { target, external } = selectedTileset(document, tilesetId);
  checkLocks(document, target);
  if (source.colorMode !== document.colorMode) fail(`source uses ${source.colorMode} and this document uses ${document.colorMode}; convert the source to the same color mode before choosing it.`);
  const matching = source.tilesets.filter((value, index) => (value.asepriteId ?? index) === target.externalTilesetId);
  if (matching.length !== 1) fail(`the chosen file must contain exactly one native tileset with ID ${target.externalTilesetId}.`);
  const from = matching[0];
  if (from.tileWidth !== target.tileWidth || from.tileHeight !== target.tileHeight) fail(`source grid ${from.tileWidth}×${from.tileHeight} differs from the required ${target.tileWidth}×${target.tileHeight}.`);
  const replaced = new Set([target.imageId, ...(target.tiles ?? []).map(tile => tile.imageId)].filter(Boolean));
  for (const frame of document.frames) for (const cel of Object.values(frame.cels)) replaced.delete(cel.imageId);
  for (const other of document.tilesets) if (other.id !== target.id) { replaced.delete(other.imageId); for (const tile of other.tiles ?? []) replaced.delete(tile.imageId); }
  const retainedPixels = Object.entries(document.images).reduce((total, [id, image]) => total + (replaced.has(id) ? 0 : image.width * image.height), 0);
  if (retainedPixels + from.tileWidth * from.tileHeight * from.tileCount > LIMITS.pixels) fail('embedding this source would exceed the document stored-pixel limit.');
  const raster = sourcePixels(source, from);
  if (target.tileCount != null && integer(target.tileCount, 0, 65536, 'destination tile count') > raster.count) fail('source has fewer tiles than the destination declares; choose the complete source.');
  validateReferences(document, target, raster.count);
  let converted = false;
  if (document.colorMode === 'indexed') {
    if (transparentIndex(source) !== transparentIndex(document)) fail('indexed source and destination must use the same transparent palette index.');
    let maximum = transparentIndex(document); for (const value of raster.pixels) if (value !== null) maximum = Math.max(maximum, value);
    for (const frame of document.frames) if (maximum >= getFramePalette(document, frame.id).length) fail(`destination frame “${frame.id}” is missing palette index ${maximum}; extend its palette or convert the source first.`);
  } else if (!matchingProfiles(documentProfile(source), documentProfile(document))) {
    if (typeof colorManager?.transformColors !== 'function') fail('these files use different color profiles; provide the existing color manager to convert the source pixels.');
    integer(intent, 0, 3, 'rendering intent');
    const colors = [...new Set(raster.pixels.filter(value => value !== null))], output = colorManager.transformColors(colors, documentProfile(source), documentProfile(document), { intent });
    if (!Array.isArray(output) || output.length !== colors.length) fail('color manager returned an invalid conversion result.');
    const normalized = output.map(normalizeColor);
    if (normalized.some((value, index) => value.slice(7) !== colors[index].slice(7))) fail('color conversion changed alpha.');
    if (document.colorMode === 'grayscale' && normalized.some(value => value.slice(1, 3) !== value.slice(3, 5) || value.slice(3, 5) !== value.slice(5, 7))) fail('profile conversion produced colored pixels for a grayscale document; convert the document to RGBA first.');
    const lookup = new Map(colors.map((value, index) => [value, normalized[index]])); raster.pixels = raster.pixels.map(value => value === null ? null : lookup.get(value)); converted = true;
  }
  const previousImages = new Set([target.imageId, ...(target.tiles ?? []).map(tile => tile.imageId)].filter(Boolean));
  const oldTiles = new Map(); for (const tile of target.tiles ?? []) { const index = nativeIndex(tile, 'destination'); if (oldTiles.has(index)) fail('duplicate destination native tile IDs.'); if (index < 0 || index >= raster.count) fail('source is missing an existing destination tile.'); oldTiles.set(index, tile); }
  const imageId = freshImageId(document, target.id), tileIds = new Set((target.tiles ?? []).map(tile => tile.id));
  target.imageId = imageId; target.tileCount = raster.count; target.flags = ((target.flags & ~1) | 2) >>> 0;
  delete target.externalFileId; delete target.externalTilesetId;
  target.tiles = Array.from({ length: raster.count }, (_, index) => {
    const previous = oldTiles.get(index); let id = previous?.id ?? `ase-tile-${index}`;
    if (!previous) { let n = 1; while (tileIds.has(id)) id = `ase-tile-${index}-${n++}`; tileIds.add(id); }
    return { ...previous, id, imageId, asepriteTileId: index, sourceRect: { x: 0, y: index * target.tileHeight, width: target.tileWidth, height: target.tileHeight } };
  });
  document.images[imageId] = { width: raster.width, height: raster.height, pixels: raster.pixels };
  const used = retainedImages(document); for (const id of previousImages) if (!used.has(id)) delete document.images[id];
  // Preserve external registry records: other tilesets, opaque metadata or application history may refer to them.
  const resolved = normalizeDocument(document);
  return { document: resolved, resolution: { tilesetId: target.id, sourceTilesetId: from.id, sourceNativeTilesetId: from.asepriteId ?? source.tilesets.indexOf(from), externalFileId: external.id, sourceLabel: external.name, tileCount: raster.count, convertedColors: converted, usesDestinationPalette: document.colorMode === 'indexed' } };
}
