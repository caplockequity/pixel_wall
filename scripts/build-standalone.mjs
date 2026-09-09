#!/usr/bin/env node
import { build as viteBuild } from 'vite';
import { rolldown } from 'rolldown';
import { cp, mkdir, readFile, readdir, writeFile, chmod, rm } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { standaloneConfig } from '../standalone/vite.config.mjs';
const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(process.env.PIXELWALL_SOURCE_ROOT ?? ownRoot);
const webOut = join(sourceRoot, 'dist/standalone');
const cliOut = join(sourceRoot, 'dist/cli');
const desktopOut = join(sourceRoot, 'desktop/app');
await viteBuild(await standaloneConfig({ sourceRoot, outDir: webOut }));
for (const filename of ['pixelwall-mark.svg', 'pixelwall-icon-192.png', 'pixelwall-icon-512.png']) await cp(join(sourceRoot, 'public', filename), join(webOut, filename));
await writeFile(join(webOut, 'pixelwall.webmanifest'), JSON.stringify({ name: 'PixelWall Studio', short_name: 'PixelWall', description: 'Local pixel art and animation studio', start_url: './', scope: './', id: './', display: 'standalone', background_color: '#111219', theme_color: '#111219', icons: [{src:'./pixelwall-icon-192.png',sizes:'192x192',type:'image/png'},{src:'./pixelwall-icon-512.png',sizes:'512x512',type:'image/png'}] }, null, 2));
async function walk(folder) { const found = []; for (const item of await readdir(folder, { withFileTypes: true })) { if (item.name.startsWith('.')) continue; const path = join(folder, item.name); if (item.isDirectory()) found.push(...await walk(path)); else found.push(path); } return found; }
const files = (await walk(webOut)).sort();
const assets = files.map((path) => './' + relative(webOut, path).split('\\').join('/'));
const hash = createHash('sha256');
for (const path of files) { const content = await readFile(path); hash.update(relative(webOut,path)); hash.update(content); if (/\.(?:js|html)$/.test(path) && /PIXELWALL_OFFLINE_PRIVATE_JWK|STRIPE_SECRET_KEY|BEGIN PRIVATE KEY/.test(content.toString())) throw new Error('A server-secret reference appeared in the standalone bundle.'); }
const buildId = hash.digest('hex').slice(0,16);
const worker = `const CACHE='pixelwall-standalone-${buildId}';const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('pixelwall-standalone-')&&k!==CACHE)await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.includes('/api/'))return;e.respondWith((async()=>{const c=await caches.open(CACHE);const cached=await c.match(e.request);if(cached)return cached;if(e.request.mode==='navigate'){const shell=await c.match(new URL('./index.html',self.registration.scope));if(shell)return shell}return fetch(e.request)})())});\n`;
await writeFile(join(webOut, 'sw.js'), worker);
await writeFile(join(webOut, 'build-info.json'), JSON.stringify({ format: 'pixelwall-standalone', version: 1, buildId, includes: ['editor', 'document-storage', 'offline-license-verifier'], assets: assets.length }, null, 2));
await rm(cliOut, { recursive: true, force: true });
await mkdir(cliOut, { recursive: true });
const cli = await rolldown({ input: resolve(process.env.PIXELWALL_CLI_ENTRY ?? join(sourceRoot, 'app/cli.mjs')), platform: 'node', external: /^node:/, onwarn: (warning) => { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') console.warn(warning.message); } });
try { await cli.write({ file: join(cliOut, 'pixelwall.mjs'), format: 'es', sourcemap: false }); } finally { await cli.close(); }
await chmod(join(cliOut, 'pixelwall.mjs'), 0o755);
await writeFile(join(cliOut, 'package.json'), JSON.stringify({ name: '@caplock/pixelwall-cli', version: '0.1.0', type: 'module', description: 'PixelWall local pixel art command line tools', bin: {pixelwall:'./pixelwall.mjs'}, engines:{node:'>=22.13.0'}, license:'UNLICENSED', private:true }, null, 2));
await writeFile(join(cliOut, 'README.md'), '# PixelWall CLI\n\nRequires Node.js 22.13 or newer. Run `node pixelwall.mjs help`. No npm dependencies or server are required. Premium exports require your downloaded PW2 ownership license; pass `--license /path/license.txt`.\n');
await rm(desktopOut,{recursive:true,force:true});
await mkdir(desktopOut, { recursive: true });
await cp(webOut, desktopOut, { recursive: true, force: true });
console.log(`Standalone browser build: ${webOut}\nBundled CLI: ${cliOut}\nDesktop app assets: ${desktopOut}\nBuild: ${buildId}`);
