import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopSession } from '../app/desktop-session.mjs';
import { createAutomation } from '../app/editor-automation.mjs';

const state = () => ({ loaded: true, id: 'sprite', revision: 7, canSave: true, busy: false });
const saved = () => ({ document: { id: 'sprite' }, revision: 2 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes;reject=no; }); return {promise,resolve,reject}; };

test('desktop close requires a positive save and a stable document, and keeps editing locked until cancelled', async () => {
  for (const result of [null, undefined, {}, {revision:2}, {document:{id:'other'},revision:2}, {saved:false}, {saved:false,reason:'Quota exceeded'}]) {
    const session=createDesktopSession({desktopState:state,save:async()=>result});
    const response=await session.prepareClose('a');
    assert.equal(response.status,'blocked');assert.equal(response.attemptId,'a');
    assert.throws(()=>session.assertEditable(),/close dialog/);
    assert.equal(session.cancelClose('wrong'),false);assert.equal(session.locked,true);
    assert.equal(session.cancelClose('a'),true);session.assertEditable();
  }
  const session=createDesktopSession({desktopState:state,save:async()=>saved()});
  assert.deepEqual(await session.prepareClose('ok'),{status:'ready',attemptId:'ok',id:'sprite',revision:7});
  assert.equal(session.locked,true);
});

test('opening, missing storage and active operations never authorize close or start a save', async () => {
  for(const patch of [{loaded:false},{id:undefined},{canSave:false},{busy:true}]) {
    let saves=0;const session=createDesktopSession({desktopState:()=>({...state(),...patch}),save:async()=>{saves++;}});
    assert.equal((await session.prepareClose('a')).status,'blocked');assert.equal(saves,0);
  }
});

test('newer edits or switched documents during save block close, while rejections keep the dialog lock', async () => {
  for(const patch of [{revision:8},{id:'other'},{busy:true},{canSave:false}]) {
    let current=state();const saving=deferred();
    const session=createDesktopSession({desktopState:()=>current,save:()=>saving.promise});
    const pending=session.prepareClose('a');current={...current,...patch};saving.resolve(saved());
    assert.equal((await pending).status,'blocked');assert.equal(session.locked,true);
  }
  const session=createDesktopSession({desktopState:state,save:async()=>{throw Error('storage failed');}});
  await assert.rejects(session.prepareClose('a'),/storage failed/);assert.equal(session.locked,true);
});

test('cancelling a timed-out save prevents late completion from authorizing close or relocking editing', async () => {
  const saving=deferred();const session=createDesktopSession({desktopState:state,save:()=>saving.promise});
  const pending=session.prepareClose('old');assert.equal(session.prepareClose('old'),pending);
  assert.equal((await session.prepareClose('other')).status,'blocked');
  session.cancelClose('old');saving.resolve(saved());
  assert.equal((await pending).status,'blocked');assert.equal(session.locked,false);
});

test('automation mutations and desktop actions are blocked for the whole close handshake', async () => {
  const calls=[];const host={desktopState:state,save:async()=>saved(),revision:()=>7,inspect:()=>({}),apply:()=>calls.push('apply'),undo:()=>calls.push('undo'),redo:()=>calls.push('redo'),newDocument:()=>calls.push('new'),desktopAction:n=>calls.push(n)};
  const api=createAutomation(host);await api.desktop.prepareClose('a');
  for(const action of [()=>api.apply({commands:[{type:'draw.stroke'}]}),()=>api.undo(),()=>api.redo(),()=>api.newDocument(),()=>api.desktop.action('open')])await assert.rejects(action,/close dialog/);
  assert.deepEqual(calls,[]);api.desktop.cancelClose('a');await api.desktop.action('open');assert.deepEqual(calls,['open']);
});
