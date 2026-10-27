import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpBridge } from '../desktop/mcp-bridge.mjs';

test('desktop MCP selection route forwards create/list/remove arguments', async () => {
  const calls=[];
  const bridge=createMcpBridge({configPath:'/tmp/pixelwall-selection-route.json',webContents:{executeJavaScript:async source=>{calls.push(source);return {created:true};}}});
  const response=await bridge.handle({id:1,token:bridge.token,method:'tools/call',params:{name:'pixelwall_selection',arguments:{action:'create',expectedDocumentId:'doc',expectedRevision:4,id:'trees',selection:{type:'rect',x:0,y:0,width:4,height:4}}}});
  assert.equal(response.result.isError,false);
  assert.ok(calls.some(source=>source.includes('selection')&&source.includes('trees')&&source.includes('expectedRevision')));
});
