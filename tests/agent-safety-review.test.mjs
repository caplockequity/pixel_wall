import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomation } from '../app/editor-automation.mjs';
import { createDocument, applyCommand, describeDocument } from '../app/editor-core.mjs';
import { preflightCommands } from '../app/command-preflight.mjs';

function hostFixture({ apply = async () => {}, document = createDocument({ width: 8, height: 8 }) } = {}) {
  let doc = document, revision = 0;
  return {
    host: {
      revision: () => revision, inspect: () => describeDocument(doc), commands: () => [], apply,
      desktopState: () => ({ loaded: true, id: doc.id, busy: false, canSave: true, revision }),
      desktopAction: async () => ({}), save: async () => ({ revision, document: { id: doc.id } }),
      newDocument: async () => {}, undo: async () => {}, redo: async () => {}, preview: async () => new Uint8Array(),
      export: async () => ({}), colorProfile: async () => ({}), runLua: async () => ({}),
      projects: () => [], openProject: async () => {}, importProject: async () => {},
      artifacts: () => [], artifact: () => null, readArtifact: () => null, removeArtifact: () => {}, downloadArtifact: () => {},
    }, setDocument(next) { doc = next; revision++; }, document: () => doc, revision: () => revision,
  };
}

test('preflight applies against immutable scratch and leaves the source byte-identical', async () => {
  const source = createDocument({ width: 8, height: 8 }), before = structuredClone(source);
  const result = await preflightCommands(source, [{ type: 'draw.stroke', points: [{ x: 2, y: 2 }], color: '#ff0000ff' }], { yieldControl: async () => {} });
  assert.equal(result.valid, true);
  assert.deepEqual(source, before);
  assert.equal(result.changedImageIds.length, 1);
});

test('preflight reports layers affected by cel positioning and removal', async () => {
  const source = applyCommand(createDocument({ width: 8, height: 8 }), { type: 'draw.stroke', points: [{ x: 2, y: 2 }], color: '#ff0000ff' });
  const layerId = source.layers[0].id;
  for (const command of [{ type: 'cel.move', layerId, x: 3 }, { type: 'cel.clear', layerId }]) {
    const result = await preflightCommands(source, [command], { yieldControl: async () => {} });
    assert.equal(result.valid, true);
    assert.deepEqual(result.affectedLayerIds, [layerId]);
  }
});

test('identical concurrent request keys share one operation and mismatched payloads are rejected', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const fixture = hostFixture({ apply: async () => gate });
  const api = createAutomation(fixture.host), commands = [{ type: 'document.update', patch: { name: 'one' } }];
  const first = await api.apply({ commands, requestKey: 'same', wait: false });
  const [retry, retryAgain] = await Promise.all([
    api.apply({ commands: structuredClone(commands), requestKey: 'same', wait: false }),
    api.apply({ commands: structuredClone(commands), requestKey: 'same', wait: false }),
  ]);
  assert.equal(retry.operationId, first.operationId); assert.equal(retryAgain.operationId, first.operationId);
  await assert.rejects(api.apply({ commands: [{ type: 'document.update', patch: { name: 'two' } }], requestKey: 'same', wait: false }), /different edit/);
  release();
  for (;;) { const status = api.operation(first.operationId); if (status.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 0)); }
});

test('cancelled automation reports cancellation without committing a revision', async () => {
  let observedSignal, release; const wait = new Promise(resolve => { release = resolve; });
  const fixture = hostFixture({ apply: async (_commands, _label, { signal }) => { observedSignal = signal; await wait; if (signal.aborted) { const error = Error('cancelled'); error.name = 'AbortError'; throw error; } } });
  const api = createAutomation(fixture.host), pending = await api.apply({ commands: [{ type: 'draw.stroke', points: [{ x: 1, y: 1 }], color: '#fff' }], wait: false });
  while (!observedSignal) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(api.cancel(pending.operationId).cancellationRequested, true); release();
  for (;;) { const status = api.operation(pending.operationId); if (status.status !== 'running') { assert.equal(status.status, 'cancelled'); break; } await new Promise(resolve => setTimeout(resolve, 0)); }
  assert.equal(fixture.revision(), 0);
});

test('expired request keys refuse replay after bounded operation retention', async () => {
  const fixture = hostFixture({ apply: async (commands) => { let next = fixture.document(); for (const command of commands) next = applyCommand(next, command); fixture.setDocument(next); } });
  const api = createAutomation(fixture.host);
  for (let index = 0; index < 65; index++) await api.apply({ requestKey: `retained-${index}`, commands: [{ type: 'document.update', patch: { name: `Project ${index}` } }] });
  await assert.rejects(api.apply({ requestKey: 'retained-0', commands: [{ type: 'document.update', patch: { name: 'Project 0' } }] }), /result has expired/);
});
