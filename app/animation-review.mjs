/** Deterministic animation diagnostics and anchored environmental motion helpers. */
const rgbaEqual = (a, b) => a === b || (a && b && a.length === b.length && a.every((v, i) => v === b[i]));

function imagePixels(document, imageId) { return document?.images?.[imageId]?.pixels ?? null; }
function cel(document, frame, layerId) { return frame?.cels?.[layerId] ?? null; }

/** Return actionable warnings; this never scores visual quality or assumes identical loop endpoints. */
export function diagnoseAnimation(document, options = {}) {
  if (!document || !Array.isArray(document.frames) || !Array.isArray(document.layers)) throw new TypeError('A PixelWall document is required.');
  const warnings = [], frames = document.frames, byId = new Map(frames.map(frame => [frame.id, frame]));
  const clip = options.clipId ? document.clips?.find(value => value.id === options.clipId) : null;
  const frameIds = clip ? clip.frameIds : (options.frameIds ?? frames.map(frame => frame.id));
  if (clip && !clip.frameIds.every(id => byId.has(id))) warnings.push({ code: 'clip-membership', severity: 'error', message: 'Clip references a missing frame.', clipId: clip.id });
  const anchored = Array.isArray(options.anchoredLayers) ? options.anchoredLayers : [];
  const exclusions = new Set(options.exclusions ?? []);
  const selected = frameIds.map(id => byId.get(id)).filter(Boolean);
  for (const [index, frame] of selected.entries()) {
    for (const layer of document.layers) {
      const value = cel(document, frame, layer.id);
      if (!value && layer.visible && !exclusions.has(`missing-exposure:${layer.id}`)) warnings.push({ code: 'missing-exposure', severity: 'warning', frameId: frame.id, layerId: layer.id, message: `Layer ${layer.name ?? layer.id} has no exposure in frame ${index + 1}.` });
      if (value && !imagePixels(document, value.imageId) && !exclusions.has(`missing-image:${layer.id}`)) warnings.push({ code: 'missing-image', severity: 'error', frameId: frame.id, layerId: layer.id, message: `Layer ${layer.name ?? layer.id} references missing image ${value.imageId}.` });
    }
    if (!Number.isSafeInteger(frame.durationMs) || frame.durationMs < 1) warnings.push({ code: 'duration', severity: 'error', frameId: frame.id, message: 'Frame duration must be a positive integer.' });
    for (const edge of ['x', 'y']) if (selected.length && selected.some(value => value.cels && Object.values(value.cels).some(item => item && (item[edge] ?? 0) < 0))) warnings.push({ code: 'canvas-edge', severity: 'warning', frameId: frame.id, message: 'A cel is offset outside the canvas.' });
  }
  for (const layerId of anchored) {
    const first = selected[0] && cel(document, selected[0], layerId); if (!first) continue;
    for (const frame of selected.slice(1)) { const current = cel(document, frame, layerId); if (!current) continue; if ((current.x ?? 0) !== (first.x ?? 0) || (current.y ?? 0) !== (first.y ?? 0)) warnings.push({ code: 'anchored-drift', severity: 'warning', frameId: frame.id, layerId, message: 'Anchored layer offset changed across frames.' }); }
  }
  const expected = options.expectedFrameCount;
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 1 || selected.length !== expected)) warnings.push({ code: 'frame-count', severity: 'warning', expected: expected, actual: selected.length, message: `Expected ${expected} frames but found ${selected.length}.` });
  return { ok: warnings.every(value => value.severity !== 'error'), frameIds: selected.map(frame => frame.id), warnings, exclusions: [...exclusions] };
}

function shiftedPixels(pixels, width, height, dx, dy) {
  const result = Array(width * height).fill(null);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const sx = x - dx, sy = y - dy; if (sx >= 0 && sy >= 0 && sx < width && sy < height) result[y * width + x] = pixels[sy * width + sx]; }
  return result;
}

/** Bake periodic per-layer offsets into ordinary editable cels. Pinned layers never move. */
export function bakeAnchoredMotion(document, { frames = document.frames.length, layers = [], pinnedLayers = [], amplitudeX = 1, amplitudeY = 0, phaseOffsets = {}, period = frames } = {}) {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > 64 || !Number.isSafeInteger(period) || period < 1 || period > 64) throw new RangeError('frames and period must be integers from 1 to 64.');
  const moving = new Set(layers), pinned = new Set(pinnedLayers); const result = structuredClone(document); const source = result.frames[0];
  result.frames = Array.from({ length: frames }, (_, index) => { const frame = structuredClone(result.frames[index % result.frames.length] ?? source); frame.id = result.frames[index]?.id ?? `motion-frame-${index + 1}`; frame.durationMs = source?.durationMs ?? 100; const phase = (index / period) * Math.PI * 2; for (const layerId of moving) { if (pinned.has(layerId)) continue; const current = frame.cels?.[layerId]; if (!current) continue; const image = result.images?.[current.imageId]; if (!image) continue; const offset = Number(phaseOffsets[layerId] ?? 0); const dx = Math.round(Math.sin(phase + offset) * amplitudeX), dy = Math.round(Math.sin(phase + offset) * amplitudeY); if (dx || dy) { const imageId = `${current.imageId}-motion-${index + 1}`; result.images[imageId] = { ...image, pixels: shiftedPixels(image.pixels, image.width, image.height, dx, dy) }; current.imageId = imageId; } } return frame; });
  result.metadata = { ...(result.metadata ?? {}), animationBake: { kind: 'anchored-motion', frames, period, movingLayers: [...moving], pinnedLayers: [...pinned], amplitudeX, amplitudeY, phaseOffsets } };
  return result;
}

export function compareAnimationWrap(document, { frameIds = document.frames.map(frame => frame.id), compareCount = 2, renderFrame } = {}) {
  if (typeof renderFrame !== 'function') throw new TypeError('compareAnimationWrap requires a renderFrame function.');
  const ids = frameIds.filter(id => document.frames.some(frame => frame.id === id));
  const count = Math.max(1, Math.min(compareCount, Math.floor(ids.length / 2))); const pairs = [];
  for (let i = 0; i < count; i++) { const from = renderFrame(document, ids[ids.length - count + i]); const to = renderFrame(document, ids[i]); let changed = 0; for (let p = 0; p < from.length; p += 4) if (!rgbaEqual(from.slice(p, p + 4), to.slice(p, p + 4))) changed++; pairs.push({ fromFrameId: ids[ids.length - count + i], toFrameId: ids[i], changedPixels: changed }); }
  return { pairs, compareCount: count, identicalEndpoints: pairs.length === 1 && pairs[0].changedPixels === 0 };
}
