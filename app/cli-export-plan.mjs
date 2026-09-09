/** Pure export planning. The caller supplies a color manager for custom profiles and owns licensing/I/O. */
import { applyOrderedExportScales, exportRegionDocument } from './export-transform.mjs';
import { exportGridCells, exportGridCanvas, parseExportGrid } from './export-grid.mjs';
import { exportFrameTraversal } from './frame-traversal.mjs';
import { normalizeDocument } from './editor-core.mjs';
import { renderExportFrame } from './export-render.mjs';
import { scaleExportDocument, scaleExportRectangle, validateExportScale } from './export-scale.mjs';

const PIXEL_LIMIT = 64 * 1024 * 1024;
const ENTRY_LIMIT = 32768;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
function option(options, ...keys) { for (const key of keys) if (own(options, key)) return options[key]; }
function boolean(value, fallback = false) {
  if (value == null) return fallback;
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  fail(`Expected a boolean option, received ${String(value)}.`);
}
function number(value, fallback, label, min = 0, max = 16384, integer = true) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) fail(`${label} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
  return n;
}
function rectangle(value, label) {
  if (value == null) return null;
  const parts = typeof value === 'string' ? value.split(',').map(Number) : Array.isArray(value) ? value : [value.x, value.y, value.width ?? value.w, value.height ?? value.h];
  if (parts.length !== 4 || !parts.every(Number.isSafeInteger) || parts[2] < 1 || parts[3] < 1 || parts[2] * parts[3] > PIXEL_LIMIT) fail(`${label} requires x,y,width,height with positive dimensions within the export pixel limit.`);
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/** Accepts CLI hyphenated keys and corresponding camelCase keys. Unknown CLI keys are ignored. */
export function normalizeExportOptions(options = {}) {
  const mode = options.mode ?? 'atlas';
  if (!['atlas', 'sequence', 'animation'].includes(mode)) fail('Export mode must be atlas, sequence, or animation.');
  const sheetType = option(options, 'sheet-type', 'sheetType', 'layout') ?? 'packed';
  if (!['packed', 'horizontal', 'vertical', 'rows', 'columns', 'grid'].includes(sheetType)) fail('Unknown sheet layout.');
  const metadataFormat = option(options, 'metadata-format', 'metadataFormat', 'data-format') ?? (['json-array', 'json-hash'].includes(options.format) ? options.format : 'json-hash');
  if (!['json-array', 'json-hash'].includes(metadataFormat)) fail('Metadata format must be json-array or json-hash.');
  const trim = boolean(options.trim), splitGrid = boolean(option(options, 'split-grid', 'splitGrid'));
  const grid = parseExportGrid(options.grid), orderedInputs = boolean(option(options, 'ordered-inputs', 'orderedInputs'));
  if (orderedInputs && options.scale != null) fail('Ordered scale operations must be associated with their input command sequence.');
  if (orderedInputs && options.crop != null && mode === 'atlas') fail('Ordered crop is available for PNG, BMP, TGA and GIF exports only.');
  if (grid && !splitGrid) fail('--grid requires --split-grid.');
  if (splitGrid && mode !== 'atlas') fail('--split-grid is available for sheet, atlas and ZIP exports only.');
  if (splitGrid && (options.crop != null || options.slice != null || boolean(option(options, 'split-slices', 'splitSlices')) || boolean(option(options, 'trim-sprite', 'trimSprite')))) fail('--split-grid cannot be combined with crop, slice, split-slices or trim-sprite selections.');
  return {
    mode, metadataFormat, sheetType, splitGrid, grid, orderedInputs,
    layer: list(option(options, 'layer', 'layers', 'import-layer')).map(String),
    ignoreLayer: list(option(options, 'ignore-layer', 'ignoreLayer')).map(String),
    allLayers: boolean(option(options, 'all-layers', 'allLayers')),
    includeReferences: boolean(option(options, 'include-reference-layers', 'includeReferences')),
    splitLayers: boolean(option(options, 'split-layers', 'splitLayers')),
    tag: option(options, 'clip', 'tag', 'frame-tag'),
    splitTags: boolean(option(options, 'split-tags', 'splitTags')),
    playSubtags: boolean(option(options, 'play-subtags', 'playSubtags')),
    slice: options.slice,
    splitSlices: boolean(option(options, 'split-slices', 'splitSlices')),
    frame: options.frame,
    frameRange: option(options, 'frame-range', 'frameRange'),
    ignoreEmpty: boolean(option(options, 'ignore-empty', 'ignoreEmpty')),
    filenameFormat: option(options, 'filename-format', 'filenameFormat'),
    tagnameFormat: option(options, 'tagname-format', 'tagnameFormat'),
    crop: rectangle(options.crop, 'Crop'),
    trim: mode === 'atlas' && trim && !splitGrid,
    trimSprite: boolean(option(options, 'trim-sprite', 'trimSprite')) || (mode !== 'atlas' && trim),
    scale: validateExportScale(options.scale),
    padding: number(option(options, 'shape-padding', 'shapePadding', 'padding'), 0, 'Shape padding'),
    border: number(option(options, 'border-padding', 'borderPadding', 'border'), 0, 'Border padding'),
    innerPadding: number(option(options, 'inner-padding', 'innerPadding'), 0, 'Inner padding'),
    extrude: options.extrude === true ? 1 : number(options.extrude, 0, 'Extrude'),
    powerOfTwo: boolean(option(options, 'power-of-two', 'power-of-two-size', 'powerOfTwo')),
    maxSize: number(option(options, 'max-size', 'maxSize'), 8192, 'Maximum atlas size', 1),
    columns: number(option(options, 'sheet-columns', 'columns'), undefined, 'Sheet columns', 1, ENTRY_LIMIT),
    rows: number(option(options, 'sheet-rows', 'rows'), undefined, 'Sheet rows', 1, ENTRY_LIMIT),
    width: number(option(options, 'sheet-width', 'width'), undefined, 'Sheet width', 1),
    height: number(option(options, 'sheet-height', 'height'), undefined, 'Sheet height', 1),
    imageName: option(options, 'imageName', 'image-name') ?? 'atlas.png',
  };
}

function fileParts(filename) {
  const fullname = String(filename).replaceAll('\\', '/'), at = fullname.lastIndexOf('/');
  const name = fullname.slice(at + 1), dot = name.lastIndexOf('.');
  return { fullname, path: at < 0 ? '' : fullname.slice(0, at), name, title: dot <= 0 ? name : name.slice(0, dot), extension: dot <= 0 ? '' : name.slice(dot + 1) };
}

/** Numeric suffixes specify both offset and width: frame001 starts at one, padded to three digits. */
export function formatExportFilename(template, context) {
  if (typeof template !== 'string' || !template.length || template.length > 4096) fail('Filename format must be a nonempty string of at most 4096 characters.');
  return template.replace(/\{([^{}]+)\}/g, (token, key) => {
    const match = /^(tagframe|frame|cell|column|row)(\d*)$/.exec(key);
    if (match) {
      if (['cell', 'column', 'row'].includes(match[1]) && !own(context, match[1])) fail(`Unknown filename placeholder ${token}. Grid placeholders require --split-grid.`);
      const base = Number(context[match[1]] ?? 0), suffix = match[2];
      const offset = suffix ? Number(suffix) : 0;
      if (!Number.isSafeInteger(offset)) fail('Frame placeholder offset is too large.');
      return String(base + offset).padStart(suffix.length, '0');
    }
    if (!own(context, key)) fail(`Unknown filename placeholder ${token}.`);
    return String(context[key] ?? '');
  });
}

function layerContext(document) {
  const byId = new Map(document.layers.map(layer => [layer.id, layer]));
  const path = layer => layer.parentId ? `${path(byId.get(layer.parentId))}/${layer.name}` : layer.name;
  const paths = new Map(document.layers.map(layer => [layer.id, path(layer)]));
  const ancestors = layer => { const result = []; while (layer?.parentId) { layer = byId.get(layer.parentId); result.push(layer); } return result; };
  const descendants = root => document.layers.filter(layer => layer.id === root.id || ancestors(layer).some(parent => parent.id === root.id));
  const resolve = value => {
    // Native CLI resolves the first matching name; full hierarchy paths or IDs disambiguate duplicates.
    const layer = byId.get(value) ?? document.layers.find(layer => paths.get(layer.id) === value) ?? document.layers.find(layer => layer.name === value);
    if (!layer) fail(`Unknown layer: ${value}.`);
    return layer;
  };
  return { paths, ancestors, descendants, resolve };
}

/** Visibility-only document scopes retain all source frames, preserving inherited frame palettes and slice timing. */
function layerJobs(document, options) {
  const context = layerContext(document), included = options.layer.map(context.resolve), excluded = new Set(options.ignoreLayer.flatMap(value => context.descendants(context.resolve(value)).map(layer => layer.id)));
  const chosen = included.length ? new Set(included.flatMap(layer => context.descendants(layer).map(child => child.id))) : null;
  const explicitAncestors = new Set(included.flatMap(layer => [layer, ...context.ancestors(layer)]).map(layer => layer.id));
  const visible = layer => !excluded.has(layer.id) && (options.allLayers || explicitAncestors.has(layer.id) || (layer.visible && context.ancestors(layer).every(parent => parent.visible || explicitAncestors.has(parent.id))));
  const leaves = document.layers.filter(layer => layer.type !== 'group' && (layer.type !== 'reference' || options.includeReferences) && (!chosen || chosen.has(layer.id)) && visible(layer));
  const selections = options.splitLayers ? leaves.map(layer => ({ layer, leaves: [layer] })) : [{ layer: included.length === 1 ? included[0] : null, leaves }];
  return selections.map(({ layer, leaves }) => {
    const ids = new Set(leaves.flatMap(item => [item, ...context.ancestors(item)]).map(item => item.id));
    return { layer, layerPath: layer ? context.paths.get(layer.id) : '', document: { ...document, layers: document.layers.map(item => ({ ...item, visible: ids.has(item.id) })) }, layerIds: leaves.map(item => item.id) };
  });
}

function frameIndices(document, options, tag) {
  let indices = document.frames.map((_, index) => index);
  if (tag) indices = indices.filter(index => tag.frameIds.includes(document.frames[index].id));
  if (options.frameRange != null) {
    const range = typeof options.frameRange === 'string' ? options.frameRange.split(',').map(Number) : options.frameRange;
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < 0 || range[1] < range[0] || range[1] >= document.frames.length) fail('Frame range must be inclusive zero-based from,to indices inside the document.');
    indices = indices.filter(index => index >= range[0] && index <= range[1]);
  }
  if (options.frame != null) {
    const byId = document.frames.findIndex(frame => frame.id === String(options.frame));
    const index = byId >= 0 ? byId : Number(options.frame);
    if (!Number.isInteger(index) || index < 0 || index >= document.frames.length) fail(`Unknown frame: ${options.frame}.`);
    indices = indices.filter(value => value === index);
  }
  if (options.mode !== 'atlas' && options.frameRange == null && options.frame == null) {
    indices = exportFrameTraversal(document, { clip: tag, playSubtags: options.playSubtags, legacyDirection: options.mode === 'animation', maxFrames: ENTRY_LIMIT });
  }
  return indices;
}

/** Slice keys persist until their next key; a zero-size key hides the slice until it reappears. */
export function sliceBoundsAt(document, slice, frameIndex) {
  if (slice.bounds) return { ...slice.bounds, ...(slice.pivot ? { pivot: copy(slice.pivot) } : {}) };
  let current = null, at = -1;
  for (const key of slice.keys ?? []) {
    const index = key.frameId ? document.frames.findIndex(frame => frame.id === key.frameId) : key.frame ?? 0;
    if (index >= 0 && index <= frameIndex && index >= at) { current = key; at = index; }
  }
  return current && current.width > 0 && current.height > 0 ? copy(current) : null;
}

function cropPixels(entry, rect) {
  if (rect.width * rect.height > PIXEL_LIMIT) fail('Cropped output exceeds the pixel limit.');
  const rgba = new Uint8Array(rect.width * rect.height * 4);
  const left = Math.max(0, rect.x), right = Math.min(entry.width, rect.x + rect.width);
  if (right > left) for (let y = Math.max(0, rect.y); y < Math.min(entry.height, rect.y + rect.height); y++) {
    rgba.set(entry.rgba.subarray((y * entry.width + left) * 4, (y * entry.width + right) * 4), ((y - rect.y) * rect.width + left - rect.x) * 4);
  }
  return { ...entry, width: rect.width, height: rect.height, rgba };
}
function scalePixels(entry, scale) {
  if (scale === 1) return entry;
  const width = Math.max(1, Math.floor(entry.width * scale)), height = Math.max(1, Math.floor(entry.height * scale));
  if (width * height > PIXEL_LIMIT) fail('Scaled output exceeds the pixel limit.');
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.floor(y * entry.height / height) * entry.width + Math.floor(x * entry.width / width)) * 4;
    rgba.set(entry.rgba.subarray(source, source + 4), (y * width + x) * 4);
  }
  return { ...entry, width, height, rgba };
}
function opaqueBounds(entry) {
  let left = entry.width, top = entry.height, right = -1, bottom = -1;
  for (let y = 0; y < entry.height; y++) for (let x = 0; x < entry.width; x++) if (entry.rgba[(y * entry.width + x) * 4 + 3]) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
function unionBounds(bounds) {
  const nonempty = bounds.filter(Boolean);
  if (!nonempty.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...nonempty.map(value => value.x)), y = Math.min(...nonempty.map(value => value.y));
  return { x, y, width: Math.max(...nonempty.map(value => value.x + value.width)) - x, height: Math.max(...nonempty.map(value => value.y + value.height)) - y };
}

function resolveNamed(values, name, kind) {
  const result = values.find(value => value.id === name || value.name === name);
  if (!result) fail(`Unknown ${kind}: ${String(name)}.`);
  return result;
}
function filenameContext(document, filename, entry, job, ordinal) {
  const tags = document.clips.filter(tag => tag.frameIds.includes(entry.sourceFrameId)).sort((a, b) => a.frameIds.length - b.frameIds.length);
  const tag = job.tag ?? tags[0];
  const selectedIndices = tag?.frameIds.map(id => document.frames.findIndex(frame => frame.id === id)).sort((a, b) => a - b);
  return { ...fileParts(filename), layer: job.layer?.name ?? '', layerpath: job.layerPath, tag: tag?.name ?? '', innertag: tags[0]?.name ?? '', outertag: tags.at(-1)?.name ?? '', slice: job.slice?.name ?? '', frame: ordinal, sourceframe: entry.frameIndex, tagframe: tag ? selectedIndices.indexOf(entry.frameIndex) : entry.frameIndex, duration: entry.durationMs, ...(entry.grid ? { cell: entry.grid.index, column: entry.grid.column, row: entry.grid.row } : {}) };
}

/**
 * Build one ordered atlas entry list and separate output jobs from one or more inputs.
 * Input options override global options. File names are labels only; this function performs no I/O.
 * Atlas frames stay in timeline order. Animation/sequence traversal requires playSubtags; discontiguous animation clips retain legacy direction.
 * Trimming and inner padding are already baked; pass atlasOptions.trim=false to the packer.
 */
export function planExport(inputs, globalOptions = {}, rendering = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1024) fail('Export requires 1–1024 document inputs.');
  const options = normalizeExportOptions(globalOptions), entries = [], jobs = [], sources = [], usedNames = new Set();
  let totalPixels = 0, packedPixels = 0;
  const transformBudget = { workPixels: 0, steps: 0 };
  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
    const input = inputs[inputIndex], sourceDocument = normalizeDocument(input.document), settings = normalizeExportOptions({ ...globalOptions, ...input.options });
    if (input.transforms?.length && !settings.orderedInputs) fail('Input scale operations require --ordered-inputs.');
    const prepared = applyOrderedExportScales(sourceDocument, input.transforms, transformBudget);
    const fractional = !Number.isInteger(settings.scale), document = scaleExportDocument(prepared.document, fractional || settings.splitGrid ? settings.scale : 1);
    const gridCells = settings.splitGrid ? exportGridCells(document.width, document.height, settings.grid ?? sourceDocument.metadata?.aseprite?.grid) : [null];
    const sx = document.width / sourceDocument.width, sy = document.height / sourceDocument.height;
    // Shared atlas geometry and JSON representation belong to the output, not individual source files.
    for (const key of ['padding', 'border', 'extrude', 'powerOfTwo', 'maxSize', 'columns', 'rows', 'width', 'height', 'sheetType', 'metadataFormat']) if (settings[key] !== options[key]) fail(`${key} must be specified globally for a multi-input atlas.`);
    const filename = String(input.filename ?? `${document.name}.pixelwall`);
    sources.push({ inputIndex, filename, document: sourceDocument, transforms: prepared.transforms });
    const tags = settings.tag != null ? [resolveNamed(document.clips, settings.tag, 'tag')] : settings.splitTags && document.clips.length ? document.clips : [null];
    const slices = settings.slice != null ? [resolveNamed(document.slices, settings.slice, 'slice')] : settings.splitSlices && document.slices.length ? document.slices : [null];
    for (const layerJob of layerJobs(document, settings)) for (const tag of tags) for (const slice of slices) {
      const job = { id: `input-${inputIndex}/job-${jobs.length}`, inputIndex, filename, document: layerJob.document, layer: layerJob.layer, layerPath: layerJob.layerPath, layerIds: layerJob.layerIds, tag, slice, options: settings, entries: [] };
      const indices = frameIndices(document, settings, tag);
      if (settings.splitGrid && (entries.length + indices.length * gridCells.length > ENTRY_LIMIT || totalPixels + indices.length * gridCells.length * (gridCells[0]?.bounds.width ?? 0) * (gridCells[0]?.bounds.height ?? 0) > PIXEL_LIMIT)) fail('Grid export exceeds the total pixel or frame limit; export smaller batches.');
      for (const [ordinal, frameIndex] of indices.entries()) {
        const frame = document.frames[frameIndex], sliceBounds = slice ? sliceBoundsAt(document, slice, frameIndex) : null;
        if ((slice && !sliceBounds) || !gridCells.length) continue;
        const gridCanvas = settings.splitGrid ? exportGridCanvas(layerJob.document, frame.id, gridCells) : null;
        const orderedCrop = settings.orderedInputs && settings.crop ? sliceBounds ?? settings.crop : null;
        const rasterDocument = gridCanvas?.document ?? (orderedCrop ? exportRegionDocument(layerJob.document, frame.id, orderedCrop) : layerJob.document);
        const rgba = renderExportFrame(rasterDocument, frame.id, rendering);
        for (const grid of gridCells) {
          let entry = { id: `${job.id}/frame-${ordinal}${grid ? `/cell-${grid.index}` : ''}`, inputIndex, jobId: job.id, sourceFrameId: frame.id, frameIndex, layerId: layerJob.layer?.id ?? null, tagId: tag?.id ?? null, sliceId: slice?.id ?? null, width: rasterDocument.width, height: rasterDocument.height, rgba, durationMs: frame.durationMs, ...(grid ? { grid } : {}) };
          const sourceSlice = slice ? sourceDocument.slices.find(value => value.id === slice.id) : null;
          const sourceRect = prepared.transforms.length && settings.crop ? { x: 0, y: 0, width: sourceDocument.width, height: sourceDocument.height } : grid && settings.scale === 1 && !prepared.transforms.length ? grid.bounds : (sourceSlice ? sliceBoundsAt(sourceDocument, sourceSlice, frameIndex) : null) ?? settings.crop ?? { x: 0, y: 0, width: sourceDocument.width, height: sourceDocument.height };
          const rect = grid?.bounds ?? sliceBounds ?? (fractional && settings.crop ? scaleExportRectangle(settings.crop, sx, sy) : settings.crop) ?? { x: 0, y: 0, width: document.width, height: document.height };
          if (rect.width < 1 || rect.height < 1) continue;
          const rasterRect = grid ? { ...rect, x: rect.x - gridCanvas.x, y: rect.y - gridCanvas.y } : orderedCrop ? { ...rect, x: 0, y: 0 } : rect;
          entry = scalePixels(cropPixels(entry, rasterRect), fractional || grid ? 1 : settings.scale);
          entry.crop = { x: sourceRect.x, y: sourceRect.y, width: sourceRect.width, height: sourceRect.height };
          if (fractional || grid || prepared.transforms.length || orderedCrop) entry.scaledCrop = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          entry.scale = settings.scale;
          entry.empty = !opaqueBounds(entry);
          if (settings.ignoreEmpty && entry.empty) continue;
          if (sliceBounds?.pivot) entry.pivot = { x: sliceBounds.pivot.x / rect.width, y: sliceBounds.pivot.y / rect.height };
          entry.filenameContext = filenameContext(document, filename, entry, job, ordinal);
          const defaultName = `${fileParts(filename).title}${layerJob.layer ? ` (${layerJob.layerPath})` : ''}${tag && settings.splitTags ? ` (${tag.name})` : ''}${slice ? ` (${slice.name})` : ''}${indices.length > 1 ? ` ${ordinal}` : ''}${grid ? ` (cell ${grid.index})` : ''}.${fileParts(filename).extension || 'pixelwall'}`;
          entry.name = settings.filenameFormat ? formatExportFilename(settings.filenameFormat, entry.filenameContext) : defaultName;
          if (usedNames.has(entry.name)) fail(`Duplicate export filename "${entry.name}". Use distinct input names or include {layerpath}, {tag}, {slice}, {frame}, and {cell} for grid exports in --filename-format.`);
          usedNames.add(entry.name);
          totalPixels += entry.width * entry.height;
          if (totalPixels > PIXEL_LIMIT || entries.length + job.entries.length >= ENTRY_LIMIT) fail('Export exceeds the total pixel or frame limit; export smaller batches.');
          job.entries.push(entry);
        }
      }
      if (settings.trimSprite && job.entries.length) {
        const bounds = unionBounds(job.entries.map(opaqueBounds));
        job.entries = job.entries.map(entry => ({ ...cropPixels(entry, bounds), spriteCrop: bounds }));
      }
      // Animated files need a single canvas; moving slices can have different key dimensions.
      if (settings.mode === 'animation' && job.entries.length) {
        const width = Math.max(...job.entries.map(entry => entry.width)), height = Math.max(...job.entries.map(entry => entry.height));
        job.entries = job.entries.map(entry => cropPixels(entry, { x: 0, y: 0, width, height }));
      }
      job.entries = job.entries.map(entry => {
        const sourceSize = { w: entry.width, h: entry.height }, bounds = settings.trim ? opaqueBounds(entry) ?? { x: 0, y: 0, width: 1, height: 1 } : { x: 0, y: 0, width: entry.width, height: entry.height };
        let raster = cropPixels(entry, bounds);
        if (settings.innerPadding) raster = cropPixels(raster, { x: -settings.innerPadding, y: -settings.innerPadding, width: raster.width + settings.innerPadding * 2, height: raster.height + settings.innerPadding * 2 });
        return { ...raster, sourceSize, spriteSourceSize: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }, trimmed: bounds.x !== 0 || bounds.y !== 0 || bounds.width !== sourceSize.w || bounds.height !== sourceSize.h, innerPadding: settings.innerPadding };
      });
      const addedPixels = job.entries.reduce((sum, entry) => sum + entry.width * entry.height, 0);
      packedPixels += addedPixels;
      if (packedPixels > PIXEL_LIMIT) fail('Padded export exceeds the total pixel limit.');
      job.frameIds = job.entries.map(entry => entry.sourceFrameId);
      job.entryIds = job.entries.map(entry => entry.id);
      entries.push(...job.entries); jobs.push(job);
    }
  }
  const layout = ['rows', 'columns'].includes(options.sheetType) ? 'grid' : options.sheetType;
  const columns = options.sheetType === 'columns' && options.rows ? Math.ceil(entries.length / options.rows) : options.columns;
  const atlasOptions = { trim: false, padding: options.padding, border: options.border, extrude: options.extrude, powerOfTwo: options.powerOfTwo, maxSize: options.maxSize, layout, ...(columns ? { columns } : {}), ...(options.width ? { width: options.width } : {}), ...(options.height ? { height: options.height } : {}), scale: options.scale, imageName: options.imageName };
  return { entries, jobs, sources, options, atlasOptions, metadataFormat: options.metadataFormat };
}

/** Rebuild metadata after packing so cropping, padding, source IDs and per-input tags remain unambiguous. */
export function buildExportMetadata(result, plan, format = plan.metadataFormat) {
  if (!['json-array', 'json-hash'].includes(format)) fail('Metadata format must be json-array or json-hash.');
  if (!Array.isArray(result.frames) || result.frames.length !== plan.entries.length) fail('Packed metadata frame count does not match the export plan.');
  const byId = new Map(result.frames.filter(frame => frame.id).map(frame => [frame.id, frame]));
  const frames = plan.entries.map((entry, index) => {
    const packed = byId.get(entry.id) ?? result.frames[index];
    if (packed.filename !== entry.name) fail('Packed metadata frame order or filenames do not match the export plan.');
    return { ...packed, filename: entry.name, id: entry.id, duration: entry.durationMs, sourceSize: copy(entry.sourceSize), spriteSourceSize: copy(entry.spriteSourceSize), trimmed: entry.trimmed, empty: entry.empty, source: { inputIndex: entry.inputIndex, filename: plan.sources[entry.inputIndex].filename, frameId: entry.sourceFrameId, frame: entry.frameIndex, layerId: entry.layerId, tagId: entry.tagId, sliceId: entry.sliceId, crop: copy(entry.crop), scale: entry.scale, ...(entry.grid ? { grid: copy(entry.grid) } : {}), ...(entry.scaledCrop ? { scaledCrop: copy(entry.scaledCrop) } : {}), ...(entry.spriteCrop ? { spriteCrop: copy(entry.spriteCrop) } : {}) }, ...(entry.innerPadding ? { innerPadding: entry.innerPadding } : {}) };
  });
  const frameTags = [];
  for (const job of plan.jobs) for (const tag of job.tag ? [job.tag] : plan.sources[job.inputIndex].document.clips) {
    const indices = plan.entries.flatMap((entry, index) => entry.jobId === job.id && tag.frameIds.includes(entry.sourceFrameId) ? [index] : []);
    if (!indices.length) continue;
    const context = { ...fileParts(job.filename), tag: tag.name, layer: job.layer?.name ?? '', layerpath: job.layerPath, slice: job.slice?.name ?? '' };
    frameTags.push({ name: job.options.tagnameFormat ? formatExportFilename(job.options.tagnameFormat, context) : tag.name, from: indices[0], to: indices.at(-1), direction: tag.direction, repeat: String(tag.repeat ?? 0), inputIndex: job.inputIndex, jobId: job.id, sourceTagId: tag.id, frameIndices: indices, partial: tag.frameIds.some(id => !job.frameIds.includes(id)) });
  }
  const layers = plan.jobs.flatMap(job => job.document.layers.filter(layer => layer.visible).map(layer => ({ inputIndex: job.inputIndex, jobId: job.id, id: layer.id, name: layer.name, parentId: layer.parentId, opacity: Math.round(layer.opacity * 255), blendMode: layer.blendMode, type: layer.type })));
  const slices = plan.jobs.flatMap(job => (job.slice ? [job.slice] : job.document.slices).map(slice => ({
    name: slice.name, id: slice.id, inputIndex: job.inputIndex, jobId: job.id,
    keys: plan.entries.flatMap((entry, index) => {
      if (entry.jobId !== job.id) return [];
      const key = sliceBoundsAt(job.document, slice, entry.frameIndex);
      if (!key) return [{ frame: index, bounds: { x: 0, y: 0, w: 0, h: 0 } }];
      const scale = entry.scaledCrop ? 1 : entry.scale, crop = entry.scaledCrop ?? entry.crop;
      return [{ frame: index, bounds: { x: (key.x - crop.x) * scale - (entry.spriteCrop?.x ?? 0), y: (key.y - crop.y) * scale - (entry.spriteCrop?.y ?? 0), w: key.width * scale, h: key.height * scale }, ...(key.pivot ? { pivot: { x: key.pivot.x * scale, y: key.pivot.y * scale } } : {}), ...(key.center ? { center: { x: key.center.x * scale, y: key.center.y * scale, w: (key.center.width ?? key.center.w) * scale, h: (key.center.height ?? key.center.h) * scale } } : {}) }];
    }),
  })));
  const sourceSlices = plan.sources.flatMap(source => source.document.slices.map(slice => ({ ...copy(slice), inputIndex: source.inputIndex })));
  const meta = { ...result.meta, frameTags, layers, slices, sourceSlices, sources: plan.sources.map(source => ({ inputIndex: source.inputIndex, filename: source.filename, documentId: source.document.id, ...(source.transforms.length ? { transforms: copy(source.transforms) } : {}) })) };
  return { frames: format === 'json-array' ? frames : Object.fromEntries(frames.map(frame => { const { filename, ...value } = frame; return [filename, value]; })), meta };
}
