import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAseprite } from '../app/formats.mjs';
import { normalizeDocument } from '../app/editor-core.mjs';
import { createDocumentPlayback } from '../app/frame-traversal.mjs';

const source = readFileSync(new URL('../app/workbench.jsx',import.meta.url),'utf8');
const start = source.indexOf('  useEffect(() => {\n    if (!playing || !doc) return;');
assert(start > 0);
const code = source.slice(start,source.indexOf('  useEffect(',start+10));
const folder = new URL('./fixtures/tag-traversal/',import.meta.url);
function preview(name, options = {}) {
 const doc = normalizeDocument(readAseprite(readFileSync(new URL(`${name}.aseprite`,folder))).document);
 const clip = doc.clips.find(clip => clip.name === 'clip') ?? doc.clips[0];
 if (options.repeat !== undefined) clip.repeat = options.repeat;
 clip.loop = options.loop ?? false;
 const timers = new Map(), frames = [], errors = [], playing = [], delays = []; let serial = 0, cleanup;
 const deps = {doc, selectedClip:clip, playing:true, activeRef:{current:{frameId:doc.frames.at(-1).id}}, createDocumentPlayback,
  useEffect:fn => {cleanup=fn();}, setActiveFrame:id => frames.push(doc.frames.findIndex(frame => frame.id===id)),
  setPlaying:value=>playing.push(value), report:error=>errors.push(error),
  setTimeout:(fn,delay)=>{timers.set(++serial,fn);delays.push(delay);return serial;}, clearTimeout:id=>timers.delete(id)};
 Function(...Object.keys(deps),code)(...Object.values(deps));
 return {doc,frames,errors,playing,delays,cleanup:()=>cleanup(),timers,step(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
}
test('actual preview schedules native ping-pong legs with each source duration then stops', () => {
 const p = preview('pingpong-3');
 for(let i=0;p.timers.size && i<20;i++)p.step();
 assert.deepEqual(p.frames,[1,2,3,2,1,2,3,3]);
 assert.deepEqual(p.delays,[0,70,80,90,80,70,80,90]);
 assert.deepEqual(p.playing,[false]);assert.equal(p.errors.length,0);
});
test('looping preview cleanup cancels its next frame and stops the cursor', () => {
 const p=preview('reverse-0',{loop:true});for(let i=0;i<12;i++)p.step();
 assert.equal(p.playing.length,0);assert.equal(p.timers.size,1);p.cleanup();assert.equal(p.timers.size,0);
});
test('excessive finite repeats report an error and stop without a hung timer', () => {
 const p=preview('forward-3',{repeat:65535});p.step();
 assert.equal(p.errors.length,1);assert.match(p.errors[0].message,/maximum output frame count/);
 assert.deepEqual(p.playing,[false]);assert.equal(p.timers.size,0);assert.equal(p.frames.length,0);
});
