/*! Portable modified adaptation of the separately MIT-licensed Aseprite Document
 * and Render Libraries, v1.3.18.5. Copyright (c) 2018-present Igara Studio S.A.;
 * Copyright (c) 2001-2018 David Capello. File-specific copyright includes
 * 2020-2024 Igara Studio S.A. (octree), 2019-2022 Igara Studio S.A. and
 * 2017 David Capello (dithering), 2001-2017 David Capello (median cut).
 * Modifications: JavaScript sparse storage, resource validation, pure inputs and
 * outputs, integer arithmetic and explicit modes. Full provenance:
 * docs/indexed-NOTICES.txt, distributed as runtimes/indexed-NOTICES.txt.
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
const MAX_WORK = 67108864, MAX_PIXELS = 16777216, MAX_NODES = 1048576;
const fail = message => { throw Error(`Native indexed conversion: ${message}`); };
const integer = (n, low, high, label) => { if (!Number.isSafeInteger(n) || n < low || n > high) fail(`invalid ${label}.`); return n; };
const clamp = n => Math.max(0, Math.min(255, n));
const div = (n, d) => Math.trunc(n / d);
const packed = c => ((c[0] | c[1] << 8 | c[2] << 16 | c[3] << 24) >>> 0);
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const parse = c => { if (c === null) return [0, 0, 0, 0]; if (typeof c !== 'string' || !/^#[0-9a-f]{8}$/i.test(c)) fail('colors must be RGBA hex strings or null.'); return [1, 3, 5, 7].map(i => parseInt(c.slice(i, i + 2), 16)); };
function meter(input) { const budget = input ?? { remaining: MAX_WORK }; integer(budget.remaining, 0, MAX_WORK, 'work budget'); return n => { budget.remaining -= n; if (budget.remaining < 0) fail('work limit exceeded.'); }; }

/** Exact palette-search arithmetic. Octree preserves last exact duplicate entries;
 * RGB5A3 first expands quantized channels, then searches. No premultiplication. */
export function createNativeRgbMap(palette, input = {}) {
  if (!Array.isArray(palette) || !palette.length || palette.length > 256) fail('palette must contain 1–256 entries.');
  const colors = palette.map(parse), mask = input.transparentIndex == null ? -1 : integer(input.transparentIndex, 0, palette.length - 1, 'transparent index');
  const algorithm = input.rgbmap ?? 'octree', fit = input.fitCriteria ?? 'default', spend = meter(input.budget);
  if (!['octree', 'rgb5a3'].includes(algorithm)) fail('unsupported RGB map.');
  if (!['default', 'rgb', 'linearizedRGB', 'ciexyz', 'cielab'].includes(fit)) fail('unsupported fitting criterion.');
  function space(c) {
    if (fit === 'rgb' || fit === 'default') return c;
    const lin = c.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    if (fit === 'linearizedRGB') return lin;
    const [r, g, b] = lin, x = 41.24564 * r + 35.75761 * g + 18.04375 * b, y = 21.26729 * r + 71.51522 * g + 7.2175 * b, z = 1.93339 * r + 11.91920 * g + 95.03041 * b;
    if (fit === 'ciexyz') return [x, y, z];
    const f = t => t > .00885645171 ? t ** .3333333333333333 : t / .12841855 + .137931034, fy = f(y / 100);
    return [116 * fy - 16, 500 * (f(x / 95.0489) - fy), 200 * (fy - f(z / 108.884))];
  }
  const spaces = colors.map(space), exact = new Map(), cache = new Map();
  function best(c) {
    spend(colors.length);
    if ((fit === 'default' ? c[3] >> 3 : c[3]) === 0 && mask >= 0) return mask;
    let result = 0, least = Infinity; const v = space(c);
    for (let i = 0; i < colors.length; i++) {
      if (i === mask) continue;
      const p = colors[i];
      const distance = fit === 'default' ? ((c[0] >> 3) - (p[0] >> 3)) ** 2 * 900 + ((c[1] >> 3) - (p[1] >> 3)) ** 2 * 3481 + ((c[2] >> 3) - (p[2] >> 3)) ** 2 * 121 + ((c[3] >> 3) - (p[3] >> 3)) ** 2 * 64 : (v[0] - spaces[i][0]) ** 2 + (v[1] - spaces[i][1]) ** 2 + (v[2] - spaces[i][2]) ** 2 + ((c[3] - p[3]) / 128) ** 2;
      if (distance < least) { least = distance; result = i; }
    }
    return result;
  }
  if (algorithm === 'octree') for (let i = 0; i < colors.length; i++) exact.set(packed(colors[i]), i === mask ? best(colors[i]) : i);
  function map(c) {
    spend(1); let key;
    if (algorithm === 'octree') { key = packed(c); if (exact.has(key)) return exact.get(key); }
    else { c = c.map((v, i) => i < 3 ? ((v >> 3) << 3) | (v >> 5) : ((v >> 5) << 5) | ((v >> 5) << 2) | (v >> 6)); key = packed(c); }
    if (cache.has(key)) return cache.get(key);
    const index = best(c); if (cache.size < 65536) cache.set(key, index); return index;
  }
  return { map, colors, transparentIndex: mask };
}

