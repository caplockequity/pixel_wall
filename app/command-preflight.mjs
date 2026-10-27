import { applyCommand, describeDocument } from './editor-core.mjs';

export const COMMAND_BATCH_LIMIT = 2000;
export const COMMAND_BATCH_BYTES = 16 * 1024 * 1024;

export function captureCommands(commands) {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > COMMAND_BATCH_LIMIT)
    throw Error(`Provide between 1 and ${COMMAND_BATCH_LIMIT} commands.`);
  let text;
  try { text = JSON.stringify(commands); } catch { throw Error('Commands must be serializable JSON values.'); }
  if (new TextEncoder().encode(text).byteLength > COMMAND_BATCH_BYTES) throw Error('Command batch exceeds 16 MB.');
  const copied = JSON.parse(text);
  // Nested batches use the same limit as ordinary batches. A bounded depth also
  // prevents recursive inputs from bypassing the work/cancellation boundaries.
  let count = 0;
  function visit(list, depth) {
    if (depth > 8) throw Error('Nested command batches may be at most 8 levels deep.');
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.type !== 'string') throw Error('Command type is missing.');
      if (++count > COMMAND_BATCH_LIMIT) throw Error(`Nested batches may contain at most ${COMMAND_BATCH_LIMIT} commands in total.`);
      if (item.type === 'batch') {
        if (!Array.isArray(item.commands) || item.commands.length > 1024) throw Error('Invalid command batch.');
        visit(item.commands, depth + 1);
      }
    }
  }
  visit(copied, 0);
  return { commands: copied, bytes: new TextEncoder().encode(text).byteLength, expandedCommands: count };
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) {
    const error = Error('Command edit cancelled. No partial edits were committed.');
    error.name = 'AbortError';
    throw error;
  }
}

/** Runs the real engine against immutable scratch documents; never commits. */
export async function preflightCommands(document, commands, { frameId, layerId, timeoutMs = 5000, signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), now = () => performance.now() } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) throw Error('Validation timeout must be between 50 and 10000 ms.');
  const captured = captureCommands(commands), started = now();
  let next = document, processed = 0;
  try {
    for (const command of captured.commands) {
      throwIfCancelled(signal);
      if (now() - started >= timeoutMs) return { valid: false, complete: false, commandsProcessed: processed, commandsTotal: captured.commands.length, error: 'Validation reached its time limit. Split this batch into smaller edits.' };
      next = applyCommand(next, { frameId, layerId, ...command });
      processed++;
      // Yield every command so cancellation and the editor remain responsive.
      await yieldControl();
    }
    throwIfCancelled(signal);
    if (now() - started >= timeoutMs) return { valid: false, complete: false, commandsProcessed: processed, commandsTotal: captured.commands.length, error: 'Validation reached its time limit. Split this batch into smaller edits.' };
    const changedImageIds = Object.keys(next.images).filter(id => next.images[id] !== document.images[id]);
    const beforeLayers = new Map(document.layers.map(layer => [layer.id, JSON.stringify(layer)]));
    const affected = new Set(next.layers.filter(layer => beforeLayers.get(layer.id) !== JSON.stringify(layer)).map(layer => layer.id));
    for (const layer of document.layers) if (!next.layers.some(item => item.id === layer.id)) affected.add(layer.id);
    const changed = new Set(changedImageIds);
    const beforeFrames = new Map(document.frames.map(frame => [frame.id, frame]));
    for (const frame of next.frames) {
      const beforeCels = beforeFrames.get(frame.id)?.cels || {};
      for (const id of new Set([...Object.keys(beforeCels), ...Object.keys(frame.cels)])) {
        if (changed.has(frame.cels[id]?.imageId) || JSON.stringify(beforeCels[id]) !== JSON.stringify(frame.cels[id])) affected.add(id);
      }
      beforeFrames.delete(frame.id);
    }
    for (const frame of beforeFrames.values()) for (const id of Object.keys(frame.cels)) affected.add(id);
    return {
      valid: true, complete: true, commandsProcessed: processed, commandsTotal: captured.commands.length,
      expandedCommands: captured.expandedCommands, inputBytes: captured.bytes,
      affectedLayerIds: [...affected], changedImageIds,
      changedImagePixels: changedImageIds.reduce((sum, id) => sum + next.images[id].width * next.images[id].height, 0),
      result: describeDocument(next),
      warnings: captured.expandedCommands > 500 ? ['Large batch: use wait:false, poll the operation, and reuse a requestKey when retrying.'] : [],
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { valid: false, complete: true, commandsProcessed: processed, commandsTotal: captured.commands.length, failedCommandIndex: processed, error: error instanceof Error ? error.message : String(error) };
  }
}
