/** Bounded, pure preview rendering for automation and review surfaces. */
import { renderFrame as defaultRenderFrame } from "./editor-core.mjs";

export const PREVIEW_PIXEL_LIMIT = 16 * 1024 * 1024;
export const PREVIEW_FRAME_LIMIT = 64;
export const PREVIEW_SCALE_LIMIT = 8;

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function checkedPixels(width, height, label = "Preview") {
  positiveInteger(width, `${label} width`); positiveInteger(height, `${label} height`);
  if (!Number.isSafeInteger(width * height) || width * height > PREVIEW_PIXEL_LIMIT) throw new Error(`${label} exceeds the ${PREVIEW_PIXEL_LIMIT}-pixel preview limit.`);
}

function cropRect(rect, width, height) {
  if (rect == null) return { x: 0, y: 0, width, height };
  if (!rect || typeof rect !== "object") throw new Error("Preview crop must be an object.");
  const x = Number(rect.x), y = Number(rect.y), w = Number(rect.width ?? rect.w), h = Number(rect.height ?? rect.h);
  if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1) throw new Error("Preview crop must have finite positive dimensions.");
  const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + w)), bottom = Math.min(height, Math.ceil(y + h));
  if (right <= left || bottom <= top) throw new Error("Preview crop does not intersect the canvas.");
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function cropRGBA(rgba, sourceWidth, rect) {
  const output = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * sourceWidth + rect.x) * 4;
    output.set(rgba.subarray(from, from + rect.width * 4), y * rect.width * 4);
  }
  return output;
}

function scaleRGBA(rgba, width, height, scale) {
  if (scale === 1) return { width, height, rgba };
  const outputWidth = width * scale, outputHeight = height * scale;
  checkedPixels(outputWidth, outputHeight, "Scaled preview");
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y++) for (let x = 0; x < outputWidth; x++) {
    const source = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
    output.set(rgba.subarray(source, source + 4), (y * outputWidth + x) * 4);
  }
  return { width: outputWidth, height: outputHeight, rgba: output };
}

function selectedDocument(document, layerIds, includeReferenceLayers) {
  if (layerIds == null) return includeReferenceLayers ? document : { ...document, layers: document.layers.map(layer => layer.type === "reference" ? { ...layer, visible: false } : layer) };
  if (!Array.isArray(layerIds) || !layerIds.length) throw new Error("Preview layerIds must be a nonempty array.");
  const byId = new Map(document.layers.map(layer => [layer.id, layer]));
  const included = new Set();
  for (const id of layerIds) {
    const layer = byId.get(id);
    if (!layer) throw new Error(`Preview layer not found: ${id}`);
    for (let current = layer; current; current = byId.get(current.parentId)) included.add(current.id);
    if (layer.type === "group") {
      for (const candidate of document.layers) {
        let current = candidate;
        while (current?.parentId) { if (current.parentId === layer.id) { included.add(candidate.id); break; } current = byId.get(current.parentId); }
      }
    }
  }
  // An explicit selection is an instruction for the preview, including when
  // the selected layer is hidden in the document. Ancestors are included so
  // a hidden group does not suppress an explicitly selected child. Reference
  // layers still require the separate opt-in because they are editorial aids,
  // rather than artwork selected by an agent.
  return { ...document, layers: document.layers.map(layer => ({ ...layer, visible: included.has(layer.id) && (includeReferenceLayers || layer.type !== "reference") })) };
}

function frameIdList(document, frameIds) {
  const ids = frameIds == null ? document.frames.map(frame => frame.id) : frameIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > PREVIEW_FRAME_LIMIT) throw new Error(`Preview supports 1–${PREVIEW_FRAME_LIMIT} frames.`);
  if (new Set(ids).size !== ids.length || ids.some(id => !document.frames.some(frame => frame.id === id))) throw new Error("Preview frameIds must identify unique document frames.");
  return ids;
}

/** Render one selected frame, optionally filtered and cropped. */
export function renderPreview(document, { frameId = document.frames[0]?.id, layerIds, crop, scale = 1, includeReferenceLayers = false, renderFrame = defaultRenderFrame } = {}) {
  const magnification = Number(scale);
  if (!Number.isInteger(magnification) || magnification < 1 || magnification > PREVIEW_SCALE_LIMIT) throw new Error(`Preview scale must be an integer from 1 to ${PREVIEW_SCALE_LIMIT}.`);
  checkedPixels(document.width, document.height, "Source preview");
  const selected = selectedDocument(document, layerIds, includeReferenceLayers);
  const rendered = renderFrame(selected, frameId);
  const rect = cropRect(crop, document.width, document.height);
  const cropped = cropRGBA(rendered, document.width, rect);
  const scaled = scaleRGBA(cropped, rect.width, rect.height, magnification);
  return { kind: "frame", frameId, source: { width: rect.width, height: rect.height, crop: rect }, width: scaled.width, height: scaled.height, rgba: scaled.rgba };
}

