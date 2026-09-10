import { createLuaColorCommands } from './lua-color-commands.mjs';
import { createLuaImageSpecs, LUA_SPEC_NOT_HANDLED } from './lua-image-specs.mjs';
import { createLuaColorSpaces, LUA_COLOR_SPACE_NOT_HANDLED } from './lua-color-spaces.mjs';
import { createLuaRasterLifetime } from './lua-raster-lifetime.mjs';
import { createLuaTilesets, LUA_TILE_NOT_HANDLED } from './lua-tilesets.mjs';
import { tilesetSlots } from './tileset-access.mjs';
import { createLuaImageApi, LUA_IMAGE_NOT_HANDLED } from './lua-image-api.mjs';
import { validateLuaColor } from './lua-colors.mjs';
import { createLuaAuthoring, LUA_NOT_HANDLED } from './lua-authoring.mjs';
import { applyCommand, createDocument, normalizeDocument, normalizeColor, pixelRGBA, getFramePalette, getTile } from './editor-core.mjs';

export const LUA_LIMITS = Object.freeze({ sourceBytes: 256 * 1024, pixels: 1048576, calls: 250000, commands: 4096, outputBytes: 32 * 1024 * 1024, memoryBytes: 32 * 1024 * 1024, timeoutMs: 3000, instructions: 100000000 });
const copy = value => structuredClone(value);
const integer = (value, min, max, label = 'Value') => { if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`${label} must be an integer from ${min} to ${max}.`); return value; };
const packed = bytes => (bytes[0] + bytes[1] * 256 + bytes[2] * 65536 + bytes[3] * 16777216) >>> 0;
const unpacked = value => { integer(value, 0, 0xffffffff, 'RGBA pixel'); return [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24]; };
const hex = bytes => '#' + bytes.map(v => integer(v, 0, 255, 'Color channel').toString(16).padStart(2, '0')).join('');
const modeName = value => ({ 0: 'rgba', 1: 'grayscale', 2: 'indexed', rgba: 'rgba', rgb: 'rgba', grayscale: 'grayscale', gray: 'grayscale', indexed: 'indexed' })[value] || (() => { throw Error('Unsupported color mode.'); })();
const modeNumber = value => ({ rgba: 0, grayscale: 1, indexed: 2 })[value];
const reference = (kind, id) => ({ __kind: kind, id });
const raster = layer => layer.type === 'image' || layer.type === 'reference';

