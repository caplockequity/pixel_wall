import * as runtime from 'lcms-wasm';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createColorManager } from './color-management.mjs';
let pending;
export function loadNodeColorManager() {
  pending ??= (async()=>{
    const distributed=new URL('./runtimes/lcms.wasm',import.meta.url);
    const wasm=existsSync(distributed)?distributed:new URL('../node_modules/lcms-wasm/dist/lcms.wasm',import.meta.url);
    return createColorManager(await runtime.instantiate({wasmBinary:await readFile(wasm)}),runtime);
  })().catch(error=>{pending=undefined;throw error;});
  return pending;
}
