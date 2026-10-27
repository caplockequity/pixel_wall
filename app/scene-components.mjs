/** Deterministic, editable scene props for agent-authored compositions. */
const KINDS = ['tree', 'rock', 'river-bank', 'bridge', 'terrain'];
const STYLES = ['summer', 'autumn', 'mossy', 'stone', 'woodland'];
const PALETTE = {
  summer: { trunk: '#704833ff', trunkDark: '#422e2aff', leaf: '#4f8f4bff', leafLight: '#8fbd5bff', leafDark: '#28543aff', stone: '#687777ff', stoneLight: '#b0b49bff', soil: '#9b704fff', grass: '#78ad59ff', water: '#368fabff', wood: '#9b633dff', woodLight: '#d09a58ff', shadow: '#283447ff' },
  autumn: { trunk: '#75442fff', trunkDark: '#422827ff', leaf: '#b46d38ff', leafLight: '#e0a64fff', leafDark: '#6b4431ff', stone: '#77736dff', stoneLight: '#c0b49bff', soil: '#9a6446ff', grass: '#b4934dff', water: '#3e8195ff', wood: '#915334ff', woodLight: '#d18a4dff', shadow: '#302c38ff' },
  mossy: { trunk: '#5d4835ff', trunkDark: '#382f2bff', leaf: '#4b7650ff', leafLight: '#9bb36aff', leafDark: '#2e4d3aff', stone: '#5e7068ff', stoneLight: '#a7b79aff', soil: '#80644aff', grass: '#7f9e5aff', water: '#39869aff', wood: '#765237ff', woodLight: '#b48753ff', shadow: '#29373aff' },
  stone: { trunk: '#5e5146ff', trunkDark: '#38383aff', leaf: '#657665ff', leafLight: '#9eaa82ff', leafDark: '#3e5147ff', stone: '#686b73ff', stoneLight: '#b8b4a5ff', soil: '#746355ff', grass: '#82936aff', water: '#3b8499ff', wood: '#705646ff', woodLight: '#b28a61ff', shadow: '#303443ff' },
  woodland: { trunk: '#67442fff', trunkDark: '#3d2b28ff', leaf: '#39734aff', leafLight: '#8db967ff', leafDark: '#234c38ff', stone: '#68746fff', stoneLight: '#b3b49dff', soil: '#866044ff', grass: '#73a85bff', water: '#348ca3ff', wood: '#895638ff', woodLight: '#c38b50ff', shadow: '#293543ff' },
};
const integer = (v, fallback, label, min, max) => {
  if (v === undefined) return fallback;
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  return v;
};
const hash = n => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 13), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const noise = (x, y, seed) => hash(Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed) / 4294967296;
const color = (value, label) => { if (typeof value !== 'string' || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) throw new TypeError(`Invalid palette color for ${label}`); return value.length === 7 ? `${value}ff`.toLowerCase() : value.toLowerCase(); };
function palette(style, custom) {
  if (!Object.hasOwn(PALETTE, style)) throw new RangeError(`Unknown component style: ${style}`);
  const result = { ...PALETTE[style] };
  if (custom !== undefined) {
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw new TypeError('Palette must be an object of named roles.');
    for (const [key, value] of Object.entries(custom)) { if (!Object.hasOwn(result, key)) throw new RangeError(`Unknown palette role: ${key}`); result[key] = color(value, key); }
  }
  return result;
}
function canvas(width, height) { return Array(width * height).fill(null); }
function stamp(layer, width, height, x, y, value) { if (x >= 0 && y >= 0 && x < width && y < height) layer[y * width + x] = value; }
function rect(layer, width, height, x, y, w, h, value) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) stamp(layer, width, height, xx, yy, value); }
function line(layer, width, height, ax, ay, bx, by, value) { const dx = Math.abs(bx - ax), sx = ax < bx ? 1 : -1, dy = -Math.abs(by - ay), sy = ay < by ? 1 : -1; let err = dx + dy; for (;;) { stamp(layer, width, height, ax, ay, value); if (ax === bx && ay === by) return; const e = err * 2; if (e >= dy) { err += dy; ax += sx; } if (e <= dx) { err += dx; ay += sy; } } }
function ellipse(layer, width, height, cx, cy, rx, ry, value) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x / Math.max(1, rx)) ** 2 + (y / Math.max(1, ry)) ** 2 <= 1) stamp(layer, width, height, cx + x, cy + y, value); }
function tree(width, height, pal, seed, controls = {}) { const trunk = canvas(width, height), leaves = canvas(width, height), shadow = canvas(width, height), cx = Math.floor(width / 2), base = height - 2, crown = Math.max(2, Math.floor(height * .42)); const aspect = Math.max(.55, Math.min(1.6, Number(controls.crownAspectRatio ?? 1))); const asym = Math.max(-.35, Math.min(.35, Number(controls.asymmetry ?? 0))); const bend = Math.max(-.25, Math.min(.25, Number(controls.trunkBend ?? 0))); const roots = Math.max(.5, Math.min(1.5, Number(controls.rootSpread ?? 1))); ellipse(shadow, width, height, cx, base, Math.max(2, Math.floor(width * .32 * roots)), 1, pal.shadow); const trunkW = Math.max(2, Math.floor(width / 6)); rect(trunk, width, height, cx - Math.floor(trunkW / 2), base - crown, trunkW, crown, pal.trunk); const bendX = Math.round(width * bend); line(trunk, width, height, cx, base - crown + 3, cx - Math.floor(width * .22) + bendX, base - Math.floor(height * .62), pal.trunkDark); line(trunk, width, height, cx, base - crown + 5, cx + Math.floor(width * .2) + bendX, base - Math.floor(height * .58), pal.trunk); const clusters = [[cx + Math.round(width * asym), Math.floor(height * .25), .34 * aspect, .2, pal.leafDark], [cx - Math.floor(width * .2) + Math.round(width * asym), Math.floor(height * .36), .22 * aspect, .17, pal.leaf], [cx + Math.floor(width * .2) + Math.round(width * asym), Math.floor(height * .34), .23 * aspect, .18, pal.leaf], [cx + Math.round(width * asym), Math.floor(height * .42), .3 * aspect, .14, pal.leaf]]; for (const [x, y, rx, ry, colorValue] of clusters) ellipse(leaves, width, height, x, y, Math.max(2, Math.floor(width * rx)), Math.max(2, Math.floor(height * ry)), colorValue); for (let i = 0; i < 5; i++) { const x = cx - Math.floor(width * .25) + Math.floor(noise(i, 2, seed) * width * .5) + Math.round(width * asym), y = Math.floor(height * (.18 + noise(i, 7, seed) * .24)); ellipse(leaves, width, height, x, y, 1 + i % 2, 1, pal.leafLight); } return [['Shadow', shadow], ['Trunk', trunk], ['Canopy', leaves]]; }
function rock(width, height, pal, seed) { const stone = canvas(width, height), detail = canvas(width, height); const cx = Math.floor(width / 2), cy = Math.floor(height * .6) + (seed & 1); ellipse(stone, width, height, cx, cy, Math.floor(width * .4), Math.floor(height * .28), pal.stone); const facet = Math.max(2, Math.floor(width * .22)); for (let y = cy - facet; y <= cy; y++) for (let x = cx - facet; x <= cx + facet; x++) if ((x - cx) ** 2 / (facet * facet) + (y - (cy - 1)) ** 2 / Math.max(1, facet * facet) < 1) stamp(detail, width, height, x, y, pal.stoneLight); line(detail, width, height, cx - facet, cy - Math.floor(height * .15), cx, cy - facet, pal.stoneLight); return [['Rock', stone], ['Rock facets', detail]]; }
function bank(width, height, pal, seed) { const soil = canvas(width, height), grass = canvas(width, height); for (let y = 0; y < height; y++) { const edge = Math.floor(width * .35 + Math.sin(y * .35 + seed) * width * .08); for (let x = edge; x < width; x++) stamp(soil, width, height, x, y, x === edge ? pal.grass : pal.soil); for (let i = 0; i < 3; i++) { const x = edge + Math.floor(noise(y, i, seed) * Math.max(1, width - edge)); line(grass, width, height, x, y, x - 1, y - 2 - (i % 2), pal.grass); } } return [['River bank', soil], ['Bank grass', grass]]; }
function bridge(width, height, pal) { const deck = canvas(width, height), rails = canvas(width, height), shadow = canvas(width, height), y = Math.floor(height * .5); rect(shadow, width, height, 1, y + 2, width - 2, Math.max(1, Math.floor(height * .16)), pal.shadow); rect(deck, width, height, 1, y, width - 2, Math.max(2, Math.floor(height * .18)), pal.wood); for (let x = 2; x < width - 2; x += 3) line(deck, width, height, x, y, x, y + Math.max(1, Math.floor(height * .15)), pal.woodLight); line(rails, width, height, 1, y - 2, width - 2, y - 2, pal.woodLight); line(rails, width, height, 1, y + Math.max(2, Math.floor(height * .22)), width - 2, y + Math.max(2, Math.floor(height * .22)), pal.woodLight); return [['Bridge shadow', shadow], ['Bridge deck', deck], ['Bridge rails', rails]]; }
function terrain(width, height, pal, seed) { const ground = canvas(width, height), texture = canvas(width, height); const cx = Math.floor(width * .5), cy = Math.floor(height * .54), rx = Math.floor(width * .46), ry = Math.floor(height * .38); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const wobble = Math.sin(y * .23 + seed) * 2 + Math.sin(y * .07 + seed * .4) * 2; if (((x - cx - wobble) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) stamp(ground, width, height, x, y, y < cy - 2 ? pal.grass : pal.soil); } for (let i = 0; i < Math.max(4, Math.floor(width / 8)); i++) { const px = Math.floor(width * (.18 + noise(i, 1, seed) * .64)), py = Math.floor(height * (.35 + noise(i, 2, seed) * .4)); ellipse(texture, width, height, px, py, 2 + (i % 3), 1 + (i % 2), i % 3 ? pal.grass : pal.stoneLight); } return [['Terrain island', ground], ['Terrain clusters', texture]]; }

