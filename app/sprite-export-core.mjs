/**
 * Pure sprite-atlas planning and metadata helpers.
 *
 * This module deliberately has no React, DOM, Canvas, Node, or filesystem
 * dependencies. A browser UI can use the returned rectangles to draw PNGs and
 * then put the returned metadata and file names into any archive implementation.
 */

export const SPRITE_EXPORT_SCHEMA = "pixelwall.sprite-atlas";
export const SPRITE_EXPORT_VERSION = 2;
export const SHEET_LAYOUT_TYPES = Object.freeze(["horizontal", "vertical", "grid"]);
export const CLIP_DIRECTIONS = Object.freeze([
  "forward",
  "reverse",
  "pingpong",
  "pingpong_reverse",
]);

// Keep the default deployment-neutral. Callers may pass `app: location.origin`
// when they want the current self-hosted URL recorded in the manifest.
const DEFAULT_APP_IDENTIFIER = "PixelWall";
const DEFAULT_FPS = 8;

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Turn a user-facing project or clip name into a safe, portable file stem. */
export function exportFileStem(value, fallback = "pixelwall") {
  const stem = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return stem || fallback;
}

function safeFilename(value, fallback) {
  const requested = String(value ?? "").trim().replace(/\\/g, "/");
  const rawLeaf = requested.split("/").at(-1);
  const leaf = rawLeaf
    ? [...rawLeaf].map((character) => character.charCodeAt(0) < 32 ? "-" : character).join("").replace(/[<>:"|?*]/g, "-")
    : "";
  if (!leaf || leaf === "." || leaf === "..") return fallback;
  return leaf.slice(0, 180);
}

function defaultDuration(fps) {
  return Math.max(1, Math.round(1000 / Math.max(1, finiteNumber(fps, DEFAULT_FPS))));
}

function normalizedDirection(direction) {
  return CLIP_DIRECTIONS.includes(direction) ? direction : "forward";
}

function stableFrameId(frame, index) {
  return frame?.id ?? index;
}

function normalizeClip(clip, index, frames, sourceIndexById) {
  const frameCount = frames.length;
  const rawName = typeof clip?.name === "string" ? clip.name.trim() : "";
  const name = rawName || `animation-${index + 1}`;
  const rawFrom = Number.isInteger(clip?.from) ? clip.from : 0;
  const rawTo = Number.isInteger(clip?.to) ? clip.to : frameCount - 1;
  const first = clamp(Math.min(rawFrom, rawTo), 0, frameCount - 1);
  const last = clamp(Math.max(rawFrom, rawTo), 0, frameCount - 1);
  const repeat = Number.isInteger(clip?.repeat) ? clip.repeat : clip?.loop === false ? 0 : -1;
  let sourceIndices;
  if (Array.isArray(clip?.frameIds) && clip.frameIds.length) {
    sourceIndices = clip.frameIds.map((frameId) => {
      const sourceIndex = sourceIndexById.get(frameId);
      if (sourceIndex === undefined) throw new Error(`Animation ${name} references missing frame id: ${frameId}`);
      return sourceIndex;
    });
  } else {
    sourceIndices = Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
  }
  return {
    name,
    from: Math.min(...sourceIndices),
    to: Math.max(...sourceIndices),
    frameIds: sourceIndices.map((sourceIndex) => stableFrameId(frames[sourceIndex], sourceIndex)),
    sourceIndices,
    direction: normalizedDirection(clip?.direction),
    repeat,
  };
}

function normalizeClips(clips, frames) {
  const frameCount = frames.length;
  const sourceIndexById = new Map();
  frames.forEach((frame, sourceIndex) => {
    const id = stableFrameId(frame, sourceIndex);
    if (sourceIndexById.has(id)) throw new Error(`Frame ids must be unique: ${id}`);
    sourceIndexById.set(id, sourceIndex);
  });
  const normalized = Array.isArray(clips) && clips.length
    ? clips.map((clip, index) => normalizeClip(clip, index, frames, sourceIndexById))
    : [normalizeClip({ name: "default", from: 0, to: frameCount - 1 }, 0, frames, sourceIndexById)];
  const names = new Set();
  normalized.forEach((clip) => {
    const key = clip.name.toLocaleLowerCase();
    if (names.has(key)) throw new Error(`Animation clip names must be unique: ${clip.name}`);
    names.add(key);
  });
  return normalized;
}

function normalizePivot(value, frameWidth, frameHeight) {
  const pivot = value && typeof value === "object" ? value : {};
  const unit = pivot.unit === "normalized" ? "normalized" : "pixels";
  const inputX = finiteNumber(pivot.x, unit === "normalized" ? 0.5 : frameWidth / 2);
  const inputY = finiteNumber(pivot.y, unit === "normalized" ? 0.5 : frameHeight / 2);
  const pixelX = unit === "normalized" ? inputX * frameWidth : inputX;
  const pixelY = unit === "normalized" ? inputY * frameHeight : inputY;
  return {
    pixels: { x: pixelX, y: pixelY },
    normalized: { x: pixelX / frameWidth, y: pixelY / frameHeight },
  };
}

function framePivot(frame, sourceIndex, pivots, fallback, frameWidth, frameHeight) {
  let candidate = frame?.pivot;
  if (Array.isArray(pivots) && pivots[sourceIndex] !== undefined) {
    candidate = pivots[sourceIndex];
  } else if (pivots && typeof pivots === "object") {
    const sourceId = frame?.id;
    candidate = pivots[sourceId] ?? pivots[String(sourceId)] ?? pivots[sourceIndex] ?? candidate;
  }
  return normalizePivot(candidate ?? fallback, frameWidth, frameHeight);
}

/**
 * Calculate sheet geometry for an already-selected number of frames.
 *
 * @param {number} frameCount
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {string | {type?: string, columns?: number}} [layout]
 */
export function calculateSheetLayout(frameCount, frameWidth, frameHeight, layout = "horizontal") {
  assertPositiveInteger(frameCount, "frameCount");
  assertPositiveInteger(frameWidth, "frameWidth");
  assertPositiveInteger(frameHeight, "frameHeight");

  const requested = typeof layout === "string" ? { type: layout } : (layout ?? {});
  const type = SHEET_LAYOUT_TYPES.includes(requested.type) ? requested.type : "horizontal";
  let columns;
  if (type === "vertical") columns = 1;
  else if (type === "horizontal") columns = frameCount;
  else {
    const requestedColumns = Number.isInteger(requested.columns) ? requested.columns : Math.ceil(Math.sqrt(frameCount));
    columns = clamp(requestedColumns, 1, frameCount);
  }
  const rows = Math.ceil(frameCount / columns);
  return {
    type,
    columns,
    rows,
    width: columns * frameWidth,
    height: rows * frameHeight,
  };
}

function normalizeSourceRect(frame, frameWidth, frameHeight, trim) {
  const full = { x: 0, y: 0, w: frameWidth, h: frameHeight };
  if (!trim) return full;
  const requested = frame?.trimBounds ?? frame?.sourceRect;
  if (!requested || typeof requested !== "object") return full;
  const x = clamp(Math.floor(finiteNumber(requested.x, 0)), 0, frameWidth - 1);
  const y = clamp(Math.floor(finiteNumber(requested.y, 0)), 0, frameHeight - 1);
  const w = clamp(Math.ceil(finiteNumber(requested.w ?? requested.width, frameWidth - x)), 1, frameWidth - x);
  const h = clamp(Math.ceil(finiteNumber(requested.h ?? requested.height, frameHeight - y)), 1, frameHeight - y);
  return { x, y, w, h };
}

function calculateVariableSheet(sourceRects, layout, padding) {
  const frameCount = sourceRects.length;
  const requested = typeof layout === "string" ? { type: layout } : (layout ?? {});
  const type = SHEET_LAYOUT_TYPES.includes(requested.type) ? requested.type : "horizontal";
  const columns = type === "vertical"
    ? 1
    : type === "horizontal"
      ? frameCount
      : clamp(Number.isInteger(requested.columns) ? requested.columns : Math.ceil(Math.sqrt(frameCount)), 1, frameCount);
  const rows = Math.ceil(frameCount / columns);
  let width = 0;
  let height = 0;
  const placements = [];
  if (type === "horizontal") {
    width = sourceRects.reduce((total, rect) => total + rect.w, 0) + padding * (frameCount + 1);
    height = Math.max(...sourceRects.map((rect) => rect.h)) + padding * 2;
    let x = padding;
    sourceRects.forEach((rect) => {
      placements.push({ x, y: padding, w: rect.w, h: rect.h });
      x += rect.w + padding;
    });
  } else if (type === "vertical") {
    width = Math.max(...sourceRects.map((rect) => rect.w)) + padding * 2;
    height = sourceRects.reduce((total, rect) => total + rect.h, 0) + padding * (frameCount + 1);
    let y = padding;
    sourceRects.forEach((rect) => {
      placements.push({ x: padding, y, w: rect.w, h: rect.h });
      y += rect.h + padding;
    });
  } else {
    const cellWidth = Math.max(...sourceRects.map((rect) => rect.w));
    const cellHeight = Math.max(...sourceRects.map((rect) => rect.h));
    width = columns * cellWidth + padding * (columns + 1);
    height = rows * cellHeight + padding * (rows + 1);
    sourceRects.forEach((rect, index) => placements.push({
      x: padding + (index % columns) * (cellWidth + padding),
      y: padding + Math.floor(index / columns) * (cellHeight + padding),
      w: rect.w,
      h: rect.h,
    }));
  }
  return { sheet: { type, columns, rows, width, height }, placements };
}

function normalizeSlices(slices, frameWidth, frameHeight) {
  if (!Array.isArray(slices)) return [];
  const names = new Set(["origin"]);
  return slices.slice(0, 256).map((slice, index) => {
    const name = String(slice?.name ?? `slice-${index + 1}`).trim() || `slice-${index + 1}`;
    const key = name.toLocaleLowerCase();
    if (names.has(key)) throw new Error(`Slice names must be unique: ${name}`);
    names.add(key);
    const bounds = normalizeSourceRect({ sourceRect: slice?.bounds ?? slice?.rect }, frameWidth, frameHeight, true);
    const pivot = normalizePivot(slice?.pivot ?? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }, frameWidth, frameHeight);
    return { name, bounds, pivot };
  });
}

function normalizeTilemap(tilemap, plannedFrames) {
  if (!tilemap || typeof tilemap !== "object") return null;
  const width = assertPositiveInteger(tilemap.width, "tilemap.width");
  const height = assertPositiveInteger(tilemap.height, "tilemap.height");
  if (width > 64 || height > 64 || !Array.isArray(tilemap.cells) || tilemap.cells.length !== width * height) {
    throw new Error("Tilemap must be at most 64 × 64 with one cell per tile");
  }
  const bySourceId = new Map(plannedFrames.map((frame, index) => [frame.sourceId, { filename: frame.filename, gid: index + 1 }]));
  const cells = tilemap.cells.map((frameId) => {
    if (frameId === null || frameId === undefined || frameId === 0) return null;
    const frame = bySourceId.get(frameId);
    if (!frame) throw new Error(`Tilemap references frame ${frameId}, which is not in this export`);
    return { frameId, filename: frame.filename, gid: frame.gid };
  });
  return { width, height, cells };
}

function sourceIndicesForClip(clip) {
  return [...clip.sourceIndices];
}

function uniqueInOrder(values) {
  return [...new Set(values)];
}

function playbackSequence(clip, sourceToFilename) {
  const forward = sourceIndicesForClip(clip).filter((index) => sourceToFilename.has(index));
  const reverse = [...forward].reverse();
  let sourceSequence;
  if (clip.direction === "reverse") sourceSequence = reverse;
  else if (clip.direction === "pingpong") sourceSequence = [...forward, ...reverse.slice(1, -1)];
  else if (clip.direction === "pingpong_reverse") sourceSequence = [...reverse, ...forward.slice(1, -1)];
  else sourceSequence = forward;
  return sourceSequence.map((index) => sourceToFilename.get(index));
}

function asepriteFrameTag(clip, sourceToExportIndex) {
  const indices = clip.sourceIndices.map((sourceIndex) => sourceToExportIndex.get(sourceIndex));
  const unique = uniqueInOrder(indices);
  const isContiguous = unique.length === indices.length && unique.every((value, offset) => value === unique[0] + offset);
  if (!isContiguous) return null;
  return {
    name: clip.name,
    from: unique[0],
    to: unique.at(-1),
    direction: clip.direction,
    repeat: clip.repeat < 0 ? 0 : clip.repeat + 1,
  };
}

function publicClip(clip) {
  return {
    name: clip.name,
    from: clip.from,
    to: clip.to,
    frameIds: [...clip.frameIds],
    direction: clip.direction,
    repeat: clip.repeat,
  };
}

/**
 * Build one manifest that keeps Aseprite's familiar hash-frame base, Pixi's
 * `animations` map, Phaser-friendly tags/animation recipes, and explicit
 * PixelWall layout/pivot data.
 */
export function buildEngineSpriteMetadata(plan) {
  if (!plan || plan.schema !== SPRITE_EXPORT_SCHEMA) {
    throw new TypeError("Expected a PixelWall sprite export plan");
  }

  const hashFrames = Object.fromEntries(plan.frames.map((entry) => [
    entry.filename,
    {
      frame: { ...entry.rect },
      rotated: false,
      trimmed: entry.sourceRect.x !== 0 || entry.sourceRect.y !== 0 ||
        entry.sourceRect.w !== plan.frame.width || entry.sourceRect.h !== plan.frame.height,
      spriteSourceSize: { ...entry.sourceRect },
      sourceSize: { w: plan.frame.width, h: plan.frame.height },
      duration: entry.durationMs,
      pivot: { ...entry.pivot.normalized },
      anchor: { ...entry.pivot.normalized },
    },
  ]));
  const sourceToFilename = new Map(plan.frames.map((frame) => [frame.sourceIndex, frame.filename]));
  const durationByFilename = new Map(plan.frames.map((frame) => [frame.filename, frame.durationMs]));
  const animations = Object.fromEntries(plan.clips.map((clip) => [
    clip.name,
    playbackSequence(clip, sourceToFilename),
  ]));
  const sourceToExportIndex = new Map(plan.frames.map((frame) => [frame.sourceIndex, frame.exportIndex]));
  // Aseprite tags can only describe contiguous ranges. Arbitrary stable-id
  // sequences remain fully represented by Pixi/Phaser/PixelWall metadata.
  const frameTags = plan.clips
    .map((clip) => asepriteFrameTag(clip, sourceToExportIndex))
    .filter(Boolean);
  const phaserAnimations = plan.clips.map((clip) => {
    const filenames = animations[clip.name];
    return {
      key: clip.name,
      frames: filenames.map((filename) => ({
        key: plan.atlasKey,
        frame: filename,
        duration: durationByFilename.get(filename) ?? 0,
      })),
      duration: 1,
      repeat: clip.repeat,
    };
  });

  return {
    frames: hashFrames,
    animations,
    meta: {
      app: plan.app,
      version: String(SPRITE_EXPORT_VERSION),
      image: plan.files.sheet,
      format: "RGBA8888",
      size: { w: plan.sheet.width, h: plan.sheet.height },
      scale: "1",
      frameTags,
      slices: [{
        name: "origin",
        color: "#00ff00ff",
        keys: plan.frames.map((entry) => ({
          frame: entry.exportIndex,
          bounds: { x: 0, y: 0, w: plan.frame.width, h: plan.frame.height },
          pivot: { ...entry.pivot.pixels },
        })),
      }, ...plan.slices.map((slice) => ({
        name: slice.name,
        color: "#70d6b2ff",
        keys: plan.frames.map((entry) => ({
          frame: entry.exportIndex,
          bounds: { ...slice.bounds },
          pivot: { ...slice.pivot.pixels },
        })),
      }))],
    },
    phaser: {
      atlasKey: plan.atlasKey,
      animations: phaserAnimations,
      ...(plan.tilemap ? {
        tilemap: {
          width: plan.tilemap.width,
          height: plan.tilemap.height,
          tileWidth: plan.frame.width,
          tileHeight: plan.frame.height,
          data: plan.tilemap.cells.map((cell) => cell?.gid ?? 0),
        },
      } : {}),
    },
    pixelwall: {
      schema: SPRITE_EXPORT_SCHEMA,
      version: SPRITE_EXPORT_VERSION,
      selectedClip: plan.selectedClip,
      layout: { ...plan.sheet },
      padding: plan.padding,
      trimmed: plan.trim,
      frame: { ...plan.frame },
      files: {
        sheet: plan.files.sheet,
        frames: [...plan.files.frames],
      },
      frames: plan.frames.map((entry) => ({
        filename: entry.filename,
        sourceIndex: entry.sourceIndex,
        sourceId: entry.sourceId,
        durationMs: entry.durationMs,
        sourceRect: { ...entry.sourceRect },
        pivot: {
          pixels: { ...entry.pivot.pixels },
          normalized: { ...entry.pivot.normalized },
        },
      })),
      slices: plan.slices.map((slice) => ({
        name: slice.name,
        bounds: { ...slice.bounds },
        pivot: { ...slice.pivot.pixels },
      })),
      ...(plan.tilemap ? {
        tilemap: {
          width: plan.tilemap.width,
          height: plan.tilemap.height,
          cells: plan.tilemap.cells.map((cell) => cell ? { ...cell } : null),
        },
      } : {}),
      clips: plan.clips.map(publicClip),
    },
  };
}

/**
 * Create a complete, renderer-independent atlas export plan.
 *
 * Important options:
 * - `layout`: `"horizontal"`, `"vertical"`, or `{type:"grid", columns:4}`
 * - `selectedClip`: a clip name to export only its frames; omit for all frames
 * - clips may use `from`/`to` or an explicit ordered `frameIds` array
 * - `pivots`: array or object keyed by frame id/index; coordinates default to px
 * - `files`: optional `{sheet, data, archive}` filename overrides
 *
 * @param {object} options
 */
export function createSpriteExportPlan(options) {
  if (!options || typeof options !== "object") throw new TypeError("Export options are required");
  const frames = Array.isArray(options.frames) ? options.frames : [];
  assertPositiveInteger(frames.length, "frames.length");
  const frameWidth = assertPositiveInteger(options.frameWidth ?? options.size, "frameWidth");
  const frameHeight = assertPositiveInteger(options.frameHeight ?? options.size, "frameHeight");
  const clips = normalizeClips(options.clips, frames);
  const selectedClip = options.selectedClip == null || options.selectedClip === ""
    ? null
    : String(options.selectedClip);
  const chosenClip = selectedClip === null ? null : clips.find((clip) => clip.name === selectedClip);
  if (selectedClip !== null && !chosenClip) throw new Error(`Unknown animation clip: ${selectedClip}`);

  const sourceIndices = chosenClip
    ? uniqueInOrder(sourceIndicesForClip(chosenClip))
    : Array.from({ length: frames.length }, (_, index) => index);
  const exportedClips = chosenClip ? [chosenClip] : clips;
  const padding = clamp(Number.isInteger(options.padding) ? options.padding : 0, 0, 64);
  const trim = options.trim === true;
  const sourceRects = sourceIndices.map((sourceIndex) => normalizeSourceRect(frames[sourceIndex], frameWidth, frameHeight, trim));
  const layoutPlan = calculateVariableSheet(sourceRects, options.layout, padding);
  const sheet = layoutPlan.sheet;
  if (Number.isInteger(options.maxTextureSize) &&
    (sheet.width > options.maxTextureSize || sheet.height > options.maxTextureSize)) {
    throw new RangeError(`Sprite sheet exceeds ${options.maxTextureSize}px texture limit`);
  }
  if (Number.isInteger(options.maxSheetPixels) && sheet.width * sheet.height > options.maxSheetPixels) {
    throw new RangeError("Sprite sheet exceeds pixel budget");
  }

  const projectStem = exportFileStem(options.basename, "pixelwall");
  const selectionStem = chosenClip ? `${projectStem}-${exportFileStem(chosenClip.name, "animation")}` : projectStem;
  const digits = Math.max(3, String(sourceIndices.length).length);
  const defaultPivot = options.defaultPivot ?? { x: frameWidth / 2, y: frameHeight / 2, unit: "pixels" };
  const plannedFrames = sourceIndices.map((sourceIndex, exportIndex) => {
    const source = frames[sourceIndex] ?? {};
    const filenameFallback = `${selectionStem}-${String(exportIndex + 1).padStart(digits, "0")}.png`;
    const filename = safeFilename(source.exportFilename, filenameFallback);
    const durationMs = Math.max(1, Math.round(finiteNumber(source.durationMs, defaultDuration(options.fps))));
    return {
      exportIndex,
      sourceIndex,
      sourceId: source.id ?? sourceIndex,
      filename,
      rect: { ...layoutPlan.placements[exportIndex] },
      sourceRect: { ...sourceRects[exportIndex] },
      durationMs,
      pivot: framePivot(source, sourceIndex, options.pivots, defaultPivot, frameWidth, frameHeight),
    };
  });
  const filenames = plannedFrames.map((frame) => frame.filename);
  if (new Set(filenames).size !== filenames.length) throw new Error("Individual frame filenames must be unique");

  const files = {
    sheet: safeFilename(options.files?.sheet, `${selectionStem}-sheet.png`),
    data: safeFilename(options.files?.data, `${selectionStem}.json`),
    archive: safeFilename(options.files?.archive, `${selectionStem}-sprites.zip`),
    frames: options.includeIndividualFrames === false ? [] : filenames,
  };
  const tilemap = normalizeTilemap(options.tilemap, plannedFrames);
  const plan = {
    schema: SPRITE_EXPORT_SCHEMA,
    version: SPRITE_EXPORT_VERSION,
    app: typeof options.app === "string" && options.app ? options.app : DEFAULT_APP_IDENTIFIER,
    atlasKey: exportFileStem(options.atlasKey ?? selectionStem, "pixelwall"),
    selectedClip: chosenClip?.name ?? null,
    frame: { width: frameWidth, height: frameHeight },
    padding,
    trim,
    sheet,
    slices: normalizeSlices(options.slices, frameWidth, frameHeight),
    tilemap,
    files,
    frames: plannedFrames,
    clips: exportedClips,
  };
  return { ...plan, metadata: buildEngineSpriteMetadata(plan) };
}
