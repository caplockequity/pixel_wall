import * as runtime from 'lcms-wasm';
import { createColorManager } from './color-management.mjs';
import { needsLuaColorManager } from './lua-color-spaces.mjs';

/** Only the trusted worker startup URL selects this bundled asset. Lua never
 * receives the URL, the fetch function, or a LittleCMS handle. */
export async function loadLuaBrowserColorManager(request, wasmUri) {
  if (!needsLuaColorManager(request)) return undefined;
  let options = {};
  if (wasmUri) {
    const asset = new URL('lcms.wasm', wasmUri);
    const response = await fetch(asset);
    if (!response.ok) throw Error('The bundled color-management runtime could not be loaded.');
    options = {wasmBinary: new Uint8Array(await response.arrayBuffer())};
  }
  return createColorManager(await runtime.instantiate(options), runtime);
}
