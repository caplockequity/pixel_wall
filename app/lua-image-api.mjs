import { assertTilesetEditable } from './tileset-access.mjs';
import { BLEND_MODES, createDocument, getFramePalette, renderFrame } from './editor-core.mjs';
const copy = value => structuredClone(value);
const integer = (value, min, max, label) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`${label} must be an integer from ${min} to ${max}.`); return value; };
const hex = bytes => '#' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
export const LUA_IMAGE_NOT_HANDLED = Symbol('image API not handled');

/** Worker-only image operations. Mutations remain buffered until the session's normal transactional flush. */
export function createLuaImageApi({ doc, image, ref, getRef, frameAt, celRef, reservePixels, flush, imagePixel, outputPixel, limits, specMask, renderedProfile, resized }) {
  let serial = 0; const ids = new WeakMap(), transfers = new Map();
  const id = value => { if (!ids.has(value)) ids.set(value, ++serial); return ids.get(value); };
  const mask = value => specMask(value);
  const bpp = value => value.colorMode === 'rgba' ? 4 : value.colorMode === 'grayscale' ? 2 : 1;
  const comparable = (value, pixel) => { const packed = outputPixel(value, pixel); return value.colorMode === 'indexed' || Math.floor(packed / (value.colorMode === 'rgba' ? 16777216 : 256)) !== 0 ? packed : 0; };
  const emptyPixel = value => mask(value);
  function editable(value) {
    if (!value.docId) return;
    const d = doc(value.docId);
    if (value.tilesetId) { if (value.virtualTile) throw Error('Virtual empty tile artwork cannot be edited; import an embedded native tileset first.'); assertTilesetEditable(d, value.tilesetId); return; }
    for (const frame of d.frames) for (const [layerId, cel] of Object.entries(frame.cels)) if (cel.imageId === value.imageId) {
      let layer = d.layers.find(entry => entry.id === layerId);
      while (layer) { if (layer.locked) throw Error(`Layer “${layer.name}” is locked.`); layer = d.layers.find(entry => entry.id === layer.parentId); }
    }
  }
  function changed(value, pixels, width = value.width, height = value.height) { editable(value); value.pixels = pixels; value.width = width; value.height = height; value.version = (value.version ?? 0) + 1; value.dirty = !!value.docId; }
  function dimensions(width, height) { integer(width, 1, 2048, 'Image width'); integer(height, 1, 2048, 'Image height'); if (width * height > limits.pixels) throw Error('Lua image pixel budget exceeded.'); }
  function crop(source, rectangle) {
    const x = integer(rectangle.x ?? 0, -65535, 65535, 'Crop x'), y = integer(rectangle.y ?? 0, -65535, 65535, 'Crop y'), width = integer(rectangle.width, -65535, 2048, 'Crop width'), height = integer(rectangle.height, -65535, 2048, 'Crop height');
    if (width <= 0 || height <= 0) return null; dimensions(width, height); reservePixels(width * height);
    const padding=imagePixel(source,mask(source));
    const pixels = Array.from({ length: width * height }, (_, at) => { const sx = x + at % width, sy = y + Math.floor(at / width); return sx >= 0 && sy >= 0 && sx < source.width && sy < source.height ? source.pixels[sy * source.width + sx] : padding; });
    return ref('Image', { width, height, pixels, colorMode: source.colorMode, transparentColor: mask(source), version: 0 });
  }
  function get(target, key) {
    if (target.__kind !== 'Image') return LUA_IMAGE_NOT_HANDLED;
    const value = image(target);
    if (key === 'id') return id(value);
    if (key === 'rowStride') return value.width * bpp(value);
    if (key === 'cel') {
      if (value.tilesetId) throw Error('Tileset internal Cel handles are not exposed; edit Tile.image directly.');
      if (value.docId) for (const frame of doc(value.docId).frames) for (const [layerId, cel] of Object.entries(frame.cels)) if (cel.imageId === value.imageId) return celRef(value.docId, layerId, frame.id);
      return null;
    }
    return LUA_IMAGE_NOT_HANDLED;
  }
  function bytesGet(target, start, count) {
    const value = image(target), stride = bpp(value), size = value.width * value.height * stride;
    integer(start, 0, size, 'Byte offset'); integer(count, 0, Math.min(4096, size - start), 'Byte count');
    return Array.from({ length: count }, (_, offset) => { const at = start + offset, packed = integer(outputPixel(value, value.pixels[Math.floor(at / stride)]), 0, 256 ** stride - 1, 'Packed image pixel'); return Math.floor(packed / 256 ** (at % stride)) & 255; });
  }
  function bytesBegin(target, size) { const value = image(target); editable(value); integer(size, value.width * value.height * bpp(value), value.width * value.height * bpp(value), 'Image byte length'); if (transfers.size) throw Error('An image byte transfer is already in progress.'); reservePixels(value.width * value.height); const token = ++serial; transfers.set(token, { value, bytes: new Uint8Array(size), at: 0 }); return token; }
  function bytesAppend(token, bytes) { const transfer = transfers.get(token); if (!transfer || !Array.isArray(bytes) || !bytes.length || bytes.length > 4096 || transfer.at + bytes.length > transfer.bytes.length) throw Error('Invalid image byte transfer.'); for (const byte of bytes) integer(byte, 0, 255, 'Image byte'); transfer.bytes.set(bytes, transfer.at); transfer.at += bytes.length; }
  function bytesCommit(token) {
    const transfer = transfers.get(token); if (!transfer || transfer.at !== transfer.bytes.length) throw Error('Incomplete image byte transfer.');
    const { value, bytes } = transfer, stride = bpp(value), pixels = new Array(value.width * value.height);
    for (let at = 0; at < pixels.length; at++) {
      const offset = at * stride;
      if (value.colorMode === 'indexed') { const index = bytes[offset]; if (value.docId && index >= Math.max(doc(value.docId).palette.length, ...doc(value.docId).frames.map(frame => frame.palette?.length ?? 0))) throw Error('Indexed bytes reference a missing sprite palette entry.'); pixels[at] = index; }
      else pixels[at] = value.colorMode === 'rgba' ? hex(bytes.subarray(offset, offset + 4)) : hex([bytes[offset], bytes[offset], bytes[offset], bytes[offset + 1]]);
    }
    changed(value, pixels); transfers.delete(token);
  }
  function rendered(sprite, frameNumber, destinationMode) {
    flush(); const source = doc(getRef(sprite, 'Sprite').docId), frameIndex = frameAt(source.id, frameNumber, 0), frameId = source.frames[frameIndex].id;
    if (destinationMode !== 'rgba' && destinationMode !== source.colorMode) throw Error('drawSprite supports matching color modes or an RGB destination; other cross-mode fitting is not implemented.');
    let rendering = source;
    if (destinationMode === 'indexed') {
      // Native indexed-to-indexed rendering copies index values, ignoring layer/cel opacity and blend modes.
      // An injective opaque palette lets the shared geometry/tilemap renderer preserve even duplicate colors' indices.
      const palette = Array.from({ length: Math.max(source.palette.length, ...source.frames.map(frame => frame.palette?.length ?? 0)) }, (_, index) => hex([index & 255, index >>> 8, 1, 255]));
      rendering = { ...source, palette, layers: source.layers.map(layer => ({ ...layer, opacity: 1, blendMode: 'normal', ...(layer.tilemaps ? { tilemaps: Object.fromEntries(Object.entries(layer.tilemaps).map(([key, map]) => [key, { ...map, opacity: 1 }])) } : {}) })), frames: source.frames.map(frame => ({ ...frame, palette, cels: Object.fromEntries(Object.entries(frame.cels).map(([key, cel]) => [key, { ...cel, opacity: 1 }])) })) };
    }
    const bytes = renderFrame(rendering, frameId), pixels = Array.from({ length: source.width * source.height }, (_, at) => {
      const c = bytes.subarray(at * 4, at * 4 + 4); if (!c[3]) return null;
      return destinationMode === 'indexed' ? c[0] + c[1] * 256 : hex(c);
    });
    return { width: source.width, height: source.height, pixels, ...(destinationMode === 'indexed' ? { coverage: Array.from({ length: pixels.length }, (_, at) => bytes[at * 4 + 3] > 0) } : {}), colorMode: destinationMode, transparentColor: source.metadata?.aseprite?.transparentIndex ?? 0, palette: getFramePalette(source, frameId) };
  }
  function spriteImage(sprite) { const source = doc(getRef(sprite, 'Sprite').docId), renderedImage = rendered(sprite, 1, source.colorMode); reservePixels(renderedImage.width * renderedImage.height); delete renderedImage.coverage; return ref('Image', { ...renderedImage, specProfile:renderedProfile(sprite), version: 0 }); }
  function draw(value, source, position = { x: 0, y: 0 }, opacity = 255, blendMode = 'normal') {
    editable(value); integer(position.x, -65535, 65535, 'Image position x'); integer(position.y, -65535, 65535, 'Image position y'); integer(opacity, 0, 255, 'Image opacity');
    if (blendMode !== 'src' && !BLEND_MODES.includes(blendMode)) throw Error('Unsupported image blend mode.');
    if (source.colorMode !== value.colorMode) throw Error('Image color modes must match.');
    if (blendMode === 'src') {
      const pixels = [...value.pixels];
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) { const dx = position.x + x, dy = position.y + y; if (dx >= 0 && dy >= 0 && dx < value.width && dy < value.height) pixels[dy * value.width + dx] = source.pixels[y * source.width + x]; }
      changed(value, pixels); return;
    }
    if (value.colorMode === 'indexed') {
      const pixels = [...value.pixels];
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) { const dx = position.x + x, dy = position.y + y, p = source.pixels[y * source.width + x]; if (dx >= 0 && dy >= 0 && dx < value.width && dy < value.height && p !== null && (source.coverage ? source.coverage[y * source.width + x] : p !== mask(source))) pixels[dy * value.width + dx] = p; }
      changed(value, pixels); return;
    }
    const seed = createDocument({ width: value.width, height: value.height }), first = seed.layers[0], frame = seed.frames[0];
    seed.layers = [first, { ...first, id: 'source', blendMode }];
    seed.images = { destination: { width: value.width, height: value.height, pixels: value.pixels }, source: { width: source.width, height: source.height, pixels: source.pixels } };
    frame.cels = { [first.id]: { imageId: 'destination', x: 0, y: 0, opacity: 1 }, source: { imageId: 'source', x: position.x, y: position.y, opacity: opacity / 255 } };
    const bytes = renderFrame(seed), pixels = Array.from({ length: value.width * value.height }, (_, at) => bytes[at * 4 + 3] ? hex(bytes.subarray(at * 4, at * 4 + 4)) : null);
    changed(value, pixels);
  }
  function method(target, name, args = []) {
    if (target.__kind !== 'Image') return LUA_IMAGE_NOT_HANDLED;
    const value = image(target);
    if (name === 'clear') {
      if (args.length > 2) throw Error('Unsupported Image:clear arguments.');
      const rectangle = args[0] && typeof args[0] === 'object' && (args[0].width !== undefined || args[0].height !== undefined) ? args[0] : { x: 0, y: 0, width: value.width, height: value.height };
      const pixel = imagePixel(value, rectangle === args[0] ? args[1] ?? mask(value) : args[0] ?? mask(value));
      const x = integer(rectangle.x ?? 0, -65535, 65535, 'Clear x'), y = integer(rectangle.y ?? 0, -65535, 65535, 'Clear y'), width = integer(rectangle.width, -65535, 65535, 'Clear width'), height = integer(rectangle.height, -65535, 65535, 'Clear height'), pixels = [...value.pixels];
      for (let py = Math.max(0, y); py < Math.min(value.height, y + height); py++) for (let px = Math.max(0, x); px < Math.min(value.width, x + width); px++) pixels[py * value.width + px] = pixel;
      changed(value, pixels); return;
    }
    if (name === 'resize') {
      const options = typeof args[0] === 'object' ? args[0] : { width: args[0], height: args[1] };
      if (!options || Object.keys(options).some(key => !['width', 'height', 'size', 'method', 'pivot'].includes(key))) throw Error('Unsupported Image:resize argument.');
      if (options.method != null && !['nearest', 'nearest-neighbor'].includes(options.method)) throw Error('Image:resize currently supports nearest-neighbor only.');
      if (options.pivot && (options.pivot.x !== 0 || options.pivot.y !== 0)) throw Error('Nonzero Image:resize pivots are not implemented.');
      const width = options.size?.width ?? options.width, height = options.size?.height ?? options.height; dimensions(width, height); editable(value); if (value.tilesetId && (width !== value.width || height !== value.height)) throw Error('Tile image dimensions must match the tileset grid.'); reservePixels(width * height);
      const pixels = Array.from({ length: width * height }, (_, at) => value.pixels[Math.min(value.height - 1, Math.floor(Math.floor(at / width) * value.height / height)) * value.width + Math.min(value.width - 1, Math.floor(at % width * value.width / width))]);
      changed(value, pixels, width, height); resized(value); ids.set(value, ++serial); return;
    }
    if (name === 'flip') { const axis = args[0] ?? 0; if (![0, 1].includes(axis) || args.length > 1) throw Error('Image:flip supports HORIZONTAL or VERTICAL.'); const pixels = Array.from({ length: value.pixels.length }, (_, at) => { const x = at % value.width, y = Math.floor(at / value.width); return value.pixels[(axis === 1 ? value.height - 1 - y : y) * value.width + (axis === 0 ? value.width - 1 - x : x)]; }); changed(value, pixels); return; }
    if (name === 'drawImage' || name === 'putImage') { if (args.length > 4) throw Error('Unsupported Image:drawImage arguments.'); draw(value, copy(image(args[0])), args[1], args[2], args[3]); return; }
    if (name === 'drawSprite' || name === 'putSprite') { if (args.length > 3 || args[1] == null) throw Error('Image:drawSprite requires a sprite and frame.'); const source = rendered(args[0], args[1], value.colorMode); draw(value, source, args[2]); return; }
    if (name === 'shrinkBounds') {
      const reference = args[0] == null ? emptyPixel(value) : comparable(value, imagePixel(value, args[0])); let x = value.width, y = value.height, right = -1, bottom = -1;
      for (let at = 0; at < value.pixels.length; at++) if (comparable(value, value.pixels[at]) !== reference) { const px = at % value.width, py = Math.floor(at / value.width); x = Math.min(x, px); y = Math.min(y, py); right = Math.max(right, px); bottom = Math.max(bottom, py); }
      return { __value: 'Rectangle', x: right < 0 ? 0 : x, y: bottom < 0 ? 0 : y, width: right < 0 ? 0 : right - x + 1, height: bottom < 0 ? 0 : bottom - y + 1 };
    }
    return LUA_IMAGE_NOT_HANDLED;
  }
  return { crop, spriteImage, get, method, editable, mask, comparable, bytesGet, bytesBegin, bytesAppend, bytesCommit, bytesCancel: token => transfers.delete(token) };
}
