/** Deterministic animation diagnostics and anchored environmental motion helpers. */
const rgbaEqual = (a, b) => a === b || (a && b && a.length === b.length && a.every((v, i) => v === b[i]));

function image(document, imageId) { return document?.images?.[imageId] ?? null; }
function imagePixels(document, imageId) { return image(document, imageId)?.pixels ?? null; }
function cel(document, frame, layerId) { return frame?.cels?.[layerId] ?? null; }

/** Return actionable warnings; this never scores visual quality or assumes identical loop endpoints. */
export function diagnoseAnimation(document, options = {}) {
  if (!document || !Array.isArray(document.frames) || !Array.isArray(document.layers)) throw new TypeError('A PixelWall document is required.');
  const warnings = [], frames = document.frames, byId = new Map(frames.map(frame => [frame.id, frame]));
  const clip = options.clipId ? document.clips?.find(value => value.id === options.clipId) : null;
  if (options.clipId && !clip) warnings.push({ code: 'clip-reference', severity: 'error', message: `Clip ${options.clipId} was not found.`, clipId: options.clipId });
  const frameIds = clip ? clip.frameIds : (options.frameIds ?? frames.map(frame => frame.id));
  if (clip && !clip.frameIds.every(id => byId.has(id))) warnings.push({ code: 'clip-membership', severity: 'error', message: 'Clip references a missing frame.', clipId: clip.id });
  if (clip && options.frameIds && options.frameIds.some(id => !clip.frameIds.includes(id))) warnings.push({ code: 'clip-membership', severity: 'warning', message: 'Requested frame is outside the selected clip.', clipId: clip.id, frameIds: options.frameIds.filter(id => !clip.frameIds.includes(id)) });
  const anchored = Array.isArray(options.anchoredLayers) ? options.anchoredLayers : [];
  const anchoredRegions = Array.isArray(options.anchoredRegions) ? options.anchoredRegions : [];
  if (anchoredRegions.length > 64 || anchoredRegions.reduce((sum, region) => sum + Math.max(0, Number(region?.width) || 0) * Math.max(0, Number(region?.height) || 0), 0) > 4_000_000) warnings.push({ code: 'region-budget', severity: 'error', message: 'Anchored-region review exceeds the bounded 64-region / 4MP review budget.' });
  for (const id of options.frameIds ?? []) if (!byId.has(id)) warnings.push({ code: 'frame-reference', severity: 'error', frameId: id, message: `Frame ${id} was not found.` });
  const exclusions = new Set(options.exclusions ?? []);
  const excluded = (code, layerId) => exclusions.has(code) || (layerId && exclusions.has(`${code}:${layerId}`));
  const selected = frameIds.map(id => byId.get(id)).filter(Boolean);
  for (const [index, frame] of selected.entries()) {
    for (const layer of document.layers) {
      if (layer.type === 'group') continue;
      const value = cel(document, frame, layer.id);
      if (!value && layer.visible && !excluded('missing-exposure', layer.id)) warnings.push({ code: 'missing-exposure', severity: 'warning', frameId: frame.id, layerId: layer.id, message: `Layer ${layer.name ?? layer.id} has no exposure in frame ${index + 1}.` });
      const source = value && image(document, value.imageId);
      if (value && !source && !excluded('missing-image', layer.id)) warnings.push({ code: 'missing-image', severity: 'error', frameId: frame.id, layerId: layer.id, message: `Layer ${layer.name ?? layer.id} references missing image ${value.imageId}.` });
      if (value && source && (!Array.isArray(source.pixels) || source.pixels.every(pixel => pixel == null)) && !excluded('empty-exposure', layer.id)) warnings.push({ code: 'empty-exposure', severity: 'warning', frameId: frame.id, layerId: layer.id, message: `Layer ${layer.name ?? layer.id} has an empty cel in frame ${index + 1}.` });
    }
    if (!Number.isSafeInteger(frame.durationMs) || frame.durationMs < 1) warnings.push({ code: 'duration', severity: 'error', frameId: frame.id, message: 'Frame duration must be a positive integer.' });
    for (const layer of document.layers) { if (layer.type === 'group') continue; const item = cel(document, frame, layer.id); if (!item) continue; const source = image(document, item.imageId), outside = source && ((item.x ?? 0) < 0 || (item.y ?? 0) < 0 || (item.x ?? 0) + (source.width ?? 0) > document.width || (item.y ?? 0) + (source.height ?? 0) > document.height); if (outside && !excluded('canvas-edge', layer.id) && !excluded('canvas-edge')) warnings.push({ code: 'canvas-edge', severity: 'warning', frameId: frame.id, layerId: layer.id, message: `Layer ${layer.name ?? layer.id} extends beyond the canvas.` }); }
  }
  for (const layerId of anchored) if (!document.layers.some(layer => layer.id === layerId) && !excluded('anchored-drift', layerId)) warnings.push({ code: 'layer-reference', severity: 'error', layerId, message: `Anchored layer ${layerId} was not found.` });
  for (const layerId of anchored) {
    const first = selected[0] && cel(document, selected[0], layerId); if (!first) continue;
    const firstPixels = imagePixels(document, first.imageId);
    for (const frame of selected.slice(1)) { const current = cel(document, frame, layerId); if (!current) continue; const pixels = imagePixels(document, current.imageId); const offsetChanged = (current.x ?? 0) !== (first.x ?? 0) || (current.y ?? 0) !== (first.y ?? 0); const pixelChanged = firstPixels && pixels && !rgbaEqual(firstPixels, pixels); if ((offsetChanged || pixelChanged) && !excluded('anchored-drift', layerId)) warnings.push({ code: 'anchored-drift', severity: 'warning', frameId: frame.id, layerId, message: pixelChanged ? 'Anchored layer pixels changed across frames.' : 'Anchored layer offset changed across frames.' }); }
  }
  for (const region of anchoredRegions) {
    if (!region || !Number.isSafeInteger(region.x) || !Number.isSafeInteger(region.y) || !Number.isSafeInteger(region.width) || !Number.isSafeInteger(region.height) || region.width < 1 || region.height < 1) continue;
    const first = selected[0]; if (!first) continue; let changed = false;
    const firstRendered = options.renderFrame?.(document, first.id), renderedFrames = selected.slice(1).map(frame => options.renderFrame?.(document, frame.id));
    for (const rendered of renderedFrames) { if (!firstRendered || !rendered) continue; for (let y = Math.max(0, region.y); y < Math.min(document.height, region.y + region.height) && !changed; y++) for (let x = Math.max(0, region.x); x < Math.min(document.width, region.x + region.width); x++) { const i = (y * document.width + x) * 4; if (firstRendered[i] !== rendered[i] || firstRendered[i + 1] !== rendered[i + 1] || firstRendered[i + 2] !== rendered[i + 2] || firstRendered[i + 3] !== rendered[i + 3]) { changed = true; break; } } }
    if (changed && !excluded('anchored-region-drift')) warnings.push({ code: 'anchored-region-drift', severity: 'warning', region: { x: region.x, y: region.y, width: region.width, height: region.height }, message: 'Pixels changed inside an anchored region.' });
  }
  const expected = options.expectedFrameCount;
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 1 || selected.length !== expected)) warnings.push({ code: 'frame-count', severity: 'warning', expected: expected, actual: selected.length, message: `Expected ${expected} frames but found ${selected.length}.` });
  return { ok: warnings.every(value => value.severity !== 'error'), frameIds: selected.map(frame => frame.id), warnings, exclusions: [...exclusions] };
}

