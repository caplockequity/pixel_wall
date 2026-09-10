/** Native color-command semantics kept separate from the editor's global remap workflow. */
import { mapNativeIndexedImage, quantizeNativePalette } from './native-indexed.mjs';

const fail = message => { throw Error(`Color command: ${message}`); };
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`invalid ${label}.`);
  return value;
};
const rgba = pixel => pixel == null ? [0, 0, 0, 0] : [1, 3, 5, 7].map(index => parseInt(pixel.slice(index, index + 2), 16));
const hex = values => '#' + values.map(value => value.toString(16).padStart(2, '0')).join('');
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

export function nativePaletteKeys(doc, requested) {
  const keys = [];
  let palette = doc.palette;
  for (let index = 0; index < doc.frames.length; index++) {
    const frame = doc.frames[index];
    if (frame.palette) palette = frame.palette;
    if (index === 0 || !equal(palette, keys.at(-1).palette)) keys.push({ frameId: frame.id, index, palette });
  }
  if (requested === undefined) return keys;
  if (!Array.isArray(requested) || !requested.length || requested.length > doc.frames.length || requested[0] !== doc.frames[0].id || new Set(requested).size !== requested.length) fail('invalid palette key frames.');
  const requestedKeys = requested.map(frameId => {
    const index = doc.frames.findIndex(frame => frame.id === frameId);
    if (index < 0) fail('palette key frame no longer exists.');
    let effective = keys[0];
    for (const key of keys) if (key.index <= index) effective = key;
    return { frameId, index, palette: effective.palette };
  });
  if (requestedKeys.some((key, index) => index && key.index <= requestedKeys[index - 1].index)) fail('palette key frames must be ordered.');
  for (const key of keys) if (!requestedKeys.some(requestedKey => requestedKey.index === key.index)) fail('palette key boundaries changed.');
  return requestedKeys;
}

export function setNativePalette(doc, command, api) {
  const keys = nativePaletteKeys(doc, command.paletteFrameIds);
  const frameIndex = doc.frames.findIndex(frame => frame.id === (command.frameId ?? doc.frames[0].id));
  if (frameIndex < 0) fail('palette frame no longer exists.');
  let target = keys[0];
  for (const key of keys) if (key.index <= frameIndex) target = key;
  const colors = command.palette;
  if (!Array.isArray(colors) || !colors.length || colors.length > 256) fail('palette must contain 1–256 colors.');
  const palette = colors.map(api.normalizeColor);
  const end = keys.find(key => key.index > target.index)?.index ?? doc.frames.length;
  if (doc.colorMode === 'indexed') {
    const checked = new Set();
    const check = id => {
      if (!id || checked.has(id)) return;
      checked.add(id);
      const image = doc.images[id];
      if (!image || image.tilemap) return;
      if (image.pixels.some(pixel => pixel != null && pixel >= palette.length)) fail('palette-only shrinking would leave unsupported out-of-palette pixel indices; remap them first.');
    };
    for (let index = target.index; index < end; index++) {
      for (const cel of Object.values(doc.frames[index].cels)) check(cel.imageId);
      for (const layer of doc.layers) if (layer.type === 'tilemap') {
        const tileset = doc.tilesets.find(item => item.id === (layer.tilemaps?.[doc.frames[index].id]?.tilesetId ?? layer.tilesetId));
        if (tileset) {
          check(tileset.imageId);
          for (const tile of tileset.tiles ?? []) check(tile.imageId);
        }
      }
    }
    if (target.index === 0) for (const tileset of doc.tilesets) {
      check(tileset.imageId);
      for (const tile of tileset.tiles ?? []) check(tile.imageId);
    }
  }
  const byId = new Map(keys.map(key => [key.frameId, key.frameId === target.frameId ? palette : key.palette]));
  for (const frame of doc.frames) {
    if (byId.has(frame.id)) frame.palette = [...byId.get(frame.id)];
    else delete frame.palette;
  }
  doc.palette = [...doc.frames[0].palette];
  const capacity = Math.max(...[...byId.values()].map(value => value.length));
  while (doc.palette.length < capacity) doc.palette.push('#00000000');
  if (doc.colorMode === 'indexed' && doc.metadata?.aseprite?.transparentIndex >= palette.length) doc.metadata = { ...doc.metadata, aseprite: { ...doc.metadata.aseprite, transparentIndex: palette.length - 1 } };
}

export function generateNativePalette(doc, command, api) {
  const keys = nativePaletteKeys(doc, command.paletteFrameIds);
  const index = doc.frames.findIndex(frame => frame.id === (command.frameId ?? doc.frames[0].id));
  if (index < 0) fail('palette frame no longer exists.');
  let target = keys[0];
  for (const key of keys) if (key.index <= index) target = key;
  const selected = command.colors;
  if (selected !== undefined && (!Array.isArray(selected) || selected.some((value, at) => !Number.isSafeInteger(value) || value < 0 || value >= target.palette.length || (at > 0 && value <= selected[at - 1])))) fail('palette color range must be sorted unique valid indices.');
  if (selected && !selected.length) return;
  const count = selected ? Math.max(2, selected.length) : command.maxColors ?? 256;
  integer(count, 2, 256, 'generated color count');
  const budget = { remaining: api.limits.operations };
  function* samples() {
    for (const frame of doc.frames) {
      budget.remaining -= doc.width * doc.height * Math.max(1, doc.layers.length);
      if (budget.remaining < 0) fail('palette sampling exceeds the work budget.');
      const pixels = api.renderFrame(doc, frame.id);
      for (let index = 0; index < pixels.length; index += 4) yield hex([...pixels.subarray(index, index + 4)]);
    }
  }
  const documentMask = doc.layers.length === 1 && (doc.layers[0].asepriteFlags & 8) ? null : doc.colorMode === 'indexed' ? doc.metadata?.aseprite?.transparentIndex ?? 0 : 0;
  const transparentIndex = selected && documentMask !== null ? (selected.includes(documentMask) ? selected.indexOf(documentMask) : null) : documentMask;
  const generated = quantizeNativePalette(samples(), { quantization: command.algorithm ?? 'octree', maxColors: count, withAlpha: command.withAlpha ?? true, transparentIndex, budget });
  const palette = selected ? [...target.palette] : generated;
  if (selected) {
    if (generated.length < selected.length) fail('generated palette is smaller than the selected color range.');
    selected.forEach((at, generatedIndex) => { palette[at] = generated[generatedIndex]; });
  }
  setNativePalette(doc, { frameId: target.frameId, paletteFrameIds: keys.map(key => key.frameId), palette }, api);
}

