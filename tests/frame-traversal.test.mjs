import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRuntimes, RUNTIME_FILES } from '../scripts/prepare-runtimes.mjs';
import { createFramePlayback, collectPlaybackFrames, documentPlaybackTags, exportFrameTraversal, createDocumentPlayback } from '../app/frame-traversal.mjs';
import { readAseprite, importGif } from '../app/formats.mjs';
import { normalizeDocument, renderFrame } from '../app/editor-core.mjs';
import { planExport } from '../app/cli-export-plan.mjs';
import { buildCliExportOutputs } from '../app/cli.mjs';
import { parseCliArguments } from '../app/cli-arguments.mjs';
const folder = new URL('./fixtures/tag-traversal/', import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, folder)));
const readDoc = name => normalizeDocument(readAseprite(readFileSync(new URL(`${name}.aseprite`, folder))).document);
const cases = json('playback-vectors.json');
for (const vector of cases) test(`native Playback: ${vector.name}`, () => {
  const playback = createFramePlayback(vector.options);
  const actual = Array.from({ length: vector.steps }, (_, i) => i ? playback.next(vector.delta) : playback.snapshot());
  assert.deepEqual(actual, vector.expected);
});
const exports = [...json('cli-vectors.json'), ...json('cli-more-vectors.json').filter(c => c.format !== 'sheet'), ...json('cli-scope-vectors.json'), ...json('cli-bitmap-vectors.json')];
for (const [index, vector] of exports.entries()) test(`native exported traversal ${index}: ${vector.fixture ?? vector.direction} ${vector.format} sub=${vector.subtags} tag=${vector.tag}`, () => {
  const document = readDoc(vector.fixture ?? `${vector.direction}-${vector.repeat}`);
  const name = vector.tag === true ? 'clip' : vector.tag;
  const clip = name ? document.clips.find(clip => clip.name === name) : null;
  const mode = vector.format === 'gif' ? 'animation' : vector.format === 'sheet' ? 'atlas' : 'sequence';
  const options = { mode, ...(name ? { tag: name } : {}), playSubtags: vector.subtags, ...(vector.range ? { frameRange: vector.range } : {}) };
  const source = [{ document, filename: 'input.aseprite' }];
  if (vector.subtags && !vector.range && mode !== 'atlas' && clip && ['nested', 'nested-contained'].includes(vector.fixture) && name !== 'clip') {
    assert.throws(() => planExport(source, options), /crossing the selected tag boundary/);
    return;
  }
  const before = structuredClone(document), plan = planExport(source, options);
  assert.deepEqual(plan.entries.map(entry => entry.frameIndex), vector.frames.map(frame => frame.frame));
  if (vector.format === 'gif') assert.deepEqual(plan.entries.map(entry => entry.durationMs), vector.frames.map(frame => frame.ms));
  assert.deepEqual(document, before);
});