/** Render an animation contact sheet in frame order. */
export function renderPreviewContactSheet(document, { frameIds, layerIds, crop, scale = 1, includeReferenceLayers = false, columns = frameIds?.length ?? document.frames.length, gap = 0, renderFrame = defaultRenderFrame } = {}) {
  const ids = frameIdList(document, frameIds);
  const columnsValue = Number(columns);
  const gapValue = Number(gap);
  if (!Number.isInteger(columnsValue) || columnsValue < 1 || columnsValue > ids.length) throw new Error("Contact-sheet columns must be between one and the frame count.");
  if (!Number.isInteger(gapValue) || gapValue < 0 || gapValue > 64) throw new Error("Contact-sheet gap must be a nonnegative integer up to 64.");
  checkedPixels(document.width, document.height, "Source preview");
  const cropWidth = crop == null ? document.width : Math.min(document.width, Math.ceil(Number(crop.x) + Number(crop.width ?? crop.w))) - Math.max(0, Math.floor(Number(crop.x)));
  const cropHeight = crop == null ? document.height : Math.min(document.height, Math.ceil(Number(crop.y) + Number(crop.height ?? crop.h))) - Math.max(0, Math.floor(Number(crop.y)));
  if (!Number.isInteger(cropWidth) || !Number.isInteger(cropHeight) || cropWidth < 1 || cropHeight < 1) throw new Error("Preview crop does not intersect the canvas.");
  const magnification = Number(scale);
  if (!Number.isInteger(magnification) || magnification < 1 || magnification > PREVIEW_SCALE_LIMIT) throw new Error(`Preview scale must be an integer from 1 to ${PREVIEW_SCALE_LIMIT}.`);
  const frameWidth = cropWidth * magnification, frameHeight = cropHeight * magnification;
  const rows = Math.ceil(ids.length / columnsValue);
  const width = columnsValue * frameWidth + Math.max(0, columnsValue - 1) * gapValue;
  const height = rows * frameHeight + Math.max(0, rows - 1) * gapValue;
  checkedPixels(width, height, "Contact sheet");
  const rgba = new Uint8ClampedArray(width * height * 4);
  ids.forEach((frameId, index) => {
    const frame = renderPreview(document, { frameId, layerIds, crop, scale, includeReferenceLayers, renderFrame });
    const dx = (index % columnsValue) * (frameWidth + gapValue), dy = Math.floor(index / columnsValue) * (frameHeight + gapValue);
    for (let y = 0; y < frameHeight; y++) rgba.set(frame.rgba.subarray(y * frameWidth * 4, (y + 1) * frameWidth * 4), ((dy + y) * width + dx) * 4);
  });
  return { kind: "contact-sheet", frameIds: ids, columns: columnsValue, rows, gap: gapValue, width, height, rgba, frames: ids.map(frameId => ({ kind: "frame", frameId, width: frameWidth, height: frameHeight })) };
}

/** Compare two documents using the same preview selection and return a diff mask. */
export function renderPreviewComparison(before, after, options = {}) {
  // The baseline may have a different frame/layer set (for example, after an
  // agent adds a layer). Keep those selectors separate so the comparison
  // remains deterministic instead of silently rendering the after selection
  // against the baseline.
  const { beforeFrameId, beforeLayerIds, afterFrameId, ...shared } = options;
  const beforePreview = renderPreview(before, {
    ...shared,
    frameId: beforeFrameId ?? options.frameId ?? before.frames[0]?.id,
    layerIds: beforeLayerIds ?? options.layerIds,
  });
  const afterPreview = renderPreview(after, {
    ...shared,
    frameId: afterFrameId ?? options.frameId ?? after.frames[0]?.id,
    layerIds: options.layerIds,
  });
  if (beforePreview.width !== afterPreview.width || beforePreview.height !== afterPreview.height) throw new Error("Before and after previews must have equal dimensions.");
  const diff = new Uint8ClampedArray(beforePreview.rgba.length);
  let changedPixels = 0;
  for (let index = 0; index < diff.length; index += 4) {
    const changed = beforePreview.rgba[index] !== afterPreview.rgba[index] || beforePreview.rgba[index + 1] !== afterPreview.rgba[index + 1] || beforePreview.rgba[index + 2] !== afterPreview.rgba[index + 2] || beforePreview.rgba[index + 3] !== afterPreview.rgba[index + 3];
    if (changed) { changedPixels++; diff[index] = 255; diff[index + 1] = 72; diff[index + 2] = 72; diff[index + 3] = 255; }
  }
  return { kind: "comparison", width: beforePreview.width, height: beforePreview.height, changedPixels, totalPixels: beforePreview.width * beforePreview.height, before: beforePreview, after: afterPreview, diff };
}