/** Isolated state: every document mutation is replayable through the shared engine. */
export function createLuaSession({ document, activeFrameId, activeLayerId, selection, range, fgColor = [0, 0, 0, 255], bgColor = [255, 255, 255, 255], params = {} } = {}, {colorManager} = {}) {
  let colors = { fgColor: validateLuaColor(fgColor, 'Initial Lua foreground color'), bgColor: validateLuaColor(bgColor, 'Initial Lua background color') };
  let serial = 0, calls = 0, commandCount = 0, pixelsAllocated = 0, bytesLogged = 0;
  const tileImages = new Map(), tileImageTokens = new Map(), retiredTileImages = new Map();
  const documents = new Map(), seeds = new Map(), refs = new Map(), attached = new Map(), logs = [], transactions = [], prints = [];
  const initial = document ? normalizeDocument(copy(document)) : null;
  if (initial) documents.set(initial.id, initial);
  let active = initial?.id ?? null, frameIndex = initial ? Math.max(0, initial.frames.findIndex(f => f.id === activeFrameId)) : 0;
  let layerId = initial ? initial.layers.find(l => l.id === activeLayerId)?.id ?? initial.layers.find(raster)?.id ?? initial.layers[0].id : null;
  const activeRef = () => active ? spriteRef(active) : null;
  const doc = (id = active) => { const d = documents.get(id); if (!d) throw Error('This sprite is no longer available.'); return d; };
  const ref = (kind, data, key) => { const id = key ?? `lua-${++serial}`; if (!refs.has(id)) refs.set(id, { kind, ...data }); return reference(kind, id); };
  const getRef = (value, kind) => { const r = refs.get(value?.id); if (r?.profileRetired) throw Error('This Image was deleted by pixel or color-space conversion. Request the current cel image again.'); if (!r || r.kind !== kind || value.__kind !== kind) throw Error(`Expected a valid ${kind}.`); return r; };
  const spriteRef = id => ref('Sprite', { docId: id }, `sprite:${id}`);
  const layerRef = (docId, lid) => ref('Layer', { docId, layerId: lid }, `layer:${docId}:${lid}`);
  // Aseprite Frame handles intentionally refer to a frame NUMBER, even after insertion.
  const frameRef = (docId, index) => ref('Frame', { docId, index }, `frame:${docId}:${index}`);
  const frame = value => { const r = getRef(value, 'Frame'); const f = doc(r.docId).frames[r.index]; if (!f) throw Error('Frame no longer exists.'); return { ...r, value: f }; };
  const layer = value => { const r = getRef(value, 'Layer'); const l = doc(r.docId).layers.find(l => l.id === r.layerId); if (!l) throw Error('Layer no longer exists.'); return { ...r, value: l }; };
  function frameAt(docId, value, fallback = frameIndex) { return typeof value === 'number' ? integer(value, 1, doc(docId).frames.length, 'Frame number') - 1 : value ? (frame(value).docId === docId ? frame(value).index : (() => { throw Error('Frame belongs to another sprite.'); })()) : fallback; }
  function celRef(docId, lid, fid) { if (!doc(docId).frames.find(f => f.id === fid)?.cels[lid]) return null; return ref('Cel', { docId, layerId: lid, frameId: fid }, `cel:${docId}:${lid}:${fid}`); }
  function cel(value) { const r = getRef(value, 'Cel'); const c = doc(r.docId).frames.find(f => f.id === r.frameId)?.cels[r.layerId]; if (!c) throw Error('Cel no longer exists.'); return { ...r, value: c }; }
  function reservePixels(count) { pixelsAllocated += count; if (pixelsAllocated > LUA_LIMITS.pixels * 4) throw Error('Lua image allocation budget exceeded.'); }
  const rasterLifetime = createLuaRasterLifetime({refs,attached,doc});
  function imageRef(docId, imageId) {
    const {key,epoch} = rasterLifetime.identity(docId,imageId);
    if (!refs.has(key)) { const image = doc(docId).images[imageId]; if (!image || image.tilemap) throw Error('Lua raster Image does not support tilemaps.'); reservePixels(image.pixels.length); refs.set(key, { kind: 'Image', docId, imageId, ...copy(image), profileImageEpoch:epoch, colorMode: doc(docId).colorMode, dirty: false }); attached.set(key, refs.get(key)); }
    return reference('Image', key);
  }
  function tileSource(docId, tilesetId, index) { const d = doc(docId), ts = d.tilesets.find(ts => ts.id === tilesetId); if (!ts) throw Error('Tileset no longer exists.'); if (ts.tileWidth * ts.tileHeight > LUA_LIMITS.pixels) throw Error('Lua tile image pixel budget exceeded.'); const slots = tilesetSlots(d, ts); if (index >= slots.count) throw Error('Tile no longer exists.'); const tile = slots.entries.get(index); if (tile) return getTile(d, tilesetId, tile.id); if ((ts.flags & 1) || slots.native) throw Error('External or missing tile artwork must be embedded before access.'); return { width: ts.tileWidth, height: ts.tileHeight, pixels: Array(ts.tileWidth * ts.tileHeight).fill(null), virtualTile: true }; }
  function tileObject(docId, tilesetId, tileIndex) { if (tileIndex === 0) return '@zero'; const d = doc(docId), ts = d.tilesets.find(ts => ts.id === tilesetId); return ts && tilesetSlots(d, ts).entries.get(tileIndex)?.id; }
  const tileTokenKey = (docId, tilesetId, objectId) => JSON.stringify([docId, tilesetId, objectId]);
  function forgetTileImage(key, value) { if (transactions.length && value.tilesetId) retiredTileImages.set(key, value); attached.delete(key); refs.delete(key); }
  function tileImageRef(docId, tilesetId, tileIndex) {
    const owner = JSON.stringify([docId, tilesetId, tileIndex]); let key = tileImages.get(owner);
    if (!key || !refs.has(key)) { const source = tileSource(docId, tilesetId, tileIndex); reservePixels(source.width * source.height); const tileObjectId = tileObject(docId, tilesetId, tileIndex), tileImageToken = tileImageTokens.get(tileTokenKey(docId, tilesetId, tileObjectId)) ?? 0; const target = ref('Image', { docId, tilesetId, tileIndex, tileObjectId, tileImageToken, ...source, colorMode: doc(docId).colorMode, dirty: false }); key = target.id; tileImages.set(owner, key); attached.set(key, refs.get(key)); }
    return reference('Image', key);
  }
  function retireTileImage(docId, tilesetId, tileIndex) { const owner = JSON.stringify([docId, tilesetId, tileIndex]), key = tileImages.get(owner); tileImageTokens.set(tileTokenKey(docId, tilesetId, tileObject(docId, tilesetId, tileIndex)), ++serial); if (key) { const value = attached.get(key); if (value) forgetTileImage(key, value); tileImages.delete(owner); } }

  function moveTileImages(docId, tilesetId, tileIndex, insert) {
    const moving = [...attached].filter(([, value]) => value.docId === docId && value.tilesetId === tilesetId);
    for (const [, value] of moving) tileImages.delete(JSON.stringify([docId, tilesetId, value.tileIndex]));
    for (const [key, value] of moving) {
      if (!insert && value.tileIndex === tileIndex) { forgetTileImage(key, value); continue; }
      if (value.tileIndex >= tileIndex) value.tileIndex += insert ? 1 : -1;
      tileImages.set(JSON.stringify([docId, tilesetId, value.tileIndex]), key);
    }
  }
  function snapshotTileImages() { return new Map(tileImageTokens); }
  function restoreTileImages(snapshot) {
    const candidates = new Map([...retiredTileImages, ...[...attached].filter(([, value]) => value.tilesetId)]);
    for (const [key, value] of attached) if (value.tilesetId) { attached.delete(key); refs.delete(key); }
    tileImages.clear(); tileImageTokens.clear(); for (const [key, value] of snapshot) tileImageTokens.set(key, value);
    for (const [key, value] of candidates) {
      const d = documents.get(value.docId), ts = d?.tilesets.find(ts => ts.id === value.tilesetId); if (!ts) continue;
      const slots = tilesetSlots(d, ts), index = value.tileObjectId === '@zero' ? slots.count ? 0 : -1 : [...slots.entries].find(([, tile]) => tile.id === value.tileObjectId)?.[0] ?? -1;
      if (index < 0 || value.tileImageToken !== (tileImageTokens.get(tileTokenKey(value.docId, value.tilesetId, value.tileObjectId)) ?? 0)) continue;
      value.tileIndex = index; refs.set(key, value); attached.set(key, value); tileImages.set(JSON.stringify([value.docId, value.tilesetId, index]), key); retiredTileImages.delete(key);
    }
    if (!transactions.length) retiredTileImages.clear();
  }

  function image(value) { return getRef(value, 'Image'); }
  function invalidateImages(docId) { for (const [key, item] of attached) if (item.docId === docId) { let current; try { current = item.tilesetId ? tileSource(docId, item.tilesetId, item.tileIndex) : doc(docId).images[item.imageId]; } catch { current = null; } if (current) { item.width = current.width; item.height = current.height; item.pixels = [...current.pixels]; item.colorMode = doc(docId).colorMode; item.virtualTile = !!current.virtualTile; item.dirty = false; } else { forgetTileImage(key, item); } } }
  function apply(docId, command, label = command.type) {
    if (++commandCount > LUA_LIMITS.commands) throw Error('Lua command budget exceeded.');
    bytesLogged += JSON.stringify(command).length;
    if (bytesLogged > LUA_LIMITS.outputBytes) throw Error('Lua command output budget exceeded.');
    const next = applyCommand(doc(docId), command);
    if (Object.values(next.images).reduce((sum, i) => sum + i.width * i.height, 0) > LUA_LIMITS.pixels) throw Error('Lua sprite pixel budget exceeded.');
    documents.set(docId, next);
    authoring.track(next); colorCommands.track(next, command);
    const transaction = transactions.at(-1);
    (transaction?.entries ?? logs).push({ documentId: docId, label, commands: [copy(command)] });
    return next;
  }
  function flush() {
    for (const value of attached.values()) if (value.dirty) {
      if (value.tilesetId) { apply(value.docId, { type: 'tileset.tileImage', tilesetId: value.tilesetId, tileIndex: value.tileIndex, width: value.width, height: value.height, pixels: value.pixels }, 'Edit tile image pixels'); value.dirty = false; continue; }
      const d = doc(value.docId); let target;
      for (const f of d.frames) for (const [lid, c] of Object.entries(f.cels)) if (c.imageId === value.imageId) { target = { frameId: f.id, layerId: lid, ...c }; break; }
      if (!target) throw Error('The edited image is no longer attached to this sprite.');
      apply(value.docId, { type: 'cel.set', frameId: target.frameId, layerId: target.layerId, width: value.width, height: value.height, pixels: value.pixels, x: target.x, y: target.y, opacity: target.opacity, editLinked: true }, 'Edit image pixels');
      value.dirty = false;
    }
  }
  function mutate(docId, command) { flush(); const result = apply(docId, command); if (['tileset.tileInsert', 'tileset.tileRemove'].includes(command.type)) moveTileImages(docId, command.tilesetId, command.tileIndex ?? result.tilesets.find(ts => ts.id === command.tilesetId).tileCount - 1, command.type === 'tileset.tileInsert'); invalidateImages(docId); if(command.type==='document.colorProfile')imageSpecs.profileAssigned(docId); return result; }
  function inputColor(value, mode = 'rgba', palette = doc().palette) {
    if (value && typeof value === 'object') {
      if (value.index !== undefined && mode === 'indexed') return integer(value.index, 0, Math.min(255, palette.length - 1), 'Palette index');
      value = hex([value.red ?? value.r ?? 0, value.green ?? value.g ?? 0, value.blue ?? value.b ?? 0, value.alpha ?? value.a ?? 255]);
    }
    if (typeof value === 'string') return normalizeColor(value);
    if (typeof value === 'number') {
      if (mode === 'indexed') return integer(value, 0, Math.min(255, palette.length - 1), 'Palette index');
      if (mode === 'grayscale') { integer(value, 0, 65535, 'Gray pixel'); return hex([value & 255, value & 255, value & 255, value >>> 8]); }
      return hex(unpacked(value));
    }
    if (value == null) return null;
    throw Error('Expected Color or packed pixel value.');
  }
  function imagePixel(value, pixel) {
    const mode = value.colorMode;
    const p = inputColor(pixel, mode, value.docId ? { length: Math.max(doc(value.docId).palette.length, ...doc(value.docId).frames.map(frame => frame.palette?.length ?? 0)) } : Array(256).fill('#000000ff'));
    if (mode === 'indexed' && typeof p !== 'number' && p !== null) throw Error('Indexed Image pixels must be palette indices or Color{index=...}.');
    if (mode === 'grayscale' && p !== null && typeof p === 'string') { const channels = pixelRGBA({}, p); if (channels[0] !== channels[1] || channels[1] !== channels[2]) throw Error('Gray Image colors must have equal RGB channels.'); }
    return p;
  }
  function outputPixel(value, p) { if (value.colorMode === 'indexed') return p ?? (value.docId ? doc(value.docId).metadata?.aseprite?.transparentIndex ?? 0 : value.transparentColor ?? 0); const c = pixelRGBA({}, p); return value.colorMode === 'grayscale' ? c[0] + c[3] * 256 : packed(c); }
  function colorValue(value) { const [red, green, blue, alpha] = pixelRGBA({}, value); return { __value: 'Color', red, green, blue, alpha }; }
  function palette(value) { return colorCommands.palette(value); }
  function imageNew(options) {
    if(options.source?.__kind==='ImageSpec'){if(options.rectangle!=null)throw Error('Image(spec) accepts one specification.');const spec=imageSpecs.options(options.source);reservePixels(spec.width*spec.height);const value={...spec,specProfile:spec.profile,version:0};delete value.profile;const pixel=imagePixel(value,spec.transparentColor);return ref('Image',{...value,pixels:Array(spec.width*spec.height).fill(pixel)});}
    if (options.source?.__kind === 'Image') { const original = image(options.source); return images.crop(original, options.rectangle ?? { x: 0, y: 0, width: original.width, height: original.height }); }
    if (options.source?.__kind === 'Sprite') { if (options.rectangle != null) throw Error('Image(sprite, rectangle) is not supported; crop a rendered Image instead.'); return images.spriteImage(options.source); }
    if (Object.keys(options).some(key => !['width', 'height', 'colorMode', 'transparentColor'].includes(key))) throw Error('Unsupported Image specification field.');
    const width = integer(options.width, 1, 2048, 'Image width'), height = integer(options.height, 1, 2048, 'Image height');
    if (width * height > LUA_LIMITS.pixels) throw Error('Lua image pixel budget exceeded.'); reservePixels(width * height);
    if (modeName(options.colorMode ?? 0) !== 'indexed' && (options.transparentColor ?? 0) !== 0) throw Error('Custom mask colors are only supported for indexed Images.');
    return ref('Image', { width, height, colorMode: modeName(options.colorMode ?? 0), transparentColor: integer(options.transparentColor ?? 0, 0, 255, 'Image transparent color'), pixels: Array(width * height).fill(null), version: 0 });
  }
  const images = createLuaImageApi({ doc, image, ref, getRef, frameAt, celRef, reservePixels, flush, imagePixel, outputPixel, limits: LUA_LIMITS, specMask:value=>imageSpecs.mask(value), renderedProfile:sprite=>imageSpecs.renderedProfile(sprite), resized:value=>imageSpecs.resized(value) });
  const colorSpaces = createLuaColorSpaces({ref,getRef,doc,flush,mutate,retireRasterImages:rasterLifetime.retire,colorManager});
  const imageSpecs=createLuaImageSpecs({ref,getRef,image,doc,colorSpaces,limits:LUA_LIMITS});
  const tiles = createLuaTilesets({ doc, ref, getRef, mutate, tileImageRef, image, retireTileImage, reservePixels, limits: LUA_LIMITS, newId: prefix => `lua-${prefix}-${++serial}`, layerRef, getActiveLayer: () => layerId, setActiveLayer: value => { layerId = value; } });
  const authoring = createLuaAuthoring({ tileObject: tiles.object, doc, mutate, ref, getRef, frameAt, frameRef, layerRef, celRef, imageRef, spriteRef, layer, cel, inputColor, colorValue, getActive: () => ({ docId: active, frameIndex, layerId }), limits: LUA_LIMITS });
  const colorCommands = createLuaColorCommands({ doc, ref, getRef, mutate, flush, frameRef, getActive: () => ({ docId: active, frameIndex }), getRangeColors: () => authoring.finish().range?.colors ?? [], retireImages: docId => { rasterLifetime.retire(docId); for (const value of [...attached.values()]) if (value.docId === docId && value.tilesetId) retireTileImage(docId, value.tilesetId, value.tileIndex); } });
  if (initial) { authoring.track(initial); authoring.initialize(initial.id, selection, range); }
  function get(target, key) {
    const specValue=imageSpecs.get(target,key); if(specValue!==LUA_SPEC_NOT_HANDLED)return specValue;
    const profileValue = colorSpaces.get(target,key); if (profileValue !== LUA_COLOR_SPACE_NOT_HANDLED) return profileValue;
    const tileValue = tiles.get(target, key); if (tileValue !== LUA_TILE_NOT_HANDLED) return tileValue;
    const imageValue = images.get(target, key); if (imageValue !== LUA_IMAGE_NOT_HANDLED) return imageValue;
    const extra = authoring.get(target, key); if (extra !== LUA_NOT_HANDLED) return extra;
    const kind = target.__kind;
    if (kind === 'Sprite') {
      const d = doc(getRef(target, kind).docId);
      const values = { id: d.id, width: d.width, height: d.height, filename: d.name, colorMode: modeNumber(d.colorMode), bounds: { __value: 'Rectangle', x: 0, y: 0, width: d.width, height: d.height }, isValid: true, isModified: d !== initial, hasAssociatedFile: false, transparentColor: d.metadata?.aseprite?.transparentIndex ?? 0 };
      if (key in values) return values[key];
      if (key === 'frames') return d.frames.map((_, i) => frameRef(d.id, i));
      if (key === 'layers') return d.layers.filter(l => !l.parentId).map(l => layerRef(d.id, l.id));
      if (key === 'palettes') return colorCommands.list(d.id);
      if (key === 'cels') return d.frames.flatMap(f => d.layers.flatMap(l => f.cels[l.id] ? [celRef(d.id, l.id, f.id)] : []));
    } else if (kind === 'Layer') {
      const l = layer(target), d = doc(l.docId), v = l.value;
      const values = { name: v.name, isVisible: v.visible, isEditable: !v.locked, opacity: Math.round(v.opacity * 255), isImage: raster(v), isGroup: v.type === 'group', isTilemap: v.type === 'tilemap', isReference: v.type === 'reference', isBackground: Boolean(v.asepriteFlags & 8), blendMode: v.blendMode, stackIndex: d.layers.filter(o => o.parentId === v.parentId).findIndex(o => o.id === v.id) + 1, sprite: spriteRef(d.id), parent: v.parentId ? layerRef(d.id, v.parentId) : spriteRef(d.id) };
      if (key in values) return values[key];
      if (key === 'layers') return d.layers.filter(o => o.parentId === v.id).map(o => layerRef(d.id, o.id));
      if (key === 'cels') return d.frames.flatMap(f => f.cels[v.id] ? [celRef(d.id, v.id, f.id)] : []);
    } else if (kind === 'Frame') {
      const f = frame(target), d = doc(f.docId);
      const values = { frameNumber: f.index + 1, duration: f.value.durationMs / 1000, sprite: spriteRef(f.docId), previous: f.index ? frameRef(d.id, f.index - 1) : null, next: f.index + 1 < d.frames.length ? frameRef(d.id, f.index + 1) : null };
      if (key in values) return values[key];
    } else if (kind === 'Cel') {
      const c = cel(target), d = doc(c.docId), i = d.images[c.value.imageId];
      if (key === 'image') return imageRef(d.id,c.value.imageId);
      const tileset = i.tilemap ? d.tilesets.find(t => t.id === d.layers.find(l => l.id === c.layerId)?.tilesetId) : null;
      const values = { sprite: spriteRef(d.id), layer: layerRef(d.id, c.layerId), frame: frameRef(d.id, d.frames.findIndex(f => f.id === c.frameId)), frameNumber: d.frames.findIndex(f => f.id === c.frameId) + 1, position: { __value: 'Point', x: c.value.x, y: c.value.y }, bounds: { __value: 'Rectangle', x: c.value.x, y: c.value.y, width: i.width * (tileset?.tileWidth ?? 1), height: i.height * (tileset?.tileHeight ?? 1) }, opacity: Math.round(c.value.opacity * 255), zIndex: c.value.zIndex ?? 0 };
      if (key in values) return values[key];
    } else if (kind === 'Image') {
      const i = image(target), values = { width: i.width, height: i.height, id: target.id, version: i.version ?? 0, colorMode: modeNumber(i.colorMode), bounds: { __value: 'Rectangle', x: 0, y: 0, width: i.width, height: i.height }, bytesPerPixel: i.colorMode === 'rgba' ? 4 : i.colorMode === 'grayscale' ? 2 : 1 };
      if (key in values) return values[key];
    } else if (kind === 'Palette') { if (key === 'size') return palette(target).colors.length; if (key === 'frame') return colorCommands.frame(target); }
    throw Error(`Unsupported ${kind}.${key}. See PixelWall Lua compatibility documentation.`);
  }
  function set(target, key, value) {
    const specValue=imageSpecs.set(target,key,value); if(specValue!==LUA_SPEC_NOT_HANDLED)return specValue;
    const profileValue = colorSpaces.set(target,key,value); if (profileValue !== LUA_COLOR_SPACE_NOT_HANDLED) return profileValue;
    if (tiles.set(target, key, value)) return;
    if (authoring.set(target, key, value)) return;
    if (target.__kind === 'Sprite' && key === 'transparentColor') { const d = doc(getRef(target, 'Sprite').docId); if (d.colorMode !== 'indexed') throw Error('transparentColor requires an indexed sprite.'); mutate(d.id, { type: 'document.update', patch: { metadata: { ...d.metadata, aseprite: { ...d.metadata?.aseprite, transparentIndex: integer(value, 0, d.palette.length - 1) } } } }); return; }
    if (target.__kind === 'Sprite' && key === 'filename') return mutate(getRef(target, 'Sprite').docId, { type: 'document.update', patch: { name: String(value) } }).name;
    if (target.__kind === 'Layer') {
      const l = layer(target), fields = { name: 'name', isVisible: 'visible', isEditable: 'locked', opacity: 'opacity', blendMode: 'blendMode' };
      if (fields[key]) { mutate(l.docId, { type: 'layer.update', layerId: l.layerId, patch: { [fields[key]]: key === 'isEditable' ? !value : key === 'opacity' ? integer(value, 0, 255) / 255 : value } }); return; }
      if (key === 'parent') { const parent = value.__kind === 'Sprite' ? getRef(value, 'Sprite') : layer(value); if (parent.docId !== l.docId) throw Error('Parent belongs to another sprite.'); mutate(l.docId, { type: 'layer.update', layerId: l.layerId, patch: { parentId: parent.layerId ?? null } }); return; }
      if (key === 'stackIndex') { const d = doc(l.docId), siblings = d.layers.filter(o => o.parentId === l.value.parentId), sibling = siblings[integer(value, 1, siblings.length) - 1]; mutate(l.docId, { type: 'layer.reorder', layerId: l.layerId, index: d.layers.indexOf(sibling) }); return; }
    }
    if (target.__kind === 'Frame' && key === 'duration') { const f = frame(target); if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('Frame duration must be seconds.'); mutate(f.docId, { type: 'frame.update', frameId: f.value.id, patch: { durationMs: integer(Math.round(value * 1000), 1, 65535, 'Frame duration in milliseconds') } }); return; }
    if (target.__kind === 'Cel') {
      const c = cel(target);
      if (key === 'zIndex') { mutate(c.docId, {type:'cel.move',frameId:c.frameId,layerId:c.layerId,zIndex:integer(value,-2147483648,2147483647,'Cel z-index')}); return; }
      if (key === 'position' || key === 'opacity') { mutate(c.docId, { type: 'cel.move', frameId: c.frameId, layerId: c.layerId, ...(key === 'position' ? { x: value.x, y: value.y } : { opacity: integer(value, 0, 255) / 255 }) }); return; }
      if (key === 'frame' || key === 'frameNumber') { const index = frameAt(c.docId, value), fid = doc(c.docId).frames[index].id; if (fid === c.frameId) return; mutate(c.docId, { type: 'cel.link', layerId: c.layerId, sourceFrameId: c.frameId, frameId: fid }); mutate(c.docId, { type: 'cel.clear', layerId: c.layerId, frameId: c.frameId }); getRef(target, 'Cel').frameId = fid; return; }
      if (key === 'image') { const i = image(value); if (i.colorMode !== doc(c.docId).colorMode) throw Error('Image and sprite color modes must match.'); mutate(c.docId, { type: 'cel.set', frameId: c.frameId, layerId: c.layerId, width: i.width, height: i.height, pixels: [...i.pixels], x: c.value.x, y: c.value.y, opacity: c.value.opacity }); imageSpecs.attachedCopy(c.docId,doc(c.docId).frames.find(f=>f.id===c.frameId).cels[c.layerId].imageId,i); return; }
    }
    throw Error(`Unsupported or read-only ${target.__kind}.${key}.`);
  }
  function method(target, name, args = []) {
    const profileValue = colorSpaces.method(target,name,args); if (profileValue !== LUA_COLOR_SPACE_NOT_HANDLED) return profileValue;
    const tileValue = tiles.method(target, name, args); if (tileValue !== LUA_TILE_NOT_HANDLED) return tileValue;
    const imageValue = images.method(target, name, args); if (imageValue !== LUA_IMAGE_NOT_HANDLED) return imageValue;
    const extra = authoring.method(target, name, args); if (extra !== LUA_NOT_HANDLED) return extra;
    if (target.__kind === 'Sprite') {
      const docId = getRef(target, 'Sprite').docId, d = doc(docId);
      if (name === 'newLayer' || name === 'newGroup') { let id; do { id = `lua-layer-${++serial}`; } while (d.layers.some(l => l.id === id)); mutate(docId, { type: 'layer.add', layer: { id, type: name === 'newGroup' ? 'group' : 'image' } }); layerId = id; return layerRef(docId, id); }
      if (name === 'deleteLayer') { const l = typeof args[0] === 'string' ? d.layers.find(l => l.name === args[0]) : layer(args[0]).value; if (!l) throw Error('Layer not found.'); mutate(docId, { type: 'layer.remove', layerId: l.id }); if (layerId === l.id) layerId = doc(docId).layers[0].id; return; }
      if (name === 'newFrame' || name === 'newEmptyFrame') {
        const index = args[0] == null ? d.frames.length : typeof args[0] === 'number' ? integer(args[0], 1, d.frames.length + (name === 'newEmptyFrame' ? 1 : 0), 'Frame number') - 1 : frameAt(docId, args[0]);
        const sourceIndex = Math.min(index, d.frames.length - 1), previousIds = new Set(d.frames.map(f => f.id));
        mutate(docId, name === 'newFrame' ? { type: 'frame.duplicate', frameId: d.frames[sourceIndex].id } : { type: 'frame.add', durationMs: d.frames[sourceIndex].durationMs });
        const added = doc(docId).frames.find(f => !previousIds.has(f.id));
        const nextIndex = doc(docId).frames.findIndex(f => f.id === added.id);
        if (index !== nextIndex) mutate(docId, { type: 'frame.reorder', frameId: added.id, index });
        for (const clip of d.clips) {
          const current = doc(docId), indices = clip.frameIds.map(id => current.frames.findIndex(f => f.id === id)), previous = clip.frameIds.map(id => d.frames.findIndex(f => f.id === id));
          if (index > Math.min(...previous) && index <= Math.max(...previous) + 1) indices.push(index);
          const frameIds = current.frames.slice(Math.min(...indices), Math.max(...indices) + 1).map(f => f.id);
          if (JSON.stringify(frameIds) !== JSON.stringify(clip.frameIds)) mutate(docId, { type: 'clip.update', clipId: clip.id, patch: { frameIds } });
        }
        frameIndex = index; return frameRef(docId, index);
      }
      if (name === 'deleteFrame') { const index = frameAt(docId, args[0]); mutate(docId, { type: 'frame.remove', frameId: d.frames[index].id }); frameIndex = Math.min(frameIndex, doc(docId).frames.length - 1); return; }
      if (name === 'newCel') {
        const l = layer(args[0]); if (l.docId !== docId) throw Error('Layer belongs to another sprite.'); const index = frameAt(docId, args[1]);
        const i = args[2] ? image(args[2]) : image(imageNew({ width: d.width, height: d.height, colorMode: modeNumber(d.colorMode) }));
        if (i.colorMode !== d.colorMode) throw Error('Image and sprite color modes must match.');
        const position = args[3] ?? { x: 0, y: 0 };
        mutate(docId, { type: 'cel.set', layerId: l.layerId, frameId: d.frames[index].id, width: i.width, height: i.height, pixels: [...i.pixels], x: position.x, y: position.y });
        imageSpecs.attachedCopy(docId,doc(docId).frames[index].cels[l.layerId].imageId,i);
        return celRef(docId, l.layerId, d.frames[index].id);
      }
      if (name === 'deleteCel') { const c = args[0]?.__kind === 'Cel' ? cel(args[0]) : { layerId: layer(args[0]).layerId, frameId: d.frames[frameAt(docId, args[1])].id }; mutate(docId, { type: 'cel.clear', layerId: c.layerId, frameId: c.frameId }); return; }
      if (name === 'setPalette') { const p = palette(args[0]); colorCommands.setFirst(docId, p.colors); return; }
      if (name === 'resize') { const value = typeof args[0] === 'object' ? args[0] : { width: args[0], height: args[1] }; mutate(docId, { type: 'document.resize', width: value.width, height: value.height, mode: 'scale' }); return; }
    }
    if (target.__kind === 'Layer' && name === 'cel') { const l = layer(target); return celRef(l.docId, l.layerId, doc(l.docId).frames[frameAt(l.docId, args[0])].id); }
    if (target.__kind === 'Image') {
      const i = image(target);
      if (name === 'clone') return images.crop(i, { x: 0, y: 0, width: i.width, height: i.height });
      if (name === 'getPixel') { const x = integer(args[0], -65535, 65535), y = integer(args[1], -65535, 65535); return outputPixel(i, x < 0 || y < 0 || x >= i.width || y >= i.height ? null : i.pixels[y * i.width + x]); }
      if (name === 'drawPixel' || name === 'putPixel') { images.editable(i); const x = integer(args[0], -65535, 65535), y = integer(args[1], -65535, 65535); if (x < 0 || y < 0 || x >= i.width || y >= i.height) return; i.pixels[y * i.width + x] = imagePixel(i, args[2]); i.dirty = !!i.docId; i.version = (i.version ?? 0) + 1; return; }
      if (name === 'clear') { images.editable(i); i.pixels.fill(imagePixel(i, args[0] ?? images.mask(i))); i.dirty = !!i.docId; i.version = (i.version ?? 0) + 1; return; }
      if (name === 'isEmpty') return i.pixels.every(p => i.colorMode === 'indexed' ? outputPixel(i,p) === images.mask(i) : pixelRGBA({},p)[3] === 0);
      if (name === 'isPlain') { const p = images.comparable(i,imagePixel(i, args[0])); return i.pixels.every(v => images.comparable(i,v) === p); }
      if (name === 'isEqual') { const other = image(args[0]); return i.width === other.width && i.height === other.height && i.colorMode === other.colorMode && i.pixels.every((p, n) => images.comparable(i,p) === images.comparable(other,other.pixels[n])); }
    }
    if (target.__kind === 'Palette') {
      const p = palette(target), colors = [...p.colors];
      if (name === 'getColor') return colorValue(colors[integer(args[0], 0, colors.length - 1, 'Palette index')]);
      if (name === 'setColor') colors[integer(args[0], 0, colors.length - 1, 'Palette index')] = inputColor(args[1], 'rgba', colors);
      else if (name === 'resize') { const size = integer(args[0], 1, 256, 'Palette size'); colors.length = Math.min(colors.length, size); while (colors.length < size) colors.push('#000000ff'); }
      else throw Error(`Unsupported Palette:${name}().`);
      colorCommands.set(target, colors);
      return;
    }
    throw Error(`Unsupported ${target.__kind}:${name}(). Files, exports, dialogs and extensions are unavailable in the Lua sandbox.`);
  }
  function appGet(key) {
    const extra = authoring.appGet(key); if (extra !== LUA_NOT_HANDLED) return extra;
    const aliases = { activeSprite: 'sprite', activeFrame: 'frame', activeLayer: 'layer', activeCel: 'cel', activeImage: 'image' }; key = aliases[key] ?? key;
    if (key === 'sprite') return activeRef();
    if (key === 'sprites') return [...documents.keys()].map(spriteRef);
    if (key === 'params') return copy(params);
    if (key === 'isUIAvailable') return false;
    if (key === 'pixelwallApiVersion') return 1;
    if (!active) return null;
    if (key === 'frame') return frameRef(active, frameIndex);
    if (key === 'layer') return layerRef(active, layerId);
    if (key === 'cel' || key === 'image') { const c = celRef(active, layerId, doc().frames[frameIndex].id); return key === 'image' ? c && imageRef(active, cel(c).value.imageId) : c; }
    throw Error(`Unsupported app.${key}.`);
  }
  function appSet(key, value) {
    key = ({ activeSprite: 'sprite', activeFrame: 'frame', activeLayer: 'layer' })[key] ?? key;
    if (key === 'sprite') { active = getRef(value, 'Sprite').docId; frameIndex = 0; layerId = doc().layers[0].id; return; }
    if (key === 'frame') { frameIndex = frameAt(active, value); return; }
    if (key === 'layer') { const l = layer(value); if (l.docId !== active) throw Error('Layer belongs to another sprite.'); layerId = l.layerId; return; }
    throw Error(`Unsupported app.${key} assignment.`);
  }
  function command(name, options = {}) {
    if (name === 'ChangePixelFormat' || name === 'ColorQuantization') return colorCommands.command(name, options);
    if (['SelectAll', 'Deselect', 'InvertMask', 'Clear'].includes(name)) { if (Object.keys(options).some(key => key !== 'ui')) throw Error(`Unsupported options for app.command.${name}.`); authoring.selectionCommand(name); return; }
    const d = doc(), fid = d.frames[frameIndex].id;
    const allowed = { NewLayer: ['name', 'group', 'tilemap', 'gridBounds'], NewFrame: ['content'], NewEmptyFrame: [], RemoveFrame: [], RemoveLayer: [], MergeDownLayer: [], MergeDown: [], DuplicateLayer: ['name'], ClearCel: [], UnlinkCel: [], SpriteSize: ['width', 'height', 'method'], CanvasSize: ['width', 'height'] }[name];
    if (allowed && Object.keys(options).some(key => key !== 'ui' && !allowed.includes(key))) throw Error(`Unsupported options for app.command.${name}.`);
    if (name === 'SpriteSize' && options.method !== undefined && !['nearest', 'nearest-neighbor'].includes(options.method)) throw Error('Lua SpriteSize currently supports nearest-neighbor only.');
    if (name === 'NewFrame' && options.content !== undefined && !['empty', 'current'].includes(options.content)) throw Error('Unsupported NewFrame content option.');
    if (name === 'NewLayer' && options.tilemap) { tiles.newLayer(activeRef(), options); return true; }
    if (name === 'NewLayer' && options.gridBounds != null) throw Error('gridBounds requires a tilemap layer.');
    if (name === 'NewLayer') { const result = method(activeRef(), options.group ? 'newGroup' : 'newLayer'); if (options.name) set(result, 'name', options.name); return result; }
    if (name === 'NewFrame') return method(activeRef(), options.content === 'empty' ? 'newEmptyFrame' : 'newFrame');
    if (name === 'NewEmptyFrame') return method(activeRef(), 'newEmptyFrame');
    if (name === 'RemoveFrame') return method(activeRef(), 'deleteFrame', [frameIndex + 1]);
    if (name === 'RemoveLayer') return method(activeRef(), 'deleteLayer', [layerRef(active, layerId)]);
    if (name === 'MergeDownLayer' || name === 'MergeDown') { mutate(active, { type: 'layer.mergeDown', layerId }); layerId = doc().layers[0].id; return; }
    if (name === 'DuplicateLayer') { const ids = new Set(d.layers.map(l => l.id)); mutate(active, { type: 'layer.duplicate', layerId, name: options.name }); layerId = doc().layers.find(l => !ids.has(l.id)).id; return; }
    if (name === 'ClearCel') return mutate(active, { type: 'cel.clear', layerId, frameId: fid }), undefined;
    if (name === 'UnlinkCel') return mutate(active, { type: 'cel.unlink', layerId, frameId: fid }), undefined;
    if (name === 'SpriteSize' || name === 'CanvasSize') { mutate(active, { type: 'document.resize', width: options.width ?? d.width, height: options.height ?? d.height, mode: name === 'SpriteSize' ? 'scale' : 'canvas' }); return; }
    throw Error(`Unsupported app.command.${name}. Saving and exporting must use PixelWall's normal entitlement-checked UI/API.`);
  }
  function performTool(options) {
    if (Object.keys(options).some(key => !['tool', 'color', 'points', 'layer', 'frame', 'opacity', 'tolerance', 'contiguous'].includes(key))) throw Error('Unsupported app.useTool option.');
    if (options.layer && layer(options.layer).docId !== active) throw Error('Tool layer belongs to another sprite.');
    const d = doc(), points = options.points; if (!Array.isArray(points) || !points.length) throw Error('app.useTool requires points.');
    const lid = options.layer ? layer(options.layer).layerId : layerId, fid = d.frames[frameAt(active, options.frame)].id;
    const base = { layerId: lid, frameId: fid, selection: authoring.canvasMask(active), color: inputColor(options.color ?? { red: 0, green: 0, blue: 0 }), size: options.brush?.size ?? 1, opacity: (options.opacity ?? 255) / 255 };
    const tool = options.tool ?? 'pencil'; let c;
    if (tool === 'pencil' || tool === 'eraser') c = { type: 'draw.stroke', ...base, points, ...(tool === 'eraser' ? { color: null } : {}) };
    else if (tool === 'line') c = { type: 'draw.line', ...base, from: points[0], to: points.at(-1) };
    else if (['rectangle', 'filled_rectangle', 'ellipse', 'filled_ellipse'].includes(tool)) { const a = points[0], b = points.at(-1); c = { type: tool.includes('ellipse') ? 'draw.ellipse' : 'draw.rect', ...base, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1, filled: tool.startsWith('filled_') }; }
    else if (tool === 'paint_bucket') c = { type: 'draw.fill', ...base, ...points[0], tolerance: options.tolerance ?? 0, contiguous: options.contiguous !== false };
    else throw Error(`Unsupported Lua tool: ${tool}.`);
    mutate(active, c);
  }
  function dispatch(op, data = {}) {
    if (++calls > LUA_LIMITS.calls) throw Error('Lua API call budget exceeded.');
    if (op === 'colorSpaceNew') return colorSpaces.create(data);
    if (op === 'colorSpaceEqual') return colorSpaces.equal(data.left,data.right);
    if (op === 'colorLookup') { const entries = getFramePalette(doc(), doc().frames[frameIndex].id); return pixelRGBA({}, entries[integer(data.index, 0, Math.min(entries.length - 1, 255), 'Palette index')]); }
    if (op === 'colorFindIndex') { const entries = getFramePalette(doc(), doc().frames[frameIndex].id), channels = [data.red, data.green, data.blue, data.alpha]; let best = 0, distance = Infinity; for (let index = 0; index < Math.min(entries.length, 256); index++) { const c = pixelRGBA({}, entries[index]), d = channels.reduce((sum, value, channel) => sum + (value - c[channel]) ** 2 * (channel === 3 ? 2 : 1), 0); if (d < distance) { best = index; distance = d; } } return best; }
    if (op === 'imageBytesGet') return images.bytesGet(data.target, data.start, data.count);
    if (op === 'imageBytesBegin') return images.bytesBegin(data.target, data.size);
    if (op === 'imageBytesAppend') return images.bytesAppend(data.token, data.bytes);
    if (op === 'imageBytesCommit') return images.bytesCommit(data.token);
    if (op === 'imageBytesCancel') return images.bytesCancel(data.token);
    if (op === 'get') return get(data.target, data.key);
    if (op === 'set') return set(data.target, data.key, data.value);
    if (op === 'method') return method(data.target, data.name, data.args ?? []);
    if (op === 'colorsGet') return copy(colors);
    if (op === 'colorsSet') { colors = { fgColor: validateLuaColor(data.fgColor, 'Lua foreground color'), bgColor: validateLuaColor(data.bgColor, 'Lua background color') }; return; }
    if (op === 'appGet') return appGet(data.key);
    if (op === 'appSet') return appSet(data.key, data.value);
    if (op === 'command') return command(data.name, data.options);
    if (op === 'useTool') return performTool(data);
    if (op === 'imageSpecNew')return imageSpecs.create(data);
    if (op === 'imageSpecEqual')return imageSpecs.equal(data.left,data.right);
    if (op === 'imageNew') return imageNew(data);
    if (op === 'selectionNew') return authoring.selectionNew(data.rectangle);
    if (op === 'paletteNew') { const colors = data.source ? [...palette(data.source).colors] : Array(integer(data.size ?? 256, 1, 256, 'Palette size')).fill('#000000ff'); return ref('Palette', { colors }); }
    if (op === 'spriteNew') {
      const spec=data.spec?imageSpecs.options(data.spec,{sprite:true}):null;
      if(spec)data={width:spec.width,height:spec.height,colorMode:spec.colorMode};
      flush(); if (documents.size >= 8) throw Error('Lua sprite limit reached.');
      const width = integer(data.width, 1, 2048, 'Sprite width'), height = integer(data.height, 1, 2048, 'Sprite height'); if (width * height > LUA_LIMITS.pixels) throw Error('Lua sprite pixel budget exceeded.');
      let id; do { id = `lua-sprite-${++serial}`; } while (documents.has(id)); const seed = createDocument({ id, width, height, colorMode: modeName(data.colorMode ?? 0), palette: modeName(data.colorMode ?? 0) === 'indexed' ? [spec?.transparentColor ? '#000000ff' : '#00000000', ...Array(255).fill('#000000ff')] : undefined });
      seed.clips = []; documents.set(id, seed); seeds.set(id, seed); authoring.track(seed); active = id; frameIndex = 0; layerId = seed.layers[0].id;
      if (seed.colorMode === 'indexed') mutate(id, { type: 'document.update', patch: { metadata: { aseprite: { transparentIndex: 0 } } } });
      if(spec){const metadata={aseprite:{transparentIndex:spec.transparentColor}};mutate(id,{type:'document.update',patch:{metadata}});colorSpaces.set(spriteRef(id),'colorSpace',colorSpaces.fromValue(spec.profile));}
      mutate(id, { type: 'cel.set', frameId: seed.frames[0].id, layerId, width, height, pixels: Array(width * height).fill(seed.colorMode==='indexed'?0:null) }); return spriteRef(id);
    }
    if (op === 'begin') { flush(); if (transactions.length >= 16) throw Error('Lua transaction nesting limit reached.'); transactions.push({ label: String(data.label ?? 'Lua transaction').slice(0, 100), documents: new Map(documents), seeds: new Map(seeds), active, frameIndex, layerId, authoring: authoring.snapshot(), tileImages: snapshotTileImages(), rasterImages:rasterLifetime.snapshot(), imageSpecs:imageSpecs.snapshot(), palettes: colorCommands.snapshot(), entries: [] }); return; }
    if (op === 'commit') { flush(); const transaction = transactions.pop(); if (!transaction) throw Error('No Lua transaction.'); const entries = []; for (const entry of transaction.entries) { const previous = entries.at(-1); if (previous?.documentId === entry.documentId) previous.commands.push(...entry.commands); else entries.push({ ...entry, label: transaction.label }); } (transactions.at(-1)?.entries ?? logs).push(...entries); if (!transactions.length) retiredTileImages.clear(); return; }
    if (op === 'rollback') { const transaction = transactions.pop(); if (!transaction) throw Error('No Lua transaction.'); documents.clear(); for (const [id, d] of transaction.documents) documents.set(id, d); seeds.clear(); for (const [id, d] of transaction.seeds) seeds.set(id, d); active = transaction.active; frameIndex = transaction.frameIndex; layerId = transaction.layerId; authoring.restore(transaction.authoring); restoreTileImages(transaction.tileImages); rasterLifetime.restore(transaction.rasterImages); imageSpecs.restore(transaction.imageSpecs); colorCommands.restore(transaction.palettes); for (const [key, item] of attached) { const d = documents.get(item.docId); let source; try { source = item.tilesetId ? tileSource(item.docId, item.tilesetId, item.tileIndex) : d?.images[item.imageId]; } catch { source = null; } if (source) { Object.assign(item, copy(source)); item.virtualTile = !!source.virtualTile; item.dirty = false; item.colorMode = d.colorMode; } else { attached.delete(key); refs.delete(key); } } return; }
    if (op === 'print') { const text = String(data.text).slice(0, 4096); if (prints.join('').length + text.length > 32768) throw Error('Lua log budget exceeded.'); prints.push(text); return; }
    throw Error('Unsupported Lua bridge operation.');
  }
  return {
    rpc(op, json) { try { if (typeof json !== 'string' || json.length > LUA_LIMITS.outputBytes) throw Error('Lua argument size limit exceeded.'); const value = dispatch(op, JSON.parse(json)); return JSON.stringify({ ok: true, value: value ?? null }); } catch (error) { return JSON.stringify({ ok: false, error: String(error.message).slice(0, 1024) }); } },
    finish() { if (calls > LUA_LIMITS.calls || commandCount > LUA_LIMITS.commands || pixelsAllocated > LUA_LIMITS.pixels * 4 || bytesLogged > LUA_LIMITS.outputBytes) throw Error('Lua execution budget exceeded.'); flush(); if (transactions.length) throw Error('Unfinished Lua transaction.'); const result = { format: 'pixelwall-lua-result', version: 1, document: active ? doc() : null, documents: [...documents.values()], created: [...seeds.values()], transactions: logs, active: { documentId: active, frameId: active ? doc().frames[frameIndex].id : null, layerId }, prints, ...colors, ...authoring.finish(), stats: { calls, commands: commandCount } }; if (JSON.stringify(result).length > LUA_LIMITS.outputBytes) throw Error('Lua output size limit exceeded.'); return copy(result); },
  };
}

