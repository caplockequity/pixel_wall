import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCommand, createDocument, renderFrame } from '../app/editor-core.mjs';

test('published agent command batch creates the documented three-frame ninja-panda animation', async () => {
  const commands = JSON.parse(await readFile(new URL('../public/examples/agent-ninja-panda-commands.json', import.meta.url), 'utf8'));
  let document = createDocument({ name: 'Ninja Panda Idle', width: 24, height: 24 });
  for (const command of commands) document = applyCommand(document, command);
  assert.equal(commands.length, 63);
  assert.deepEqual(document.frames.map(frame => frame.id), ['frame-1', 'idle-2', 'idle-3']);
  assert.deepEqual(document.clips[0].frameIds, ['frame-1', 'idle-2', 'idle-3']);
  assert.equal(document.clips[0].direction, 'pingpong');
  assert.ok(document.frames.every(frame => frame.cels['layer-1']));
  const frames = document.frames.map(frame => renderFrame(document, frame.id));
  assert.ok(frames.every(pixels => pixels.some((value, index) => index % 4 === 3 && value === 255)));
  assert.notDeepEqual(frames[0], frames[1]);
  assert.notDeepEqual(frames[1], frames[2]);
});

test('machine-readable agent statement accurately distinguishes available interfaces', async () => {
  const statement = JSON.parse(await readFile(new URL('../public/agent-integration.json', import.meta.url), 'utf8'));
  assert.equal(statement.interfaces.cli.available, true);
  assert.equal(statement.interfaces.browserCommandApi.global, 'window.pixelwall');
  assert.equal(statement.interfaces.lua.sandboxed, true);
  assert.equal(statement.interfaces.localMcp.available, true);
  assert.equal(statement.interfaces.localMcp.remoteAccess, false);
  assert.equal(statement.interfaces.localMcp.artifactLimits.maxReadChunkBytes, 1048576);
  for (const name of ['standaloneMcpServer', 'publicRestEditingApi', 'javascriptSdk', 'pythonSdk', 'universalAgentProtocol']) assert.equal(statement.interfaces[name].available, false);
});

test('scene component examples and review guides are published with the MCP capability statement', async () => {
  const statement = JSON.parse(await readFile(new URL('../public/agent-integration.json', import.meta.url), 'utf8'));
  const documents = JSON.parse(await readFile(new URL('../app/public-content.json', import.meta.url), 'utf8'));
  for (const slug of ['guides/desktop-mcp', 'guides/scene-components', 'guides/review-artifacts']) assert.ok(documents.some((page) => page.slug === slug));
  for (const key of ['sceneComponentsCommands', 'sceneComponentsProject', 'sceneComponentsPreview']) {
    const url = new URL(statement.examples[key]);
    assert.match(url.pathname, /^\/examples\/scene-components-/);
    await readFile(new URL(`../public${url.pathname}`, import.meta.url));
  }
});

test('isometric water guide is discoverable as an agent example', async () => {
  const statement = JSON.parse(await readFile(new URL('../public/agent-integration.json', import.meta.url), 'utf8'));
  const documents = JSON.parse(await readFile(new URL('../app/public-content.json', import.meta.url), 'utf8'));
  const guide = documents.find((page) => page.slug === 'guides/isometric-water');
  assert.ok(guide);
  assert.match(guide.description, /scene\.water/);
  assert.ok(guide.sections.some((section) => section.code?.includes('type: "scene.water"')));
  assert.equal(statement.sceneWaterGuide, 'https://www.pixelwall.dev/guides/isometric-water');
  assert.equal(statement.examples.isometricWaterCommands, 'https://www.pixelwall.dev/examples/isometric-water.json');
  assert.equal(statement.isometricPixelArtGuide, 'https://www.pixelwall.dev/guides/isometric-pixel-art');
  assert.equal(statement.examples.isometricShapeCommands, 'https://www.pixelwall.dev/examples/isometric-shapes.json');
  const batch = JSON.parse(await readFile(new URL('../public/examples/isometric-water.json', import.meta.url), 'utf8'));
  assert.equal(batch.length, 1);
  assert.equal(batch[0].type, 'scene.water');
});

test('isometric shape command example is a readable batch', async () => {
  const batch = JSON.parse(await readFile(new URL('../public/examples/isometric-shapes.json', import.meta.url), 'utf8'));
  assert.equal(batch.length, 6);
  assert.deepEqual(batch.map((command) => command.shape), ['tile', 'tile', 'tile', 'block', 'block', 'ramp']);
  assert.ok(batch.every((command) => command.type === 'draw.isometric' && command.width % 4 === 0));
});

test('isometric shape command batch replays through the document engine', async () => {
  const batch = JSON.parse(await readFile(new URL('../public/examples/isometric-shapes.json', import.meta.url), 'utf8'));
  const source = createDocument({ id: 'shape-test', width: 128, height: 96 });
  const result = batch.reduce((document, command) => applyCommand(document, command), source);
  assert.equal(result.id, 'shape-test');
  assert.equal(result.frames.length, 1);
  const pixels = result.images[result.frames[0].cels['layer-1'].imageId].pixels;
  assert.ok(pixels.some(Boolean));
  assert.ok(new Set(pixels.filter(Boolean)).size >= 4);
});

test('isometric water command batch replays through the document engine', async () => {
  const batch = JSON.parse(await readFile(new URL('../public/examples/isometric-water.json', import.meta.url), 'utf8'));
  const source = createDocument({ id: 'water-test', width: 64, height: 48 });
  const result = batch.reduce((document, command) => applyCommand(document, command), source);
  assert.equal(result.id, 'water-test');
  assert.equal(result.frames.length, 12);
  assert.equal(result.frames[0].durationMs, 125);
  assert.ok(result.layers.some((layer) => layer.name.includes('Water')));
});
