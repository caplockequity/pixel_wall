#!/usr/bin/env node
/** Fixed, reproducible local workloads; reports measurements, never a speed claim. */
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const args = Object.fromEntries(process.argv.slice(2).map(value=>value.split(/=(.*)/s).slice(0,2)));
const root = resolve(args['--root'] || dirname(fileURLToPath(new URL('../package.json',import.meta.url))));
const {createDocument,applyCommand,renderFrame} = await import(pathToFileURL(resolve(root,'app/editor-core.mjs')));
const {createHistory} = await import(pathToFileURL(resolve(root,'app/history.mjs')));
const {encodeProjectContainer,decodeProjectContainer} = await import(pathToFileURL(resolve(root,'desktop/project-container.mjs')));
const {writePng,readPng} = await import(pathToFileURL(resolve(root,'app/formats.mjs')));
const output = args['--out'];
if (!output) throw Error('Supply --out=/Volumes/DevStorage/Builds/pixelwall/<task>/profile.json');
const fixtures = [
  {name:'sprite-details',width:32,height:32,count:64,detail:true},
  {name:'linked-animation',width:96,height:64,count:24,linked:true},
  {name:'regional-recolor',width:512,height:384,count:5,recolor:true},
  {name:'fills-64',width:64,height:64,count:64},
  {name:'fills-256',width:256,height:256,count:128},
  {name:'fills-512',width:512,height:512,count:256},
];
function build(fixture) {
  let doc = createDocument({id:'benchmark',width:fixture.width,height:fixture.height});
  const layerId = doc.layers[0].id, frameId = doc.frames[0].id;
  if (fixture.linked) {
    doc = applyCommand(doc,{type:'draw.rect',x:4,y:4,width:12,height:12,filled:true,color:'#31593fff'});
    for(let i=1;i<12;i++) doc = applyCommand(doc,{type:'frame.duplicate',frameId,linked:true});
  }
  if (fixture.recolor) doc = applyCommand(doc,{type:'draw.rect',x:0,y:0,width:doc.width,height:doc.height,filled:true,color:'#31593fff'});
  const selection = fixture.recolor ? Array.from({length:doc.width*doc.height},(_,i)=>i%doc.width>=100&&i%doc.width<151&&Math.floor(i/doc.width)>=100&&Math.floor(i/doc.width)<175) : null;
  const commands = Array.from({length:fixture.count},(_,i)=>fixture.recolor
    ? {type:'effect.apply',effect:'replace',fromColor:i%2?'#b56b37ff':'#31593fff',toColor:i%2?'#31593fff':'#b56b37ff',selection,layerId,frameId}
    : {type:'draw.rect',x:fixture.detail?i%30:0,y:fixture.detail?Math.floor(i/30):0,width:fixture.detail?2:doc.width,height:fixture.detail?2:doc.height,filled:true,color:i%2?'#31593fff':'#387f95ff',layerId,frameId});
  return {doc,commands};
}
const results = [];
for(const fixture of fixtures) {
  const {doc,commands} = build(fixture), originalJSON=JSON.stringify(doc), history = createHistory(doc), phases = {};
  globalThis.gc?.();
  const before = process.memoryUsage(), samples = [before];
  const measure = async (name,fn) => {const start=performance.now();const value=await fn();phases[name]=performance.now()-start;samples.push(process.memoryUsage());return value;};
  const captured = await measure('captureMs',()=>JSON.parse(JSON.stringify(commands)));
  const staged = await measure('rasterMs',async()=>{let next=doc;for(let i=0;i<captured.length;i++){next=applyCommand(next,captured[i]);if(i%16===0){samples.push(process.memoryUsage());await new Promise(resolve=>setImmediate(resolve));}}return next;});
  await measure('historyCommitMs',()=>history.commit(staged,'Fixed workload'));
  const bytes = await measure('serializeMs',()=>encodeProjectContainer(staged));
  const reopened = await measure('reopenMs',()=>decodeProjectContainer(bytes));
  const png = await measure('exportMs',()=>writePng(reopened.width,reopened.height,renderFrame(reopened,reopened.frames[0].id)));
  const decoded = readPng(png);
  if(decoded.width!==doc.width||decoded.height!==doc.height) throw Error('Export dimensions did not survive decoding.');
  const cancelStart=performance.now();let scratch=doc,stagedBeforeCancel=0;
  for(const command of captured){if(stagedBeforeCancel===Math.min(4,captured.length))break;scratch=applyCommand(scratch,command);stagedBeforeCancel++;}
  const cancellation = {stagedCommands:stagedBeforeCancel,boundaryMs:performance.now()-cancelStart,originalUnchanged:JSON.stringify(doc)===originalJSON,scratchChanged:JSON.stringify(scratch)!==originalJSON,committed:false};
  history.undo();
  if(Buffer.compare(Buffer.from(renderFrame(history.present,doc.frames[0].id)),Buffer.from(renderFrame(doc,doc.frames[0].id)))!==0) throw Error('Undo did not restore original pixels.');
  results.push({fixture:fixture.name,width:doc.width,height:doc.height,frames:doc.frames.length,commands:captured.length,payloadBytes:Buffer.byteLength(JSON.stringify(captured)),projectBytes:bytes.length,pngBytes:png.length,phases,memory:{before,sampledPeakRss:Math.max(...samples.map(s=>s.rss)),sampledPeakHeap:Math.max(...samples.map(s=>s.heapUsed)),sampledPeakExternal:Math.max(...samples.map(s=>s.external)),note:'Sampled process memory, not an allocation trace or browser heap measurement.'},cancellation});
}
const report = {format:'pixelwall-workload-profile',version:1,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,platform:process.platform,architecture:process.arch,createdAt:new Date().toISOString(),method:'Single measured pass per fixed fixture after fixture construction. GC requested between fixtures when --expose-gc is supplied. Phase timings and sampled memory; no universal throughput inference.',results};
await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({output:resolve(output),fixtures:results.length})+'\n');
