export const SPRITE_SHEET_FILENAME = "pixelwall-sprites.png";
export const SPRITE_DATA_FILENAME = "pixelwall-sprites.json";

/** @param {number} index @param {number} frameCount */
export function spriteFrameFilename(index, frameCount) {
  const digits = Math.max(3, String(frameCount).length);
  return `frame-${String(index + 1).padStart(digits, "0")}.png`;
}

/** @param {number} size @param {number} frameCount @param {number} fps */
export function buildSpriteSheetMetadata(size, frameCount, fps) {
  const duration = Math.max(1, Math.round(1000 / Math.max(1, fps)));
  const frameIds = Array.from({ length: frameCount }, (_, index) => String(index));
  const frames = Object.fromEntries(frameIds.map((frameId, index) => [
    frameId,
    {
      frame: { x: index * size, y: 0, w: size, h: size },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: size, h: size },
      sourceSize: { w: size, h: size },
      duration,
    },
  ]));

  return {
    frames,
    animations: { default: frameIds },
    meta: {
      app: "https://pixelwall-maker.ben-zavadil.chatgpt.site/",
      version: "1",
      image: SPRITE_SHEET_FILENAME,
      format: "RGBA8888",
      size: { w: size * frameCount, h: size },
      scale: "1",
      frameTags: [{ name: "default", from: 0, to: frameCount - 1, direction: "forward" }],
    },
  };
}
