/** Native tile numbering for commands and scripting, matching native export. No I/O. */
export function tilesetSlots(document, tileset) {
  const native = Number.isInteger(tileset.asepriteId) && (!!document.images[tileset.imageId] || !!(tileset.flags & 1));
  let count = native ? tileset.tileCount ?? 0 : 1;
  if (!Number.isSafeInteger(count) || count < 0 || count > 65536) throw Error('Invalid native tileset count.');
  const entries = new Map();
  for (const tile of tileset.tiles ?? []) {
    const index = native && Number.isInteger(tile.asepriteTileId) ? tile.asepriteTileId : count++;
    if (!Number.isSafeInteger(index) || index < 0 || index >= 65536 || entries.has(index)) throw Error('Invalid or duplicate native tile index.');
    count = Math.max(count, index + 1); entries.set(index, tile);
  }
  return { native, count, entries };
}
export function assertTilesetEditable(document, tilesetId) {
  for (const item of document.layers) if (item.tilesetId === tilesetId || Object.values(item.tilemaps ?? {}).some(map => map.tilesetId === tilesetId)) {
    let layer = item;
    while (layer) { if (layer.locked) throw Error(`Layer “${layer.name}” is locked.`); layer = document.layers.find(value => value.id === layer.parentId); }
  }
}
