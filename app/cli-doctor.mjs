/** Read-only diagnostics for the optional loopback desktop connection. Never expose its secret. */
import {connect} from 'node:net';
import {homedir,platform} from 'node:os';
import {join,resolve} from 'node:path';
import {readFile,stat} from 'node:fs/promises';
export async function diagnoseDesktopConnection(explicitPath) {
  const configured=explicitPath||process.env.PIXELWALL_MCP_CONFIG;
  const candidates=configured?[resolve(configured)]:[join(homedir(),'.pixelwall','mcp.json'),platform()==='darwin'?join(homedir(),'Library','Application Support','PixelWall','mcp.json'):platform()==='win32'?join(process.env.APPDATA||join(homedir(),'AppData','Roaming'),'PixelWall','mcp.json'):join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'PixelWall','mcp.json')];
  let config;
  for(const path of candidates) {
    try {
      const info=await stat(path);if(!info.isFile()||info.size>65536)throw Error('invalid');
      config=JSON.parse(await readFile(path,'utf8'));
      if(config.host!=='127.0.0.1'||!Number.isSafeInteger(config.port)||config.port<1||config.port>65535||typeof config.token!=='string'||config.token.length<32||config.token.length>256)throw Error('invalid');
      break;
    } catch(error) {if(error.code!=='ENOENT')return {status:'invalid-configuration',required:!!configured};}
  }
  if(!config)return {status:'not-configured',required:!!configured,reason:'Enable the local agent connection in PixelWall desktop to use MCP. CLI file commands remain available.'};
  return new Promise(resolveResult=>{
    const socket=connect({host:'127.0.0.1',port:config.port});let done=false,buffer='';
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolveResult({...result,required:!!configured});};
    const timer=setTimeout(()=>finish({status:'unreachable',reason:'Desktop connection timed out.'}),3000);
    socket.setEncoding('utf8');
    socket.once('error',()=>finish({status:'unreachable',reason:'Desktop connection could not be reached.'}));
    socket.once('close',()=>finish({status:'unreachable',reason:'Desktop closed the diagnostic connection.'}));
    socket.once('connect',()=>socket.write(JSON.stringify({jsonrpc:'2.0',id:'doctor',method:'ping',token:config.token})+'\n'));
    socket.on('data',chunk=>{
      buffer+=chunk;
      if(Buffer.byteLength(buffer)>65536)return finish({status:'invalid-response'});
      const end=buffer.indexOf('\n');if(end<0)return;
      try {
        const reply=JSON.parse(buffer.slice(0,end));
        if(reply.id!=='doctor'||!reply.result?.serverInfo)return finish({status:reply.error?'unauthorized':'invalid-response'});
        finish({status:'connected',server:reply.result.serverInfo.name,version:reply.result.serverInfo.version,protocolVersion:reply.result.protocolVersion});
      }catch{finish({status:'invalid-response'});}
    });
  });
}
