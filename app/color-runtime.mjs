import { createColorManager } from './color-management.mjs';
let pending;
export function loadBrowserColorManager() {
  if(!pending)pending=(async()=>{
    const base=process.env.NEXT_PUBLIC_PIXELWALL_STANDALONE==='true'?new URL('./runtimes/',location.href):new URL('/runtimes/',location.origin);
    const runtime=await import(/* webpackIgnore: true */ /* @vite-ignore */ new URL('lcms.mjs',base).href);
    const lcms=await runtime.instantiate({locateFile:()=>new URL('lcms.wasm',base).href});
    return createColorManager(lcms,runtime);
  })().catch(error=>{pending=undefined;throw error;});
  return pending;
}
