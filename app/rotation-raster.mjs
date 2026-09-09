/*! PixelWall portable adaptation of the MIT Aseprite Document Library rotation
 * algorithms. Copyright (c) 2018-present Igara Studio S.A.; 2001-2018 David Capello.
 * RotSprite source: Copyright (c) 2020-2023 Igara Studio S.A.; 2001-2018 David Capello.
 * Original Allegro rotation: Shawn Hargreaves; flipping: Andrew Geers;
 * optimization: Sven Sandberg; C++ templates: David Capello.
 * Full MIT permission and upstream notices: docs/rotation-NOTICES.txt,
 * distributed as runtimes/rotation-NOTICES.txt. This JavaScript adaptation is
 * modified from upstream: bounded owned buffers, explicit validation, pure output,
 * no image-library dependencies, no global scratch storage, no mutable destination.
 *
 * Copyright (c) 2018-present Igara Studio S.A.
 * Copyright (c) 2001-2018 David Capello
 * 
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * 
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
const UNIT = 65536, MAX_FIXED = 0x7fffffff;
export const ROTATION_PIXEL_BUDGET = 16 * 1024 * 1024;
const fail = message => { throw Error(message); };
const int = (value, label, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} to ${max}.`); return value; };
// Independently expressed 16.16 arithmetic matches the observable fixed-point
// rounding/saturation contract of Allegro-derived fixmath (half away from zero).
const fixed = value => value > 32767 ? MAX_FIXED : value < -32767 ? -MAX_FIXED : Math.trunc(value * UNIT + (value < 0 ? -.5 : .5));
const multiply = (a, b) => fixed((a / UNIT) * (b / UNIT));
const divide = (a, b) => b === 0 ? a < 0 ? -MAX_FIXED : MAX_FIXED : fixed(a / b);
const rounded = value => (value >> 16) + ((value & 0x8000) >>> 15);
const outOf = (value, size) => (value >> 16) < 0 || (value >> 16) >= size;

/** MIT scanline parallelogram port. Coordinates are outer pixel corners, TL/TR/BR/BL.
 * Fixed-point ties, endpoint adjustments and edge repair deliberately match upstream. */
