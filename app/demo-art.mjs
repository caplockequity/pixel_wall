import frames from './demo-art-frames.json' with { type: 'json' };

// Rendered by PixelWall CLI from the published Desert Signal command batch.
// Classic, the homepage canvas, and downloadable examples share these pixels.
export function makeDemoPixels(size, shift = 0) {
  const frame = frames[Math.max(0, Math.min(2, Math.round(shift / .45)))];
  return Array.from({ length: size * size }, (_, index) => {
    const x = Math.floor((index % size) * 16 / size);
    const y = Math.floor(Math.floor(index / size) * 16 / size);
    return frame[y * 16 + x];
  });
}
