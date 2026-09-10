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
  for (const name of ['standaloneMcpServer', 'publicRestEditingApi', 'javascriptSdk', 'pythonSdk', 'universalAgentProtocol']) assert.equal(statement.interfaces[name].available, false);
});