function shiftedPixels(pixels, width, height, dx, dy, pinnedRegions = []) {
  const result = Array(width * height).fill(null), feather = 2;
  const inside = (x, y, region) => x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height;
  const distance = (x, y, region) => Math.max(region.x - x, x - (region.x + region.width - 1), region.y - y, y - (region.y + region.height - 1), 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pinned = pinnedRegions.some(region => inside(x, y, region));
    const nearest = pinnedRegions.length ? Math.min(...pinnedRegions.map(region => distance(x, y, region))) : Infinity;
    const factor = pinned ? 0 : Math.min(1, nearest / feather);
    const sx = x - Math.round(dx * factor), sy = y - Math.round(dy * factor);
    if (sx >= 0 && sy >= 0 && sx < width && sy < height && !pinnedRegions.some(region => inside(sx, sy, region))) result[y * width + x] = pixels[sy * width + sx];
  }
  // Restore pinned source pixels exactly once; moving pixels never overwrite them.
  for (const region of pinnedRegions) for (let y = Math.max(0, region.y); y < Math.min(height, region.y + region.height); y++) for (let x = Math.max(0, region.x); x < Math.min(width, region.x + region.width); x++) result[y * width + x] = pixels[y * width + x];
  return result;
}

/** Bake periodic per-layer offsets into ordinary editable cels. Pinned layers never move. */
export function bakeAnchoredMotion(document, { frames = document.frames.length, layers = [], pinnedLayers = [], pinnedRegions = {}, amplitudeX = 1, amplitudeY = 0, layerAmplitudes = {}, phaseOffsets = {}, period = frames } = {}) {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > 64 || !Number.isSafeInteger(period) || period < 1 || period > 64 || frames % period !== 0) throw new RangeError('frames and period must be integers from 1 to 64, with period dividing frames.');
  if (![amplitudeX, amplitudeY].every(value => Number.isFinite(value)) || Object.values(layerAmplitudes).some(value => !Number.isFinite(Number(value.x ?? 0)) || !Number.isFinite(Number(value.y ?? 0)))) throw new RangeError('Motion amplitudes must be finite numbers.');
  const validLayers = new Set((document.layers ?? []).map(layer => layer.id));
  for (const id of layers) if (!validLayers.has(id)) throw new RangeError(`Unknown motion layer: ${id}`);
  // Missing pinned IDs are harmless no-ops for compatibility with optional pin lists.
  const requestedPinnedLayers = [...pinnedLayers];
  pinnedLayers = pinnedLayers.filter(id => validLayers.has(id));
  const normalizedRegions = {};
  for (const [layerId, regions] of Object.entries(pinnedRegions ?? {})) {
    if (!validLayers.has(layerId)) throw new RangeError(`Unknown pinned-region layer: ${layerId}`);
    if (!Array.isArray(regions)) throw new TypeError(`Pinned regions for ${layerId} must be an array.`);
    normalizedRegions[layerId] = regions.map(region => { if (!region || ![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) || region.width < 1 || region.height < 1) throw new RangeError('Pinned regions require positive integer bounds.'); return { x: region.x, y: region.y, width: region.width, height: region.height }; });
  }
  const moving = new Set(layers), pinned = new Set(pinnedLayers);
  const originalFrames = document.frames.map(frame => frame.id);
  let bakePixels = 0;
  for (let index = 0; index < frames; index++) { const sourceFrame = document.frames[index % document.frames.length]; for (const layerId of moving) { const cel = sourceFrame?.cels?.[layerId], sourceImage = cel && document.images?.[cel.imageId]; if (sourceImage) bakePixels += sourceImage.width * sourceImage.height; } }
  if (bakePixels > 16_777_216) throw new RangeError('Anchored motion bake exceeds the bounded 16MP generated-pixel budget.');
  const result = structuredClone(document); const source = result.frames[0];
  for (const [layerId, regions] of Object.entries(normalizedRegions)) { const cel = source?.cels?.[layerId], sourceImage = cel && result.images?.[cel.imageId]; if (!sourceImage) continue; for (const region of regions) if (region.x < 0 || region.y < 0 || region.x + region.width > sourceImage.width || region.y + region.height > sourceImage.height) throw new RangeError(`Pinned region for ${layerId} must fit its image bounds.`); }
  for (const [layerId, value] of Object.entries(phaseOffsets ?? {})) if (!Number.isFinite(Number(value))) throw new RangeError(`Motion phase for ${layerId} must be finite.`);
  result.frames = Array.from({ length: frames }, (_, index) => { const frame = structuredClone(result.frames[index % result.frames.length] ?? source); frame.id = result.frames[index]?.id ?? `motion-frame-${index + 1}`; frame.durationMs = source?.durationMs ?? 100; const phase = (index / period) * Math.PI * 2; for (const layerId of moving) { if (pinned.has(layerId)) continue; const current = frame.cels?.[layerId]; if (!current) continue; const image = result.images?.[current.imageId]; if (!image) continue; const settings = layerAmplitudes[layerId] ?? {}; const offset = Number(phaseOffsets[layerId] ?? settings.phase ?? 0); const dx = Math.round(Math.sin(phase + offset) * Number(settings.x ?? amplitudeX)), dy = Math.round(Math.sin(phase + offset) * Number(settings.y ?? amplitudeY)); if (dx || dy || normalizedRegions[layerId]?.length) { let imageId = `${current.imageId}-motion-${index + 1}`, suffix = 1; while (result.images[imageId]) imageId = `${current.imageId}-motion-${index + 1}-${suffix++}`; result.images[imageId] = { ...image, pixels: shiftedPixels(image.pixels, image.width, image.height, dx, dy, normalizedRegions[layerId] ?? []) }; current.imageId = imageId; } } return frame; });
  const frameMap = new Map(originalFrames.map((id, index) => [id, result.frames[index]?.id]).filter(([, id]) => id));
  result.clips = (result.clips ?? []).map(clip => ({ ...clip, frameIds: clip.frameIds.map(id => frameMap.get(id)).filter(Boolean) })).filter(clip => clip.frameIds.length);
  result.metadata = { ...(result.metadata ?? {}), animationBake: { kind: 'anchored-motion', frames, period, movingLayers: [...moving], pinnedLayers: requestedPinnedLayers, pinnedRegions: normalizedRegions, amplitudeX, amplitudeY, layerAmplitudes, phaseOffsets } };
  return result;
}

export function compareAnimationWrap(document, { frameIds = document.frames.map(frame => frame.id), compareCount = 2, renderFrame } = {}) {
  if (typeof renderFrame !== 'function') throw new TypeError('compareAnimationWrap requires a renderFrame function.');
  const ids = frameIds.filter(id => document.frames.some(frame => frame.id === id));
  const count = Math.max(1, Math.min(compareCount, Math.floor(ids.length / 2))); const pairs = [];
  for (let i = 0; i < count; i++) { const fromId = ids[ids.length - count + i], toId = ids[(ids.length - count + i + 1) % ids.length]; const from = renderFrame(document, fromId), to = renderFrame(document, toId); let changed = 0; for (let p = 0; p < from.length; p += 4) if (!rgbaEqual(from.slice(p, p + 4), to.slice(p, p + 4))) changed++; pairs.push({ fromFrameId: fromId, toFrameId: toId, changedPixels: changed, wraps: toId === ids[0] }); }
  return { pairs, compareCount: count, identicalEndpoints: pairs.length === 1 && pairs[0].changedPixels === 0 };
}
