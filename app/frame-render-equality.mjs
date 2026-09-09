/** Pixel-only comparison for immutable PixelWall v4 document snapshots.
 * Never scans image pixels: edited image objects are replaced by the engine.
 * Keep this list aligned with renderFrame when new rendered properties appear.
 */
const tileLookups = new WeakMap();
const equalValues = (a, b) => a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));
function paletteAt(doc, frameId) {
  let palette = doc.palette;
  for (const frame of doc.frames) {
    if (frame.palette) palette = frame.palette;
    if (frame.id === frameId) break;
  }
  return palette;
}
function tileLookup(tileset) {
  if (!tileset) return null;
  let result = tileLookups.get(tileset);
  if (!result) {
    result = new Map((tileset.tiles || []).map(tile => [tile.id, tile]));
    tileLookups.set(tileset, result);
  }
  return result;
}
function samePreciseBounds(a, b) {
  const av = !!(a?.flags & 1), bv = !!(b?.flags & 1);
  return av === bv && (!av || ['x', 'y', 'width', 'height'].every(k => a[k] === b[k]));
}
function sameCel(a, b, ac, bc) {
  if (!ac || !bc) return !ac && !bc;
  return ac.x === bc.x && ac.y === bc.y && ac.opacity === bc.opacity &&
    (ac.zIndex ?? 0) === (bc.zIndex ?? 0) &&
    samePreciseBounds(ac.preciseBounds, bc.preciseBounds) &&
    a.images[ac.imageId] === b.images[bc.imageId];
}
function sameTilemap(a, b, af, bf, al, bl) {
  const am = al.tilemaps?.[af.id], bm = bl.tilemaps?.[bf.id];
  if (!!am !== !!bm) return false;
  const at = a.tilesets.find(t => t.id === (am?.tilesetId ?? al.tilesetId));
  const bt = b.tilesets.find(t => t.id === (bm?.tilesetId ?? bl.tilesetId));
  if (!at || !bt) return !at && !bt;
  if (at.tileWidth !== bt.tileWidth || at.tileHeight !== bt.tileHeight) return false;
  if (!am) {
    return sameCel(a, b, af.cels[al.id], bf.cels[bl.id]) &&
      at.tileCount === bt.tileCount && (at.flags & 4) === (bt.flags & 4) &&
      a.images[at.imageId] === b.images[bt.imageId];
  }
  if (am.columns !== bm.columns || am.rows !== bm.rows ||
      (am.x ?? 0) !== (bm.x ?? 0) || (am.y ?? 0) !== (bm.y ?? 0) ||
      (am.opacity ?? 1) !== (bm.opacity ?? 1) || am.cells.length !== bm.cells.length) return false;
  const used = new Set();
  for (let i = 0; i < am.cells.length; i++) {
    const x = am.cells[i], y = bm.cells[i];
    if (!x || !y) { if (!!x !== !!y) return false; continue; }
    if (x.tileId !== y.tileId || !!x.flipX !== !!y.flipX || !!x.flipY !== !!y.flipY ||
        (x.rotate ?? 0) !== (y.rotate ?? 0)) return false;
    used.add(x.tileId);
  }
  const atl = tileLookup(at), btl = tileLookup(bt);
  for (const key of used) {
    const x = atl.get(key), y = btl.get(key);
    if (!x || !y) { if (!!x !== !!y) return false; continue; }
    const ai = a.images[x.imageId], bi = b.images[y.imageId];
    if (ai !== bi) return false;
    const ar = x.sourceRect ?? {x: 0, y: 0, width: ai?.width, height: ai?.height};
    const br = y.sourceRect ?? {x: 0, y: 0, width: bi?.width, height: bi?.height};
    if (!['x','y','width','height'].every(k => ar[k] === br[k])) return false;
  }
  return true;
}

/** True guarantees unchanged rendered pixels for current engine semantics.
 * False may conservatively invalidate invisible or off-canvas artwork.
 */
export function sameFrameRender(a, b, frameId) {
  if (a === b) return true;
  if (!a || !b || a.width !== b.width || a.height !== b.height || a.colorMode !== b.colorMode) return false;
  const af = a.frames.find(f => f.id === frameId), bf = b.frames.find(f => f.id === frameId);
  if (!af || !bf) return false;
  if (a.colorMode === 'indexed' &&
      (!equalValues(paletteAt(a, frameId), paletteAt(b, frameId)) ||
       a.metadata?.aseprite?.transparentIndex !== b.metadata?.aseprite?.transparentIndex)) return false;
  if (a.layers.length !== b.layers.length) return false;
  for (let i = 0; i < a.layers.length; i++) {
    const al = a.layers[i], bl = b.layers[i];
    if (!['id','type','parentId','visible','opacity','blendMode'].every(k => al[k] === bl[k]) ||
        (al.asepriteFlags & 8) !== (bl.asepriteFlags & 8) ||
        (af.cels[al.id]?.zIndex ?? 0) !== (bf.cels[bl.id]?.zIndex ?? 0)) return false;
    if (al.type === 'group') continue;
    if (al.type === 'tilemap') {
      if (!sameTilemap(a, b, af, bf, al, bl)) return false;
    } else if (!sameCel(a, b, af.cels[al.id], bf.cels[bl.id])) return false;
  }
  return true;
}
