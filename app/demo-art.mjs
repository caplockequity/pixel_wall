// Shared source for the studio starter and its downloadable example.
export function makeDemoPixels(size, shift = 0) {
  return Array.from({ length: size * size }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const scale = size / 16;
    const px = x / scale;
    const py = y / scale + shift;
    const sun = Math.hypot(px - 11.5, py - 4.5);
    if (sun < 2.4) return sun < 1.55 ? "#ffe66d" : "#ffb34b";
    if (py >= 11 + Math.abs(px - 4) * 0.42) return "#218c89";
    if (py >= 9 + Math.abs(px - 4) * 0.56) return "#ff6b57";
    if (py >= 10 + Math.abs(px - 11) * 0.48) return "#7059c7";
    if (
      (Math.round(px) === 2 && Math.round(py) === 3) ||
      (Math.round(px) === 5 && Math.round(py) === 2) ||
      (Math.round(px) === 8 && Math.round(py) === 5)
    ) {
      return "#f8f0df";
    }
    return py < 7 ? "#262447" : "#3c315f";
  });
}
