import { decodeAsepriteProperties, encodeAsepriteProperties } from './aseprite-properties.mjs';
export const LUA_NOT_HANDLED = Symbol('not handled');
const copy = value => structuredClone(value), no = LUA_NOT_HANDLED;
const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Expected an integer from ${min} to ${max}.`); return value; };
const rect = value => ({ x: integer(value?.x ?? 0, -65535, 65535), y: integer(value?.y ?? 0, -65535, 65535), width: integer(value?.width ?? 0, 0, 65535), height: integer(value?.height ?? 0, 0, 65535) });
const empty = () => ({ x: 0, y: 0, width: 0, height: 0, mask: new Uint8Array() });
const bounds = value => ({ __value: 'Rectangle', x: value.x, y: value.y, width: value.width, height: value.height });
const directions = ['forward', 'reverse', 'pingpong', 'pingpong_reverse'];
const array = value => Array.isArray(value) ? value : value && !Object.keys(value).length ? [] : (() => { throw Error('Expected an array.'); })();

/** Session-only selections/ranges plus command-backed native tags, slices and user properties. */
export function createLuaAuthoring(api) {
  const { doc, mutate, ref, getRef, frameAt, frameRef, layerRef, celRef, imageRef, spriteRef, layer, cel, inputColor, colorValue, getActive, limits } = api;
  let selections = new Map(), ranges = new Map();
  const creationOrder = new Map(); let serial = 0, selectionPixels = 0;
  function track(document) { if (!creationOrder.has(document.id)) creationOrder.set(document.id, new Map()); const order = creationOrder.get(document.id); for (const item of document.layers) if (!order.has(item.id)) order.set(item.id, order.size); }
  function allocate(width, height) { if (width * height > limits.pixels || (selectionPixels += width * height) > limits.pixels * 16) throw Error('Lua selection allocation budget exceeded.'); return new Uint8Array(width * height); }
  function rectangleSelection(value) { const result = rect(value); result.mask = allocate(result.width, result.height).fill(1); return result.width && result.height ? result : empty(); }
  function selectionRef(docId) { if (!selections.has(docId)) selections.set(docId, empty()); return ref('Selection', { docId }, `selection:${docId}`); }
  function selection(target) { const value = getRef(target, 'Selection'); return value.docId ? selections.get(value.docId) ?? empty() : value.selection; }
  function putSelection(target, value) { const state = getRef(target, 'Selection'); if (state.docId) selections.set(state.docId, value); else state.selection = value; }
  function selected(value, x, y) { return x >= value.x && y >= value.y && x < value.x + value.width && y < value.y + value.height && !!value.mask[(y - value.y) * value.width + x - value.x]; }
  function combine(a, b, operation) {
    const nonempty = [a, b].filter(value => value.width && value.height);
    if (!nonempty.length) return empty();
    const x = Math.min(...nonempty.map(value => value.x)), y = Math.min(...nonempty.map(value => value.y));
    const width = Math.max(...nonempty.map(value => value.x + value.width)) - x, height = Math.max(...nonempty.map(value => value.y + value.height)) - y;
    const mask = allocate(width, height); let left = width, top = height, right = -1, bottom = -1;
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) if (operation(selected(a, xx + x, yy + y), selected(b, xx + x, yy + y))) { mask[yy * width + xx] = 1; left = Math.min(left, xx); top = Math.min(top, yy); right = Math.max(right, xx); bottom = Math.max(bottom, yy); }
    if (right < 0) return empty();
    const w = right - left + 1, h = bottom - top + 1, cropped = allocate(w, h);
    for (let yy = 0; yy < h; yy++) cropped.set(mask.subarray((top + yy) * width + left, (top + yy) * width + left + w), yy * w);
    return { x: x + left, y: y + top, width: w, height: h, mask: cropped };
  }
  function canvasMask(docId) { const d = doc(docId), value = selection(selectionRef(docId)); if (!value.mask.length) return null; return Array.from({ length: d.width * d.height }, (_, index) => Number(selected(value, index % d.width, Math.floor(index / d.width)))); }
  function rangeState(docId) { if (!ranges.has(docId)) ranges.set(docId, { type: 0, layers: [], frames: [], colors: [], slices: [] }); return ranges.get(docId); }
  function rangeValues(docId) {
    const d = doc(docId), active = getActive(), state = rangeState(docId); track(d);
    const layers = (state.layers.length ? state.layers : [active.layerId]).filter(id => d.layers.some(layer => layer.id === id)).sort((a, b) => creationOrder.get(docId).get(a) - creationOrder.get(docId).get(b));
    const frames = (state.frames.length ? state.frames : [active.frameIndex]).filter(index => index < d.frames.length).sort((a, b) => a - b);
    const cels = frames.flatMap(index => layers.map(id => celRef(docId, id, d.frames[index].id)).filter(Boolean));
    return { d, state, layers, frames, cels };
  }
  function object(target) {
    const kind = target.__kind;
    if (kind === 'Sprite') { const r = getRef(target, kind); return { docId: r.docId, value: doc(r.docId), command: { target: 'sprite' } }; }
    if (kind === 'Layer') { const r = layer(target); return { ...r, command: { target: 'layer', layerId: r.layerId } }; }
    if (kind === 'Cel') { const r = cel(target); return { ...r, command: { target: 'cel', layerId: r.layerId, frameId: r.frameId } }; }
    if (kind === 'Tag' || kind === 'Slice') { const r = getRef(target, kind), key = kind === 'Tag' ? 'clips' : 'slices', value = doc(r.docId)[key].find(value => value.id === r.objectId); if (!value) throw Error(`${kind} no longer exists.`); return { ...r, value, command: { target: kind === 'Tag' ? 'tag' : 'slice', [kind === 'Tag' ? 'clipId' : 'sliceId']: value.id } }; }
    return api.tileObject?.(target) ?? null;
  }
  const tagRef = (docId, id) => ref('Tag', { docId, objectId: id }, `tag:${docId}:${id}`);
  const sliceRef = (docId, id) => ref('Slice', { docId, objectId: id }, `slice:${docId}:${id}`);
  const propertiesRef = (owner, namespace = 0, extension = '') => ref('Properties', { owner, namespace, extension }, `properties:${owner.id}:${extension || namespace}`);
  function mapsFor(target) { return decodeAsepriteProperties(object(target).value.userData?.propertiesBytes); }
  function namespaceId(p) { return p.extension ? doc(object(p.owner).docId).metadata?.aseprite?.externalFiles?.find(v => v.type === 2 && v.name === p.extension)?.id : p.namespace; }
  function propertyMap(target) { const p = getRef(target, 'Properties'), id = namespaceId(p); return id == null ? {} : mapsFor(p.owner)[id] ?? {}; }
  function setUserData(target, patch) { const o = object(target); mutate(o.docId, { type: 'object.userData', ...o.command, userData: { ...o.value.userData, ...patch } }); }
  function replaceProperties(target, values) {
    if (!values || Array.isArray(values) || typeof values !== 'object' || values.__kind) throw Error('Properties require a string-keyed table.');
    const p = getRef(target, 'Properties'), o = object(p.owner), maps = mapsFor(p.owner), files = doc(o.docId).metadata?.aseprite?.externalFiles ?? [];
    const existing = namespaceId(p), id = existing ?? Math.max(0, ...files.map(v => v.id)) + 1; integer(id, 0, 0xffffffff);
    maps[id] = copy(values); setUserData(p.owner, { propertiesBytes: encodeAsepriteProperties(maps) });
    if (existing == null) { const d = doc(o.docId); mutate(o.docId, { type: 'document.update', patch: { metadata: { ...d.metadata, aseprite: { ...d.metadata?.aseprite, externalFiles: [...files, { id, type: 2, name: p.extension }] } } } }); }
  }
  function keyAtZero(o) {
    const slice = o.value;
    if (slice.bounds) return { frameId: doc(o.docId).frames[0].id, ...slice.bounds, ...(slice.pivot ? { pivot: slice.pivot } : {}), ...(slice.ninePatch ? { center: slice.ninePatch } : {}) };
    return slice.keys?.find(key => !key.frameId || key.frameId === doc(o.docId).frames[0].id) ?? null;
  }
  function sliceKeySet(target, key, value) {
    const o = object(target), d = doc(o.docId), current = copy(keyAtZero(o) ?? { frameId: d.frames[0].id, x: 0, y: 0, width: 0, height: 0 });
    if (key === 'bounds') Object.assign(current, rect(value));
    else if (value == null) delete current[key];
    else current[key] = key === 'pivot' ? { x: integer(value.x, -65535, 65535), y: integer(value.y, -65535, 65535) } : rect(value);
    const keys = [current, ...(o.value.keys ?? []).filter(k => k.frameId !== d.frames[0].id && k.frameId)];
    mutate(o.docId, { type: 'slice.update', sliceId: o.value.id, patch: { keys } });
  }
  function get(target, key) {
    const kind = target.__kind;
    if (kind === 'Properties') { const values = propertyMap(target); return { __value: 'PlainData', value: Object.hasOwn(values, key) ? values[key] : null }; }
    if (kind === 'Selection') { const value = selection(target); if (key === 'bounds') return bounds(value); if (key === 'origin') return { __value: 'Point', x: value.x, y: value.y }; if (key === 'isEmpty') return !value.mask.length; return no; }
    if (kind === 'Range') {
      const r = getRef(target, kind), { state, layers, frames, cels } = rangeValues(r.docId);
      if (key === 'sprite') return spriteRef(r.docId); if (key === 'type') return state.type; if (key === 'isEmpty') return state.type === 0;
      if (key === 'layers') return layers.map(id => layerRef(r.docId, id)); if (key === 'frames') return frames.map(index => frameRef(r.docId, index)); if (key === 'cels') return cels;
      if (key === 'colors') return [...state.colors]; if (key === 'slices') return state.slices.filter(id => doc(r.docId).slices.some(s => s.id === id)).map(id => sliceRef(r.docId, id));
      if (key === 'images' || key === 'editableImages') { const ids = new Set(); for (const target of cels) { const c = cel(target); let l = doc(r.docId).layers.find(l => l.id === c.layerId), locked = false; while (l) { locked ||= l.locked; l = doc(r.docId).layers.find(v => v.id === l.parentId); } if (key !== 'editableImages' || !locked) ids.add(c.value.imageId); } return [...ids].map(id => imageRef(r.docId, id)); }
      return no;
    }
    const o = object(target); if (!o) return no;
    if (key === 'properties') return propertiesRef(target);
    if (key === 'data') return o.value.userData?.text ?? '';
    if (key === 'color') return colorValue(o.value.userData?.color ?? (kind === 'Tag' ? o.value.color ?? '#000000ff' : '#00000000'));
    if (kind === 'Sprite') { if (key === 'selection') return selectionRef(o.docId); if (key === 'tags') return o.value.clips.map(v => tagRef(o.docId, v.id)); if (key === 'slices') return o.value.slices.map(v => sliceRef(o.docId, v.id)); }
    if (kind === 'Tag') {
      const d = doc(o.docId), indices = o.value.frameIds.map(id => d.frames.findIndex(f => f.id === id));
      const values = { sprite: spriteRef(o.docId), name: o.value.name, fromFrame: frameRef(o.docId, Math.min(...indices)), toFrame: frameRef(o.docId, Math.max(...indices)), frames: Math.max(...indices) - Math.min(...indices) + 1, aniDir: directions.indexOf(o.value.direction), repeats: o.value.repeat ?? (o.value.loop ? 0 : 1) };
      if (key in values) return values[key];
    }
    if (kind === 'Slice') { const current = keyAtZero(o); if (key === 'name') return o.value.name; if (key === 'sprite') return spriteRef(o.docId); if (key === 'bounds') return current ? bounds(current) : null; if (key === 'pivot') return current?.pivot ? { __value: 'Point', ...current.pivot } : null; if (key === 'center') return current?.center ? { __value: 'Rectangle', ...current.center } : null; }
    return no;
  }
  function set(target, key, value) {
    const kind = target.__kind;
    if (kind === 'Properties') { const values = copy(propertyMap(target)); if (value == null) delete values[key]; else Object.defineProperty(values, key, { value: copy(value), enumerable: true, writable: true, configurable: true }); replaceProperties(target, values); return true; }
    if (kind === 'Selection' && key === 'origin') { const current = copy(selection(target)); if (current.mask.length) { current.x = integer(value.x, -65535, 65535); current.y = integer(value.y, -65535, 65535); putSelection(target, current); } return true; }
    if (kind === 'Range') {
      const r = getRef(target, kind), state = rangeState(r.docId), values = array(value);
      if (key === 'layers') { state.layers = [...new Set(values.map(value => { const l = layer(value); if (l.docId !== r.docId) throw Error('Range layer belongs to another sprite.'); return l.layerId; }))]; state.type = values.length ? 4 : 0; return true; }
      if (key === 'frames') { state.frames = [...new Set(values.map(value => frameAt(r.docId, value)))].sort((a, b) => a - b); state.type = values.length ? 2 : 0; return true; }
      if (key === 'colors') { state.colors = [...new Set(values.map(value => integer(value, 0, doc(r.docId).palette.length - 1)))].sort((a, b) => a - b); return true; }
      if (key === 'slices') { state.slices = [...new Set(values.map(value => { const s = object(value); if (value.__kind !== 'Slice' || s.docId !== r.docId) throw Error('Range slice belongs to another sprite.'); return s.value.id; }))]; return true; }
      return false;
    }
    const o = object(target); if (!o) return false;
    if (key === 'data') { if (typeof value !== 'string') throw Error('User data must be a string.'); setUserData(target, { text: value }); return true; }
    if (key === 'color') { setUserData(target, { color: inputColor(value, 'rgba') }); return true; }
    if (key === 'properties') { replaceProperties(propertiesRef(target), value); return true; }
    if (kind === 'Sprite' && key === 'selection') { putSelection(selectionRef(o.docId), value ? copy(selection(value)) : empty()); return true; }
    if (kind === 'Tag') {
      const d = doc(o.docId); let patch;
      if (key === 'name') patch = { name: value };
      if (key === 'aniDir') patch = { direction: directions[integer(value, 0, 3)] };
      if (key === 'repeats') patch = { repeat: integer(value, 0, 65535), loop: value === 0 };
      if (key === 'fromFrame' || key === 'toFrame') { const indices = o.value.frameIds.map(id => d.frames.findIndex(f => f.id === id)); const from = key === 'fromFrame' ? frameAt(o.docId, value) : Math.min(...indices), to = key === 'toFrame' ? frameAt(o.docId, value) : Math.max(...indices); if (from > to) throw Error('Tag start must not be after its end.'); patch = { frameIds: d.frames.slice(from, to + 1).map(f => f.id) }; }
      if (patch) { mutate(o.docId, { type: 'clip.update', clipId: o.value.id, patch }); return true; }
    }
    if (kind === 'Slice') { if (key === 'name') { mutate(o.docId, { type: 'slice.update', sliceId: o.value.id, patch: { name: value } }); return true; } if (['bounds', 'pivot', 'center'].includes(key)) { sliceKeySet(target, key, value); return true; } }
    return false;
  }
  function method(target, name, args) {
    const kind = target.__kind;
    if (kind === 'Properties') {
      if (name === 'entries') return { __value: 'PlainData', value: copy(propertyMap(target)) };
      if (name === 'namespace') {
        const p = getRef(target, kind), key = args[0]; if (typeof key !== 'string' || key.length > 1024 || (key && !/^[^/]+\/[^/]+$/.test(key))) throw Error('Extension property namespace must be publisher/name or empty.');
        const result = propertiesRef(p.owner, 0, key);
        if (args[1] != null) replaceProperties(result, args[1]);
        return result;
      }
    }
    if (kind === 'Selection') {
      if (name === 'contains') { const point = typeof args[0] === 'object' ? args[0] : { x: args[0], y: args[1] }; return selected(selection(target), integer(point.x, -65535, 65535), integer(point.y, -65535, 65535)); }
      if (name === 'deselect') { putSelection(target, empty()); return null; }
      if (name === 'selectAll') { const r = getRef(target, kind); if (!r.docId) throw Error('selectAll requires a sprite selection.'); const d = doc(r.docId); putSelection(target, rectangleSelection({ x: 0, y: 0, width: d.width, height: d.height })); return null; }
      const other = args[0]?.__kind === 'Selection' ? copy(selection(args[0])) : rectangleSelection(args[0]);
      if (name === 'select') { if (args[0]?.__kind) throw Error('Selection:select requires a Rectangle. Use add for another selection.'); putSelection(target, other); return null; }
      if (['add', 'subtract', 'intersect'].includes(name)) { putSelection(target, combine(selection(target), other, name === 'add' ? (a, b) => a || b : name === 'subtract' ? (a, b) => a && !b : (a, b) => a && b)); return null; }
    }
    if (kind === 'Range') {
      const r = getRef(target, kind), values = rangeValues(r.docId);
      if (name === 'clear') { ranges.delete(r.docId); return null; }
      if (name === 'containsColor') return values.state.colors.includes(args[0]);
      if (name === 'contains') { const value = args[0]; if (value?.__kind === 'Layer') { const l = layer(value); return l.docId === r.docId && values.layers.includes(l.layerId); } if (value?.__kind === 'Frame') { const f = getRef(value, 'Frame'); return f.docId === r.docId && values.frames.includes(f.index); } if (value?.__kind === 'Cel') return values.cels.some(c => c.id === value.id); if (value?.__kind === 'Slice') { const s = object(value); return s.docId === r.docId && values.state.slices.includes(s.value.id); } throw Error('Unsupported Range:contains value.'); }
    }
    if (kind === 'Sprite') {
      const o = object(target), d = doc(o.docId);
      if (name === 'newTag') { const from = frameAt(o.docId, args[0], 0), to = frameAt(o.docId, args[1], 0); if (from > to) throw Error('Tag start must not be after end.'); let id; do { id = `lua-tag-${++serial}`; } while (d.clips.some(v => v.id === id)); mutate(o.docId, { type: 'clip.add', clip: { id, name: 'Tag', frameIds: d.frames.slice(from, to + 1).map(f => f.id), direction: 'forward', repeat: 0, loop: true, color: '#000000ff', userData: { color: '#000000ff' } } }); return tagRef(o.docId, id); }
      if (name === 'newSlice') { let id; do { id = `lua-slice-${++serial}`; } while (d.slices.some(v => v.id === id)); const keys = args[0] == null ? [] : [{ frameId: d.frames[0].id, ...rect(args[0]) }]; mutate(o.docId, { type: 'slice.add', slice: { id, name: 'Slice', keys } }); return sliceRef(o.docId, id); }
      if (name === 'deleteTag' || name === 'deleteSlice') { const isTag = name === 'deleteTag', kind = isTag ? 'Tag' : 'Slice', values = isTag ? d.clips : d.slices; let value; if (typeof args[0] === 'string') value = values.find(v => v.name === args[0]); else { if (args[0]?.__kind !== kind) throw Error(`Expected a ${kind}.`); const other = object(args[0]); if (other.docId !== o.docId) throw Error(`${kind} belongs to another sprite.`); value = other.value; } if (!value) throw Error(`${kind} not found.`); mutate(o.docId, { type: isTag ? 'clip.remove' : 'slice.remove', [isTag ? 'clipId' : 'sliceId']: value.id }); return null; }
    }
    return no;
  }
  function selectionCommand(name) {
    const { docId, layerId } = getActive(); if (!docId) throw Error('No active sprite.');
    const target = selectionRef(docId);
    if (name === 'SelectAll') { method(target, 'selectAll', []); return true; }
    if (name === 'Deselect') { method(target, 'deselect', []); return true; }
    if (name === 'InvertMask') { const d = doc(docId); putSelection(target, combine(rectangleSelection({ x: 0, y: 0, width: d.width, height: d.height }), selection(target), (a, b) => a && !b)); return true; }
    if (name === 'Clear') { const { frames, layers } = rangeValues(docId), mask = canvasMask(docId); for (const index of frames) for (const lid of layers.length ? layers : [layerId]) mutate(docId, { type: mask ? 'selection.clear' : 'cel.clear', frameId: doc(docId).frames[index].id, layerId: lid, ...(mask ? { selection: mask } : {}) }); return true; }
    return false;
  }
  return { get, set, method, canvasMask, selectionCommand, track,
    appGet(key) { const { docId } = getActive(); return key === 'range' ? docId ? ref('Range', { docId }, `range:${docId}`) : null : no; },
    selectionNew(value) { return ref('Selection', { selection: value ? rectangleSelection(value) : empty() }); },
    initialize(docId, mask, range) {
      if (mask) { const d = doc(docId), value = { x: 0, y: 0, width: d.width, height: d.height, mask: Uint8Array.from(mask) }; selections.set(docId, combine(value, empty(), (a) => a)); }
      if (range) ranges.set(docId, { type: range.type, layers: [...range.layerIds], frames: range.frameIds.map(id => doc(docId).frames.findIndex(frame => frame.id === id)), colors: [...range.colors], slices: [...range.sliceIds] });
    },
    snapshot() { return { selections: copy(selections), ranges: copy(ranges) }; },
    restore(state) { selections = state.selections; ranges = state.ranges; },
    finish() { const { docId } = getActive(); if (!docId) return { selection: null, range: null }; const { layers, frames, state } = rangeValues(docId); return { selection: canvasMask(docId), range: { type: state.type, layerIds: layers, frameIds: frames.map(index => doc(docId).frames[index].id), colors: [...state.colors], sliceIds: [...state.slices] } }; },
  };
}
