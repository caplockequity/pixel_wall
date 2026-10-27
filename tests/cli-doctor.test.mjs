import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { diagnoseDesktopConnection } from '../app/cli-doctor.mjs';

async function configDir(t, value) {
  const dir=await mkdtemp('/Volumes/DevStorage/Builds/pixelwall/doctor-');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'mcp.json'); await writeFile(path,JSON.stringify(value)); return path;
}
async function serverFor(t, reply) {
  const server=createServer(socket=>{socket.on('data',()=>socket.write(`${JSON.stringify(reply)}\n`));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>server.close());
  return server.address().port;
}
test('doctor reports connected protocol/version without exposing token', async t=>{
  const token='T'.repeat(64), port=await serverFor(t,{jsonrpc:'2.0',id:'doctor',result:{protocolVersion:'2025-06-18',serverInfo:{name:'PixelWall desktop',version:'0.5.1'}}});
  const path=await configDir(t,{host:'127.0.0.1',port,token}); const result=await diagnoseDesktopConnection(path);
  assert.deepEqual({status:result.status,version:result.version,protocolVersion:result.protocolVersion},{status:'connected',version:'0.5.1',protocolVersion:'2025-06-18'}); assert.equal(JSON.stringify(result).includes(token),false);
});
test('doctor rejects non-loopback and malformed oversized configurations', async t=>{
  const token='T'.repeat(64); const bad=await configDir(t,{host:'192.0.2.1',port:1,token}); assert.equal((await diagnoseDesktopConnection(bad)).status,'invalid-configuration');
  const huge=await configDir(t,{host:'127.0.0.1',port:1,token:'x'.repeat(70000)}); assert.equal((await diagnoseDesktopConnection(huge)).status,'invalid-configuration');
});
test('doctor distinguishes stale unreachable configuration and bounds malformed responses', async t=>{
  const stale=await configDir(t,{host:'127.0.0.1',port:9,token:'T'.repeat(64)}); assert.equal((await diagnoseDesktopConnection(stale)).status,'unreachable');
  const port=await serverFor(t,'x'.repeat(70000)); const malformed=await configDir(t,{host:'127.0.0.1',port,token:'T'.repeat(64)}); const result=await diagnoseDesktopConnection(malformed); assert.equal(result.status,'invalid-response');
});
