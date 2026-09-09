import { quantizeNativePalette, mapNativeIndexedImage } from './native-indexed.mjs';
/** Original, deterministic palette reduction and dithering. No host access or document mutation. */
const MAX_PIXELS = 16777216, MAX_WORK = 67108864, MAX_HISTOGRAM = 65536;
const fail = message => { throw Error(`Indexed conversion: ${message}`); };
const clamp = (value, low = 0, high = 255) => Math.max(low, Math.min(high, value));
const integer = (value, low, high, label) => { if (!Number.isSafeInteger(value) || value < low || value > high) fail(`invalid ${label}.`); return value; };
const color = value => { if (value === null) return [0, 0, 0, 0]; if (typeof value !== 'string' || !/^#[0-9a-f]{8}$/i.test(value)) fail('pixels and palette entries must be RGBA hex strings or null.'); return [1, 3, 5, 7].map(at => parseInt(value.slice(at, at + 2), 16)); };
const hex = values => '#' + values.map(value => Math.round(clamp(value)).toString(16).padStart(2, '0')).join('');
const vector = c => [c[0] * c[3] / 255, c[1] * c[3] / 255, c[2] * c[3] / 255, c[3]];
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + 2 * (a[3] - b[3]) ** 2;
function workBudget(value) { const budget = value ?? { remaining: MAX_WORK }; integer(budget.remaining, 0, MAX_WORK, 'remaining work budget'); return budget; }
function spend(budget, amount) { budget.remaining -= amount; if (budget.remaining < 0) fail('work limit exceeded; reduce the image, palette, or frame count.'); }
export function indexedConversionOptions(input = {}) {
  const options = { paletteMode: input.paletteMode ?? 'existing', maxColors: input.maxColors ?? 256, quantization: input.quantization ?? 'median-cut', withAlpha: input.withAlpha ?? true, dithering: input.dithering ?? 'none', ditherMatrix: input.ditherMatrix ?? 'bayer4x4', ditherStrength: input.ditherStrength ?? 1, rgbmap: input.rgbmap ?? (['octree', 'rgb5a3'].includes(input.quantization) || input.dithering?.startsWith('aseprite-') ? 'octree' : 'pixelwall'), fitCriteria: input.fitCriteria ?? 'default' };
  if (!['existing', 'generate'].includes(options.paletteMode)) fail('palette mode must be existing or generate.');
  integer(options.maxColors, 2, 256, 'palette color limit');
  if (!['median-cut', 'octree', 'rgb5a3'].includes(options.quantization)) fail('quantization must be median-cut, octree, or rgb5a3.');
  if (!['pixelwall', 'octree', 'rgb5a3'].includes(options.rgbmap)) fail('RGB map must be pixelwall, octree, or rgb5a3.');
  if (!['default', 'rgb', 'linearizedRGB', 'ciexyz', 'cielab'].includes(options.fitCriteria)) fail('unsupported fitting criterion.');
  if (options.rgbmap === 'pixelwall' && options.fitCriteria !== 'default') fail('fitting criteria require a native RGB map.');
  if (typeof options.withAlpha !== 'boolean') fail('withAlpha must be boolean.');
  if (!['none', 'ordered', 'floyd-steinberg', 'aseprite-ordered', 'aseprite-old', 'aseprite-error-diffusion'].includes(options.dithering)) fail('unsupported dithering algorithm.');
  if (options.rgbmap !== 'pixelwall' && ['ordered', 'floyd-steinberg'].includes(options.dithering)) fail('legacy dithering requires the pixelwall RGB map; choose a native dithering mode.');
  if (options.rgbmap === 'pixelwall' && options.dithering.startsWith('aseprite-')) fail('native dithering requires an octree or rgb5a3 RGB map.');
  if (['aseprite-ordered', 'aseprite-old'].includes(options.dithering) && options.ditherStrength !== 1) fail('native ordered dithering does not have a strength control.');
  if (!['bayer2x2', 'bayer4x4', 'bayer8x8'].includes(options.ditherMatrix)) fail('unsupported Bayer matrix.');
  if (typeof options.ditherStrength !== 'number' || !Number.isFinite(options.ditherStrength) || options.ditherStrength < 0 || options.ditherStrength > 1) fail('dither strength must be from 0 to 1.');
  return options;
}

/** Weighted median cut in premultiplied RGBA. The reserved transparent slot counts toward maxColors. */
export function quantizePalette(samples, input = {}) {
  const options = indexedConversionOptions({ ...input, paletteMode: 'generate' });
  if (options.quantization !== 'median-cut') return quantizeNativePalette(samples, { ...input, ...options });
  const transparentIndex = integer(input.transparentIndex ?? 0, 0, options.maxColors - 1, 'transparent index'), budget = workBudget(input.budget);
  let histogram = new Map(), binned = false;
  function keyOf(c) { return binned ? c.map(value => Math.floor(value / 16)).join(',') : c.join(','); }
  function add(c, count = 1, sums = null) {
    const key = keyOf(c), entry = histogram.get(key), v = vector(c);
    const sum = sums ?? v.map(value => value * count);
    if (entry) { entry.count += count; for (let k = 0; k < 4; k++) entry.sum[k] += sum[k]; }
    else histogram.set(key, { count, sum, first: c });
  }
  for (const sample of samples) {
    spend(budget, 1); const c = color(sample); if (c[3] === 0) continue; if (!options.withAlpha) c[3] = 255;
    add(c);
    // Bound memory for photographs without throwing away their population/average color.
    if (!binned && histogram.size > MAX_HISTOGRAM) { const entries = [...histogram.values()]; histogram = new Map(); binned = true; for (const entry of entries) add(entry.first, entry.count, entry.sum); }
  }
  const entries = [...histogram.values()].map((entry, order) => ({ ...entry, order, v: entry.sum.map(value => value / entry.count) }));
  function box(items) {
    const low = [Infinity, Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity, -Infinity]; let count = 0;
    for (const entry of items) { count += entry.count; for (let k = 0; k < 4; k++) { low[k] = Math.min(low[k], entry.v[k]); high[k] = Math.max(high[k], entry.v[k]); } }
    let axis = 0, spread = 0; for (let k = 0; k < 4; k++) { const value = (high[k] - low[k]) ** 2 * (k === 3 ? 2 : 1); if (value > spread) { axis = k; spread = value; } }
    return { items, count, axis, score: items.length > 1 ? spread * count : 0 };
  }
  const boxes = entries.length ? [box(entries)] : [], available = options.maxColors - 1;
  while (boxes.length < available) {
    let best = -1; for (let i = 0; i < boxes.length; i++) if (boxes[i].score > 0 && (best < 0 || boxes[i].score > boxes[best].score)) best = i;
    if (best < 0) break;
    const current = boxes[best], items = [...current.items].sort((a, b) => a.v[current.axis] - b.v[current.axis] || a.order - b.order); spend(budget, items.length);
    let count = 0, cut = 0; while (cut < items.length - 1) { count += items[cut++].count; if (count >= current.count / 2) break; }
    boxes.splice(best, 1, box(items.slice(0, cut)), box(items.slice(cut)));
  }
  const colors = boxes.map(item => { const sum = [0, 0, 0, 0]; for (const entry of item.items) for (let k = 0; k < 4; k++) sum[k] += entry.sum[k]; const a = sum[3] / item.count; return hex([sum[0] / item.count * 255 / a, sum[1] / item.count * 255 / a, sum[2] / item.count * 255 / a, a]); });
  const palette = []; const unique = [...new Set(colors)];
  const length = Math.max(transparentIndex + 1, unique.length + 1);
  for (let index = 0; index < length; index++) palette.push(index === transparentIndex ? '#00000000' : unique.shift() ?? '#00000000');
  return palette;
}

function bayer(size) { let matrix = [[0]]; while (matrix.length < size) { const n = matrix.length, next = Array.from({ length: n * 2 }, () => Array(n * 2)); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { next[y][x] = 4 * matrix[y][x]; next[y][x + n] = 4 * matrix[y][x] + 2; next[y + n][x] = 4 * matrix[y][x] + 3; next[y + n][x + n] = 4 * matrix[y][x] + 1; } matrix = next; } return matrix; }

/** Dither an RGBA raster into a palette. Regions reset both Bayer origin and diffusion for native atlas tiles. */
export function mapIndexedImage(image, palette, input = {}) {
  const options = indexedConversionOptions(input);
  if (options.rgbmap !== 'pixelwall') return mapNativeIndexedImage(image, palette, { ...input, ...options });
  const width = integer(image.width, 1, 65535, 'image width'), height = integer(image.height, 1, 65535, 'image height');
  if (width * height > MAX_PIXELS || !Array.isArray(image.pixels) || image.pixels.length !== width * height) fail('invalid image pixel count.');
  if (!Array.isArray(palette) || !palette.length || palette.length > 256) fail('indexed conversion requires a palette of 1–256 colors.');
  const transparentIndex = input.transparentIndex == null ? null : integer(input.transparentIndex, 0, palette.length - 1, 'transparent index');
  const colors = palette.map(color); if (transparentIndex !== null) colors[transparentIndex] = [0, 0, 0, 0];
  const vectors = colors.map(vector), budget = workBudget(input.budget), output = new Array(width * height), cache = new Map();
  const tileWidth = integer(input.tileWidth ?? width, 1, width, 'tile width'), tileHeight = integer(input.tileHeight ?? height, 1, height, 'tile height');
  if (width % tileWidth || height % tileHeight) fail('atlas dimensions must be multiples of the tile grid.');
  const matrixSize = Number(options.ditherMatrix[5]), matrix = bayer(matrixSize), algorithm = options.ditherStrength === 0 ? 'none' : options.dithering;
  function nearest(v, opaque, pair) {
    let a = -1, b = -1, da = Infinity, db = Infinity;
    spend(budget, colors.length);
    for (let index = 0; index < colors.length; index++) {
      if (opaque && (index === transparentIndex || colors[index][3] === 0)) continue;
      const d = distance(v, vectors[index]);
      if (d < da) { b = a; db = da; a = index; da = d; } else if (d < db) { b = index; db = d; }
    }
    if (a < 0) fail('palette has no visible color for an opaque pixel.');
    return pair ? [a, b < 0 ? a : b] : a;
  }
  for (let top = 0; top < height; top += tileHeight) for (let left = 0; left < width; left += tileWidth) {
    let errors = new Float64Array((tileWidth + 2) * 4), next = new Float64Array(errors.length);
    for (let y = 0; y < tileHeight; y++) {
      for (let x = 0; x < tileWidth; x++) {
        const at = (top + y) * width + left + x, c = color(image.pixels[at]); spend(budget, 1);
        if (c[3] === 0) { output[at] = null; continue; }
        const v = vector(c), opaque = c[3] === 255, slot = (x + 1) * 4; let chosen;
        if (algorithm === 'floyd-steinberg') {
          for (let k = 0; k < 4; k++) v[k] = clamp(v[k] + errors[slot + k]);
          for (let k = 0; k < 3; k++) v[k] = Math.min(v[k], v[3]);
          chosen = nearest(v, opaque, false);
          for (let k = 0; k < 4; k++) { const error = (v[k] - vectors[chosen][k]) * options.ditherStrength; errors[slot + 4 + k] += error * 7 / 16; next[slot - 4 + k] += error * 3 / 16; next[slot + k] += error * 5 / 16; next[slot + 4 + k] += error / 16; }
        } else {
          const key = hex(c); let candidates = cache.get(key);
          if (!candidates) { candidates = nearest(v, opaque, true); if (cache.size < MAX_HISTOGRAM) cache.set(key, candidates); }
          chosen = candidates[0];
          if (algorithm === 'ordered' && candidates[0] !== candidates[1]) {
            const [a, b] = [...candidates].sort((one, two) => one - two), start = vectors[a], end = vectors[b], nearestVector = vectors[chosen]; let numerator = 0, denominator = 0;
            for (let k = 0; k < 4; k++) { const step = end[k] - start[k], weight = k === 3 ? 2 : 1, value = nearestVector[k] + (v[k] - nearestVector[k]) * options.ditherStrength; numerator += (value - start[k]) * step * weight; denominator += step * step * weight; }
            const fraction = denominator ? clamp(numerator / denominator, 0, 1) : 0, threshold = (matrix[y % matrixSize][x % matrixSize] + .5) / (matrixSize * matrixSize);
            chosen = fraction > threshold ? b : a;
          }
        }
        output[at] = chosen === transparentIndex || colors[chosen][3] === 0 ? null : chosen;
      }
      errors = next; next = new Float64Array(errors.length);
    }
  }
  return output;
}