function bayer(n) { let m = [[0, 2], [3, 1]]; for (let size = 2; size < n; size *= 2) { const next = Array.from({ length: size * 2 }, () => []); for (let y = 0; y < size * 2; y++) for (let x = 0; x < size * 2; x++) next[y][x] = 4 * m[y % size][x % size] + [[0, 2], [3, 1]][Math.floor(y / size)][Math.floor(x / size)]; m = next; } return m; }
const colorDistance = (a, b) => (a[3] && b[3] ? Math.abs(a[0] - b[0]) * 2126 + Math.abs(a[1] - b[1]) * 7152 + Math.abs(a[2] - b[2]) * 722 : 0) + Math.abs(a[3] - b[3]) * 20000;

export function mapNativeIndexedImage(image, palette, input = {}) {
  const width = integer(image.width, 1, 65535, 'width'), height = integer(image.height, 1, 65535, 'height');
  if (width * height > MAX_PIXELS || !Array.isArray(image.pixels) || image.pixels.length !== width * height) fail('invalid raster pixels.');
  const budget = input.budget ?? { remaining: MAX_WORK };
  if (input.background !== undefined && typeof input.background !== 'boolean') fail('background must be boolean.');
  const { map, colors, transparentIndex: mapMask } = createNativeRgbMap(palette, { ...input, budget }), mask = input.background ? -1 : mapMask, spend = meter(budget), output = Array(width * height);
  let mode = input.dithering ?? 'none';
  if (!['none', 'aseprite-ordered', 'aseprite-old', 'aseprite-error-diffusion'].includes(mode)) fail('unsupported native dithering.');
  const strength = input.ditherStrength ?? 1;
  if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 1) fail('invalid dither strength.');
  if (mode.startsWith('aseprite-') && mode !== 'aseprite-error-diffusion' && strength !== 1) fail('native ordered dithering does not have a strength control.');
  if (input.sourceColorMode === 'grayscale') mode = 'none'; // Native grayscale conversion skips the RGB dither branch.
  const matrixName = input.ditherMatrix ?? 'bayer4x4'; if (!['bayer2x2', 'bayer4x4', 'bayer8x8'].includes(matrixName)) fail('unsupported Bayer matrix.');
  const size = Number(matrixName[5]), matrix = bayer(size), maximum = size * size - 1;
  const tw = integer(input.tileWidth ?? width, 1, width, 'tile width'), th = integer(input.tileHeight ?? height, 1, height, 'tile height');
  if (width % tw || height % th) fail('atlas dimensions must be multiples of the tile grid.');
  const orderedCache = new Map();
  function ordered(c) {
    const key = packed(c); if (orderedCache.has(key)) return orderedCache.get(key);
    const index = map(c), c0 = colors[index]; let alternate = index, mix = 0;
    if (mode === 'aseprite-old') {
      alternate = map(c.map((v, i) => clamp(2 * v - c0[i])));
      const D = colorDistance(c0, colors[alternate]); mix = D ? div(maximum * colorDistance(c0, c), D) : 0;
    } else {
      let closest = Infinity;
      spend(colors.length);
      for (let i = 0; i < colors.length; i++) {
        if (i === mask) continue;
        const c1 = colors[i]; let m = 0, divisor = 0;
        for (let k = 0; k < 4; k++) if ((k === 3 || c[3] && c0[3] && c1[3]) && c1[k] !== c0[k]) { const weight = [2126, 7152, 722, 20000][k]; m += div(weight * maximum * (c[k] - c0[k]), c1[k] - c0[k]); divisor += weight; }
        if (m) m = Math.max(0, Math.min(maximum, divisor ? div(m, divisor) : m));
        const mixed = c0.map((v, k) => v + div((c1[k] - v) * m, maximum));
        const distance = colorDistance(c, mixed) + div(colorDistance(c0, c1), 10);
        if (distance < closest) { closest = distance; alternate = i; mix = m; }
      }
    }
    const result = { index, alternate, mix }; if (orderedCache.size < 65536) orderedCache.set(key, result); return result;
  }
  for (let top = 0; top < height; top += th) for (let left = 0; left < width; left += tw) {
    const stride = tw + 2; let row = Array.from({ length: 4 }, () => new Int32Array(stride)), next = Array.from({ length: 4 }, () => new Int32Array(stride));
    for (let y = 0; y < th; y++) {
      const reverse = mode === 'aseprite-error-diffusion' && (y & 1);
      for (let step = 0; step < tw; step++) {
        const x = reverse ? tw - 1 - step : step, at = (top + y) * width + left + x, c = parse(image.pixels[at]); spend(1); let index;
        if (mode === 'aseprite-error-diffusion') {
          const v = c.map((n, k) => clamp(n + row[k][x + 1])); index = map(v);
          const p = index === mask || colors[index][3] === 0 ? [...c.slice(0, 3), 0] : colors[index];
          for (let k = 0; k < 4; k++) { const q = div((v[k] - p[k]) * Math.trunc(strength * 100), 100), sign = reverse ? -1 : 1; row[k][x + 1 + sign] += div(q * 7, 16); next[k][x + 1 - sign] += div(q * 3, 16); next[k][x + 1] += div(q * 5, 16); next[k][x + 1 + sign] += div(q, 16); }
        } else if (c[3] === 0 && (mask >= 0 || mode === 'none')) index = mapMask < 0 ? 0 : mapMask;
        else if (mode === 'none') index = map(c);
        else { const choice = ordered(c); index = matrix[y % size][x % size] < choice.mix ? choice.alternate : choice.index; }
        // Preserve invisible non-mask numeric entries; they are still native palette indices.
        output[at] = index === mask ? null : index;
      }
      row = next; next = Array.from({ length: 4 }, () => new Int32Array(stride));
    }
  }
  return output;
}

