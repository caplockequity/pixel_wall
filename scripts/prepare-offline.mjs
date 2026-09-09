#!/usr/bin/env node
/** Run AFTER `vinext build`: node scripts/prepare-offline.mjs [dist/client].
 * Emits a complete same-origin bundle inventory and a deterministic worker ID.
 */
import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const output = resolve(process.argv[2] ?? 'dist/client');
async function walk(directory) { const result = []; for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) result.push(...await walk(path)); else result.push(path); } return result; }
await access(output);
const files = (await walk(output)).filter((path) => /\.(?:m?js|css|wasm|png|svg|ico|woff2?)$/.test(path) && !path.endsWith('/sw.js'));
const assets = files.map((path) => '/' + relative(output, path).split('\\').join('/')).sort();
const hash = createHash('sha256');
for (const path of files.sort()) { hash.update(relative(output, path)); hash.update(await readFile(path)); }
const template = await readFile(resolve('public/sw.js'), 'utf8');
hash.update(template);
const buildId = hash.digest('hex').slice(0, 16);
await writeFile(join(output, 'offline-assets.json'), JSON.stringify({ version: 1, buildId, assets }));
await writeFile(join(output, 'sw.js'), template.replaceAll('__PIXELWALL_BUILD_ID__', buildId));
console.log(`Offline shell prepared: ${assets.length} assets, build ${buildId}`);
