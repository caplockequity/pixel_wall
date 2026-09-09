import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readAseprite, readPng, writeAseprite, makeGamePackage } from '../app/formats.mjs';
import { unzipSync } from 'fflate';
import { normalizeDocument, renderFrame, applyCommand } from '../app/editor-core.mjs';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/tile-orientation-oracle.json', import.meta.url), 'utf8'));
const visible = pixels => Uint8Array.from(pixels, (value, index) => index % 4 < 3 && !pixels[index - index % 4 + 3] ? 0 : value);
for (const item of oracle.cases) test(`native rectangular tile orientation ${item.flag}: import, edit and reopen`, () => {
 const source = Buffer.from(item.aseprite, 'base64'), png = Buffer.from(item.png, 'base64');
 for (const [kind, bytes] of [['aseprite', source], ['png', png]]) assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256[kind]);
 const expected = readPng(png), imported = normalizeDocument(readAseprite(source).document);
 assert.equal(imported.width, expected.width); assert.equal(imported.height, expected.height);
 assert.deepEqual(visible(renderFrame(imported)), visible(expected.rgba));
 const layer = imported.layers.find(layer => layer.type === 'tilemap');
 // Enter the editable representation without replacing any of the original cells.
 const edited = applyCommand(imported, { type: 'tilemap.paint', layerId: layer.id, points: [] });
 assert.ok(edited.layers.find(candidate => candidate.id === layer.id).tilemaps);
 assert.deepEqual(visible(renderFrame(edited)), visible(expected.rgba));
 const reopened = normalizeDocument(readAseprite(writeAseprite(edited)).document);
 assert.deepEqual(visible(renderFrame(reopened)), visible(expected.rgba));
 // Interpret the exported Tiled flags independently and compare with native PNG.
 for (const document of [imported, edited]) {
  const files = unzipSync(makeGamePackage(document)), json = name => JSON.parse(new TextDecoder().decode(files[name]));
  const map = json(json('manifest.json').maps[0].source), result = new Uint8Array(expected.rgba.length);
  for (const layer of map.layers) for (let index = 0; index < layer.data.length; index++) {
   const value = layer.data[index] >>> 0, gid = value & 0x0fffffff;
   if (!gid) continue;
   const set = [...map.tilesets].reverse().find(set => set.firstgid <= gid), path = set.source.replace(/^\.\.\//, '');
   const tile = json(path).tiles.find(tile => tile.id === gid - set.firstgid);
   const image = readPng(files[path.slice(0,path.lastIndexOf('/')+1) + tile.image]);
   for (let y = 0; y < map.tileheight; y++) for (let x = 0; x < map.tilewidth; x++) {
    let u = value & 0x80000000 ? map.tilewidth - 1 - x : x, v = value & 0x40000000 ? map.tileheight - 1 - y : y;
    if (value & 0x20000000) [u,v] = [v,u];
    const dx = index % map.width * map.tilewidth + layer.offsetx + x, dy = Math.floor(index / map.width) * map.tileheight + layer.offsety + y;
    if (u >= image.width || v >= image.height || dx < 0 || dy < 0 || dx >= expected.width || dy >= expected.height) continue;
    result.set(image.rgba.subarray((v * image.width + u) * 4, (v * image.width + u + 1) * 4), (dy * expected.width + dx) * 4);
   }
  }
  assert.deepEqual(visible(result), visible(expected.rgba));
 }
});
