import { validateLuaColor } from './lua-colors.mjs';
import { LUA_LIMITS, validateLuaResult } from './lua-session.mjs';
import { normalizeDocument } from './editor-core.mjs';

export function luaRequest(input) {
  if (!input || typeof input.source !== 'string' || new TextEncoder().encode(input.source).length > LUA_LIMITS.sourceBytes) throw Error('Lua source exceeds 256 KiB or is not text.');
  const timeoutMs = input.timeoutMs ?? LUA_LIMITS.timeoutMs, instructionLimit = input.instructionLimit ?? LUA_LIMITS.instructions;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) throw Error('Lua timeout must be 50–10000 milliseconds.');
  if (!Number.isSafeInteger(instructionLimit) || instructionLimit < 1000 || instructionLimit > 500000000) throw Error('Lua instruction limit must be 1000–500000000.');
  const params = input.params ?? {};
  if (!params || Array.isArray(params) || typeof params !== 'object' || JSON.stringify(params).length > 16384) throw Error('Lua params must be an object below 16 KiB.');
  const document = input.document ? normalizeDocument(structuredClone(input.document)) : null;
  if (document && (document.width * document.height > LUA_LIMITS.pixels || Object.values(document.images).reduce((n, i) => n + i.width * i.height, 0) > LUA_LIMITS.pixels)) throw Error('Lua input exceeds the one-million-pixel budget.');
  const selection = input.selection == null ? null : structuredClone(input.selection), range = input.range == null ? null : structuredClone(input.range);
  if (selection && (!document || !Array.isArray(selection) || selection.length !== document.width * document.height || selection.some(value => value !== 0 && value !== 1))) throw Error('Invalid initial Lua selection.');
  if (range && (!document || ![0, 1, 2, 4].includes(range.type) || !Array.isArray(range.layerIds) || range.layerIds.some(id => !document.layers.some(layer => layer.id === id)) || !Array.isArray(range.frameIds) || range.frameIds.some(id => !document.frames.some(frame => frame.id === id)) || !Array.isArray(range.colors) || range.colors.some(index => !Number.isInteger(index) || index < 0 || index >= document.palette.length) || !Array.isArray(range.sliceIds) || range.sliceIds.some(id => !document.slices.some(slice => slice.id === id)))) throw Error('Invalid initial Lua range.');
  const fgColor = validateLuaColor(input.fgColor === undefined ? [0, 0, 0, 255] : input.fgColor, 'Initial Lua foreground color');
  const bgColor = validateLuaColor(input.bgColor === undefined ? [255, 255, 255, 255] : input.bgColor, 'Initial Lua background color');
  return { source: input.source, document, selection, range, fgColor, bgColor, params: JSON.parse(JSON.stringify(params)), activeFrameId: input.activeFrameId, activeLayerId: input.activeLayerId, timeoutMs, instructionLimit };
}
export { validateLuaResult };
