import { nativePaletteKeys } from './native-color-commands.mjs';

const fail = message => { throw Error(`Lua color command: ${message}`); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const allowed = (options, names) => {
  if (!record(options)) fail('options must be a table.');
  for (const name of Object.keys(options)) if (!names.includes(name)) fail(`unsupported option ${name}.`);
  if (options.ui !== undefined && typeof options.ui !== 'boolean') fail('ui must be boolean.');
  if (options.ui) fail('parameter dialogs are unavailable; pass ui=false.');
};
const choice = (value, fallback, choices, label) => {
  const result = value ?? fallback;
  if (!choices.includes(result)) fail(`unsupported ${label}.`);
  return result;
};
const alias = (options, one, two, fallback) => {
  if (options[one] !== undefined && options[two] !== undefined) fail(`specify only one of ${one} and ${two}.`);
  return options[one] ?? options[two] ?? fallback;
};

export function createLuaColorCommands({ doc, ref, getRef, mutate, flush, frameRef, getActive, getRangeColors, retireImages }) {
  const palettes = new Map();
  let sequence = 0;
  const fresh = frameId => ({ frameId, token: ++sequence });
  function state(id) {
    if (!palettes.has(id)) palettes.set(id, nativePaletteKeys(doc(id)).map(key => fresh(key.frameId)));
    return palettes.get(id);
  }
  function paletteRef(id, key = state(id)[0]) {
    return ref('Palette', { docId: id, paletteToken: key.token }, `palette:${id}:${key.token}`);
  }
  function keyFor(value) {
    const r = getRef(value, 'Palette');
    if (!r.docId) return null;
    const key = state(r.docId).find(item => item.token === r.paletteToken);
    if (!key) fail('this Palette was deleted.');
    return key;
  }
  function palette(value) {
    const r = getRef(value, 'Palette');
    if (!r.docId) return { ref: r, colors: r.colors };
    const key = keyFor(value);
    const found = nativePaletteKeys(doc(r.docId), state(r.docId).map(item => item.frameId)).find(item => item.frameId === key.frameId);
    if (!found) fail('this Palette was deleted.');
    return { ref: r, colors: found.palette };
  }
  function setPalette(id, colors, key = state(id)[0]) {
    mutate(id, { type: 'palette.nativeSet', frameId: key.frameId, paletteFrameIds: state(id).map(item => item.frameId), palette: [...colors] });
  }
  function command(name, options = {}) {
    const { docId, frameIndex } = getActive();
    if (name === 'ChangePixelFormat') {
      allowed(options, ['ui', 'format', 'colorMode', 'dithering', 'dithering-matrix', 'ditheringMatrix', 'dithering-factor', 'ditheringFactor', 'rgbmap', 'fitCriteria', 'toGray']);
      const format = choice(alias(options, 'format', 'colorMode', 'rgb'), 'rgb', ['rgb', 'gray', 'indexed'], 'format');
      const rgbmap = choice(options.rgbmap, 'octree', ['default', 'octree', 'rgb5a3'], 'RGB map');
      const fitCriteria = choice(options.fitCriteria, 'default', ['default', 'rgb', 'linearizedRGB', 'ciexyz', 'cielab'], 'fitting criterion');
      const toGray = choice(options.toGray, 'luma', ['default', 'luma', 'hsv', 'hsl'], 'grayscale conversion');
      const dither = choice(options.dithering, 'none', ['none', 'ordered', 'old', 'error-diffusion'], 'dithering');
      const matrix = choice(alias(options, 'dithering-matrix', 'ditheringMatrix', 'bayer8x8'), 'bayer8x8', ['bayer2x2', 'bayer4x4', 'bayer8x8'], 'dithering matrix');
      const factor = alias(options, 'dithering-factor', 'ditheringFactor', 1);
      if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0 || factor > 1) fail('dithering factor must be from zero to one.');
      if (!docId) return false;
      const colorMode = { rgb: 'rgba', gray: 'grayscale', indexed: 'indexed' }[format];
      flush();
      if (doc(docId).colorMode === colorMode) return true;
      mutate(docId, { type: 'document.nativeColorMode', colorMode, rgbmap: rgbmap === 'default' ? 'octree' : rgbmap, fitCriteria, toGray: toGray === 'default' ? 'luma' : toGray, dithering: dither === 'none' ? 'none' : `aseprite-${dither}`, ditherMatrix: matrix, ditherStrength: dither === 'error-diffusion' ? factor : 1 });
      retireImages(docId);
      return true;
    }
    if (name === 'ColorQuantization') {
      allowed(options, ['ui', 'algorithm', 'maxColors', 'withAlpha', 'useRange']);
      const algorithm = choice(options.algorithm, 'octree', ['default', 'octree', 'rgb5a3'], 'quantization algorithm');
      if ((options.withAlpha !== undefined && typeof options.withAlpha !== 'boolean') || (options.useRange !== undefined && typeof options.useRange !== 'boolean')) fail('withAlpha and useRange must be boolean.');
      const maxColors = options.maxColors ?? 256;
      if (!Number.isSafeInteger(maxColors) || maxColors < 2 || maxColors > 256) fail('maxColors must be an integer from 2 to 256.');
      if (!docId) return false;
      flush();
      const colors = options.useRange ? getRangeColors() : undefined;
      if (colors && !colors.length) return true;
      mutate(docId, { type: 'palette.nativeGenerate', frameId: doc(docId).frames[frameIndex].id, paletteFrameIds: state(docId).map(key => key.frameId), algorithm: algorithm === 'default' ? 'octree' : algorithm, maxColors, withAlpha: options.withAlpha ?? true, ...(colors ? { colors } : {}) });
      return true;
    }
  }
  return {
    command,
    paletteRef,
    palette,
    list(id) { return state(id).map(key => paletteRef(id, key)); },
    frame(value) {
      const p = palette(value);
      if (!p.ref.docId) return null;
      return frameRef(p.ref.docId, doc(p.ref.docId).frames.findIndex(frame => frame.id === keyFor(value).frameId));
    },
    setFirst(id, colors) { setPalette(id, colors); },
    set(value, colors) {
      const p = palette(value);
      if (p.ref.docId) setPalette(p.ref.docId, colors, keyFor(value));
      else p.ref.colors = [...colors];
    },
    track(next, operation) {
      const before = palettes.get(next.id);
      if (!before) return;
      const frameIds = new Set(next.frames.map(frame => frame.id));
      if (operation.type === 'document.nativeColorMode' && next.colorMode === 'grayscale') palettes.set(next.id, [{ ...before[0], frameId: next.frames[0].id }]);
      else if (operation.type === 'palette.update' || operation.type === 'palette.replace') palettes.set(next.id, nativePaletteKeys(next).map(key => before.find(old => old.frameId === key.frameId) ?? fresh(key.frameId)));
      else {
        const remaining = before.filter((key, index) => index === 0 || frameIds.has(key.frameId));
        remaining[0] = { ...remaining[0], frameId: next.frames[0].id };
        remaining.sort((a, b) => next.frames.findIndex(frame => frame.id === a.frameId) - next.frames.findIndex(frame => frame.id === b.frameId));
        palettes.set(next.id, remaining);
      }
    },
    snapshot() { return new Map([...palettes].map(([id, keys]) => [id, keys.map(key => ({ ...key }))])); },
    restore(snapshot) {
      palettes.clear();
      for (const [id, keys] of snapshot) palettes.set(id, keys.map(key => ({ ...key })));
    },
  };
}