/** Replays in the receiving thread; never trust a worker document without engine validation. */
export function validateLuaResult(result, initialDocument) {
  if (!result || result.format !== 'pixelwall-lua-result' || result.version !== 1 || !Array.isArray(result.transactions) || !Array.isArray(result.created) || !Array.isArray(result.documents) || result.created.length > 8) throw Error('Invalid Lua worker result.');
  if (JSON.stringify(result).length > LUA_LIMITS.outputBytes) throw Error('Lua output size limit exceeded.');
  const replay = new Map(); if (initialDocument) { const initial = normalizeDocument(copy(initialDocument)); replay.set(initial.id, initial); }
  for (const seed of result.created) { const d = normalizeDocument(copy(seed)); if (replay.has(d.id)) throw Error('Duplicate Lua sprite.'); replay.set(d.id, d); }
  let commands = 0;
  for (const tx of result.transactions) { if (!Array.isArray(tx.commands) || !replay.has(tx.documentId) || typeof tx.label !== 'string') throw Error('Invalid Lua transaction.'); let d = replay.get(tx.documentId); for (const c of tx.commands) { if (++commands > LUA_LIMITS.commands) throw Error('Lua command budget exceeded.'); d = applyCommand(d, c); } replay.set(tx.documentId, d); }
  if (result.documents.length !== replay.size) throw Error('Lua result sprite mismatch.');
  for (const document of result.documents) { const d = normalizeDocument(copy(document)); if (JSON.stringify(d) !== JSON.stringify(replay.get(d.id))) throw Error('Lua output does not match its command transactions.'); }
  const active = result.active?.documentId ? replay.get(result.active.documentId) : null;
  if (JSON.stringify(active) !== JSON.stringify(result.document)) throw Error('Lua active sprite mismatch.');
  if (result.selection != null && (!active || !Array.isArray(result.selection) || result.selection.length !== active.width * active.height || result.selection.some(value => value !== 0 && value !== 1))) throw Error('Invalid Lua selection result.');
  if (result.range != null) { const r = result.range; if (!active || ![0, 1, 2, 4].includes(r.type) || !Array.isArray(r.layerIds) || r.layerIds.some(id => !active.layers.some(layer => layer.id === id)) || !Array.isArray(r.frameIds) || r.frameIds.some(id => !active.frames.some(frame => frame.id === id)) || !Array.isArray(r.colors) || r.colors.some(index => !Number.isInteger(index) || index < 0 || index >= active.palette.length) || !Array.isArray(r.sliceIds) || r.sliceIds.some(id => !active.slices.some(slice => slice.id === id))) throw Error('Invalid Lua range result.'); }

  const fgColor = validateLuaColor(result.fgColor, 'Lua foreground color result');
  const bgColor = validateLuaColor(result.bgColor, 'Lua background color result');
  return { ...result, fgColor, bgColor, document: active, documents: [...replay.values()] };
}
