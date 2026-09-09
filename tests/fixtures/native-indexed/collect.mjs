// Original corpus packer. Run the sibling Lua script with the reference native
// executable into an explicitly chosen directory, then pass that directory here.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const directory = process.argv[2];
if (!directory) throw Error('Pass the explicit oracle output directory.');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'))), sources = {}, jobs = [];
for (const item of manifest) {
 const source = await readFile(resolve(directory, `${item.name}-source.aseprite`));
 const key = createHash('sha256').update(source).digest('hex'); sources[key] = source.toString('base64');
 const native = await readFile(resolve(directory, `${item.name}-indexed.aseprite`));
 const frames = []; for (let i = 1; i <= item.frames; i++) frames.push((await readFile(resolve(directory, `${item.name}-${i}.rgba`))).toString('base64'));
 jobs.push({ ...item, source: key, native: native.toString('base64'), rgba: frames });
}
await writeFile(new URL('./corpus.json', import.meta.url), JSON.stringify({ version: '1.3.18.5-dev', apiVersion: 41, sources, jobs }));
console.log(`Packed ${jobs.length} original jobs, ${Object.keys(sources).length} distinct native sources.`);