export const SCENE_COMPONENT_KINDS = Object.freeze([...KINDS]);
export const SCENE_COMPONENT_STYLES = Object.freeze([...STYLES]);
export const SCENE_COMPONENT_PRESETS = Object.freeze({ tree: { size: { width: 24, height: 32 }, style: 'woodland' }, rock: { size: { width: 16, height: 10 }, style: 'stone' }, 'river-bank': { size: { width: 32, height: 24 }, style: 'summer' }, bridge: { size: { width: 40, height: 18 }, style: 'woodland' }, terrain: { size: { width: 48, height: 32 }, style: 'mossy' } });
export function listSceneComponentPresets() { return Object.freeze(KINDS.map(kind => ({ kind, ...SCENE_COMPONENT_PRESETS[kind] }))); }
export function generateSceneComponent(options = {}) {
  const kind = options.kind ?? 'tree', preset = Object.hasOwn(SCENE_COMPONENT_PRESETS, kind) ? SCENE_COMPONENT_PRESETS[kind] : undefined;
  if (!preset) throw new RangeError(`Unknown scene component: ${kind}`);
  const size = typeof options.size === 'number' ? { width: options.size, height: options.size } : options.size ?? preset.size;
  const width = integer(size.width, preset.size.width, 'Component width', 4, 128), height = integer(size.height, preset.size.height, 'Component height', 4, 128);
  const x = integer(options.position?.x, 0, 'Component x', -65535, 65535), y = integer(options.position?.y, 0, 'Component y', -65535, 65535), seed = integer(options.seed, 1, 'Component seed', 0, 0xffffffff);
  const style = options.style ?? preset.style, pal = palette(style, options.palette);
  const componentId = options.componentId ?? options.id ?? `${kind}-${seed}`;
  if (typeof componentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(componentId)) throw new RangeError('componentId must be a short stable identifier.');
  const artDirection = options.artDirection && typeof options.artDirection === 'object' ? structuredClone(options.artDirection) : {};
  const generator = { tree, rock, 'river-bank': bank, bridge, terrain }[kind];
  const layers = (kind === 'tree' ? tree(width, height, pal, seed, artDirection) : generator(width, height, pal, seed)).map(([name, pixels], index) => ({ id: `component-${kind}-${index + 1}`, name, pixels }));
  return { kind, style, seed, width, height, x, y, componentId, layers, palette: pal, artDirection, recipe: { kind, style, seed, size: { width, height }, position: { x, y }, componentId, palette: structuredClone(options.palette ?? {}), artDirection: structuredClone(artDirection) }, metadata: { generator: 'scene-component', generatorVersion: 2, kind, style, seed, componentId, position: { x, y }, size: { width, height }, paletteRoles: pal, artDirection: structuredClone(artDirection) } };
}

export function sceneComponentRecipe(component) {
  if (!component?.recipe || typeof component.recipe !== 'object') throw new TypeError('A generated scene component recipe is required.');
  return structuredClone(component.recipe);
}

export function regenerateSceneComponent(component, overrides = {}) {
  const recipe = { ...sceneComponentRecipe(component), ...structuredClone(overrides) };
  return generateSceneComponent(recipe);
}

/** Replace a generated component while protecting manually edited layers. */
export function replaceSceneComponent(component, replacement, { preserveLayerIds = [], allowManual = false } = {}) {
  const protectedIds = new Set(preserveLayerIds);
  if (!allowManual && component?.metadata?.manualLayerIds) for (const id of component.metadata.manualLayerIds) protectedIds.add(id);
  const oldLayers = new Map((component?.layers ?? []).map(layer => [layer.id, layer]));
  const layers = replacement.layers.map(layer => protectedIds.has(layer.id) && oldLayers.has(layer.id) ? structuredClone(oldLayers.get(layer.id)) : layer);
  return { ...replacement, layers, metadata: { ...replacement.metadata, manualLayerIds: [...protectedIds] } };
}
