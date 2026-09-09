import { tilesetSlots } from './tileset-access.mjs';
export const LUA_TILE_NOT_HANDLED = Symbol('tileset API not handled');
const no = LUA_TILE_NOT_HANDLED;
const integer = (value, min, max, label) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`${label} must be an integer from ${min} to ${max}.`); return value; };
/** Native tiles remain independent resources; placements are never flattened. */
export function createLuaTilesets({ doc, ref, getRef, mutate, tileImageRef, image, retireTileImage, reservePixels, limits, newId, layerRef, getActiveLayer, setActiveLayer }) {
  const tilesetRef = (docId, tilesetId) => ref('Tileset', { docId, tilesetId }, `tileset:${docId}:${tilesetId}`);
  const tileRef = (docId, tilesetId, index) => ref('Tile', { docId, tilesetId, index }, `tile:${docId}:${tilesetId}:${index}`);
  function owner(target) { const value = getRef(target, target.__kind), d = doc(value.docId), tileset = d.tilesets.find(item => item.id === value.tilesetId); if (!tileset) throw Error('Tileset no longer exists.'); return { ...value, d, tileset }; }
  function tile(target) { const value = owner(target), slots = tilesetSlots(value.d, value.tileset); if (value.index >= slots.count) throw Error('Tile no longer exists.'); return { ...value, value: slots.entries.get(value.index) }; }
  function object(target) {
    if (target.__kind === 'Tileset') { const value = owner(target); return { ...value, value: value.tileset, command: { target: 'tileset', tilesetId: value.tilesetId } }; }
    if (target.__kind === 'Tile') { const value = tile(target); return { ...value, value: { userData: value.value?.userData ?? value.tileset.tileUserData?.[value.index] }, command: { target: 'tile', tilesetId: value.tilesetId, tileIndex: value.index } }; }
    return null;
  }
  function grid(docId) { const g = doc(docId).metadata?.aseprite?.grid; return { x: g?.x ?? 0, y: g?.y ?? 0, width: g?.width || 16, height: g?.height || 16 }; }
  function gridBounds(value, origin = true) { if (!value || Object.keys(value).some(key => !['__value', 'x', 'y', 'width', 'height'].includes(key))) throw Error('Expected Grid or Rectangle.'); const result = { x: integer(value.x ?? 0, -32768, 32767, 'Grid x'), y: integer(value.y ?? 0, -32768, 32767, 'Grid y'), width: integer(value.width, 1, 65535, 'Grid width'), height: integer(value.height, 1, 65535, 'Grid height') }; if (!origin && (result.x || result.y)) throw Error('A tileset with an origin different from 0,0 cannot be created.'); return result; }
  function reserveTiles(width, height, count) { integer(width, 1, 65535, 'Tile width'); integer(height, 1, 65535, 'Tile height'); integer(count, 1, 65536, 'Tile count'); integer(height * count, 1, 65535, 'Tileset atlas height'); const size = width * height * count; if (!Number.isSafeInteger(size) || size > limits.pixels) throw Error('Lua tileset pixel budget exceeded.'); reservePixels(size); }
  function newTileset(docId, args) {
    if (!Array.isArray(args)) { if (!args || Object.keys(args).length) throw Error('Tileset arguments must be a contiguous argument list.'); args = []; }
    if (args.length > 2) throw Error('Sprite:newTileset expects a Grid/Rectangle and optional tile count, or one same-sprite Tileset.');
    let command;
    if (args[0]?.__kind === 'Tileset') { if (args.length !== 1) throw Error('Tileset copy expects one argument.'); const source = owner(args[0]); if (source.docId !== docId) throw Error('Tileset belongs to another sprite.'); reserveTiles(source.tileset.tileWidth, source.tileset.tileHeight, tilesetSlots(source.d, source.tileset).count); command = { copyTilesetId: source.tilesetId }; }
    else { const bounds = args[0] == null ? { ...grid(docId), x: 0, y: 0 } : gridBounds(args[0], false), count = integer(args[1] ?? 1, 1, 65536, 'Tile count'); reserveTiles(bounds.width, bounds.height, count); command = { tileWidth: bounds.width, tileHeight: bounds.height, tileCount: count }; }
    const tilesetId = newId('tileset'); mutate(docId, { type: 'tileset.create', tilesetId, ...command }); return tilesetRef(docId, tilesetId);
  }
  function newLayer(sprite, options) {
    if (options.tilemap !== true || (options.group != null && options.group !== false)) throw Error('NewLayer tilemap and group options are mutually exclusive.');
    if (options.name != null && typeof options.name !== 'string') throw Error('Layer name must be a string.');
    const docId = getRef(sprite, 'Sprite').docId, d = doc(docId), g = options.gridBounds ? gridBounds(options.gridBounds) : grid(docId), origin = options.gridBounds ? { x: g.x, y: g.y } : { x: ((g.x % g.width) + g.width) % g.width, y: ((g.y % g.height) + g.height) % g.height };
    reserveTiles(g.width, g.height, 1); const tilesetId = newId('tileset'), layerId = newId('layer'), current = d.layers.find(layer => layer.id === getActiveLayer()), parentId = current?.type === 'group' ? current.id : current?.parentId ?? null;
    const descendants = layer => { const ids = [layer.id]; for (const child of d.layers.filter(value => value.parentId === layer.id)) ids.push(...descendants(child)); return ids; };
    const anchorIds = current ? descendants(current) : [], index = current?.type === 'group' ? Math.max(d.layers.indexOf(current), ...d.layers.map((layer, at) => anchorIds.includes(layer.id) ? at : -1)) + 1 : current ? Math.max(...d.layers.map((layer, at) => anchorIds.includes(layer.id) ? at : -1)) + 1 : d.layers.length;
    let number = 1; while (d.layers.some(layer => layer.name === `Tilemap ${number}`)) number++;
    mutate(docId, { type: 'batch', commands: [{ type: 'tileset.create', tilesetId, tileWidth: g.width, tileHeight: g.height, tileCount: 1, gridOrigin: origin }, { type: 'layer.add', index, layer: { id: layerId, name: options.name || `Tilemap ${number}`, type: 'tilemap', tilesetId, parentId } }] }); setActiveLayer(layerId); return layerRef(docId, layerId);
  }
  function get(target, key) {
    if (target.__kind === 'Sprite' && key === 'gridBounds') return { __value: 'Rectangle', ...grid(getRef(target, 'Sprite').docId) };
    if (target.__kind === 'Sprite' && key === 'tilesets') { const d = doc(getRef(target, 'Sprite').docId); return d.tilesets.map(value => tilesetRef(d.id, value.id)); }
    if (target.__kind === 'Layer' && key === 'tileset') {
      const value = getRef(target, 'Layer'), d = doc(value.docId), layer = d.layers.find(layer => layer.id === value.layerId); if (!layer) throw Error('Layer no longer exists.'); if (layer.type !== 'tilemap') return null;
      const ids = new Set([layer.tilesetId, ...Object.values(layer.tilemaps ?? {}).map(map => map.tilesetId)].filter(Boolean));
      if (ids.size > 1) throw Error('Layer.tileset cannot represent a layer that changes tilesets between frames.');
      return ids.size ? tilesetRef(d.id, [...ids][0]) : null;
    }
    if (target.__kind === 'Tileset') { const value = owner(target), ts = value.tileset; if (key === 'name') return ts.name ?? ''; if (key === 'baseIndex') return ts.baseIndex ?? 1; if (key === 'size') return tilesetSlots(value.d, ts).count; if (key === 'grid') return { __value: 'Grid', width: ts.tileWidth, height: ts.tileHeight, x: ts.gridOrigin?.x ?? 0, y: ts.gridOrigin?.y ?? 0 }; }
    if (target.__kind === 'Tile') { const value = owner(target); if (key === 'index') return value.index; if (key === 'image') return value.index >= tilesetSlots(value.d, value.tileset).count ? null : tileImageRef(value.docId, value.tilesetId, value.index); }
    return no;
  }
  function set(target, key, value) {
    if (target.__kind === 'Sprite' && key === 'gridBounds') { const d = doc(getRef(target, 'Sprite').docId), bounds = gridBounds(value); mutate(d.id, { type: 'document.update', patch: { metadata: { ...d.metadata, aseprite: { ...d.metadata?.aseprite, grid: bounds } } } }); return true; }
    if (target.__kind === 'Tileset' && ['name', 'baseIndex'].includes(key)) {
      const ownerValue = owner(target); if (key === 'name' && (typeof value !== 'string' || new TextEncoder().encode(value).length > 240 || value.includes('\0'))) throw Error('Tileset name must be a string of at most 240 bytes without NUL.');
      if (key === 'baseIndex') integer(value, -32768, 32767, 'Tileset base index');
      mutate(ownerValue.docId, { type: 'tileset.update', tilesetId: ownerValue.tilesetId, patch: { [key]: value } }); return true;
    }
    if (target.__kind === 'Tile' && key === 'image') {
      const ownerValue = tile(target), source = image(value); if (source.colorMode !== ownerValue.d.colorMode) throw Error('Tile image and sprite color modes must match.');
      if (source.width !== ownerValue.tileset.tileWidth || source.height !== ownerValue.tileset.tileHeight) throw Error('Tile image dimensions must match the tileset grid.');
      mutate(ownerValue.docId, { type: 'tileset.tileImage', tilesetId: ownerValue.tilesetId, tileIndex: ownerValue.index, width: source.width, height: source.height, pixels: [...source.pixels] }); retireTileImage(ownerValue.docId, ownerValue.tilesetId, ownerValue.index); return true;
    }
    if (target.__kind === 'Layer' && key === 'tileset') { const l = getRef(target, 'Layer'), layer = doc(l.docId).layers.find(layer => layer.id === l.layerId); if (!layer) throw Error('Layer no longer exists.'); if (value == null || layer.type !== 'tilemap') return true; getRef(value, 'Tileset'); const ts = owner(value); if (ts.docId !== l.docId) throw Error('Tileset belongs to another sprite.'); mutate(l.docId, { type: 'layer.tileset', layerId: l.layerId, tilesetId: ts.tilesetId }); return true; }
    return false;
  }
  function method(target, name, args) {
    if (target.__kind === 'Tileset' && ['tile', 'getTile'].includes(name)) {
      if (args.length !== 1) throw Error(`Tileset:${name} expects one zero-based index.`); const value = owner(target), index = integer(args[0], -2147483648, 2147483647, 'Tile index');
      if (index < 0 || index >= tilesetSlots(value.d, value.tileset).count) return null;
      return name === 'getTile' ? tileImageRef(value.docId, value.tilesetId, index) : tileRef(value.docId, value.tilesetId, index);
    }
    if (target.__kind === 'Sprite' && name === 'deleteTileset') {
      if (args.length !== 1) throw Error('Sprite:deleteTileset expects a Tileset or one-based tileset index.'); const d = doc(getRef(target, 'Sprite').docId);
      const value = typeof args[0] === 'number' ? d.tilesets[integer(args[0], 1, d.tilesets.length, 'Tileset index') - 1] : owner(args[0]);
      if (value.docId && value.docId !== d.id) throw Error('Tileset belongs to another sprite.');
      mutate(d.id, { type: 'tileset.remove', tilesetId: value.tilesetId ?? value.id }); return;
    }
    if (target.__kind === 'Sprite' && name === 'newTileset') return newTileset(getRef(target, 'Sprite').docId, args);
    if (target.__kind === 'Sprite' && (name === 'newTile' || name === 'deleteTile')) {
      const docId = getRef(target, 'Sprite').docId, tileArgument = name === 'deleteTile' && args[0]?.__kind === 'Tile';
      if (args.length < 1 || args.length > 2 || (tileArgument && args.length !== 1)) throw Error(`Invalid Sprite:${name} arguments.`);
      getRef(args[0], tileArgument ? 'Tile' : 'Tileset'); const value = owner(args[0]); if (value.docId !== docId) throw Error('Tileset belongs to another sprite.');
      const count = tilesetSlots(value.d, value.tileset).count, insert = name === 'newTile', index = integer(tileArgument ? value.index : args[1] ?? (insert ? count : NaN), 1, insert ? count : count - 1, 'Tile index');
      reserveTiles(value.tileset.tileWidth, value.tileset.tileHeight, count + (insert ? 1 : -1));
      mutate(docId, { type: insert ? 'tileset.tileInsert' : 'tileset.tileRemove', tilesetId: value.tilesetId, tileIndex: index, ...(insert ? { tileId: newId('tile') } : {}) }); return insert ? tileRef(docId, value.tilesetId, index) : undefined;
    }
    return no;
  }
  return { get, set, method, object, newLayer };
}
