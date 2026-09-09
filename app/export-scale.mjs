import { TILE_BACKDROP_CLEAR } from './tile-render-flags.mjs';
/** Export-only geometry, independently checked against native Aseprite output.
 * Keep palette indices and working-profile pixels intact until compositing. */
export const EXPORT_PIXEL_LIMIT = 64 * 1024 * 1024;
export function validateExportScale(value = 1) {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 64) throw Error('Scale must be a positive number up to 64.');
  return scale;
}
const dimension = (value, ratio) => Math.max(1, Math.trunc(value * ratio));
const position = (value, ratio) => Math.trunc(value * ratio) || 0;

/** Rectangles scale their endpoints; their sizes are not rounded independently. */
export function scaleExportRectangle(rect, sx, sy) {
  const x = position(rect.x, sx), y = position(rect.y, sy);
  return { ...rect, x, y, width: position(rect.x + rect.width, sx) - x, height: position(rect.y + rect.height, sy) - y };
}
function scaleSliceKey(key, sx, sy) {
  return { ...scaleExportRectangle(key, sx, sy),
    ...(key.pivot ? { pivot: { x: position(key.pivot.x, sx), y: position(key.pivot.y, sy) } } : {}),
    ...(key.center ? { center: scaleExportRectangle({ ...key.center, width: key.center.width ?? key.center.w, height: key.center.height ?? key.center.h }, sx, sy) } : {}),
  };
}

export function scaleExportSlices(slices, sx, sy) {
  return slices.map(slice => slice.bounds ? {
    ...slice, bounds: scaleExportRectangle(slice.bounds, sx, sy),
    ...(slice.pivot ? { pivot: { x: position(slice.pivot.x, sx), y: position(slice.pivot.y, sy) } } : {}),
    ...(slice.ninePatch ? { ninePatch: scaleExportRectangle(slice.ninePatch, sx, sy) } : {}),
  } : { ...slice, keys: slice.keys.map(key => scaleSliceKey(key, sx, sy)) });
}

/** Pure temporary render document. The source, links and native export stay intact.
 * Canvas ratios use the rounded destination size. Each cel/tile resamples locally.
 * Reference bitmaps retain their resolution; their precise display bounds scale.
 * This is not a persisted/normalized editor document: exports allow 64M pixels. */