test('a selected tag loops indefinitely while nested repeats retain native counts', () => {
  const document = readDoc('nested-contained'), clip = document.clips.find(clip => clip.name === 'clip');
  const playback = createDocumentPlayback(document, { clip, initialFrameId: clip.frameIds[0], loop: true });
  const expected = createFramePlayback({ frameCount: document.frames.length, tags: documentPlaybackTags(document), activeTagId: clip.id, initialFrame: 1, mode: 'loop' });
  for (let i = 0; i < 120; ++i) {
    const a = i ? playback.next() : playback.snapshot(), b = i ? expected.next() : expected.snapshot();
    assert.equal(a.frame, b.frame); assert.equal(a.stopped, false); assert.equal(a.frameId, document.frames[b.frame].id);
  }
});
test('finite UI preview honors repeats and contained tags; clip.loop and GIF container looping are separate', () => {
  const document = readDoc('pingpong-3'), clip = document.clips[0];
  const playback = createDocumentPlayback(document, { clip, loop: false });
  const actual = [];
  for (let state = playback.snapshot(); !state.stopped; state = playback.next()) actual.push(state.frame);
  assert.deepEqual(actual, [1, 2, 3, 2, 1, 2, 3]);
  const built = buildCliExportOutputs([{ document, filename: 'p.aseprite' }], { format: 'gif', tag: clip.id, 'play-subtags': true, loop: 0 });
  assert.equal(importGif(built.outputs[0].data).document.metadata.gif.loopCount, 0);
});
test('legacy discontiguous clips keep explicit order, direction, ping-pong endpoints and finite stop', () => {
  const document = readDoc('forward-0');
  const clip = { id: 'legacy', name: 'legacy', frameIds: [document.frames[3].id, document.frames[0].id, document.frames[2].id], direction: 'pingpong_reverse', loop: false };
  document.clips = [clip];
  assert.deepEqual(exportFrameTraversal(document, { clip, playSubtags: true }), [2, 0, 3, 0]);
  assert.deepEqual(planExport([{ document, filename: 'legacy.pixelwall' }], { mode: 'animation', tag: 'legacy' }).entries.map(entry => entry.frameIndex), [2, 0, 3, 0]);
  const playback = createDocumentPlayback(document, { clip }), actual = [];
  for (let state = playback.snapshot(); !state.stopped; state = playback.next()) actual.push(state.frame);
  assert.deepEqual(actual, [2, 0, 3, 0]);
});
test('one-frame repeat timing survives GIF encoding', () => {
  const document = readDoc('one-pingpong');
  const built = buildCliExportOutputs([{ document, filename: 'one.aseprite' }], { format: 'gif', tag: 'clip', 'play-subtags': true });
  const decoded = importGif(built.outputs[0].data).document;
  assert.equal(decoded.frames.reduce((total, frame) => total + frame.durationMs, 0), 300);
  for (const frame of decoded.frames) assert.equal(renderFrame(decoded, frame.id)[0], 120);
});
test('ordered --play-subtags snapshots per-input state and accepts explicit false', () => {
  const parsed = parseCliArguments(['export', '--ordered-inputs', '--play-subtags', 'first.aseprite', '--play-subtags=false', 'second.aseprite', '--format', 'gif']);
  assert.equal(parsed.inputs[0].options['play-subtags'], true); assert.equal(parsed.inputs[1].options['play-subtags'], false);
  assert.equal(parsed.args['play-subtags'], undefined);
});
test('bounds prevent excessive repeats, steps, tags and invalid tag ranges without mutating inputs', () => {
  const options = { frameCount: 3, mode: 'all', tags: [{ id: 'a', from: 0, to: 2, repeat: 65535 }] }, before = structuredClone(options);
  assert.throws(() => collectPlaybackFrames(options, { maxFrames: 20 }), /maximum output frame count/);
  assert.deepEqual(options, before);
  assert.throws(() => createFramePlayback({ ...options, frameCount: 0 }), /Frame count/);
  assert.throws(() => createFramePlayback({ ...options, tags: [{ from: 2, to: 1 }] }), /Tag last frame/);
  assert.throws(() => createFramePlayback({ ...options, tags: Array.from({ length: 1025 }, (_, id) => ({ id, from: 0, to: 0 })) }), /at most/);
  assert.throws(() => createFramePlayback(options).next(Infinity), /Playback step/);
  assert.throws(() => collectPlaybackFrames({ ...options, mode: 'loop' }), /Finite collection/);
  assert.throws(() => exportFrameTraversal(readDoc('forward-3'), { playSubtags: true, maxFrames: 4 }), /maximum output/);
});
test('snapshots cannot alter state; stop and zero step are stable', () => {
  const p = createFramePlayback({ frameCount: 3, mode: 'loop' }); p.snapshot().frame = 2;
  assert.equal(p.next(0).frame, 0); p.next(); const stopped = p.stop();
  assert.equal(stopped.frame, 1); assert.deepEqual(p.next(), stopped);
});

 test('playback attribution is distributed with every runtime build', async t => {
  const target = await mkdtemp(join(tmpdir(), 'pixelwall-playback-runtime-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  await prepareRuntimes(target);
  assert(RUNTIME_FILES.includes('playback-NOTICES.txt'));
  assert.equal(await readFile(join(target, 'playback-NOTICES.txt'), 'utf8'), await readFile(new URL('../docs/playback-NOTICES.txt', import.meta.url), 'utf8'));
  const provenance = JSON.parse(await readFile(join(target, 'provenance.json'), 'utf8'));
  assert.equal(provenance.playback.license, 'MIT');
});
