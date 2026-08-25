/**
 * PixelWall's portable project format.
 *
 * This module is intentionally independent of React, the DOM, Canvas, Node
 * built-ins, and the filesystem. It can be used by browser autosave, file
 * import/export, tests, and future self-hosted builds.
 */

export const PROJECT_FORMAT = "pixelwall-project";
export const PROJECT_VERSION = 3;
export const DEFAULT_FRAME_DURATION_MS = 125;

export const DEFAULT_PROJECT_PALETTE = Object.freeze([
  "#16152b",
  "#3c315f",
  "#7059c7",
  "#ff6b57",
  "#ffb34b",
  "#ffe66d",
  "#70d6b2",
  "#218c89",
  "#f8f0df",
]);

const DEFAULT_PROJECT_NAME = "Untitled Sprite";
const DEFAULT_SELECTED_COLOR = "#ff6b57";
const DEFAULT_REFERENCE_OPACITY = 38;
const MAX_CANVAS_SIZE = 1024;
const MAX_LAYERS = 64;
const MAX_FRAMES = 1024;
const MAX_CLIPS = 256;
const MAX_SLICES = 256;
const MAX_TILEMAP_EDGE = 64;
const MAX_COLORS = 65_535;
const MAX_TOTAL_CELLS = 16_777_216;
const MAX_REFERENCE_DATA_LENGTH = 48 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;
const MIN_FRAME_DURATION_MS = 1;
const MAX_FRAME_DURATION_MS = 60_000;
const CLIP_DIRECTIONS = new Set(["forward", "reverse", "pingpong", "pingpong_reverse"]);
const RASTER_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export class ProjectFormatError extends Error {
  constructor(message, code = "INVALID_PROJECT") {
    super(message);
    this.name = "ProjectFormatError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProjectFormatError(message, code);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseInput(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    fail("Project file is not valid JSON", "INVALID_JSON");
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function stableId(value, label) {
  return positiveInteger(value, label);
}

function normalizedName(value, fallback, label = "Name") {
  const name = typeof value === "string" ? value.trim() : "";
  const result = name || fallback;
  if ([...result].length > MAX_NAME_LENGTH) fail(`${label} is too long`);
  return result;
}

function normalizedColor(value, label = "Color") {
  if (typeof value !== "string") fail(`${label} must be a hex color`);
  const color = value.trim().toLowerCase();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(color);
  if (shortMatch) {
    const [red, green, blue] = shortMatch[1];
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(color)) fail(`${label} must be a #RRGGBB hex color`);
  return color;
}

function normalizedPalette(value) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_PROJECT_PALETTE;
  const seen = new Set();
  const palette = [];
  source.forEach((color, index) => {
    const normalized = normalizedColor(color, `Palette color ${index + 1}`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      palette.push(normalized);
    }
  });
  if (!palette.length) return [...DEFAULT_PROJECT_PALETTE];
  return palette;
}

function normalizedDuration(value, fallback = DEFAULT_FRAME_DURATION_MS) {
  const duration = Number.isFinite(value) ? Math.round(value) : fallback;
  if (duration < MIN_FRAME_DURATION_MS || duration > MAX_FRAME_DURATION_MS) {
    fail(`Frame duration must be between ${MIN_FRAME_DURATION_MS} and ${MAX_FRAME_DURATION_MS} ms`);
  }
  return duration;
}

function normalizedOpacity(value) {
  const opacity = finiteNumber(value, 100);
  if (opacity < 0 || opacity > 100) fail("Layer opacity must be between 0 and 100");
  return opacity;
}

function normalizedTransform(value) {
  const transform = isRecord(value) ? value : {};
  return {
    x: finiteNumber(transform.x, 0),
    y: finiteNumber(transform.y, 0),
    scale: Math.max(0.01, finiteNumber(transform.scale, 100)),
  };
}

function normalizedPivot(value, size, fallback = { x: 0.5, y: 0.5, unit: "normalized" }) {
  const pivot = isRecord(value) ? value : fallback;
  const unit = pivot.unit === "pixels" ? "pixels" : "normalized";
  const defaultCoordinate = unit === "pixels" ? size / 2 : 0.5;
  const x = finiteNumber(pivot.x, defaultCoordinate);
  const y = finiteNumber(pivot.y, defaultCoordinate);
  const limit = unit === "pixels" ? size * 16 : 16;
  if (Math.abs(x) > limit || Math.abs(y) > limit) fail("Pivot is outside the supported range");
  return { x, y, unit };
}

function normalizedTileSettings(value) {
  const tile = isRecord(value) ? value : {};
  return {
    enabled: Boolean(tile.enabled),
    seamlessPreview: Boolean(tile.seamlessPreview),
    wrapDrawing: Boolean(tile.wrapDrawing),
  };
}

function normalizedSlices(value, size) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SLICES) fail(`Projects may contain at most ${MAX_SLICES} slices`);
  const ids = new Set();
  const names = new Set(["origin"]);
  return value.map((slice, index) => {
    if (!isRecord(slice)) fail(`Slice ${index + 1} is invalid`);
    const id = stableId(slice.id, `Slice ${index + 1} id`);
    if (ids.has(id)) fail(`Slice ids must be unique: ${id}`);
    ids.add(id);
    const name = normalizedName(slice.name, `slice-${index + 1}`, `Slice ${index + 1} name`);
    const key = name.toLocaleLowerCase();
    if (names.has(key)) fail(`Slice names must be unique: ${name}`);
    names.add(key);
    const source = isRecord(slice.bounds) ? slice.bounds : isRecord(slice.rect) ? slice.rect : {};
    const x = Number.isSafeInteger(source.x) ? source.x : -1;
    const y = Number.isSafeInteger(source.y) ? source.y : -1;
    const width = positiveInteger(source.width ?? source.w, `Slice ${index + 1} width`, size);
    const height = positiveInteger(source.height ?? source.h, `Slice ${index + 1} height`, size);
    if (x < 0 || y < 0 || x + width > size || y + height > size) fail(`Slice ${index + 1} is outside the canvas`);
    const result = { id, name, bounds: { x, y, width, height } };
    if (slice.pivot !== undefined) result.pivot = normalizedPivot(slice.pivot, size);
    return result;
  });
}