export function scaleExportDocument(source, value) {
  const scale = validateExportScale(value);
  const width = dimension(source.width, scale), height = dimension(source.height, scale);
  if (!Number.isSafeInteger(width * height) || width * height > EXPORT_PIXEL_LIMIT) throw Error('Scaled output exceeds the pixel limit.');
  if (scale === 1 && !source.layers.some(layer => layer.type === 'tilemap')) return source;
  const sx = width / source.width, sy = height / source.height, images = { ...source.images };
  let allocated = 0, serial = 0;
  const reserve = (w, h) => {
    if (!Number.isSafeInteger(w * h) || w < 1 || h < 1 || (allocated += w * h) > EXPORT_PIXEL_LIMIT) throw Error('Scaled cel and tile images exceed the export pixel limit.');
  };
  const key = () => { let result; do { result = `export-scale-${serial++}`; } while (Object.hasOwn(images, result)); return result; };
  function resized(image, w, h) {
    reserve(w, h);
    const pixels = Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels[y * w + x] = image.pixels[Math.floor(y * image.height / h) * image.width + Math.floor(x * image.width / w)];
    return { ...image, width: w, height: h, pixels };
  }
  const rasterCopies = new Map(), layerById = new Map(source.layers.map(layer => [layer.id, layer]));
  const frames = source.frames.map(frame => ({ ...frame, cels: Object.fromEntries(Object.entries(frame.cels).map(([layerId, cel]) => {
    const layer = layerById.get(layerId), image = source.images[cel.imageId];
    let imageId = cel.imageId;
    const result = { ...cel, x: position(cel.x, sx), y: position(cel.y, sy) };
    if (layer.type === 'reference') {
      const b = cel.preciseBounds?.flags & 1 ? cel.preciseBounds : { flags: 1, x: cel.x, y: cel.y, width: image.width, height: image.height };
      result.preciseBounds = { ...b, x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy };
    } else if (!image.tilemap) {
      if (!rasterCopies.has(imageId)) { const id = key(); images[id] = resized(image, dimension(image.width, sx), dimension(image.height, sy)); rasterCopies.set(imageId, id); }
      imageId = rasterCopies.get(imageId);
      // Ordinary cels use their raster dimensions, including an imported inactive extra chunk.
      if (result.preciseBounds?.flags & 1) delete result.preciseBounds;
    }
    return [layerId, { ...result, imageId }];
  })) }));
  // Tile spacing truncates, while native tile bitmap dimensions round. Bake only
  // used orientations into temporary canonical tiles, then use ordinary rendering.
  // Diagonal flips transpose pixels within the grid; rectangular tiles are clipped,
  // never stretched to fill the grid. This also corrects integer native tile exports.
  const tilesets = source.tilesets.map(ts => ({ ...ts, tileWidth: dimension(ts.tileWidth, sx), tileHeight: dimension(ts.tileHeight, sy), tiles: [] }));
  const sets = new Map(tilesets.map((ts, index) => [ts.id, { source: source.tilesets[index], output: ts, variants: new Map() }]));
  function orientedTile(set, tileId, fx, fy, diagonal, canonical) {
    const cacheKey = JSON.stringify([tileId, fx, fy, diagonal, canonical]);
    if (set.variants.has(cacheKey)) return set.variants.get(cacheKey);
    const { source: ts, output } = set;
    let image, rect;
    if (canonical) {
      const tile = ts.tiles?.find(tile => tile.id === tileId); image = source.images[tile?.imageId];
      if (!image) throw Error('Tile references a missing image.');
      rect = tile.sourceRect ?? { x: 0, y: 0, width: image.width, height: image.height };
    } else {
      image = source.images[ts.imageId];
      if (!image) throw Error('Tile references a missing atlas.');
      const columns = Math.floor(image.width / ts.tileWidth);
      rect = { x: (tileId % columns) * ts.tileWidth, y: Math.floor(tileId / columns) * ts.tileHeight, width: ts.tileWidth, height: ts.tileHeight };
    }
    const bitmapWidth = Math.max(1, Math.round(ts.tileWidth * sx)), bitmapHeight = Math.max(1, Math.round(ts.tileHeight * sy));
    const w = output.tileWidth, h = output.tileHeight; reserve(w, h);
    const pixels = Array(w * h);let clearMask;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let ix = fx ? w - 1 - x : x, iy = fy ? h - 1 - y : y;
      if (diagonal) [ix, iy] = [iy, ix];
      if (ix >= bitmapWidth || iy >= bitmapHeight) { pixels[y * w + x] = null;clearMask??=new Uint8Array(w*h);clearMask[y*w+x]=1;continue; }
      ix = Math.floor(ix * ts.tileWidth / bitmapWidth); iy = Math.floor(iy * ts.tileHeight / bitmapHeight);
      if (canonical) { ix = Math.floor((ix + .5) * rect.width / ts.tileWidth); iy = Math.floor((iy + .5) * rect.height / ts.tileHeight); }
      ix += rect.x; iy += rect.y;
      pixels[y * w + x] = ix < 0 || iy < 0 || ix >= image.width || iy >= image.height ? null : image.pixels[iy * image.width + ix];
    }
    const imageId = key(), id = imageId;
    images[imageId] = { width: w, height: h, pixels, ...(clearMask?{[TILE_BACKDROP_CLEAR]:clearMask}:{}) }; output.tiles.push({ id, imageId });
    set.variants.set(cacheKey, id); return id;
  }
  const layers = source.layers.map(layer => {
    if (layer.type !== 'tilemap') return layer;
    const tilemaps = {};
    for (const frame of source.frames) {
      const map = layer.tilemaps?.[frame.id], cel = frame.cels[layer.id], rawImage = source.images[cel?.imageId], raw = rawImage?.tilemap;
      if (!map && !raw) continue;
      const set = sets.get(map?.tilesetId ?? layer.tilesetId);
      if (!set) throw Error('Tilemap references a missing tileset.');
      let cells;
      if (map) cells = map.cells.map(cell => {
        if (!cell) return null;
        let fx = !!cell.flipX, fy = !!cell.flipY, diagonal = false;
        if (cell.rotate === 90) { diagonal = true; [fx,fy] = [!fy,fx]; }
        if (cell.rotate === 180) { fx = !fx; fy = !fy; }
        if (cell.rotate === 270) { diagonal = true; [fx,fy] = [fy,!fx]; }
        return { tileId: orientedTile(set, cell.tileId, fx, fy, diagonal, true) };
      });
      else cells = raw.tiles.map(value => {
        value >>>= 0;
        const index = (value & (raw.idMask ?? 0x1fffffff)) >>> 0;
        if ((set.source.flags & 4) ? index === 0 : value === 0xffffffff) return null;
        if (index >= set.source.tileCount) return null;
        return { tileId: orientedTile(set, index, !!(value & (raw.xFlipMask ?? 0x80000000)), !!(value & (raw.yFlipMask ?? 0x40000000)), !!(value & (raw.diagonalFlipMask ?? 0x20000000)), false) };
      });
      tilemaps[frame.id] = { ...(map ?? {}), tilesetId: set.output.id, columns: map?.columns ?? rawImage.width, rows: map?.rows ?? rawImage.height, x: position(map?.x ?? cel?.x ?? 0, sx), y: position(map?.y ?? cel?.y ?? 0, sy), opacity: map?.opacity ?? cel?.opacity ?? 1, cells };
    }
    return { ...layer, tilemaps };
  });
  const slices = scaleExportSlices(source.slices, sx, sy);
  return { ...source, width, height, images, frames, layers, tilesets, slices };
}
