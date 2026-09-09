import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {unzipSync,strFromU8} from 'fflate';
import {RUNTIME_FILES} from '../scripts/prepare-runtimes.mjs';
import {assertPublicArtifact,collect,localLauncher,packageDownloads} from '../scripts/package-downloads.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const encode=value=>new TextEncoder().encode(value);
const serverSource=await readFile(join(sourceRoot,'scripts/serve-standalone.mjs'),'utf8');
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'pixelwall-package-'));t.after(()=>rm(root,{recursive:true,force:true}));for(const dir of ['scripts','dist/standalone','dist/cli'])await mkdir(join(root,dir),{recursive:true});await writeFile(join(root,'scripts/serve-standalone.mjs'),serverSource);await writeFile(join(root,'dist/standalone/index.html'),'<h1>PixelWall</h1>');await writeFile(join(root,'dist/cli/pixelwall.mjs'),'console.log("PixelWall CLI")');await writeFile(join(root,'dist/cli/lua-node-worker.mjs'),'// test worker');await writeFile(join(root,'dist/cli/package.json'),'{}');await writeFile(join(root,'dist/cli/README.md'),'PixelWall CLI');await mkdir(join(root,'dist/cli/runtimes'));for(const name of RUNTIME_FILES)await writeFile(join(root,'dist/cli/runtimes',name),'test runtime');return root;}

test('local launcher preserves decoded spaces, percent, hash and Unicode directory names',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'pixelwall-launch-'));t.after(()=>rm(parent,{recursive:true,force:true}));const folder=join(parent,'PixelWall QA #1 50% café');await mkdir(folder);
 await writeFile(join(folder,'run-local.mjs'),localLauncher(serverSource));await writeFile(join(folder,'index.html'),'<title>Local launch OK</title>');await writeFile(join(folder,'palette #1% café.css'),'body { color: red; }');await writeFile(join(parent,'outside.txt'),'outside');
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const process=spawn(globalThis.process.execPath,['--input-type=module','-e',`process.argv[3]=${JSON.stringify(String(port))}; await import(${JSON.stringify(pathToFileURL(join(folder,'run-local.mjs')).href)});`],{cwd:parent,stdio:['ignore','pipe','pipe']});t.after(()=>process.kill());
 await Promise.race([once(process.stdout,'data'),once(process,'exit').then(([code])=>{throw Error(`Launcher exited with ${code}`);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Launcher did not start')),5000);timer.unref();})]);
 const response=await fetch(`http://127.0.0.1:${port}/`);assert.equal(response.status,200);assert.match(await response.text(),/Local launch OK/);
 const asset=await fetch(`http://127.0.0.1:${port}/${encodeURIComponent('palette #1% café.css')}`);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/^text\/css/);assert.match(await asset.text(),/color: red/);
 const escape=await fetch(`http://127.0.0.1:${port}/%2e%2e%2foutside.txt`);assert.equal(escape.status,404);
});

test('launcher generation fails loudly if server default changes',()=>assert.throws(()=>localLauncher('const root="different";'),/entry changed/));
for(const reference of ['https://private-preview.chatgpt.site/editor','//preview.chatgpt.site','preview.chatgpt-team.site','https:\\/\\/preview.chatgpt.site'])test(`private Sites reference cannot ship: ${reference}`,()=>assert.throws(()=>assertPublicArtifact('app.js',encode(reference)),/Private Sites link/));
test('distribution collector rejects symlinks',async t=>{const root=await fixture(t);await symlink(join(root,'dist/cli/README.md'),join(root,'dist/standalone/private.txt'));await assert.rejects(collect(join(root,'dist/standalone')),/linked or special/);});
test('stale CLI files prevent either archive from being written',async t=>{const root=await fixture(t);await writeFile(join(root,'dist/cli/stale.txt'),'stale');await assert.rejects(packageDownloads(root),/Unexpected or missing CLI/);await assert.rejects(access(join(root,'public/downloads/pixelwall-standalone.zip')));});
for(const [label,material]of [['Stripe secret','sk_live_'+ 's'.repeat(32)],['restricted Stripe key','rk_test_'+'r'.repeat(32)],['webhook key','whsec_'+'w'.repeat(32)],['private EC JWK',JSON.stringify({kty:'EC',crv:'P-256',d:'d'.repeat(43)})],['PKCS8','-----BEGIN PRIVATE KEY-----'],['EC PEM','-----BEGIN EC PRIVATE KEY-----']])test(`rejects ${label} even in text artifact`,()=>assert.throws(()=>assertPublicArtifact('README.txt',encode(material)),/Server-secret/));
test('allows public keys and legitimate offline license verifier source',()=>assert.doesNotThrow(()=>assertPublicArtifact('license.mjs',encode('const key={kty:"EC",crv:"P-256",x:"'+ 'x'.repeat(43)+'",y:"'+'y'.repeat(43)+'"}; if(key.d) throw Error("private key");'))));
test('both archives contain runnable expected entries',async t=>{const root=await fixture(t);await packageDownloads(root);const web=unzipSync(new Uint8Array(await readFile(join(root,'public/downloads/pixelwall-standalone.zip'))));assert.match(strFromU8(web['run-local.mjs']),/fileURLToPath\(new URL/);assert.ok(web['index.html']);assert.ok(web['README.txt']);const cli=unzipSync(new Uint8Array(await readFile(join(root,'public/downloads/pixelwall-cli.zip'))));assert.deepEqual(Object.keys(cli).sort(),['README.md','package.json','pixelwall.mjs','lua-node-worker.mjs',...RUNTIME_FILES.map(name=>'runtimes/'+name)].sort());});
test('published downloadable archives contain no recognizable server secrets',async()=>{for(const name of ['standalone','cli']){const files=unzipSync(new Uint8Array(await readFile(join(sourceRoot,`public/downloads/pixelwall-${name}.zip`))));for(const [path,data]of Object.entries(files))assertPublicArtifact(`${name}/${path}`,data);}});