function histogram(samples, withAlpha, spend) {
  const colors = new Map(); let count = 0;
  for (const sample of samples) { spend(1); const c = parse(sample); if (++count > MAX_PIXELS) fail('sample pixel limit exceeded.'); if (!c[3]) continue; if (!withAlpha) c[3] = 255; const key = packed(c), entry = colors.get(key); if (entry) entry.count++; else { if (colors.size >= MAX_NODES) fail('distinct color limit exceeded.'); colors.set(key, { c, count: 1 }); } }
  return [...colors.values()];
}

function octreePalette(entries, count, mask, spend) {
  function build(depth) {
    let nodes = 1; const root = { parent: null, children: [], sum: [0, 0, 0, 0], count: 0 };
    for (const entry of entries) {
      let node = root;
      for (let level = 0; level < depth; level++) { spend(1); const bit = 128 >> level, i = entry.c.reduce((v, c, k) => v | (c & bit ? 1 << k : 0), 0); if (!node.children[i]) { if (++nodes > MAX_NODES) fail('octree node limit exceeded.'); node.children[i] = { parent: node, children: [], sum: [0, 0, 0, 0], count: 0 }; } node = node.children[i]; }
      node.count += entry.count; for (let k = 0; k < 4; k++) node.sum[k] += entry.c[k] * entry.count;
    }
    const leaves = []; function collect(node) { for (const child of node.children) if (child) { if (child.count) leaves.push(child); else collect(child); } } collect(root); return leaves;
  }
  const reserve = mask >= 0, available = count - (reserve ? 1 : 0); let depth = 7, leaves = build(depth);
  if (leaves.length < available) { depth = 8; leaves = build(depth); }
  let aux = [], reducing = true;
  for (let level = depth; level >= 0; level--) {
    for (let i = leaves.length - 1; i >= 0; i--) {
      spend(1);
      if (leaves.length + aux.length <= available) { leaves.push(...aux.reverse()); reducing = false; break; }
      if (!leaves.length) {
        if (aux.length <= 16 && available < 16 && available > 0) {
          // Native leafColor() is returned by value; the apparent pair-blending
          // expression updates a temporary. Preserve the verified palette slots.
          aux.sort((a, b) => b.count - a.count); leaves = aux.slice(0, available); reducing = false;
        }
        break;
      }
      const parent = leaves[leaves.length - 1].parent;
      for (let c = 15; c >= 0; c--) { const child = parent.children[c]; if (child?.count) { parent.count += child.count; for (let k = 0; k < 4; k++) parent.sum[k] += child.sum[k]; if (leaves[leaves.length - 1] === child) leaves.pop(); } }
      aux.push(parent);
    }
    if (!reducing) break;
    leaves.push(...aux.reverse()); aux = [];
  }
  const colors = leaves.map(node => node.sum.map(sum => { if (sum > 2147483647) fail('octree accumulator exceeds verified signed-integer range.'); return div(sum, node.count) + (sum % node.count > Math.floor(node.count / 2) ? 1 : 0); }));
  if (reserve) { while (colors.length < mask) colors.push([0, 0, 0, 255]); colors.splice(mask, 0, [0, 0, 0, 0]); }
  return colors.map(hex);
}

