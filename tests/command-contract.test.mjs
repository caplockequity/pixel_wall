import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommandManifest, capabilityReport, COMMAND_SCHEMAS } from '../app/command-contract.mjs';
import { COMMANDS } from '../app/editor-core.mjs';
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
test('every executable catalog command has an explicit schema field mapping', () => {
  assert.equal(Object.keys(COMMAND_SCHEMAS).length, COMMANDS.length);
  for (const command of COMMANDS) {
    const schema=COMMAND_SCHEMAS[command.type];
    assert.equal(schema.properties.type.const, command.type);
    for (const field of Object.keys(command.parameters)) assert.ok(Object.hasOwn(schema.properties,field), `${command.type}.${field}`);
  }
});
test('valid family payloads and precise nested failures', () => {
  assert.equal(validateCommandManifest([
    {type:'scene.water.patch',origin:{x:0,y:0},size:{width:8,height:8},field:{width:16,height:16}},
    {type:'animation.environment',movingLayers:['canopy'],pinnedLayers:['trunk']},
    {type:'animation.particles',layerId:'layer-1',count:4,seed:2},
    {type:'selection.replaceColors',selection:{type:'rect',x:0,y:0,width:2,height:2},mapping:{null:null,'#ffffffff':'#000000ff'}},
  ]).valid,true);
  assert.throws(() => validateCommandManifest([{type:'batch',commands:[{type:'draw.line',from:3,to:{x:1,y:1}}]}]), error => error.path.includes('from'));
  assert.throws(() => validateCommandManifest([{type:'scene.component',size:'large'}]), error => error.path.endsWith('.size'));
});
