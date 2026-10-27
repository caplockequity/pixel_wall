import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
test('reliable workflow example builds and verifies through the CLI', async () => {
  const { stdout } = await run(process.execPath, ['scripts/verify-workflow-example.mjs'], { cwd: process.cwd(), maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.frames, 12); assert.equal(result.cliRendered, 12); assert.ok(result.lateRecolorChangedPixels > 0);
});