function mapParallelogram(sw, sh, dw, dh, points, draw) {
  const xs = points.map(p => p[0] * UNIT), ys = points.map(p => p[1] * UNIT);
  let top = 0;
  for (let i = 1; i < 4; i++) if (ys[i] < ys[top]) top = i;
  const right = multiply(xs[(top + 1) & 3] - xs[top], ys[(top - 1) & 3] - ys[top]) > multiply(xs[(top - 1) & 3] - xs[top], ys[(top + 1) & 3] - ys[top]) ? 1 : -1;
  const bx = [], by = [], px = [], py = [];
  for (let i = 0, index = top; i < 4; i++, index = (index + right) & 3) {
    bx[i] = xs[index]; by[i] = ys[index]; px[i] = index === 0 || index === 3 ? 0 : sw * UNIT - 1; py[i] = index < 2 ? 0 : sh * UNIT - 1;
  }
  const clipRight = dw * UNIT - 1;
  if ((bx[3] > clipRight && bx[0] > clipRight && bx[2] > clipRight) || (bx[1] < 0 && bx[0] < 0 && bx[2] < 0)) return;
  const bottom = Math.min(dh, (by[2] + 0x8000) >> 16);
  let y = Math.max(0, (by[0] + 0x8000) >> 16);
  if (y >= bottom) return;
  let extra = y * UNIT + 0x8000 - by[0];
  let ldx = divide(bx[3] - bx[0], by[3] - by[0]), lx = (bx[0] + multiply(extra, ldx)) | 0;
  let spdx = divide(px[3] - px[0], by[3] - by[0]), spx = (px[0] + multiply(extra, spdx)) | 0;
  let spdy = divide(py[3] - py[0], by[3] - by[0]), spy = (py[0] + multiply(extra, spdy)) | 0;
  let leftBottom = Math.min(bottom, (by[3] + 0x8000) >> 16);
  let rdx = divide(bx[1] - bx[0], by[1] - by[0]), rx = (bx[0] + multiply(extra, rdx)) | 0, rightBottom = (by[1] + 0x8000) >> 16;
  const determinant = (xs[1] - xs[0]) * (ys[3] - ys[0]) - (xs[3] - xs[0]) * (ys[1] - ys[0]);
  if (!determinant) return;
  const dx = Math.trunc((ys[3] - ys[0]) * UNIT * (UNIT * sw) / determinant) | 0;
  const dy = Math.trunc((ys[1] - ys[0]) * UNIT * (UNIT * sh) / -determinant) | 0;
  while (true) {
    if (y >= leftBottom) {
      if (y >= bottom) break;
      extra = y * UNIT + 0x8000 - by[3];
      ldx = divide(bx[2] - bx[3], by[2] - by[3]); lx = (bx[3] + multiply(extra, ldx)) | 0;
      spdx = divide(px[2] - px[3], by[2] - by[3]); spx = (px[3] + multiply(extra, spdx)) | 0;
      spdy = divide(py[2] - py[3], by[2] - by[3]); spy = (py[3] + multiply(extra, spdy)) | 0;
      leftBottom = Math.min(bottom, (by[2] + 0x8000) >> 16);
    }
    if (y >= rightBottom) {
      extra = y * UNIT + 0x8000 - by[1];
      rdx = divide(bx[2] - bx[1], by[2] - by[1]); rx = (bx[1] + multiply(extra, rdx)) | 0; rightBottom = bottom;
    }
    let left = Math.max(0, (lx + 0x8000) & ~0xffff), right = Math.min(clipRight, (rx - 0x8000) & ~0xffff);
    let u = (spx + multiply(left + 0x7fff - lx, dx)) | 0, v = (spy + multiply(left + 0x7fff - lx, dy)) | 0;
    scanline: {
      if (left > right) break scanline;
      if (outOf(u, sw)) {
        if ((u < 0 && dx <= 0) || (u > 0 && dx >= 0)) break scanline;
        do { u = (u + dx) | 0; left += UNIT; if (left > right) break scanline; } while (outOf(u, sw));
      }
      let edge = (u + ((right - left) >> 16) * dx) | 0;
      if (outOf(edge, sw)) {
        if ((edge < 0 && dx <= 0) || (edge > 0 && dx >= 0)) {
          do { right -= UNIT; edge = (edge - dx) | 0; if (left > right) break scanline; } while (outOf(edge, sw));
        } else break scanline;
      }
      if (outOf(v, sh)) {
        if ((v < 0 && dy <= 0) || (v > 0 && dy >= 0)) break scanline;
        do { v = (v + dy) | 0; left += UNIT; if (left > right) break scanline; } while (outOf(v, sh));
      }
      edge = (v + ((right - left) >> 16) * dy) | 0;
      if (outOf(edge, sh)) {
        if ((edge < 0 && dy <= 0) || (edge > 0 && dy >= 0)) {
          do { right -= UNIT; edge = (edge - dy) | 0; if (left > right) break scanline; } while (outOf(edge, sh));
        } else break scanline;
      }
      for (let x = left >> 16, last = right >> 16; x <= last; x++, u = (u + dx) | 0, v = (v + dy) | 0) {
        const ix = u >> 16, iy = v >> 16;
        // Explicit guard replaces native unchecked image access at arithmetic limits.
        if (ix >= 0 && iy >= 0 && ix < sw && iy < sh) draw(x, y, ix, iy);
      }
    }
    y++; lx = (lx + ldx) | 0; spx = (spx + spdx) | 0; spy = (spy + spdy) | 0; rx = (rx + rdx) | 0;
  }
}
function scale2x(source, width, height) {
  const pixels = new Uint32Array(width * height * 4), row = width * 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = source[y * width + x], a = y ? source[(y - 1) * width + x] : p, b = x < width - 1 ? source[y * width + x + 1] : p, c = x ? source[y * width + x - 1] : p, d = y < height - 1 ? source[(y + 1) * width + x] : p, at = y * 2 * row + x * 2;
    pixels[at] = c === a && c !== d && a !== b ? a : p; pixels[at + 1] = a === b && a !== c && b !== d ? b : p;
    pixels[at + row] = d === c && d !== b && c !== a ? c : p; pixels[at + row + 1] = b === d && b !== a && d !== c ? d : p;
  }
  return pixels;
}
function endpointAxis(sourceSize, destinationSize) {
  const step = divide((sourceSize - 1) * UNIT, (destinationSize - 1) * UNIT), indices = new Uint32Array(destinationSize);
  for (let i = 0, coordinate = 0; i < destinationSize; i++, coordinate = Math.min(MAX_FIXED, coordinate + step)) indices[i] = Math.min(sourceSize - 1, rounded(coordinate));
  return indices;
}

/** Pure Fast/RotSprite image mapping onto a transparent destination.
 * Pixels are Aseprite-packed RGBA (R in low byte), gray+alpha, or palette indices.
 * Corners are integer outer corners, not an angle: UI corner rounding is separate.
 * Optional source-size 0/1 mask retains irregular selection geometry.
 * Values mode carries arbitrary uint32 IDs with a reserved transparent sentinel.
 * No destination blending occurs; callers composite the returned patch once. */
