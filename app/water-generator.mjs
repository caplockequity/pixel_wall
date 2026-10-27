/** Seeded, local raster generation. No DOM, image service or editor dependency. */
const SCENES = ['pond', 'river', 'stream', 'waterfall', 'shoreline'];
const TAU = Math.PI * 2;
const hash = n => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 13), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const noise = (x, y, seed) => hash(Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed) / 4294967296;
const integer = (v, fallback, label, min, max) => {
  if (v === undefined) return fallback;
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  return v;
};
const PALETTES = {
  spring: { water:'#368fab',waterDeep:'#245a81',waterLight:'#62bac1',foam:'#c7f2dc',bank:'#70a960',bankDark:'#385b45',soil:'#8f7052',grass:'#a5cb6b',rock:'#687c79',rockHi:'#b3b8a0',reed:'#d5c37e',sand:'#d9c58a',ice:'#d9f1ef',iceDark:'#84b8c4' },
  summer: { water:'#338eaa',waterDeep:'#255777',waterLight:'#56b5bc',foam:'#c0edda',bank:'#73a153',bankDark:'#38533a',soil:'#8e6950',grass:'#a6bf61',rock:'#667775',rockHi:'#aab49a',reed:'#d5bd70',sand:'#dbc58c',ice:'#d9f1ef',iceDark:'#84b8c4' },
  autumn: { water:'#448b9b',waterDeep:'#315674',waterLight:'#72b7b3',foam:'#e4e8c7',bank:'#ab854b',bankDark:'#68543a',soil:'#946344',grass:'#d6aa5c',rock:'#807975',rockHi:'#bdb199',reed:'#e2bf7b',sand:'#d9b98b',ice:'#d9f1ef',iceDark:'#84b8c4' },
  winter: { water:'#6ba6ba',waterDeep:'#3c6587',waterLight:'#9bcbd0',foam:'#f0f8ef',bank:'#e1ece1',bankDark:'#78928c',soil:'#91a8a5',grass:'#f5f7e9',rock:'#809ca3',rockHi:'#d1e2dc',reed:'#a69b83',sand:'#d2ddcc',ice:'#cce8e8',iceDark:'#87b5c5' },
};
function paletteFor(season, custom) {
  const palette = { ...PALETTES[season] };
  if (custom !== undefined && (custom === null || Array.isArray(custom) || typeof custom !== 'object')) throw new TypeError('Palette must be an object of named palette roles.');
  for (const [key, value] of Object.entries(custom ?? {})) {
    if (!Object.hasOwn(palette, key)) throw new RangeError(`Unknown palette role: ${key}`);
    if (typeof value !== 'string' || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) throw new TypeError(`Invalid palette color for ${key}`);
    palette[key] = value;
  }
  for (const key of Object.keys(palette)) palette[key] = (palette[key].length === 7 ? palette[key] + 'ff' : palette[key]).toLowerCase();
  return palette;
}
export function generateWaterScene(options = {}) {
  const scene = options.scene ?? 'pond', view = options.view ?? 'top-down', season = options.season ?? 'summer';
  if (!SCENES.includes(scene)) throw new RangeError('Unknown water scene.');
  if (!['top-down', 'isometric'].includes(view)) throw new RangeError('Unknown water view.');
  if (!Object.hasOwn(PALETTES, season)) throw new RangeError('Unknown season.');
  const width = integer(options.width, 64, 'Width', 8, 256), height = integer(options.height, width, 'Height', 8, 256);
  const frames = integer(options.frames, 12, 'Frames', 1, 32), durationMs = integer(options.durationMs, 125, 'Duration', 1, 65535);
  const details = integer(options.details, 2, 'Details', 0, 4), seed = integer(options.seed, 1, 'Seed', 0, 0xffffffff);
  const waterSeed = integer(options.waterSeed, seed, 'Water seed', 0, 0xffffffff);
  const offset = integer(options.phaseOffset, 0, 'Phase offset', -65535, 65535), phaseOffset = ((offset % frames) + frames) % frames;
  const rippleDensity = options.rippleDensity ?? .5;
  if (typeof rippleDensity !== 'number' || !Number.isFinite(rippleDensity) || rippleDensity < 0 || rippleDensity > 1) throw new RangeError('rippleDensity must be a number from 0 to 1');
  const flowDirection = options.flowDirection ?? { x: 1, y: 0 };
  if (!flowDirection || !Number.isFinite(flowDirection.x) || !Number.isFinite(flowDirection.y) || (flowDirection.x === 0 && flowDirection.y === 0)) throw new RangeError('flowDirection must be a nonzero {x,y} vector.');
  const foamRegions = Array.isArray(options.foamRegions) ? options.foamRegions.map(region => ({ x: integer(region.x, 0, 'foam region x', -65535, 65535), y: integer(region.y, 0, 'foam region y', -65535, 65535), width: integer(region.width, 1, 'foam region width', 1, 256), height: integer(region.height, 1, 'foam region height', 1, 256) })) : [];
  const pal = paletteFor(season, options.palette), count = width * height;
  const blank = () => Array(count).fill(null), bank = blank(), rocks = blank(), grass = blank();
  const depth = new Float64Array(count).fill(Infinity), plane = new Uint8Array(count);
  const shorePhase = noise(7, 11, seed) * TAU, waterPhase = noise(23, 3, waterSeed) * TAU;
  const shift = (noise(0, 5, seed) - .5) * .09;
  const center = v => .5 + shift + Math.sin(v * TAU + shorePhase) * .085 + Math.sin(v * TAU * 2 + shorePhase) * .02;
  function shore(u, v) {
    if (scene === 'pond') {
      const dx = (u - .5 - shift) / .34, dy = (v - .5) / .32, angle = Math.atan2(dy, dx);
      return (Math.hypot(dx, dy) - 1 - Math.sin(angle * 3 + shorePhase) * .07 - Math.cos(angle * 5 - shorePhase) * .035) * .28;
    }
    if (scene === 'shoreline') return .39 + Math.sin(u * TAU + shorePhase) * .045 + Math.cos(u * TAU * 2 - shorePhase) * .018 - v;
    if (scene === 'waterfall') {
      const channel = Math.abs(u - (.5 + shift)) - .095;
      const pool = (Math.hypot((u - .5 - shift) / .29, (v - .76) / .20) - 1) * .2;
      return Math.min(v < .65 ? channel : Infinity, pool);
    }
    return Math.abs(u - center(v)) - (scene === 'stream' ? .075 : .165) * (1 + Math.sin(v * TAU + shorePhase) * .12);
  }
  // The entire scene uses one projection, including the shoreline and decorations.
  const iso = view === 'isometric', rim = Math.max(1, Math.min(6, Math.floor(height / 14)));
  const span = Math.max(4, Math.floor(Math.min(width - 4, (height - rim - 4) * 2) / 4) * 4);
  const ox = Math.floor(width / 2), oy = Math.max(1, Math.floor((height - span / 2 - rim) / 2));
  const project = (u, v) => iso ? { x: Math.round(ox + (u - v) * span / 2), y: Math.round(oy + (u + v) * span / 4) } : { x: Math.floor(u * width), y: Math.floor(v * height) };
  const unproject = (x, y) => { const dx = (x - ox) / (span / 2), dy = (y - oy) / (span / 4); return { u: (dy + dx) / 2, v: (dy - dx) / 2 }; };
  const inPlane = (u, v) => u >= 0 && v >= 0 && u < 1 && v < 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, {u, v} = iso ? unproject(x + .5, y + .5) : { u: (x + .5) / width, v: (y + .5) / height };
    if (!inPlane(u, v)) {
      if (iso) for (let z = 1; z <= rim; z++) {
        const p = unproject(x + .5, y + .5 - z);
        if (inPlane(p.u, p.v)) { bank[i] = x < ox ? pal.bankDark : pal.soil; if (noise(x >> 1, y, seed) > .9) bank[i] = pal.bankDark; break; }
      }
      continue;
    }
    plane[i] = 1;
    const distance = shore(u, v); depth[i] = distance;
    if (distance <= 0) continue;
    const n = noise(Math.floor(u * 90), Math.floor(v * 90), seed);
    bank[i] = distance < .018 ? pal.bankDark : distance < (scene === 'shoreline' ? .19 : .038) ? pal.sand : pal.bank;
    if (distance > .04 && n > .965) bank[i] = pal.grass;
    if (scene === 'shoreline' && distance < .18 && n < .025) bank[i] = pal.soil;
  }
  function put(target, x, y, color) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < width && y < height) target[y * width + x] = color; }
  function line(target, ax, ay, bx, by, color) {
    ax = Math.round(ax); ay = Math.round(ay); bx = Math.round(bx); by = Math.round(by);
    const dx = Math.abs(bx - ax), sx = ax < bx ? 1 : -1, dy = -Math.abs(by - ay), sy = ay < by ? 1 : -1;
    let e = dx + dy;
    for (;;) { put(target, ax, ay, color); if (ax === bx && ay === by) break; const e2 = e * 2; if (e2 >= dy) { e += dy; ax += sx; } if (e2 <= dx) { e += dx; ay += sy; } }
  }
  function oval(target, cx, cy, rx, ry, color) {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) put(target, cx + x, cy + y, color);
  }
  // Land-only prop anchors keep the water silhouette and collision boundary stable.
  for (let j = 0; j < details * 18; j++) {
    const u = .04 + noise(j, 13, seed) * .92, v = .05 + noise(j, 31, seed) * .9, d = shore(u, v);
    if (d < .045) continue;
    const p = project(u, v), size = Math.max(1, Math.floor(Math.min(width, height) / 40));
    if (j % 4 === 0) {
      oval(rocks, p.x + 1, p.y + 1, size + 2, size, pal.bankDark);
      oval(rocks, p.x, p.y - 1, size + 1, size + 1, pal.rock);
      line(rocks, p.x - size, p.y - size - 1, p.x, p.y - size - 1, pal.rockHi);
      put(rocks, p.x + 1, p.y, pal.rockHi);
    } else {
      const blade = Math.min(5, size + 2);
      line(grass, p.x, p.y, p.x - 1, p.y - blade, pal.grass);
      line(grass, p.x, p.y, p.x + 2, p.y - blade + 1, d < .09 ? pal.reed : pal.bankDark);
      if (d < .1) put(grass, p.x - 1, p.y - blade, pal.reed);
    }
  }
  const cascade = project(.5 + shift, .42), fallWidth = Math.max(2, Math.round((iso ? span : width) * .12));
  const fallHeight = Math.max(3, Math.round(height * (iso ? .18 : .24)));
  if (scene === 'waterfall') {
    for (let y = cascade.y - fallHeight; y <= cascade.y; y++) for (let x = cascade.x - fallWidth - 3; x <= cascade.x + fallWidth + 3; x++) {
      put(bank, x, y, noise(x >> 2, y >> 2, seed) > .7 ? pal.rockHi : pal.rock);
    }
  }
  const images = {}, layerIds = ['banks', 'water', 'rocks', 'grass'];
  for (const [id, pixels] of Object.entries({ banks: bank, rocks, grass })) images[`${id}-image`] = { width, height, pixels };
  const outputFrames = [];
  for (let f = 0; f < frames; f++) {
    const phase = ((f + phaseOffset) % frames) / frames * TAU, water = blank();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, d = depth[i];
      if (!plane[i] || d > 0) continue;
      const wave = Math.sin(x * .14 + y * .31 + phase + waterPhase);
      water[i] = d > -.025 ? pal.waterLight : d < -.10 && noise(x >> 3, y >> 3, seed) < .35 ? pal.waterDeep : pal.water;
      // Short horizontal glints: density affects surface motion, never shoreline geometry.
      const gx = Math.floor(x / 7), gy = Math.floor(y / 5), n = noise(gx, gy, waterSeed);
      const row = ((Math.floor(n * 17) + Math.round(Math.sin(phase + n * TAU))) % 5 + 5) % 5;
      if (n < rippleDensity && y % 5 === row && x % 7 < 2 + Math.round((wave + 1) * 1.3)) water[i] = wave > -.3 ? pal.waterLight : pal.waterDeep;
      const inFoamRegion = foamRegions.some(region => x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height);
      if (rippleDensity > 0 && (inFoamRegion || d > -.012 - .012 * (1 + Math.sin(x * .17 + y * .3 + phase))) && Math.sin(x * .35 + y * .41 - phase) > .25) water[i] = pal.foam;
      if (scene === 'shoreline' && rippleDensity > 0 && d > -.07 && Math.abs(d + .025 + .018 * Math.sin(phase + x * .05)) < .009) water[i] = pal.foam;
      if (season === 'winter' && scene === 'pond' && d > -.10) {
        water[i] = ((x + Math.floor(y / 4) * 2 + seed) % 17 === 0 || (y - Math.floor(x / 5) + seed) % 19 === 0) ? pal.iceDark : pal.ice;
      }
    }
    if (scene === 'waterfall') {
      for (let yy = -fallHeight; yy <= 1; yy++) for (let xx = -fallWidth; xx <= fallWidth; xx++) {
        const stripe = Math.sin(yy * .7 - phase * 2 + xx * .4 + waterPhase);
        const c = Math.abs(xx) === fallWidth ? pal.waterDeep : stripe > .35 && rippleDensity > 0 ? pal.foam : xx % 3 === 0 ? pal.waterLight : pal.water;
        put(water, cascade.x + xx, cascade.y + yy, c);
      }
      if (rippleDensity > 0) line(water, cascade.x - fallWidth - 1, cascade.y + 1, cascade.x + fallWidth + 1, cascade.y + 1, Math.sin(phase) > 0 ? pal.foam : pal.waterLight);
    }
    const imageId = `water-image-${f + 1}`; images[imageId] = { width, height, pixels: water };
    outputFrames.push({ id: `frame-${f + 1}`, durationMs, cels: Object.fromEntries(layerIds.map(id => [id, { imageId: id === 'water' ? imageId : `${id}-image`, x: 0, y: 0, opacity: 1 }])) });
  }
  return {
    format:'pixelwall-document', version:4, id:options.id ?? 'water-scene', name:options.name ?? `${scene[0].toUpperCase() + scene.slice(1)} Water`, width,height,colorMode:'rgba',colorProfile:'sRGB',palette:[...new Set(Object.values(pal))],
    layers:layerIds.map(id=>({id,name:{banks:'Banks',water:'Water (animated)',rocks:'Rocks',grass:'Grass & Reeds'}[id],type:'image',parentId:null,visible:true,locked:false,opacity:1,blendMode:'normal'})),
    frames:outputFrames,images,clips:[{id:'water-loop',name:'Water Loop',frameIds:outputFrames.map(f=>f.id),direction:'forward',loop:true}],slices:[],tilesets:[],
    metadata:{generator:'water',generatorVersion:2,scene,view,season,seed,waterSeed,rippleDensity,phaseOffset,details,flowDirection,foamRegions,seamless:true,spatiallyTileable:false,paletteRoles:pal},
  };
}
export const WATER_SCENES = Object.freeze([...SCENES]);

