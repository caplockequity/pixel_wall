/**
 * Pure planning helpers for a dedicated PixelWall Tilemap Lab package.
 *
 * The export includes every project frame as an available tile. Frames are
 * sorted by their stable frame IDs instead of map traversal or timeline order,
 * so repainting or reordering the timeline cannot silently change the
 * frame-to-GID mapping. Consumers that persist or merge maps should still treat
 * the PixelWall frame ID as canonical.
 *
 * This module deliberately has no DOM, Canvas, React, Node built-in, or
 * filesystem dependencies. A renderer can use `tiles[].sourceIndex` and
 * `tiles[].rect` to draw the PNG described by `sheet`, then serialize `tiled`
 * and `pixelwall` as the two JSON files named in `files`.
 */

export const TILEMAP_EXPORT_SCHEMA = "pixelwall.tilemap-package";
export const TILEMAP_EXPORT_VERSION = 1;
export const TILED_JSON_VERSION = "1.10";
export const TILED_COMPATIBILITY_VERSION = "1.10.2";

const MAX_MAP_CELLS = 16_777_216;
const MAX_MAP_EDGE = 16_384;
const MAX_TILE_SIZE = 4_096;
const MAX_FRAMES = 65_535;
const MAX_SHEET_EDGE = 16_384;
const MAX_SHEET_PIXELS = 16_777_216;
const MAX_NAME_LENGTH = 120;
const DEFAULT_PREVIEW_MAX_DIMENSION = 4_096;

