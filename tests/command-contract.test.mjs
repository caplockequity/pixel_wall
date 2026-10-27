import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommandManifest, capabilityReport } from '../app/command-contract.mjs';
import { createSelectionRegistry } from '../app/selection-registry.mjs';

test('command contract rejects unknown fields and recursively validates batches', () => {
  assert.throws(() => validateCommandManifest([{type:'draw.rect',x:0,y:0,width:2,height:2,wat:1}]), /not supported/);
  assert.throws(() => validateCommandManifest([{type:'batch',commands:[{type:'clip.add',clip:{direction:'bad'}}]}]), /direction/);
  assert.equal(capabilityReport().commandCount > 50, true);
});
test('selection registry is scoped to document revision', () => {
  const registry=createSelectionRegistry(); registry.create({documentId:'d',revision:2,id:'trees',selection:{type:'rect',x:0,y:0,width:2,height:2}});
  assert.deepEqual(registry.resolve({documentId:'d',revision:2,id:'trees'}),{type:'rect',x:0,y:0,width:2,height:2});
  assert.throws(()=>registry.resolve({documentId:'d',revision:3,id:'trees'}),/missing/);
});
