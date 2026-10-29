import { makeDemoPixels } from './demo-art.mjs';

export const DEMO_SIZE = 16;
export const DEMO_PALETTE = Object.freeze([
  '#16152b', '#3c315f', '#7059c7', '#ff6b57', '#ffb34b',
  '#ffe66d', '#70d6b2', '#218c89', '#f8f0df',
]);
export const createDemoPixels = () => makeDemoPixels(DEMO_SIZE);

// Interpolate quick drags so a stroke cannot skip pixels between pointer events.
// Return the original array for no-ops: opening or repainting a pixel isn't an edit.
export function paintDemoStroke(pixels, from, to, color) {
  if (![from, to].every(p => Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.y >= 0 && p.x < DEMO_SIZE && p.y < DEMO_SIZE)) return pixels;
  const next = [...pixels];
  let { x, y } = from;
  const dx = Math.abs(to.x - x), dy = -Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1;
  let error = dx + dy, changed = false;
  while (true) {
    const index = y * DEMO_SIZE + x;
    if (next[index] !== color) { next[index] = color; changed = true; }
    if (x === to.x && y === to.y) break;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
  return changed ? next : pixels;
}

// Fresh export canvas only: the grid, keyboard focus, and controls stay out of PNGs.
export function renderDemoPng(pixels, createCanvas = () => document.createElement('canvas')) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = createCanvas();
      canvas.width = DEMO_SIZE; canvas.height = DEMO_SIZE;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      pixels.forEach((color, index) => {
        if (color === null) return;
        context.fillStyle = color;
        context.fillRect(index % DEMO_SIZE, Math.floor(index / DEMO_SIZE), 1, 1);
      });
      canvas.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
    } catch (error) { reject(error); }
  });
}