export class TilemapExportError extends Error {
  constructor(message, code = "INVALID_TILEMAP_EXPORT") {
    super(message);
    this.name = "TilemapExportError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new TilemapExportError(message, code);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function normalizedName(value, fallback, label) {
  const name = typeof value === "string" ? value.trim() : "";
  const result = name || fallback;
  if ([...result].length > MAX_NAME_LENGTH) fail(`${label} is too long`);
  return result;
}

/** Turn a project name into a portable, deployment-neutral file stem. */
export function tilemapFileStem(value, fallback = "pixelwall") {
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
    ? [...rawLeaf]
      .map((character) => character.charCodeAt(0) < 32 ? "-" : character)
      .join("")
      .replace(/[<>:"|?*]/g, "-")
    : "";
  if (!leaf || leaf === "." || leaf === "..") return fallback;
  return leaf.slice(0, 180);
}

function stableId(value, label) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive integer or non-empty string`);
    return value;
  }
  if (typeof value === "string" && value.trim() && [...value].length <= MAX_NAME_LENGTH) return value;
  fail(`${label} must be a positive integer or non-empty string`);
}

function stableIdKey(value) {
  return `${typeof value === "number" ? "n" : "s"}:${value}`;
}

function compareStableIds(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "number") return -1;
  if (typeof right === "number") return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function isEmptyCell(value) {
  return value === null || value === undefined || value === 0;
}

function tiledFrameIdProperties(frameId) {
  const fitsTiledInteger = typeof frameId === "number" && frameId <= 2_147_483_647;
  return [
    {
      name: "pixelwallFrameId",
      type: fitsTiledInteger ? "int" : "string",
      value: fitsTiledInteger ? frameId : String(frameId),
    },
    {
      name: "pixelwallFrameIdType",
      type: "string",
      value: typeof frameId,
    },
  ];
}

function uniquePackageFiles(files) {
  const seen = new Set();
  Object.entries(files).forEach(([label, filename]) => {
    const key = filename.toLocaleLowerCase();
    if (seen.has(key)) fail(`Package filenames must be unique: ${filename}`, "DUPLICATE_FILENAME");
    seen.add(key);
    if (!filename) fail(`${label} filename is invalid`, "INVALID_FILENAME");
  });
  return files;
}

/**
 * Calculate exact map pixels and an aspect-preserving, optionally capped PNG
 * preview. Renderers should disable image smoothing when drawing the preview.
 */
export function calculateTilemapPreview(width, height, tileSize, maxDimension = DEFAULT_PREVIEW_MAX_DIMENSION) {
  positiveInteger(width, "Map width", MAX_MAP_EDGE);
  positiveInteger(height, "Map height", MAX_MAP_EDGE);
  positiveInteger(tileSize, "Tile size", MAX_TILE_SIZE);
  positiveInteger(maxDimension, "Preview maximum dimension", 65_535);
  if (width > maxDimension || height > maxDimension) {
    fail("Preview maximum dimension must allow at least one pixel per map cell", "PREVIEW_TOO_SMALL");
  }
  const sourceWidth = width * tileSize;
  const sourceHeight = height * tileSize;
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)) {
    fail("Map pixel dimensions are too large", "MAP_DIMENSIONS_TOO_LARGE");
  }
  const previewTileSize = Math.max(1, Math.min(
    tileSize,
    Math.floor(maxDimension / width),
    Math.floor(maxDimension / height),
  ));
  const scale = previewTileSize / tileSize;
  return {
    sourceWidth,
    sourceHeight,
    width: width * previewTileSize,
    height: height * previewTileSize,
    scale,
    capped: scale < 1,
  };
}

/**
 * Build a renderer-independent Tilemap Lab export plan.
 *
 * @param {object} options
 * @param {{width:number,height:number,cells:Array<number|string|null|undefined>}} options.tilemap
 * @param {Array<{id:number|string}>} options.frames
 * @param {number} options.tileSize
 * @param {string} [options.basename]
 * @param {string} [options.layerName]
 * @param {{archive?:string,map?:string,mapping?:string,previewImage?:string,tilesetImage?:string}} [options.files]
 * @param {number} [options.previewMaxDimension]
 */
export function createTilemapExportPlan(options) {
  if (!isRecord(options)) fail("Tilemap export options are required");
  if (!isRecord(options.tilemap)) fail("Tilemap is required");

  const width = positiveInteger(options.tilemap.width, "Map width", MAX_MAP_EDGE);
  const height = positiveInteger(options.tilemap.height, "Map height", MAX_MAP_EDGE);
  const totalCells = width * height;
  if (!Number.isSafeInteger(totalCells) || totalCells > MAX_MAP_CELLS) {
    fail(`Tilemap may contain at most ${MAX_MAP_CELLS} cells`, "MAP_TOO_LARGE");
  }
  if (!Array.isArray(options.tilemap.cells) || options.tilemap.cells.length !== totalCells) {
    fail(`Tilemap cells must contain exactly ${totalCells} row-major entries`, "INVALID_CELL_DATA");
  }

  const referencedIds = new Map();
  options.tilemap.cells.forEach((cell, index) => {
    if (isEmptyCell(cell)) return;
    const id = stableId(cell, `Tilemap cell ${index + 1} frame id`);
    referencedIds.set(stableIdKey(id), id);
  });
  if (!referencedIds.size) {
    fail("Tilemap must contain at least one painted tile", "EMPTY_TILEMAP");
  }

  if (!Array.isArray(options.frames) || !options.frames.length || options.frames.length > MAX_FRAMES) {
    fail(`Frames must contain between 1 and ${MAX_FRAMES} entries`, "INVALID_FRAMES");
  }
  const frameByKey = new Map();
  options.frames.forEach((frame, sourceIndex) => {
    if (!isRecord(frame)) fail(`Frame ${sourceIndex + 1} is invalid`, "INVALID_FRAME");
    const sourceId = stableId(frame.id, `Frame ${sourceIndex + 1} id`);
    const key = stableIdKey(sourceId);
    if (frameByKey.has(key)) fail(`Frame ids must be unique: ${sourceId}`, "DUPLICATE_FRAME_ID");
    frameByKey.set(key, { sourceId, sourceIndex });
  });

  referencedIds.forEach((sourceId) => {
    if (!frameByKey.has(stableIdKey(sourceId))) {
      fail(`Tilemap references missing frame ${sourceId}`, "MISSING_FRAME");
    }
  });
  const exportedFrames = [...frameByKey.values()]
    .sort((left, right) => compareStableIds(left.sourceId, right.sourceId));

  const tileSize = positiveInteger(options.tileSize, "Tile size", MAX_TILE_SIZE);
  const columns = Math.ceil(Math.sqrt(exportedFrames.length));
  const rows = Math.ceil(exportedFrames.length / columns);
  const sheetWidth = columns * tileSize;
  const sheetHeight = rows * tileSize;
  const sheetPixels = sheetWidth * sheetHeight;
  if (!Number.isSafeInteger(sheetWidth) || !Number.isSafeInteger(sheetHeight) ||
      sheetWidth > MAX_SHEET_EDGE || sheetHeight > MAX_SHEET_EDGE ||
      !Number.isSafeInteger(sheetPixels) || sheetPixels > MAX_SHEET_PIXELS) {
    fail("Tileset dimensions are too large", "TILESET_TOO_LARGE");
  }

  const tiles = exportedFrames.map((frame, exportIndex) => ({
    exportIndex,
    localId: exportIndex,
    gid: exportIndex + 1,
    sourceIndex: frame.sourceIndex,
    sourceId: frame.sourceId,
    rect: {
      x: (exportIndex % columns) * tileSize,
      y: Math.floor(exportIndex / columns) * tileSize,
      w: tileSize,
      h: tileSize,
    },
  }));
  const gidByFrameKey = new Map(tiles.map((tile) => [stableIdKey(tile.sourceId), tile.gid]));
  const gids = options.tilemap.cells.map((cell) => isEmptyCell(cell) ? 0 : gidByFrameKey.get(stableIdKey(cell)));
  if (gids.some((gid) => gid === undefined)) fail("Tilemap GID planning failed", "INVALID_GID_MAPPING");

  const stem = tilemapFileStem(options.basename, "pixelwall");
  const files = uniquePackageFiles({
    archive: safeFilename(options.files?.archive, `${stem}-tilemap.zip`),
    map: safeFilename(options.files?.map, `${stem}-tilemap.json`),
    mapping: safeFilename(options.files?.mapping, `${stem}-tilemap.pixelwall.json`),
    previewImage: safeFilename(options.files?.previewImage, `${stem}-tilemap-preview.png`),
    tilesetImage: safeFilename(options.files?.tilesetImage, `${stem}-tiles.png`),
  });
  const layerName = normalizedName(options.layerName, "Tile Layer 1", "Layer name");
  const preview = calculateTilemapPreview(
    width,
    height,
    tileSize,
    options.previewMaxDimension ?? DEFAULT_PREVIEW_MAX_DIMENSION,
  );
  const sheet = {
    columns,
    rows,
    width: sheetWidth,
    height: sheetHeight,
    tileWidth: tileSize,
    tileHeight: tileSize,
    margin: 0,
    spacing: 0,
  };

  const inlineTileset = {
    firstgid: 1,
    columns,
    grid: { height: tileSize, orientation: "orthogonal", width: tileSize },
    image: files.tilesetImage,
    imageheight: sheetHeight,
    imagewidth: sheetWidth,
    margin: 0,
    name: `${stem}-tiles`,
    spacing: 0,
    tilecount: tiles.length,
    tileheight: tileSize,
    tiles: tiles.map((tile) => ({
      id: tile.localId,
      properties: tiledFrameIdProperties(tile.sourceId),
    })),
    tilewidth: tileSize,
    type: "tileset",
    version: TILED_JSON_VERSION,
    tiledversion: TILED_COMPATIBILITY_VERSION,
  };

  const tiled = {
    compressionlevel: -1,
    height,
    infinite: false,
    layers: [{
      data: [...gids],
      height,
      id: 1,
      name: layerName,
      opacity: 1,
      type: "tilelayer",
      visible: true,
      width,
      x: 0,
      y: 0,
    }],
    nextlayerid: 2,
    nextobjectid: 1,
    orientation: "orthogonal",
    properties: [
      { name: "pixelwallSchema", type: "string", value: TILEMAP_EXPORT_SCHEMA },
      { name: "pixelwallVersion", type: "int", value: TILEMAP_EXPORT_VERSION },
      { name: "pixelwallMapping", type: "string", value: files.mapping },
      { name: "pixelwallPreview", type: "string", value: files.previewImage },
    ],
    renderorder: "right-down",
    tiledversion: TILED_COMPATIBILITY_VERSION,
    tileheight: tileSize,
    tilesets: [inlineTileset],
    tilewidth: tileSize,
    type: "map",
    version: TILED_JSON_VERSION,
    width,
  };

  const pixelwall = {
    schema: TILEMAP_EXPORT_SCHEMA,
    version: TILEMAP_EXPORT_VERSION,
    idStrategy: "all-frames-canonical-stable-id",
    emptyGid: 0,
    files: { ...files },
    map: {
      width,
      height,
      tileSize,
      pixelWidth: preview.sourceWidth,
      pixelHeight: preview.sourceHeight,
      layerName,
      cells: options.tilemap.cells.map((cell) => isEmptyCell(cell) ? null : cell),
      gids: [...gids],
    },
    sheet: { ...sheet },
    preview: { ...preview, image: files.previewImage },
    tiles: tiles.map((tile) => ({
      sourceId: tile.sourceId,
      sourceIndex: tile.sourceIndex,
      localId: tile.localId,
      gid: tile.gid,
      rect: { ...tile.rect },
    })),
  };

  return {
    schema: TILEMAP_EXPORT_SCHEMA,
    version: TILEMAP_EXPORT_VERSION,
    files,
    sheet,
    preview,
    tiles,
    gids: [...gids],
    tiled,
    pixelwall,
  };
}
