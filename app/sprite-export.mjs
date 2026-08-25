import { createSpriteExportPlan } from "./sprite-export-core.mjs";

export const SPRITE_SHEET_FILENAME = "pixelwall-sprites.png";
export const SPRITE_DATA_FILENAME = "pixelwall-sprites.json";

/** @param {number} index @param {number} frameCount */
export function spriteFrameFilename(index, frameCount) {
  const digits = Math.max(3, String(frameCount).length);
  return `frame-${String(index + 1).padStart(digits, "0")}.png`;
}

/** Backward-compatible fixed-row manifest wrapper around the current export core. */
export function buildSpriteSheetMetadata(size, frameCount, fps) {
  const durationMs = Math.max(1, Math.round(1000 / Math.max(1, fps)));
  const frames = Array.from({ length: frameCount }, (_, index) => ({
    id: index,
    durationMs,
    exportFilename: String(index),
  }));
  const metadata = createSpriteExportPlan({
    frames,
    size,
    clips: [{ name: "default", frameIds: frames.map((frame) => frame.id), direction: "forward", loop: true }],
    files: { sheet: SPRITE_SHEET_FILENAME, data: SPRITE_DATA_FILENAME },
    includeIndividualFrames: false,
    app: "PixelWall",
  }).metadata;
  metadata.meta.version = "1";
  metadata.meta.frameTags = metadata.meta.frameTags.map((tag) => {
    const compatible = { ...tag };
    delete compatible.repeat;
    return compatible;
  });
  return metadata;
}