export function rasterizeRotation({ pixels, width, height, destinationWidth, destinationHeight, corners, method = 'fast', pixelFormat = 'rgba', maskColor = 0, mask = null }) {
  width = int(width, 'Source width', 1, 32767); height = int(height, 'Source height', 1, 32767);
  const dw = int(destinationWidth, 'Destination width', 1, 32767), dh = int(destinationHeight, 'Destination height', 1, 32767);
  if (!['fast', 'rotsprite'].includes(method)) fail('Rotation method must be fast or rotsprite.');
  if (!['rgba', 'grayscale', 'indexed', 'bitmap', 'values'].includes(pixelFormat)) fail('Unsupported rotation pixel format.');
  const sourceCount = width * height, destinationCount = dw * dh;
  if (sourceCount > ROTATION_PIXEL_BUDGET || destinationCount > ROTATION_PIXEL_BUDGET) fail('Rotation exceeds its pixel budget.');
  if (!(Array.isArray(pixels) || pixels instanceof Uint32Array) || pixels.length !== sourceCount) fail('Rotation source pixels do not match its dimensions.');
  const maxPixel = pixelFormat === 'indexed' ? 255 : pixelFormat === 'bitmap' ? 1 : pixelFormat === 'grayscale' ? 65535 : 0xffffffff;
  for (const value of pixels) int(value, 'Rotation pixel', 0, maxPixel);
  int(maskColor, 'Transparent mask color', 0, maxPixel);
  if ((pixelFormat === 'rgba' && maskColor >>> 24) || (pixelFormat === 'grayscale' && maskColor >>> 8)) fail('RGBA and grayscale rotation require a transparent mask color.');
  if (mask && (!(Array.isArray(mask) || mask instanceof Uint8Array) || mask.length !== sourceCount || mask.some(value => value !== 0 && value !== 1))) fail('Rotation mask must contain one 0/1 value per source pixel.');
  if (!Array.isArray(corners) || corners.length !== 4 || corners.some(p => !Array.isArray(p) || p.length !== 2)) fail('Rotation requires four XY corner pairs.');
  for (const point of corners) for (const value of point) int(value, 'Rotation corner', -32767, 32767);
  const xmin = Math.min(...corners.map(p => p[0])), xmax = Math.max(...corners.map(p => p[0])), ymin = Math.min(...corners.map(p => p[1])), ymax = Math.max(...corners.map(p => p[1])), rw = xmax - xmin, rh = ymax - ymin;
  if (rw > 32767 || rh > 32767) fail('Rotation corner span exceeds fixed-point range.');
  if (corners[0][0] + corners[2][0] !== corners[1][0] + corners[3][0] || corners[0][1] + corners[2][1] !== corners[1][1] + corners[3][1]) fail('Rotation corners must form a parallelogram.');
  const bytes = (sourceCount + destinationCount) * 5 + (method === 'rotsprite' ? sourceCount * 84 * 4 + rw * rh * 64 * 5 + (mask ? (width + height) * 8 * 4 : 0) + (rw + rh) * 4 : 0);
  if (method === 'rotsprite' && (Math.max(width, height, rw, rh) > 4095 || bytes > ROTATION_PIXEL_BUDGET * 4)) fail('RotSprite exceeds its 8x temporary pixel budget; reduce the selection or choose Fast.');
  if (bytes > ROTATION_PIXEL_BUDGET * 4) fail('Rotation exceeds its temporary pixel budget.');
  const output = new Uint32Array(destinationCount).fill(maskColor), coverage = new Uint8Array(destinationCount);
  const accepts = value => pixelFormat === 'rgba' ? !(maskColor >>> 24) || (value & 0xffffff) !== (maskColor & 0xffffff) : pixelFormat === 'grayscale' ? !(maskColor >>> 8) || (value & 255) !== (maskColor & 255) : value !== maskColor;
  if (!rw || !rh) return { width: dw, height: dh, pixels: output, coverage };
  if (method === 'fast') {
    mapParallelogram(width, height, dw, dh, corners, (x, y, ix, iy) => {
      const at = iy * width + ix, value = pixels[at];
      if ((!mask || mask[at]) && accepts(value)) { output[y * dw + x] = value; coverage[y * dw + x] = 1; }
    });
  } else {
    let enlarged = pixels, w = width, h = height;
    for (let i = 0; i < 3; i++) { enlarged = scale2x(enlarged, w, h); w *= 2; h *= 2; }
    const high = new Uint32Array(rw * rh * 64).fill(maskColor), highCoverage = new Uint8Array(rw * rh * 64);
    const mx = mask ? endpointAxis(width, w) : null, my = mask ? endpointAxis(height, h) : null;
    mapParallelogram(w, h, rw * 8, rh * 8, corners.map(([x, y]) => [(x - xmin) * 8, (y - ymin) * 8]), (x, y, ix, iy) => {
      const value = enlarged[iy * w + ix];
      if ((!mask || mask[my[iy] * width + mx[ix]]) && accepts(value)) { high[y * rw * 8 + x] = value; highCoverage[y * rw * 8 + x] = 1; }
    });
    const left = Math.max(0, xmin), top = Math.max(0, ymin), targetW = Math.max(0, Math.min(rw, dw - left)), targetH = Math.max(0, Math.min(rh, dh - top));
    if (targetW && targetH) {
      const xx = endpointAxis(rw * 8, targetW), yy = endpointAxis(rh * 8, targetH);
      for (let y = 0; y < targetH; y++) for (let x = 0; x < targetW; x++) {
        const at = yy[y] * rw * 8 + xx[x], target = (y + top) * dw + x + left;
        // Native downsampling blends any chosen non-mask pixel over the destination.
        output[target] = high[at]; coverage[target] = highCoverage[at];
      }
    }
  }
  return { width: dw, height: dh, pixels: output, coverage };
}
