/** Rendered assets use sRGB. Composite layers in their working profile first;
 * converting editable cels before compositing can change their appearance. */
import { renderFrame } from './editor-core.mjs';
import { documentProfile, isSRGB } from './color-management.mjs';
import { EXPORT_PIXEL_LIMIT, scaleExportDocument, validateExportScale } from './export-scale.mjs';

/** Convert already-composited straight RGBA (or one standalone tile) to sRGB.
 * Does not modify input bytes or the editable document. No runtime or I/O here. */
export function toExportRGBA(input, document, { colorManager, intent = 1, blackPointCompensation = true } = {}) {
  if (!(input instanceof Uint8Array || input instanceof Uint8ClampedArray) || input.length % 4) throw Error('Rendered export expects RGBA bytes.');
  const source = documentProfile(document);
  if (isSRGB(source)) return Uint8ClampedArray.from(input);
  if (typeof colorManager?.transformRGBA !== 'function') throw Error('Load the color manager before exporting a document with a custom color profile.');
  return colorManager.transformRGBA(input, source, 'sRGB', { intent, blackPointCompensation });
}

/** Filter layers and apply fractional cel geometry before this call; crop and pack after it.
 * Native editable exports must save the original document instead. */
export function renderExportFrame(document, frameId, options) {
  return toExportRGBA(renderWorkingExportFrame(document, frameId), document, options);
}

/** Render bounded strips so export geometry does not enlarge the editor canvas limit. */
function renderWorkingExportFrame(document, frameId) {
  frameId ??= document.frames[0]?.id;
  if (!Number.isSafeInteger(document.width * document.height) || document.width * document.height > EXPORT_PIXEL_LIMIT) throw Error('Rendered export exceeds the pixel limit.');
  if (document.width <= 65535 && document.height <= 65535 && document.width * document.height <= 4 * 1024 * 1024) return renderFrame(document, frameId);
  const result = new Uint8ClampedArray(document.width * document.height * 4);
  for (let y = 0; y < document.height; y += 2048) for (let x = 0; x < document.width; x += 2048) {
    const width = Math.min(2048, document.width - x), height = Math.min(2048, document.height - y);
    const frames = document.frames.map(frame => frame.id !== frameId ? frame : { ...frame, cels: Object.fromEntries(Object.entries(frame.cels).map(([id, cel]) => [id, { ...cel, x: cel.x - x, y: cel.y - y, ...(cel.preciseBounds ? { preciseBounds: { ...cel.preciseBounds, x: cel.preciseBounds.x - x, y: cel.preciseBounds.y - y } } : {}) }])) });
    const layers = document.layers.map(layer => layer.tilemaps?.[frameId] ? { ...layer, tilemaps: { ...layer.tilemaps, [frameId]: { ...layer.tilemaps[frameId], x: (layer.tilemaps[frameId].x ?? 0) - x, y: (layer.tilemaps[frameId].y ?? 0) - y } } } : layer);
    const rgba = renderFrame({ ...document, width, height, frames, layers }, frameId);
    for (let row = 0; row < height; row++) result.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * document.width + x) * 4);
  }
  return result;
}

/** Integer magnification keeps existing pixel replication; fractions resize cels before compositing. */
export function renderScaledExportFrame(document, frameId, value = 1, options) {
  const scale = validateExportScale(value);
  if (!Number.isInteger(scale)) {
    const scaled = scaleExportDocument(document, scale);
    return { width: scaled.width, height: scaled.height, rgba: renderExportFrame(scaled, frameId, options) };
  }
  const width = document.width * scale, height = document.height * scale;
  if (width * height > EXPORT_PIXEL_LIMIT) throw Error('Scaled output exceeds the pixel limit.');
  const source = renderExportFrame(scaleExportDocument(document, 1), frameId, options);
  if (scale === 1) return { width, height, rgba: source };
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (Math.floor(y / scale) * document.width + Math.floor(x / scale)) * 4;
    rgba.set(source.subarray(at, at + 4), (y * width + x) * 4);
  }
  return { width, height, rgba };
}