export function convertNativeColorMode(doc, command, api) {
  const mode = command.colorMode;
  if (!['rgba', 'indexed', 'grayscale'].includes(mode)) fail('unsupported destination color mode.');
  const rgbmap = command.rgbmap ?? 'octree';
  const fit = command.fitCriteria ?? 'default';
  const toGray = command.toGray ?? 'luma';
  const dithering = command.dithering ?? 'none';
  const matrix = command.ditherMatrix ?? 'bayer4x4';
  if (!['octree', 'rgb5a3'].includes(rgbmap) || !['default', 'rgb', 'linearizedRGB', 'ciexyz', 'cielab'].includes(fit) || !['luma', 'hsv', 'hsl'].includes(toGray) || !['none', 'aseprite-ordered', 'aseprite-old', 'aseprite-error-diffusion'].includes(dithering) || !['bayer2x2', 'bayer4x4', 'bayer8x8'].includes(matrix)) fail('unsupported pixel-format options.');
  if (mode === doc.colorMode) return;
  const sourceMode = doc.colorMode;
  const budget = { remaining: api.limits.operations };
  const converted = new Map();
  const hasBackground = doc.layers.some(layer => layer.asepriteFlags & 8);
  function convert(imageId, frameId, background, grid) {
    if (converted.has(imageId)) return;
    const image = doc.images[imageId];
    if (!image || image.tilemap) return;
    const palette = api.getFramePalette(doc, frameId);
    const sourceMask = doc.metadata?.aseprite?.transparentIndex ?? 0;
    budget.remaining -= image.width * image.height;
    if (budget.remaining < 0) fail('pixel conversion exceeds the work budget.');
    const colors = image.pixels.map(pixel => {
      if (pixel == null || (sourceMode === 'indexed' && !background && pixel === sourceMask)) return null;
      const color = rgba(sourceMode === 'indexed' ? palette[pixel] : pixel);
      if (sourceMode === 'indexed' && background) color[3] = 255;
      return color[3] ? hex(color) : null;
    });
    let pixels;
    if (mode === 'indexed') {
      const found = palette.indexOf('#00000000');
      const mask = found >= 0 ? found : hasBackground ? null : 0;
      pixels = mapNativeIndexedImage({ ...image, pixels: colors }, palette, { rgbmap, fitCriteria: fit, dithering, ditherMatrix: matrix, sourceColorMode: sourceMode, transparentIndex: mask, background, ditherStrength: command.ditherStrength ?? 1, budget, ...grid });
    } else pixels = colors.map(pixel => {
      if (pixel == null || mode === 'rgba') return pixel;
      const color = rgba(pixel), rgb = color.slice(0, 3);
      const value = toGray === 'hsv' ? Math.max(...rgb) : toGray === 'hsl' ? Math.floor((Math.max(...rgb) + Math.min(...rgb)) / 2) : Math.floor((color[0] * 2126 + color[1] * 7152 + color[2] * 722) / 10000);
      return hex([value, value, value, color[3]]);
    });
    converted.set(imageId, { ...image, pixels });
  }
  for (const layer of doc.layers) if (layer.type !== 'tilemap') for (const frame of doc.frames) {
    const cel = frame.cels[layer.id];
    if (cel) convert(cel.imageId, frame.id, Boolean(layer.asepriteFlags & 8));
  }
  for (const tileset of doc.tilesets) {
    if (tileset.externalFileId != null && !tileset.tiles?.length) fail('embed external tileset artwork before changing pixel format.');
    if (tileset.imageId) convert(tileset.imageId, doc.frames[0].id, false, { tileWidth: tileset.tileWidth, tileHeight: tileset.tileHeight });
    for (const tile of tileset.tiles ?? []) convert(tile.imageId, doc.frames[0].id, false);
  }
  for (const id of Object.keys(doc.images)) convert(id, doc.frames[0].id, false);
  for (const [id, image] of converted) doc.images[id] = image;
  if (mode === 'indexed') for (const frame of doc.frames) for (const cel of Object.values(frame.cels)) cel.opacity = 1;
  const mask = mode === 'indexed' ? Math.max(0, api.getFramePalette(doc, doc.frames[0].id).indexOf('#00000000')) : 0;
  if (mode === 'grayscale') {
    const palette = Array.from({ length: 256 }, (_, index) => hex([index, index, index, 255]));
    doc.palette = palette;
    for (const frame of doc.frames) delete frame.palette;
    doc.frames[0].palette = [...palette];
  }
  doc.colorMode = mode;
  doc.metadata = { ...doc.metadata, aseprite: { ...doc.metadata?.aseprite, transparentIndex: mask } };
}