function normalizedTilemap(value, frameIds) {
  if (value === undefined || value === null) return { width: 8, height: 8, cells: Array(64).fill(null) };
  if (!isRecord(value)) fail("Tilemap is invalid");
  const width = positiveInteger(value.width, "Tilemap width", MAX_TILEMAP_EDGE);
  const height = positiveInteger(value.height, "Tilemap height", MAX_TILEMAP_EDGE);
  if (!Array.isArray(value.cells) || value.cells.length !== width * height) fail("Tilemap cell data is invalid");
  const cells = value.cells.map((cell, index) => {
    if (cell === null || cell === 0 || cell === undefined) return null;
    const frameId = stableId(cell, `Tilemap cell ${index + 1}`);
    if (!frameIds.has(frameId)) fail(`Tilemap cell ${index + 1} references missing frame ${frameId}`);
    return frameId;
  });
  return { width, height, cells };
}

function normalizedReference(value, includeData = true) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) fail("Projector reference is invalid");
  const mime = typeof value.mime === "string" ? value.mime.toLowerCase() : "";
  if (!RASTER_MIME_TYPES.has(mime)) fail("Projector reference must be a supported raster image");
  const width = positiveInteger(value.width, "Reference width", 65_535);
  const height = positiveInteger(value.height, "Reference height", 65_535);
  const reference = {
    name: normalizedName(value.name, "reference", "Reference name"),
    mime,
    width,
    height,
    tileIndex: Number.isSafeInteger(value.tileIndex) && value.tileIndex >= 0 ? value.tileIndex : 0,
    pixelFit: Boolean(value.pixelFit),
  };
  if (includeData && value.dataUrl !== undefined) {
    if (typeof value.dataUrl !== "string" || value.dataUrl.length > MAX_REFERENCE_DATA_LENGTH) {
      fail("Projector reference data is invalid or too large");
    }
    const prefix = `data:${mime};base64,`;
    if (!value.dataUrl.startsWith(prefix)) fail("Projector reference data does not match its MIME type");
    reference.dataUrl = value.dataUrl;
  }
  return reference;
}

