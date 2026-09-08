import * as gifenc from "gifenc";

// gifenc exposes ESM to browsers and CommonJS to Node.
const { GIFEncoder, quantize, applyPalette } = gifenc.GIFEncoder ? gifenc : gifenc.default;

const MAX_OUTPUT_PIXELS = 64 * 1024 * 1024;

/** Match clip playback while bounding memory and preserving total timing in GIF centiseconds. */
export function animationExportPlan(frames, clip, size, scale = 1) {
  if (!Number.isInteger(size) || size < 1 || size > 256 || ![1, 2, 4, 8].includes(scale)) {
    throw new Error("Choose a supported canvas size and GIF scale");
  }
  if (!Array.isArray(frames) || !frames.length || !clip?.frameIds?.length) {
    throw new Error("Add a frame to this animation first");
  }
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  let ids = [...clip.frameIds];
  if (ids.some((id) => !byId.has(id))) throw new Error("This animation references a missing frame");
  if (clip.direction === "reverse" || clip.direction === "pingpong_reverse") ids.reverse();
  if (clip.direction === "pingpong" || clip.direction === "pingpong_reverse") {
    ids = [...ids, ...ids.slice(1, -1).reverse()];
  }
  const width = size * scale;
  if (width * width * ids.length > MAX_OUTPUT_PIXELS) {
    throw new Error("This GIF is too large. Choose a smaller GIF scale or a shorter animation.");
  }
  let sourceTime = 0;
  let encodedTime = 0;
  const sequence = ids.map((id) => {
    const frame = byId.get(id);
    if (!Number.isFinite(frame.durationMs) || frame.durationMs < 16 || frame.durationMs > 10000) {
      throw new Error("Animation frame timing is invalid");
    }
    sourceTime += frame.durationMs;
    const delay = Math.max(20, Math.round((sourceTime - encodedTime) / 10) * 10);
    encodedTime += delay;
    return { frame, delay };
  });
  return { width, height: width, scale, size, sequence, repeat: clip.loop ? 0 : -1 };
}

/** Reserve index zero for transparency; preserve exact RGB values for pixel-art palettes. */
export function indexedGifFrame(rgba, size, scale) {
  if (rgba.length !== size * size * 4) throw new Error("Animation frame dimensions do not match");
  const colors = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    if (!colors.has(key)) colors.set(key, [rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  let palette = [[0, 0, 0], ...colors.values()];
  let indices;
  if (colors.size <= 255) {
    const lookup = new Map([...colors.keys()].map((key, i) => [key, i + 1]));
    indices = new Uint8Array(size * size);
    for (let i = 0; i < indices.length; i++) {
      const p = i * 4;
      if (rgba[p + 3] >= 128) indices[i] = lookup.get((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
    }
  } else {
    const samples = new Uint8Array(colors.size * 4);
    let offset = 0;
    for (const rgb of colors.values()) { samples.set([...rgb, 255], offset); offset += 4; }
    const reduced = quantize(samples, 255, { format: "rgb565" });
    palette = [[0, 0, 0], ...reduced];
    indices = applyPalette(rgba, reduced, "rgb565");
    for (let i = 0; i < indices.length; i++) indices[i] = rgba[i * 4 + 3] < 128 ? 0 : indices[i] + 1;
  }
  if (palette.length === 1) palette.push([0, 0, 0]);
  if (scale === 1) return { palette, indices };
  const width = size * scale;
  const enlarged = new Uint8Array(width * width);
  for (let y = 0; y < size; y++) {
    const row = y * scale * width;
    for (let x = 0; x < size; x++) enlarged.fill(indices[y * size + x], row + x * scale, row + (x + 1) * scale);
    for (let repeat = 1; repeat < scale; repeat++) enlarged.copyWithin(row + repeat * width, row, row + width);
  }
  return { palette, indices: enlarged };
}

/**
 * Render and encode one frame at a time so large animations do not retain RGBA copies.
 * @param {(completed: number, total: number) => void | Promise<void>} [onProgress]
 */
export async function encodeAnimationGif(plan, renderFrame, onProgress = async () => {}) {
  const gif = GIFEncoder();
  for (let i = 0; i < plan.sequence.length; i++) {
    const { frame, delay } = plan.sequence[i];
    const rgba = await renderFrame(frame);
    const { palette, indices } = indexedGifFrame(rgba, plan.size, plan.scale);
    gif.writeFrame(indices, plan.width, plan.height, {
      palette, delay, transparent: true, transparentIndex: 0, dispose: 2, repeat: plan.repeat,
    });
    await onProgress(i + 1, plan.sequence.length);
  }
  gif.finish();
  return gif.bytes();
}
