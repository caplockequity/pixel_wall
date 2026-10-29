import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyCommand, createDocument, renderFrame } from '../app/editor-core.mjs';
import { pixelsToRgba, readPng } from '../app/formats.mjs';
import { decodeProjectContainer } from '../desktop/project-container.mjs';
import { makeDemoPixels } from '../app/demo-art.mjs';
import { parseProjectBytes } from '../app/project-format.mjs';

const projectRoot = new URL('../', import.meta.url);
const bytes = async path => new Uint8Array(await readFile(new URL(path, projectRoot)));
const json = async path => JSON.parse(await readFile(new URL(path, projectRoot), 'utf8'));
const rgbaFor = pixels => pixelsToRgba(pixels);
const sameBytes = (actual, expected) => assert.deepEqual(Array.from(actual), Array.from(expected));
const imagePixels = (document, frame) => {
  const cel = frame.cels[document.layers[0].id];
  return document.images[cel.imageId].pixels;
};

function replay(commands, width, height, name, durationMs = 125) {
  return commands.reduce((document, command) => applyCommand(document, command), createDocument({ width, height, name, durationMs }));
}

test('Desert Signal PixelWall commands, published project, PNGs, and homepage frames agree', async () => {
  const commands = await json('public/examples/desert-signal-commands.json');
  assert.equal(commands.length, 122);
  const rendered = replay(commands, 16, 16, 'DESERT SIGNAL');
  assert.deepEqual(rendered.frames.map(frame => frame.durationMs), [125, 125, 125]);
  const portable = parseProjectBytes(await bytes('public/examples/desert-signal.pixelwall')).project;
  assert.equal(portable.size, 16);
  assert.deepEqual(portable.frames.map(frame => frame.durationMs), [125, 125, 125]);
  for (let index = 0; index < 3; index++) {
    const expected = makeDemoPixels(16, index * .45);
    assert.deepEqual(portable.frames[index].cels[0].pixels, expected);
    sameBytes(renderFrame(rendered, rendered.frames[index].id), rgbaFor(expected));
    const png = readPng(await bytes(`public/examples/desert-signal-00${index + 1}.png`));
    assert.deepEqual(png.rgba, rgbaFor(expected));
    assert.equal(png.width, 16); assert.equal(png.height, 16);
  }
});

test('Ninja Panda commands replay to the published native project and preview PNG', async () => {
  const commands = await json('public/examples/agent-ninja-panda-commands.json');
  assert.equal(commands.length, 153);
  const rendered = replay(commands, 24, 24, 'Ninja Panda Idle', 180);
  assert.deepEqual(rendered.frames.map(frame => frame.durationMs), [180, 180, 180]);
  assert.deepEqual(rendered.clips[0].frameIds, ['frame-1', 'idle-2', 'idle-3']);

  const published = decodeProjectContainer(await bytes('public/examples/agent-ninja-panda.pixelwall'));
  assert.equal(published.width, 24); assert.equal(published.height, 24);
  assert.deepEqual(published.frames.map(frame => frame.durationMs), [180, 180, 180]);
  for (let index = 0; index < 3; index++) {
    sameBytes(renderFrame(rendered, rendered.frames[index].id), pixelsToRgba(imagePixels(published, published.frames[index])));
  }
  const png = readPng(await bytes('public/examples/agent-ninja-panda.png'));
  sameBytes(png.rgba, renderFrame(rendered, 'frame-1'));
  assert.equal(png.width, 24); assert.equal(png.height, 24);
  assert.ok(renderFrame(rendered, 'frame-1').some((value, index) => index % 4 === 3 && value === 255));
});
