/** Ordered export transformations. Originals are retained separately by the planner. */
import { scaleExportDocument, validateExportScale, EXPORT_PIXEL_LIMIT } from './export-scale.mjs';
export const MAX_ORDERED_SCALES = 32;
const WORK_PIXEL_LIMIT = 256 * 1024 * 1024;
const TOTAL_STEP_LIMIT = 1024;
const fail = message => { throw Error(message); };

function retainedImages(document) {
  const ids = new Set(document.frames.flatMap(frame => Object.values(frame.cels).map(cel => cel.imageId)));
  for (const tileset of document.tilesets) { if (tileset.imageId) ids.add(tileset.imageId); for (const tile of tileset.tiles ?? []) ids.add(tile.imageId); }
  return Object.fromEntries([...ids].filter(id => document.images[id]).map(id => [id, document.images[id]]));
}

/** Apply each resize separately; multiplying factors would lose intermediate
 * dimension rounding and pixel sampling. Share one work budget across inputs. */
export function applyOrderedExportScales(source, transforms = [], budget = { workPixels: 0, steps: 0 }) {
  if (!Array.isArray(transforms) || transforms.length > MAX_ORDERED_SCALES) fail(`Ordered exports allow at most ${MAX_ORDERED_SCALES} scale operations per input.`);
  const factors = transforms.map(transform => {
    if (!transform || typeof transform !== 'object' || Object.keys(transform).some(key => !['type', 'factor'].includes(key)) || transform.type !== 'scale') fail('Unsupported ordered export transformation.');
    return validateExportScale(transform.factor);
  });
  if (factors.filter(factor => factor !== 1).length > 1 && source.layers.some(layer => layer.type === 'tilemap')) fail('Tilemap inputs support one effective ordered scale. Multiple tilemap resizes require separate editable resize steps.');
  let document = source;
  const history = [];
  for (const factor of factors) {
    if (++budget.steps > TOTAL_STEP_LIMIT) fail('Ordered export exceeds the total scale-operation limit.');
    const before = { width: document.width, height: document.height };
    const width = Math.max(1, Math.trunc(document.width * factor)), height = Math.max(1, Math.trunc(document.height * factor));
    const sx = width / document.width, sy = height / document.height;
    let estimatedPixels = width * height;
    const seen = new Set();
    for (const frame of document.frames) for (const [layerId, cel] of Object.entries(frame.cels)) {
      if (seen.has(cel.imageId) || document.layers.find(layer => layer.id === layerId)?.type === 'reference') continue;
      seen.add(cel.imageId); const image = document.images[cel.imageId];
      if (!image.tilemap) estimatedPixels += Math.max(1, Math.trunc(image.width * sx)) * Math.max(1, Math.trunc(image.height * sy));
    }
    if (!Number.isSafeInteger(estimatedPixels) || width * height > EXPORT_PIXEL_LIMIT || budget.workPixels + estimatedPixels > WORK_PIXEL_LIMIT) fail('Ordered scaling exceeds the pixel or cumulative work limit.');
    budget.workPixels += estimatedPixels;
    if (factor !== 1) {
      document = scaleExportDocument(document, factor);
      // Earlier resized images are no longer needed in this temporary view.
      document = { ...document, images: retainedImages(document) };
    }
    history.push({ type: 'scale', factor, before, after: { width: document.width, height: document.height } });
  }
  return { document, transforms: history };
}

/** Render a crop/window without clipping off-canvas cel pixels first. The result
 * is temporary: profiles, palettes, pixel arrays and source geometry are retained. */
export function exportRegionDocument(document, frameId, rectangle) {
  const { x, y, width, height } = rectangle;
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width * height > EXPORT_PIXEL_LIMIT) fail('Export region exceeds the pixel limit.');
  const frames = document.frames.map(frame => frame.id !== frameId ? frame : {
    ...frame, cels: Object.fromEntries(Object.entries(frame.cels).map(([id, cel]) => [id, {
      ...cel, x: cel.x - x, y: cel.y - y,
      ...(cel.preciseBounds ? { preciseBounds: { ...cel.preciseBounds, x: cel.preciseBounds.x - x, y: cel.preciseBounds.y - y } } : {}),
    }])),
  });
  const layers = document.layers.map(layer => layer.tilemaps?.[frameId] ? {
    ...layer, tilemaps: { ...layer.tilemaps, [frameId]: { ...layer.tilemaps[frameId], x: (layer.tilemaps[frameId].x ?? 0) - x, y: (layer.tilemaps[frameId].y ?? 0) - y } },
  } : layer);
  return { ...document, width, height, frames, layers };
}