// Native median-cut uses a volume priority queue (not population). Sparse bins
// replace scans over zero entries without changing planes or integral means.
function rgb5Palette(entries, count, mask, withAlpha, spend) {
  const reserve = count > 1 && mask >= 0 && mask < count, available = count - (reserve ? 1 : 0);
  let colors;
  if (entries.length <= 256 && entries.length <= available) colors = entries.map(e => e.c);
  else {
    const histogram = new Map(); for (const e of entries) { spend(1); const c = [e.c[0] >> 3, e.c[1] >> 2, e.c[2] >> 3, e.c[3] >> 3], key = c[0] | c[1] << 5 | c[2] << 11 | c[3] << 16, previous = histogram.get(key); if (previous) previous.count += e.count; else histogram.set(key, { c, count: e.count }); }
    const make = (items, low, high) => ({ items, low, high, volume: high.reduce((v, n, k) => v * (n - low[k] + 1), 1) });
    const queue = [];
    function push(value) { queue.push(value); let i = queue.length - 1; while (i > 0) { const parent = (i - 1) >> 1; if (queue[parent].volume >= value.volume) break; queue[i] = queue[parent]; i = parent; } queue[i] = value; }
    function pop() { const result = queue[0], last = queue.pop(); if (queue.length) { let i = 0; while (i * 2 + 1 < queue.length) { let child = i * 2 + 1; if (child + 1 < queue.length && queue[child].volume < queue[child + 1].volume) child++; queue[i] = queue[child]; i = child; } queue[i] = last; while (i > 0) { const parent = (i - 1) >> 1; if (queue[parent].volume >= last.volume) break; queue[i] = queue[parent]; i = parent; queue[i] = last; } } return result; }
    function mean(box) { const sums = [0, 0, 0, 0]; let n = 0; for (const e of box.items) { spend(1); n += e.count; for (let k = 0; k < 4; k++) sums[k] += e.c[k] * e.count; } return n ? sums.map((s, k) => div(255 * div(s, n), [31, 63, 31, 31][k])) : [0, 0, 0, 255]; }
    push(make([...histogram.values()], [0, 0, 0, 0], [31, 63, 31, 31])); colors = [];
    while (queue.length && queue.length < available) {
      const box = pop(), low = [31, 63, 31, 31], high = [0, 0, 0, 0]; let points = 0;
      for (const e of box.items) { spend(1); points += e.count; for (let k = 0; k < 4; k++) { low[k] = Math.min(low[k], e.c[k]); high[k] = Math.max(high[k], e.c[k]); } }
      let axis = 0; for (let k = 1; k < 4; k++) if (high[k] - low[k] > high[axis] - low[axis]) axis = k;
      const planes = new Map(); for (const e of box.items) planes.set(e.c[axis], (planes.get(e.c[axis]) ?? 0) + e.count);
      let first = 0, cut = null;
      for (let i = low[axis]; i <= high[axis]; i++) { const plane = planes.get(i) ?? 0; first += plane; const second = points - first; if (first > second) { if (second > 0) cut = i; else if (first - plane > 0) cut = i - 1; break; } }
      if (cut === null) { if (colors.length < available) colors.push(mean(box)); else break; }
      else { const h = [...high], l = [...low]; h[axis] = cut; l[axis] = cut + 1; push(make(box.items.filter(e => e.c[axis] <= cut), low, h)); push(make(box.items.filter(e => e.c[axis] > cut), l, high)); }
    }
    while (queue.length && colors.length < available) colors.push(mean(pop()));
  }
  if (reserve) { while (colors.length < mask) colors.push([0, 0, 0, 255]); colors.splice(mask, 0, [0, 0, 0, withAlpha ? 0 : 255]); }
  else if (!colors.length) colors = [[0, 0, 0, 255]];
  return colors.map(hex);
}

/** Samples must be full composited frames for native sprite quantization. */
export function quantizeNativePalette(samples, input = {}) {
  const algorithm = input.quantization ?? 'octree', max = integer(input.maxColors ?? 256, 2, 256, 'palette color limit');
  if (!['octree', 'rgb5a3'].includes(algorithm)) fail('unsupported native quantizer.');
  const alpha = input.withAlpha ?? true; if (typeof alpha !== 'boolean') fail('withAlpha must be boolean.');
  const mask = input.transparentIndex === null ? -1 : integer(input.transparentIndex ?? 0, 0, max - 1, 'transparent index'), spend = meter(input.budget);
  const entries = histogram(samples, alpha, spend);
  const result = algorithm === 'octree' ? octreePalette(entries, max, mask, spend) : rgb5Palette(entries, max, mask, alpha, spend);
  // Native all-transparent background octree can return an empty palette, which
  // the document/native writer cannot represent. Refuse instead of fabricating it.
  if (!result.length) fail('native quantizer produced an empty palette.'); return result;
}