/** Generate a bounded water patch for composition into a larger document. */
export function generateWaterPatch(options = {}) {
  const x = integer(options.originX, 0, 'originX', -65535, 65535), y = integer(options.originY, 0, 'originY', -65535, 65535);
  const patch = generateWaterScene({ ...options, width: Math.min(256, options.width ?? 64), height: Math.min(256, options.height ?? options.width ?? 64) });
  patch.metadata = { ...(patch.metadata ?? {}), generator: 'water-patch', globalOrigin: { x, y }, flowDirection: options.flowDirection ?? null, boundary: options.boundary ?? 'explicit' };
  return patch;
}

/** Composite only the named water layer from a patch; all other base pixels survive. */
export function composeWaterPatch(base, patch, { x = patch?.metadata?.globalOrigin?.x ?? 0, y = patch?.metadata?.globalOrigin?.y ?? 0, mask, layerId = 'water', phaseOffset = 0 } = {}) {
  if (!base?.images || !Array.isArray(base.frames) || !patch?.images || !Array.isArray(patch.frames)) throw new TypeError('Base and patch PixelWall documents are required.');
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new RangeError('Patch origin must be integer coordinates.');
  const result = structuredClone(base), patchFrames = patch.frames, baseFrames = result.frames;
  const patchLayer = patch.layers?.find(layer => layer.id === layerId) ?? patch.layers?.find(layer => /water/i.test(layer.name ?? ''));
  const targetLayer = result.layers?.find(layer => layer.id === layerId) ?? patchLayer;
  if (!patchLayer || !targetLayer) throw new Error(`Water layer ${layerId} was not found.`);
  if (!result.layers.some(layer => layer.id === targetLayer.id)) result.layers.push({ ...targetLayer, id: layerId, name: targetLayer.name ?? 'Water patch' });
  const targetId = result.layers.some(layer => layer.id === layerId) ? layerId : targetLayer.id;
  const width = patch.width, height = patch.height;
  const allowed = typeof mask === 'function' ? mask : (mask ? (px, py) => mask[py * width + px] !== false : () => true);
  for (let frameIndex = 0; frameIndex < baseFrames.length; frameIndex++) {
    const targetFrame = baseFrames[frameIndex]; const sourceFrame = patchFrames[(frameIndex + phaseOffset + patchFrames.length * 10) % patchFrames.length];
    const sourceCel = sourceFrame.cels?.[patchLayer.id]; if (!sourceCel) continue; const sourceImage = patch.images[sourceCel.imageId]; if (!sourceImage) continue;
    const existing = targetFrame.cels?.[targetId]; const pixels = result.images[existing?.imageId]?.pixels ? [...result.images[existing.imageId].pixels] : Array(result.width * result.height).fill(null);
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) { if (!allowed(px, py)) continue; const tx = x + px, ty = y + py; if (tx < 0 || ty < 0 || tx >= result.width || ty >= result.height) continue; const value = sourceImage.pixels[py * width + px]; if (value != null) pixels[ty * result.width + tx] = value; }
    const imageId = `${targetId}-patch-${frameIndex + 1}`; result.images[imageId] = { width: result.width, height: result.height, pixels }; targetFrame.cels = { ...(targetFrame.cels ?? {}), [targetId]: { imageId, x: 0, y: 0, opacity: 1 } };
  }
  result.metadata = { ...(result.metadata ?? {}), waterCompositions: [...(result.metadata?.waterCompositions ?? []), { source: patch.id, layerId: targetId, origin: { x, y }, phaseOffset, boundary: patch.metadata?.boundary ?? 'explicit' }] };
  return result;
}
