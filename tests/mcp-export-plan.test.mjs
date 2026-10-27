import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMcpBridge } from '../desktop/mcp-bridge.mjs';

const base = process.platform === 'darwin' && existsSync('/Volumes/DevStorage')
  ? '/Volumes/DevStorage/Builds/pixelwall'
  : tmpdir();

async function harness(exportRoot, executeJavaScript = async () => ({
  documentId: 'riverbank', revision: 4, format: 'png', frameIds: ['frame-1'], frameCount: 1,
  width: 96, height: 64, requiredEntitlement: 'free', currentEntitlement: 'free', canExport: true,
  filenames: ['riverbank.png'],
})) {
  const root = await mkdtemp(join(base, 'mcp-export-plan-'));
  const bridge = createMcpBridge({ configPath: join(root, 'mcp.json'), exportRoot, webContents: { executeJavaScript } });
  return { root, bridge };
}

async function call(bridge) {
  return bridge.handle({ id: 1, token: bridge.token, method: 'tools/call', params: { name: 'pixelwall_export_plan', arguments: { format: 'png' } } });
}

test('export plan reports an available empty approved folder without writing', async () => {
  const root = await mkdtemp(join(base, 'mcp-export-root-'));
  const h = await harness(root);
  try {
    const response = await call(h.bridge);
    const delivery = response.result.structuredContent.delivery;
    assert.equal(response.result.isError, false);
    assert.equal(delivery.folderAvailable, true);
    assert.equal(delivery.checked, true);
    assert.deepEqual(delivery.conflicts, []);
    assert.equal(delivery.conflictPolicy, 'refuse');
  } finally { await h.bridge.stop(); await rm(h.root, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});

test('export plan reports regular and symlink filename conflicts without replacing either', async () => {
  const root = await mkdtemp(join(base, 'mcp-export-root-'));
  const regular = join(root, 'riverbank.png');
  const target = join(root, 'existing.png');
  await writeFile(regular, 'keep'); await writeFile(target, 'target'); await symlink(target, join(root, 'linked.png'));
  const h = await harness(root, async () => ({ documentId: 'riverbank', revision: 4, filenames: ['riverbank.png', 'linked.png'] }));
  try {
    const response = await call(h.bridge);
    const delivery = response.result.structuredContent.delivery;
    assert.equal(delivery.folderAvailable, true);
    assert.equal(delivery.checked, true);
    assert.deepEqual(delivery.conflicts, ['riverbank.png', 'linked.png']);
    assert.equal(await readFile(regular, 'utf8'), 'keep');
    assert.equal(await readFile(target, 'utf8'), 'target');
  } finally { await h.bridge.stop(); await rm(h.root, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});

test('export plan marks missing and symlink approved roots unavailable', async () => {
  const parent = await mkdtemp(join(base, 'mcp-export-root-'));
  const missing = join(parent, 'missing');
  const real = join(parent, 'real'); await mkdir(real); const linked = join(parent, 'linked'); await symlink(real, linked);
  for (const exportRoot of [missing, linked]) {
    const h = await harness(exportRoot);
    try {
      const response = await call(h.bridge);
      const delivery = response.result.structuredContent.delivery;
      assert.equal(response.result.isError, false);
      assert.equal(delivery.folderAvailable, false);
      assert.equal(delivery.checked, false);
      assert.match(delivery.error, /approved export folder is unavailable|ENOENT/i);
    } finally { await h.bridge.stop(); await rm(h.root, { recursive: true, force: true }); }
  }
  await rm(parent, { recursive: true, force: true });
});

test('export-plan renderer failures remain errors and do not fabricate delivery state', async () => {
  const root = await mkdtemp(join(base, 'mcp-export-root-'));
  const h = await harness(root, async () => { throw new Error('renderer plan unavailable'); });
  try {
    const response = await call(h.bridge);
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /renderer plan unavailable/);
  } finally { await h.bridge.stop(); await rm(h.root, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});
