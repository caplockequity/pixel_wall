import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeProjectContainer, encodeProjectContainer } from '../app/project-format.mjs';
import { applyCommand, describeDocument, normalizeDocument, renderFrame, COMMANDS } from '../app/editor-core.mjs';
import { createHistory } from '../app/history.mjs';
import { readPng } from '../app/formats.mjs';
import { createAutomation } from '../app/editor-automation.mjs';
import { createMcpBridge } from '../desktop/mcp-bridge.mjs';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const fixture = join(root, 'public/examples/reliable-workflow/build/reliable-riverbank.pixelwall');
const line = (x = 2) => ({ type: 'draw.line', from: { x, y: 2 }, to: { x: x + 2, y: 4 }, color: '#ff00ffff', size: 1 });

function createRendererAdapter(api) {
  return {
    async executeJavaScript(source) {
      const method = [...source.matchAll(/api\["([^"\\]+)"\]/g)].at(-1)?.[1];
      if (!method || typeof api[method] !== 'function') throw new Error(`Unexpected renderer method: ${method}`);
      const marker = `api["${method}"](`;
      const start = source.indexOf(marker) + marker.length;
      const end = source.lastIndexOf(');})()');
      const raw = end >= start ? source.slice(start, end) : '';
      const args = raw ? JSON.parse(raw) : undefined;
      return api[method](args);
    },
  };
}

test('maintained riverbank workflow survives desktop MCP edits, retries, cancellation, checkpointing, and CLI reopen', async () => {
  const work = await mkdtemp('/Volumes/DevStorage/Builds/pixelwall/workflow-desktop-cli-');
  const exportRoot = join(work, 'approved');
  const configPath = join(work, 'mcp.json');
  await mkdir(exportRoot);
  const original = normalizeDocument(decodeProjectContainer(new Uint8Array(await readFile(fixture))));
  let document = original;
  let revision = 0;
  const history = createHistory(document);
  const artifacts = new Map();
  const delivered = [];
  const host = {
    revision: () => revision,
    inspect: () => describeDocument(document),
    commands: () => COMMANDS,
    desktopState: () => ({ loaded: true, id: document.id, revision, busy: false, canSave: true }),
    desktopAction: async () => ({ ok: true }),
    persistence: async () => ({ mode: 'library', library: 'available' }),
    async apply(commands, label, { onProgress, signal } = {}) {
      let next = document;
      for (let index = 0; index < commands.length; index++) {
        if (signal?.aborted) throw Object.assign(new Error('Edit cancelled.'), { name: 'AbortError' });
        next = applyCommand(next, commands[index]);
        onProgress?.({ phase: 'staging', commandsProcessed: index + 1, commandsTotal: commands.length, revision });
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      const changed = next !== document;
      if (changed) { history.commit(next, label); document = next; revision++; }
      onProgress?.({ status: 'committed', phase: 'completed', commandsProcessed: commands.length, commandsTotal: commands.length, revision });
      return { changed };
    },
    async validate({ commands }) {
      let scratch = document;
      for (const command of commands) scratch = applyCommand(scratch, command);
      return { valid: true, changed: scratch !== document };
    },
    async checkpoint() {
      const bytes = encodeProjectContainer(document);
      const artifactId = `checkpoint-${revision}`;
      const filename = `${document.name || 'project'}.pixelwall`;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      artifacts.set(artifactId, { artifactId, name: filename, bytes: bytes.length, sha256, data: bytes, documentId: document.id, revision });
      return { documentId: document.id, revision, filename, bytes: bytes.length, artifactId, sha256, persistence: { status: 'persisted' } };
    },
    artifacts: () => [...artifacts.values()].map(({ data, ...metadata }) => metadata),
    readArtifact: async ({ artifactId, offset = 0, length = 1024 * 1024 }) => {
      const artifact = artifacts.get(artifactId); if (!artifact) return null;
      const bytes = artifact.data.slice(offset, offset + length);
      return { bytes: Array.from(bytes), offset, length: bytes.length, done: offset + bytes.length >= artifact.data.length, metadata: artifact };
    },
    async checkpointDelivered(value) {
      if (value.documentId !== document.id || value.revision !== revision) throw new Error('Stale checkpoint.');
      delivered.push(value); return { recorded: true };
    },
  };
  const api = createAutomation(host);
  const bridge = createMcpBridge({ configPath, exportRoot, webContents: createRendererAdapter(api) });
  const call = (id, name, arguments_ = {}) => bridge.handle({ id, token: bridge.token, method: 'tools/call', params: { name, arguments: arguments_ } });
  try {
    const inspected = await call(1, 'pixelwall_inspect');
    assert.equal(inspected.result.structuredContent.document.id, original.id);
    const valid = await call(2, 'pixelwall_validate', { commands: [line()], expectedRevision: 0 });
    assert.equal(valid.result.structuredContent.valid, true);

    const applied = await call(3, 'pixelwall_apply', { commands: [line()], expectedRevision: 0, requestKey: 'river-edit-1' });
    assert.equal(applied.result.isError, false);
    assert.equal(applied.result.structuredContent.operation.status, 'completed');
    assert.equal(revision, 1);
    const retried = await call(4, 'pixelwall_apply', { commands: [line()], expectedRevision: 0, requestKey: 'river-edit-1' });
    assert.equal(retried.result.isError, false);
    assert.equal(revision, 1, 'retrying a request key must not apply the edit again');

    const beforeCancel = renderFrame(document, document.frames[0].id);
    const pending = await call(5, 'pixelwall_apply', { commands: Array.from({ length: 24 }, (_, index) => line(8 + (index % 12))), wait: false });
    const operationId = pending.result.structuredContent.operationId;
    await call(6, 'pixelwall_cancel', { operationId });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(revision, 1, 'cancelled staging must not commit a partial document');
    assert.deepEqual([...renderFrame(document, document.frames[0].id)], [...beforeCancel]);

    const checkpoint = await call(7, 'pixelwall_checkpoint', { expectedDocumentId: document.id, expectedRevision: revision, verifyReopen: true });
    const checkpointResult = checkpoint.result.structuredContent;
    assert.equal(checkpointResult.disk.status, 'persisted');
    assert.equal(checkpointResult.reopenVerification.status, 'verified');
    assert.equal(checkpointResult.checkpointDelivered.recorded, true);
    assert.equal(delivered.length, 1);
    const reopenedBytes = new Uint8Array(await readFile(checkpointResult.disk.path));
    const reopened = normalizeDocument(decodeProjectContainer(reopenedBytes));
    assert.equal(reopened.frames.length, 12);
    assert.deepEqual([...renderFrame(reopened, reopened.frames[0].id)], [...renderFrame(document, document.frames[0].id)]);

    const verified = JSON.parse((await run(process.execPath, ['app/cli.mjs', 'verify', checkpointResult.disk.path], { cwd: root })).stdout);
    assert.equal(verified.valid, true); assert.equal(verified.frames, 12); assert.equal(verified.layers, reopened.layers.length);
    const renderPath = join(work, 'reopened-frame.png');
    await run(process.execPath, ['app/cli.mjs', 'render', checkpointResult.disk.path, '--frame', '0', '--out', renderPath], { cwd: root });
    const rendered = readPng(await readFile(renderPath));
    assert.deepEqual([...rendered.rgba], [...renderFrame(reopened, reopened.frames[0].id)]);
  } finally {
    await bridge.stop().catch(() => {});
    await rm(work, { recursive: true, force: true });
  }
});
