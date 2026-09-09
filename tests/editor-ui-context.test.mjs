import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, applyCommand } from '../app/editor-core.mjs';
import { createHistory } from '../app/history.mjs';
import { editorUiContext } from '../app/editor-ui-context.mjs';

test('empty restricted selections survive context history separately from deselection', () => {
  const document = createDocument({width:2, height:2}), history = createHistory(document);
  const before = editorUiContext(document), after = editorUiContext(document, {selection:[0,0,0,0], range:{type:2, frameIds:[document.frames[0].id]}});
  history.commit(document, 'Lua selection', {beforeContext:before, afterContext:after});
  history.undo(); assert.equal(history.lastContext.selection, null);
  history.redo(); assert.deepEqual(history.lastContext.selection, new Uint8Array(4)); assert.equal(history.lastContext.range.type, 2);
});

test('UI restoration removes stale IDs and masks after structural artwork changes', () => {
  const document = createDocument({width:2, height:2});
  const input = {selection:[1,0,0,1], active:{frameId:'deleted',layerId:'deleted'}, range:{type:4, layerIds:['deleted',document.layers[0].id,document.layers[0].id],frameIds:['deleted'],colors:[0,-1,99999,0],sliceIds:['deleted']}};
  const context = editorUiContext(document, input);
  assert.deepEqual(context.active, {frameId:document.frames[0].id,layerId:document.layers[0].id});
  assert.deepEqual(context.range, {type:4,layerIds:[document.layers[0].id],frameIds:[],colors:[0],sliceIds:[]});
  input.selection[0] = 0; assert.equal(context.selection[0], 1);
  const larger = applyCommand(document, {type:'document.resize',width:3,height:3});
  assert.equal(editorUiContext(larger, context).selection, null);
});
