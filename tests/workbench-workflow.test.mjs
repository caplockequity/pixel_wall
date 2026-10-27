import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createDocument,applyCommand} from '../app/editor-core.mjs';
import {historyValuesEqual} from '../app/history.mjs';
import {validateExportScale} from '../app/export-scale.mjs';
import {exportFrameTraversal} from '../app/frame-traversal.mjs';
import {packAtlas} from '../app/formats.mjs';
import {renderScaledExportFrame} from '../app/export-render.mjs';
const text=readFileSync(new URL('../app/workbench.jsx',import.meta.url),'utf8');
const parsed=ts.createSourceFile('workbench.jsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function production(name,scope,host=false){let found;function visit(node){if(!host&&ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;if(host&&ts.isBinaryExpression(node)&&node.left.getText(parsed)==='hostRef.current'&&ts.isObjectLiteralExpression(node.right)){found=node.right.properties.find(p=>p.name?.getText(parsed)===name)?.initializer??found;}ts.forEachChild(node,visit);}visit(parsed);assert(found,`Missing production ${name}`);return new Function('scope',`with(scope){return (${found.getText(parsed)});}`)(scope);}
const ref=current=>({current});
function closeScope(){const document=createDocument({width:2,height:2});const scope={temporaryDocumentsRef:ref(new Map()),savedDocumentsRef:ref(new Map()),docRef:ref(document),revisionRef:ref(5),documentModeRef:ref('temporary'),checkpointDeliveryRef:ref(null),nativeSessionRef:ref(null),historyValuesEqual,save:async()=>({saved:false})};scope.close=production('saveForClose',scope,true);return scope;}
const checkpoint=(document,revision)=>({status:'verified',documentId:document.id,revision,sha256:'a'.repeat(64),bytes:20});
test('production close handler accepts only exact checkpoints and protects dirty retained library content',async()=>{
 const s=closeScope();assert.equal((await s.close()).saved,false);s.checkpointDeliveryRef.current=checkpoint(s.docRef.current,4);assert.equal((await s.close()).saved,false);
 s.checkpointDeliveryRef.current=checkpoint(s.docRef.current,5);assert.equal((await s.close()).saved,true);
 const original=createDocument({width:2,height:2}),dirty=applyCommand(original,{type:'draw.rect',x:0,y:0,width:1,height:1,filled:true,color:'#ff0000ff'});
 s.savedDocumentsRef.current.set(original.id,original);s.temporaryDocumentsRef.current.set(original.id,{document:dirty,revision:2,storedRevision:2,mode:'library'});
 assert.equal((await s.close()).saved,false,'equal revision counters do not prove content saved');
 s.temporaryDocumentsRef.current.get(original.id).checkpoint=checkpoint(dirty,2);assert.equal((await s.close()).saved,true);
 s.temporaryDocumentsRef.current.set(original.id,{document:original,revision:0,storedRevision:7,mode:'library'});assert.equal((await s.close()).saved,true,'different counters do not make persisted content dirty');
});
test('production close handler verifies every retained bound file and its revision',async()=>{
 const s=closeScope();s.documentModeRef.current='file';s.nativeSessionRef.current={saveAll:async()=>[{id:s.docRef.current.id,revision:5}]};
 assert.equal((await s.close()).saved,true,'real native saveAll uses id and revision');
 s.nativeSessionRef.current.saveAll=async()=>[{id:s.docRef.current.id,revision:4}];assert.equal((await s.close()).saved,false);
 s.nativeSessionRef.current.saveAll=async()=>[{id:s.docRef.current.id,revision:5}];const retained=createDocument({width:2,height:2});
 s.temporaryDocumentsRef.current.set(retained.id,{document:retained,revision:3,mode:'file'});assert.equal((await s.close()).saved,false,'unbound retained file cannot be assumed saved');
 s.nativeSessionRef.current.saveAll=async()=>[{id:s.docRef.current.id,revision:5},{id:retained.id,revision:3}];assert.equal((await s.close()).saved,true);
});
test('production export plan describes exact frames and current entitlement without asking for access',()=>{
 let doc=createDocument({width:4,height:3});doc=applyCommand(doc,{type:'frame.duplicate',frameId:doc.frames[0].id,linked:true});doc=applyCommand(doc,{type:'frame.duplicate',frameId:doc.frames[0].id,linked:true});
 const s={docRef:ref(doc),revisionRef:ref(9),activeRef:ref({frameId:doc.frames[1].id,layerId:doc.layers[0].id}),clipId:'',validateExportScale,exportFrameTraversal,renderScaledExportFrame,packAtlas,scaleExportSlices:()=>[],colorManager:null,renderingIntent:1,targetLayers:()=>[doc.layers[0].id],PAID_FORMATS:new Set(['gif','sheet','zip']),stem:()=> 'fixture',access:{pro:false,requestAccess(){throw Error('Plan must not open checkout');}}};
 s.exportFrameIds=production('exportFrameIds',s);s.plan=production('createExportPlan',s);
 assert.deepEqual(s.plan({format:'png'}).frameIds,[doc.frames[1].id]);assert.equal(s.plan({format:'project'}).frameCount,3);assert.equal(s.plan({format:'gif'}).frameCount,3);
 assert.equal(s.plan({format:'gif'}).canExport,false);assert.equal(s.plan({format:'png'}).canExport,true);s.access.pro=true;assert.equal(s.plan({format:'gif'}).canExport,true);
 assert.throws(()=>s.plan({format:'png',expectedFrameCount:3}),/frame count/);assert.throws(()=>s.plan({format:'png',frameId:'missing'}),/frame/);assert.throws(()=>s.plan({format:'gif',clipId:'missing'}),/clip/);assert.throws(()=>s.plan({format:'bogus'}),/format/);
});
test('production atlas plan reports packed output dimensions and layout inputs',()=>{
 let doc=createDocument({width:4,height:3});doc=applyCommand(doc,{type:'draw.rect',layerId:doc.layers[0].id,frameId:doc.frames[0].id,x:0,y:0,width:2,height:2,filled:true,color:'#ff0000ff'});doc=applyCommand(doc,{type:'frame.duplicate',frameId:doc.frames[0].id,linked:true});
 const s={docRef:ref(doc),revisionRef:ref(1),activeRef:ref({frameId:doc.frames[0].id,layerId:doc.layers[0].id}),clipId:'',validateExportScale,exportFrameTraversal,renderScaledExportFrame,packAtlas,scaleExportSlices:()=>[],colorManager:null,renderingIntent:1,targetLayers:()=>[doc.layers[0].id],PAID_FORMATS:new Set(['gif','sheet','zip']),stem:()=> 'fixture',access:{pro:true}};
 s.buildExportAtlasPlan=production('buildExportAtlasPlan',s);s.exportFrameIds=production('exportFrameIds',s);s.plan=production('createExportPlan',s);
 const plan=s.plan({format:'sheet',scale:2,trim:false,padding:2,border:3,extrude:1,layout:'horizontal'});
 assert.equal(plan.sourceWidth,8);assert.equal(plan.sourceHeight,6);assert.equal(plan.outputWidth,plan.atlas.width);assert.equal(plan.outputHeight,plan.atlas.height);assert.equal(plan.atlas.layout,'horizontal');assert.equal(plan.atlas.border,3);assert.ok(plan.outputWidth>plan.sourceWidth);
 assert.throws(()=>s.plan({format:'sheet',scale:1,width:8192,height:8192}),/pixel budget|atlas|maximum/i);
});
