import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strToU8, unzipSync } from 'fflate';
import * as formats from '../app/formats.mjs';
import { normalizeDocument, createDocument, renderFrame } from '../app/editor-core.mjs';
import { exportFrameTraversal } from '../app/frame-traversal.mjs';
import { renderScaledExportFrame } from '../app/export-render.mjs';
import { validateExportScale, scaleExportSlices } from '../app/export-scale.mjs';
import { documentProfile, isSRGB } from '../app/color-management.mjs';
import { loadNodeColorManager } from '../app/color-runtime-node.mjs';

// Execute the actual host export functions with only external UI services replaced.
const source = readFileSync(new URL('../app/workbench.jsx', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = extract('  function exportFrameIds(', '  async function exportArtwork(') + extract('  async function generateArtwork(', '  async function doExport(');
const folder = new URL('./fixtures/export-scale/', import.meta.url);
const load = name => readFileSync(new URL(name, folder));
const manager = await loadNodeColorManager();
test.after(() => manager.close());
const visible = pixels => Uint8Array.from(pixels, (v, i) => i % 4 < 3 && !pixels[i - i % 4 + 3] ? 0 : v);
function same(actual, expected) {
 assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
 assert.deepEqual(visible(actual.rgba), visible(expected.rgba));
}
function host(doc, requestAccess = async () => true) {
 const files = [], docRef = {current:doc};
 const deps = {...formats, strToU8, renderScaledExportFrame, validateExportScale, scaleExportSlices, exportFrameTraversal, documentProfile, isSRGB,
  colorManager:manager, loadBrowserColorManager:async () => manager, renderingIntent:1,
  docRef, activeRef:{current:{frameId:doc.frames[0].id,layerId:doc.layers[0].id}}, clipId:'',
  targetLayers:() => [doc.layers[0].id], PAID_FORMATS:new Set(['gif','sheet','zip']), access:{requestAccess},
  stem:() => 'fixture', deferred:async () => {}, downloads:{downloadFiles:items => files.push(...items)}, setNotice:() => {}};
 const run = Function(...Object.keys(deps), `${code}\nreturn generateArtwork;`)(...Object.values(deps));
 return {run, files, docRef};
}
for (const [fixture, scale] of [['geometry',0.67],['linked-indexed',1.5],['linked-grayscale',0.5],['linear',2.2],['flag-7',1.5]]) {
 for (const format of ['png','bmp','tga','sheet','zip']) test(`Workbench ${format}: native ${fixture} at ${scale}`, async () => {
  const doc = normalizeDocument(formats.readAseprite(load(fixture === 'linear' ? '../export-color/source.aseprite' : `${fixture}.aseprite`)).document), before = structuredClone(doc), h = host(doc);
  await h.run({format,scale,trim:false,padding:0,extrude:0,layout:'horizontal'});
  const bytes = new Uint8Array(await h.files[0].blob.arrayBuffer()), expected = formats.readPng(load(`${fixture}-${scale}-1.png`));
  let actual;
  if (format === 'zip' || format === 'sheet') {
   const archive = format === 'zip' ? unzipSync(bytes) : null;
   const image = formats.readPng(archive ? archive['sprites.png'] : bytes);
   const metadata = JSON.parse(archive ? new TextDecoder().decode(archive['sprites.json']) : await h.files[1].blob.text());
   const rect = metadata.frames[0].frame, rgba = new Uint8Array(rect.w * rect.h * 4);
   for (let y = 0; y < rect.h; y++) rgba.set(image.rgba.subarray(((rect.y + y) * image.width + rect.x) * 4, ((rect.y + y) * image.width + rect.x + rect.w) * 4), y * rect.w * 4);
   actual = {width:rect.w,height:rect.h,rgba};
   assert.equal(metadata.meta.scale, String(scale));
   assert.deepEqual(metadata.meta.sourceSlices, doc.slices);
   if (archive) assert.deepEqual(JSON.parse(new TextDecoder().decode(archive[Object.keys(archive).find(name => name.endsWith('.pixelwall'))])), before);
  } else actual = (format === 'png' ? formats.readPng : format === 'bmp' ? formats.readBmp : formats.readTga)(bytes);
  same(actual, expected); assert.deepEqual(doc, before);
 });
}
test('Workbench keeps native projects intact and checks invalid scales and Pro before download', async () => {
 const doc = normalizeDocument(formats.readAseprite(load('linked-indexed.aseprite')).document), h = host(doc, async () => false);
 for (const scale of [0,-1,NaN,65,'']) await assert.rejects(h.run({format:'png',scale}), /Scale/);
 await assert.rejects(h.run({format:'gif',scale:0.5}), {name:'ProExportRequired'});
 assert.equal(h.files.length, 0);
 await h.run({format:'project',scale:0.5,layers:'active'});
 assert.deepEqual(JSON.parse(await h.files[0].blob.text()), doc);
});
test('Workbench captures animation before an asynchronous Pro decision', async () => {
 const doc = normalizeDocument(formats.readAseprite(load('linked-indexed.aseprite')).document);
 let h; h = host(doc, async () => { h.docRef.current = createDocument({width:2,height:2}); return true; });
 await h.run({format:'gif',scale:0.5});
 const gif = formats.importGif(new Uint8Array(await h.files[0].blob.arrayBuffer())).document;
 assert.equal(gif.frames.length, doc.frames.length);
 assert.equal(gif.width, Math.max(1,Math.trunc(doc.width * 0.5)));
});

const tagFolder = new URL('./fixtures/tag-traversal/', import.meta.url);
const tagVectors = JSON.parse(readFileSync(new URL('cli-vectors.json', tagFolder), 'utf8')).filter(vector => vector.subtags && vector.tag && vector.format === 'gif');
for (const vector of tagVectors) test(`Workbench animated export matches native ${vector.direction} repeat ${vector.repeat}`, async () => {
 const doc = normalizeDocument(formats.readAseprite(readFileSync(new URL(`${vector.direction}-${vector.repeat}.aseprite`,tagFolder))).document);
 const clip = doc.clips.find(clip => clip.name === 'clip'), h = host(doc);
 await h.run({format:'gif',scale:1,clipId:clip.id});
 const result = normalizeDocument(formats.importGif(new Uint8Array(await h.files[0].blob.arrayBuffer())).document);
 assert.deepEqual(result.frames.map(frame => frame.durationMs), vector.frames.map(frame => frame.ms));
 assert.deepEqual(result.frames.map(frame => [...renderFrame(result,frame.id)]), vector.frames.map(frame => [...renderFrame(doc,doc.frames[frame.frame].id)]));
});

test('native project output bypasses finite repeat expansion', async () => {
 const doc = normalizeDocument(formats.readAseprite(readFileSync(new URL('forward-3.aseprite',tagFolder))).document);
 doc.clips[0].repeat = 65535;
 const h = host(doc); await h.run({format:'project',clipId:doc.clips[0].id});
 assert.deepEqual(JSON.parse(await h.files[0].blob.text()), doc);
 await assert.rejects(h.run({format:'gif',clipId:doc.clips[0].id}), /maximum output frame count/);
});