function normalizedProjector(value, includeReferenceData = true) {
  const projector = isRecord(value) ? value : {};
  const opacity = finiteNumber(projector.opacity, DEFAULT_REFERENCE_OPACITY);
  if (opacity < 0 || opacity > 100) fail("Projector opacity must be between 0 and 100");
  const result = {
    opacity,
    transform: normalizedTransform(projector.transform),
  };
  const reference = normalizedReference(projector.reference, includeReferenceData);
  if (reference) result.reference = reference;
  return result;
}

function bytesToBase64(bytes) {
  const BufferConstructor = globalThis.Buffer;
  if (BufferConstructor?.from) return BufferConstructor.from(bytes).toString("base64");
  if (typeof globalThis.btoa !== "function") fail("This runtime cannot encode project data", "UNSUPPORTED_RUNTIME");
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

function base64ToBytes(value, label) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail(`${label} contains invalid base64 data`);
  }
  const BufferConstructor = globalThis.Buffer;
  if (BufferConstructor?.from) return new Uint8Array(BufferConstructor.from(value, "base64"));
  if (typeof globalThis.atob !== "function") fail("This runtime cannot decode project data", "UNSUPPORTED_RUNTIME");
  let binary;
  try {
    binary = globalThis.atob(value);
  } catch {
    fail(`${label} contains invalid base64 data`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pixelsFromBytes(data, bytesPerIndex, colors, total, label) {
  const bytes = base64ToBytes(data, label);
  if (bytes.length !== total * bytesPerIndex) fail(`${label} does not match the canvas size`);
  const pixels = Array(total).fill(null);
  let painted = false;
  for (let index = 0; index < total; index += 1) {
    const value = bytesPerIndex === 1
      ? bytes[index]
      : bytes[index * 2] | (bytes[index * 2 + 1] << 8);
    if (value > colors.length) fail(`${label} references a missing color`);
    if (value > 0) {
      pixels[index] = colors[value - 1];
      painted = true;
    }
  }
  return painted ? pixels : null;
}

function normalizePixels(value, total, label) {
  if (!Array.isArray(value) || value.length !== total) fail(`${label} must contain exactly ${total} pixels`);
  let painted = false;
  const pixels = value.map((color, index) => {
    if (color === null || color === undefined) return null;
    painted = true;
    return normalizedColor(color, `${label}, pixel ${index + 1}`);
  });
  return painted ? pixels : null;
}

function normalizedLayer(value, index) {
  if (!isRecord(value)) fail(`Layer ${index + 1} is invalid`);
  return {
    id: stableId(value.id, `Layer ${index + 1} id`),
    name: normalizedName(value.name, `Layer ${index + 1}`, `Layer ${index + 1} name`),
    visible: value.visible !== false,
    locked: Boolean(value.locked),
    opacity: normalizedOpacity(value.opacity),
  };
}

function normalizedClip(value, index, frameIds) {
  if (!isRecord(value)) fail(`Animation clip ${index + 1} is invalid`);
  if (!Array.isArray(value.frameIds) || !value.frameIds.length) {
    fail(`Animation clip ${index + 1} must contain at least one frame`);
  }
  const seen = new Set();
  const normalizedFrameIds = value.frameIds.map((frameId, frameIndex) => {
    const id = stableId(frameId, `Animation clip ${index + 1}, frame ${frameIndex + 1} id`);
    if (!frameIds.has(id)) fail(`Animation clip ${index + 1} references missing frame ${id}`);
    if (seen.has(id)) fail(`Animation clip ${index + 1} repeats frame ${id}`);
    seen.add(id);
    return id;
  });
  const direction = CLIP_DIRECTIONS.has(value.direction) ? value.direction : "forward";
  return {
    id: stableId(value.id, `Animation clip ${index + 1} id`),
    name: normalizedName(value.name, `animation-${index + 1}`, `Animation clip ${index + 1} name`),
    frameIds: normalizedFrameIds,
    direction,
    loop: value.loop !== false,
  };
}

function assertUniqueIds(items, label) {
  const seen = new Set();
  items.forEach((item) => {
    if (seen.has(item.id)) fail(`${label} ids must be unique: ${item.id}`);
    seen.add(item.id);
  });
  return seen;
}

function assertUniqueClipNames(clips) {
  const names = new Set();
  clips.forEach((clip) => {
    const key = clip.name.toLocaleLowerCase();
    if (names.has(key)) fail(`Animation clip names must be unique: ${clip.name}`);
    names.add(key);
  });
}

function normalizedEditor(value, project) {
  const editor = isRecord(value) ? value : {};
  const layerIds = new Set(project.layers.map((layer) => layer.id));
  const frameIds = new Set(project.frames.map((frame) => frame.id));
  const clipIds = new Set(project.clips.map((clip) => clip.id));
  const activeLayerId = layerIds.has(editor.activeLayerId) ? editor.activeLayerId : project.layers[0].id;
  const activeFrameId = frameIds.has(editor.activeFrameId) ? editor.activeFrameId : project.frames[0].id;
  const activeClipId = clipIds.has(editor.activeClipId) ? editor.activeClipId : project.clips[0].id;
  return {
    activeFrameId,
    activeLayerId,
    activeClipId,
    selectedColor: normalizedColor(editor.selectedColor ?? project.palette[0] ?? DEFAULT_SELECTED_COLOR, "Selected color"),
  };
}

function normalizedRuntimeProject(value, options = {}) {
  if (!isRecord(value)) fail("Project is invalid");
  const size = positiveInteger(value.size, "Canvas size", MAX_CANVAS_SIZE);
  const total = size * size;

  if (!Array.isArray(value.layers) || !value.layers.length || value.layers.length > MAX_LAYERS) {
    fail(`Project must contain between 1 and ${MAX_LAYERS} layers`);
  }
  const layers = value.layers.map(normalizedLayer);
  const layerIds = assertUniqueIds(layers, "Layer");

  if (!Array.isArray(value.frames) || !value.frames.length || value.frames.length > MAX_FRAMES) {
    fail(`Project must contain between 1 and ${MAX_FRAMES} frames`);
  }
  let materializedCells = 0;
  const frames = value.frames.map((frame, frameIndex) => {
    if (!isRecord(frame)) fail(`Frame ${frameIndex + 1} is invalid`);
    if (!Array.isArray(frame.cels)) fail(`Frame ${frameIndex + 1} cels are invalid`);
    const celLayers = new Set();
    const cels = [];
    frame.cels.forEach((cel, celIndex) => {
      if (!isRecord(cel)) fail(`Frame ${frameIndex + 1}, cel ${celIndex + 1} is invalid`);
      const layerId = stableId(cel.layerId, `Frame ${frameIndex + 1}, cel ${celIndex + 1} layer id`);
      if (!layerIds.has(layerId)) fail(`Frame ${frameIndex + 1} references missing layer ${layerId}`);
      if (celLayers.has(layerId)) fail(`Frame ${frameIndex + 1} has more than one cel for layer ${layerId}`);
      celLayers.add(layerId);
      const pixels = normalizePixels(cel.pixels, total, `Frame ${frameIndex + 1}, layer ${layerId}`);
      if (pixels) {
        materializedCells += pixels.length;
        cels.push({ layerId, pixels });
      }
    });
    const result = {
      id: stableId(frame.id, `Frame ${frameIndex + 1} id`),
      durationMs: normalizedDuration(frame.durationMs, options.defaultDurationMs),
      cels,
    };
    if (frame.pivot !== undefined) result.pivot = normalizedPivot(frame.pivot, size);
    return result;
  });
  if (materializedCells > MAX_TOTAL_CELLS) fail("Project contains too many materialized cel pixels");
  const frameIds = assertUniqueIds(frames, "Frame");

  if (!Array.isArray(value.clips) || !value.clips.length || value.clips.length > MAX_CLIPS) {
    fail(`Project must contain between 1 and ${MAX_CLIPS} animation clips`);
  }
  const clips = value.clips.map((clip, index) => normalizedClip(clip, index, frameIds));
  assertUniqueIds(clips, "Animation clip");
  assertUniqueClipNames(clips);

  const project = {
    name: normalizedName(value.name, DEFAULT_PROJECT_NAME, "Project name"),
    size,
    layers,
    frames,
    clips,
    palette: normalizedPalette(value.palette),
    slices: normalizedSlices(value.slices, size),
    pivot: normalizedPivot(value.pivot, size),
    tile: normalizedTileSettings(value.tile),
    tilemap: normalizedTilemap(value.tilemap, frameIds),
    projector: normalizedProjector(value.projector, options.includeReferenceData !== false),
  };
  return project;
}

function encodePixels(pixels, colorIndex, bytesPerIndex) {
  const bytes = new Uint8Array(pixels.length * bytesPerIndex);
  pixels.forEach((color, index) => {
    if (!color) return;
    const value = colorIndex.get(color);
    if (!value) fail(`Pixel color ${color} is missing from the project color table`);
    if (bytesPerIndex === 1) bytes[index] = value;
    else {
      bytes[index * 2] = value & 255;
      bytes[index * 2 + 1] = value >> 8;
    }
  });
  return bytesToBase64(bytes);
}

/**
 * Create a minimal valid blank project and matching editor session.
 */
export function createBlankProject(options = {}) {
  const size = positiveInteger(options.size ?? 16, "Canvas size", MAX_CANVAS_SIZE);
  const layerId = stableId(options.layerId ?? 1, "Layer id");
  const frameId = stableId(options.frameId ?? 1, "Frame id");
  const clipId = stableId(options.clipId ?? 1, "Animation clip id");
  const palette = normalizedPalette(options.palette);
  const project = {
    name: normalizedName(options.name, DEFAULT_PROJECT_NAME, "Project name"),
    size,
    layers: [{ id: layerId, name: "Layer 1", visible: true, locked: false, opacity: 100 }],
    frames: [{ id: frameId, durationMs: normalizedDuration(options.durationMs), cels: [] }],
    clips: [{ id: clipId, name: "default", frameIds: [frameId], direction: "forward", loop: true }],
    palette,
    slices: normalizedSlices(options.slices, size),
    pivot: normalizedPivot(options.pivot, size),
    tile: normalizedTileSettings(options.tile),
    tilemap: normalizedTilemap(options.tilemap, new Set([frameId])),
    projector: normalizedProjector(options.projector),
  };
  const editor = normalizedEditor({
    activeFrameId: frameId,
    activeLayerId: layerId,
    activeClipId: clipId,
    selectedColor: options.selectedColor ?? palette[0],
  }, project);
  return { project, editor };
}

/**
 * Encode a runtime project into a compact, JSON-safe v3 object.
 *
 * @param {object} project Runtime project document.
 * @param {object} editor Active frame/layer/clip and selected color.
 * @param {{includeReference?: boolean}} [options]
 */
export function encodeProjectV3(project, editor, options = {}) {
  const normalized = normalizedRuntimeProject(project, {
    includeReferenceData: options.includeReference !== false,
    defaultDurationMs: DEFAULT_FRAME_DURATION_MS,
  });
  const normalizedSession = normalizedEditor(editor, normalized);
  const colors = [];
  const colorIndex = new Map();
  normalized.frames.forEach((frame) => {
    frame.cels.forEach((cel) => {
      cel.pixels.forEach((color) => {
        if (color && !colorIndex.has(color)) {
          if (colors.length >= MAX_COLORS) fail(`Projects may contain at most ${MAX_COLORS} distinct colors`);
          colors.push(color);
          colorIndex.set(color, colors.length);
        }
      });
    });
  });
  const bytesPerIndex = colors.length <= 255 ? 1 : 2;
  const frames = normalized.frames.map((frame) => {
    const stored = {
      id: frame.id,
      durationMs: frame.durationMs,
      cels: frame.cels.map((cel) => ({
        layerId: cel.layerId,
        data: encodePixels(cel.pixels, colorIndex, bytesPerIndex),
      })),
    };
    if (frame.pivot) stored.pivot = { ...frame.pivot };
    return stored;
  });
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: normalized.name,
    size: normalized.size,
    colors,
    bytesPerIndex,
    layers: normalized.layers.map((layer) => ({ ...layer })),
    frames,
    clips: normalized.clips.map((clip) => ({ ...clip, frameIds: [...clip.frameIds] })),
    palette: [...normalized.palette],
    slices: normalized.slices.map((slice) => ({
      ...slice,
      bounds: { ...slice.bounds },
      ...(slice.pivot ? { pivot: { ...slice.pivot } } : {}),
    })),
    editor: { ...normalizedSession },
    pivot: { ...normalized.pivot },
    tile: { ...normalized.tile },
    tilemap: { ...normalized.tilemap, cells: [...normalized.tilemap.cells] },
    projector: normalizedProjector(normalized.projector, options.includeReference !== false),
  };
}

function decodeStoredV3(value) {
  const parsed = parseInput(value);
  if (!isRecord(parsed) || parsed.format !== PROJECT_FORMAT || parsed.version !== PROJECT_VERSION) {
    fail(`Expected a ${PROJECT_FORMAT} v${PROJECT_VERSION} project`, "UNSUPPORTED_VERSION");
  }
  const size = positiveInteger(parsed.size, "Canvas size", MAX_CANVAS_SIZE);
  const total = size * size;
  if (!Array.isArray(parsed.colors) || parsed.colors.length > MAX_COLORS) fail("Project color table is invalid");
  const colors = parsed.colors.map((color, index) => normalizedColor(color, `Project color ${index + 1}`));
  if (new Set(colors).size !== colors.length) fail("Project color table contains duplicates");
  const bytesPerIndex = parsed.bytesPerIndex;
  if (bytesPerIndex !== 1 && bytesPerIndex !== 2) fail("Project color index width is invalid");
  if (bytesPerIndex === 1 && colors.length > 255) fail("Project color table does not fit one-byte indices");

  if (!Array.isArray(parsed.frames)) fail("Project frames are invalid");
  let materializedCells = 0;
  const frames = parsed.frames.map((frame, frameIndex) => {
    if (!isRecord(frame) || !Array.isArray(frame.cels)) fail(`Frame ${frameIndex + 1} is invalid`);
    const celLayers = new Set();
    const cels = [];
    frame.cels.forEach((cel, celIndex) => {
      if (!isRecord(cel)) fail(`Frame ${frameIndex + 1}, cel ${celIndex + 1} is invalid`);
      const layerId = stableId(cel.layerId, `Frame ${frameIndex + 1}, cel ${celIndex + 1} layer id`);
      if (celLayers.has(layerId)) fail(`Frame ${frameIndex + 1} repeats layer ${layerId}`);
      celLayers.add(layerId);
      const pixels = pixelsFromBytes(
        cel.data,
        bytesPerIndex,
        colors,
        total,
        `Frame ${frameIndex + 1}, cel ${celIndex + 1}`,
      );
      if (pixels) {
        materializedCells += pixels.length;
        cels.push({ layerId, pixels });
      }
    });
    const result = {
      id: stableId(frame.id, `Frame ${frameIndex + 1} id`),
      durationMs: normalizedDuration(frame.durationMs),
      cels,
    };
    if (frame.pivot !== undefined) result.pivot = normalizedPivot(frame.pivot, size);
    return result;
  });
  if (materializedCells > MAX_TOTAL_CELLS) fail("Project contains too many materialized cel pixels");

  const runtime = {
    name: parsed.name,
    size,
    layers: parsed.layers,
    frames,
    clips: parsed.clips,
    palette: parsed.palette,
    slices: parsed.slices,
    pivot: parsed.pivot,
    tile: parsed.tile,
    tilemap: parsed.tilemap,
    projector: parsed.projector,
  };
  const project = normalizedRuntimeProject(runtime);
  const editor = normalizedEditor(parsed.editor, project);
  return { project, editor };
}

/** Decode a v3 object or JSON string into mutable runtime arrays. */
export function decodeProjectV3(value) {
  return decodeStoredV3(value);
}

function nextAvailableId(requested, used, cursor) {
  if (Number.isSafeInteger(requested) && requested > 0 && !used.has(requested)) {
    used.add(requested);
    return { id: requested, cursor };
  }
  let candidate = cursor;
  while (used.has(candidate)) candidate += 1;
  used.add(candidate);
  return { id: candidate, cursor: candidate + 1 };
}

function legacyFrameIds(frames) {
  const used = new Set();
  let cursor = 1;
  return frames.map((frame) => {
    const result = nextAvailableId(frame?.id, used, cursor);
    cursor = result.cursor;
    return result.id;
  });
}

function migrateStoredV2(parsed, options) {
  const size = positiveInteger(parsed.size, "Canvas size", MAX_CANVAS_SIZE);
  const total = size * size;
  if (!Array.isArray(parsed.colors) || parsed.colors.length > MAX_COLORS) fail("Legacy color table is invalid");
  const colors = parsed.colors.map((color, index) => normalizedColor(color, `Legacy color ${index + 1}`));
  if (!Array.isArray(parsed.frames) || !parsed.frames.length || parsed.frames.length > MAX_FRAMES) {
    fail("Legacy project frames are invalid");
  }
  const frameIds = legacyFrameIds(parsed.frames);
  const frames = parsed.frames.map((frame, frameIndex) => {
    if (!isRecord(frame) || (frame.bytesPerIndex !== 1 && frame.bytesPerIndex !== 2)) {
      fail(`Legacy frame ${frameIndex + 1} is invalid`);
    }
    const pixels = pixelsFromBytes(
      frame.data,
      frame.bytesPerIndex,
      colors,
      total,
      `Legacy frame ${frameIndex + 1}`,
    );
    return {
      id: frameIds[frameIndex],
      durationMs: normalizedDuration(options.defaultDurationMs),
      cels: pixels ? [{ layerId: 1, pixels }] : [],
    };
  });
  const palette = normalizedPalette(parsed.palette);
  const project = {
    name: normalizedName(options.name ?? parsed.name, DEFAULT_PROJECT_NAME, "Project name"),
    size,
    layers: [{ id: 1, name: "Layer 1", visible: true, locked: false, opacity: 100 }],
    frames,
    clips: [{ id: 1, name: "default", frameIds: [...frameIds], direction: "forward", loop: true }],
    palette,
    pivot: normalizedPivot(undefined, size),
    tile: normalizedTileSettings(undefined),
    projector: normalizedProjector(parsed.projector),
  };
  const activeIndex = clamp(
    Number.isSafeInteger(parsed.activeFrame) ? parsed.activeFrame : 0,
    0,
    frames.length - 1,
  );
  const editor = normalizedEditor({
    activeFrameId: frames[activeIndex].id,
    activeLayerId: 1,
    activeClipId: 1,
    selectedColor: parsed.selectedColor ?? palette[0],
  }, project);
  return { project, editor };
}

function migrateRawLegacy(parsed, options) {
  const size = positiveInteger(parsed.size, "Canvas size", MAX_CANVAS_SIZE);
  const total = size * size;
  if (!Array.isArray(parsed.frames) || !parsed.frames.length || parsed.frames.length > MAX_FRAMES) {
    fail("Legacy project frames are invalid");
  }
  const frameIds = legacyFrameIds(parsed.frames);
  let materializedCells = 0;
  const frames = parsed.frames.map((frame, frameIndex) => {
    if (!isRecord(frame)) fail(`Legacy frame ${frameIndex + 1} is invalid`);
    const pixels = normalizePixels(frame.pixels, total, `Legacy frame ${frameIndex + 1}`);
    if (pixels) materializedCells += pixels.length;
    return {
      id: frameIds[frameIndex],
      durationMs: normalizedDuration(options.defaultDurationMs),
      cels: pixels ? [{ layerId: 1, pixels }] : [],
    };
  });
  if (materializedCells > MAX_TOTAL_CELLS) fail("Legacy project contains too many pixel cells");
  const palette = normalizedPalette(parsed.palette);
  const project = {
    name: normalizedName(options.name ?? parsed.name, DEFAULT_PROJECT_NAME, "Project name"),
    size,
    layers: [{ id: 1, name: "Layer 1", visible: true, locked: false, opacity: 100 }],
    frames,
    clips: [{ id: 1, name: "default", frameIds: [...frameIds], direction: "forward", loop: true }],
    palette,
    pivot: normalizedPivot(undefined, size),
    tile: normalizedTileSettings(undefined),
    projector: normalizedProjector(parsed.projector),
  };
  const activeIndex = clamp(
    Number.isSafeInteger(parsed.activeFrame) ? parsed.activeFrame : 0,
    0,
    frames.length - 1,
  );
  const editor = normalizedEditor({
    activeFrameId: frames[activeIndex].id,
    activeLayerId: 1,
    activeClipId: 1,
    selectedColor: parsed.selectedColor ?? palette[0],
  }, project);
  return { project, editor };
}

/**
 * Decode any supported PixelWall project and upgrade it to the v3 runtime model.
 * Returns `migratedFrom` so callers can decide whether to immediately autosave.
 */
export function upgradeProject(value, options = {}) {
  const parsed = parseInput(value);
  if (!isRecord(parsed)) fail("Project is invalid");
  const migrationOptions = {
    defaultDurationMs: normalizedDuration(options.defaultDurationMs),
    name: options.name,
  };
  if (parsed.format === PROJECT_FORMAT && parsed.version === PROJECT_VERSION) {
    return { ...decodeStoredV3(parsed), migratedFrom: PROJECT_VERSION };
  }
  if (parsed.version === 2) {
    return { ...migrateStoredV2(parsed, migrationOptions), migratedFrom: 2 };
  }
  if (parsed.version === 1 || (parsed.version === undefined && Array.isArray(parsed.frames))) {
    return { ...migrateRawLegacy(parsed, migrationOptions), migratedFrom: 1 };
  }
  fail("This PixelWall project version is not supported", "UNSUPPORTED_VERSION");
}

/** Parse project JSON and upgrade it to the current runtime model. */
export function parseProject(source, options = {}) {
  return upgradeProject(source, options);
}

/** Encode and stringify a runtime project for autosave or a `.pixelwall` file. */
export function stringifyProject(project, editor, options = {}) {
  const encoded = encodeProjectV3(project, editor, options);
  return JSON.stringify(encoded, null, options.pretty ? 2 : 0);
}
