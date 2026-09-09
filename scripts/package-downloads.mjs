import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zipSync,strToU8} from 'fflate';
import {RUNTIME_FILES} from './prepare-runtimes.mjs';

export function assertPublicArtifact(path,data) {
  const text=new TextDecoder().decode(data);
  if (/\b[\w.-]+\.(?:chatgpt|chatgpt-team)\.site\b/i.test(text)) {
    throw new Error(`Private Sites link in downloadable file: ${path}`);
  }
  if (/PIXELWALL_OFFLINE_PRIVATE_JWK|STRIPE_SECRET_KEY|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|["']?d["']?\s*:\s*["'][A-Za-z0-9_-]{32,}["']/.test(text)) {
    throw new Error(`Server-secret material or reference in downloadable file: ${path}`);
  }
}

export async function collect(root,folder=root) {
  const files={};
  for (const item of await readdir(folder,{withFileTypes:true})) {
    if (item.name.startsWith('.')) continue;
    const path=join(folder,item.name);
    if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) throw new Error(`Unsupported linked or special distribution file: ${relative(root,path)}`);
    if (item.isDirectory()) Object.assign(files,await collect(root,path));
    else files[relative(root,path).split('\\').join('/')]=new Uint8Array(await readFile(path));
  }
  return files;
}

export function localLauncher(source) {
  const expected="process.argv[2] ?? 'dist/standalone'";
  if (source.split(expected).length!==2) throw new Error('Local server entry changed; update the download launcher before packaging.');
  const lines=source.replace(expected,"process.argv[2] ?? fileURLToPath(new URL('.',import.meta.url))").split('\n');
  lines.splice(lines[0].startsWith('#!')?1:0,0,"import {fileURLToPath} from 'node:url';");
  return lines.join('\n');
}

export async function packageDownloads(root=process.cwd()) {
  const web=await collect(join(root,'dist/standalone'));
  web['run-local.mjs']=strToU8(localLauncher(await readFile(join(root,'scripts/serve-standalone.mjs'),'utf8')));
web['README.txt']=strToU8('PIXELWALL — LOCAL STUDIO\n\nKeep this folder with your project backups and Pro ownership license.\nInstall Node.js 22.13 or newer from nodejs.org, then run:\n\n  node run-local.mjs\n\nOpen http://127.0.0.1:4173 in a modern browser. The server stays on your computer; it does not upload artwork. Keep the folder and use this same address to reopen your device library. Save portable .pixelwall files for independent backups.\n\nThe browser needs a local HTTP address for secure storage. Do not double-click index.html. The local server and editor also work without an internet connection.\n\nEditing, scripting, individual PNG/BMP/TGA images and editable project files are free. GIF, sprite atlases and game packages require Pro. Open Pro, Restore Pro, and paste the PW2 code from your downloaded ownership license. This verifies locally with no subscription or expiry. Old PW1 codes need one online conversion in the hosted editor.\n\nNo AI runs inside PixelWall. Its public command API and CLI can be controlled by external tools. Embedded ICC profiles are retained in projects. Preview and image export use LittleCMS color conversion.\n');
  const cli=await collect(join(root,'dist/cli'));
  const expectedCli=['README.md','package.json','pixelwall.mjs','lua-node-worker.mjs',...RUNTIME_FILES.map(name=>'runtimes/'+name)];
  if (Object.keys(cli).sort().join('\n')!==expectedCli.sort().join('\n')) throw new Error('Unexpected or missing CLI output. Rebuild the CLI into a clean distribution folder.');
  const packages=[['standalone',web],['cli',cli]];
  // Validate every file before creating either downloadable archive.
  for (const [,files] of packages) for (const [path,data] of Object.entries(files)) assertPublicArtifact(path,data);
  await mkdir(join(root,'public/downloads'),{recursive:true});
  for (const [name,files] of packages) {
    const bytes=zipSync(files,{level:9});
    await writeFile(join(root,`public/downloads/pixelwall-${name}.zip`),bytes);
    console.log(`${name}: ${Object.keys(files).length} files, ${bytes.length} bytes`);
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await packageDownloads();
