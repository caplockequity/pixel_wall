import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createDocument, applyCommand, renderFrame, normalizeDocument } from '../app/editor-core.mjs';
import { writePng, encodeGif } from '../app/formats.mjs';

const root = new URL('../', import.meta.url);
const publicExamples = new URL('public/examples/', root);
await mkdir(publicExamples, { recursive: true });

const readBatch = async (name) => JSON.parse(await readFile(new URL(`public/examples/${name}`, root), 'utf8'));
const saveProject = async (name, document) => writeFile(new URL(`public/examples/${name}`, root), `${JSON.stringify(normalizeDocument(document), null, 2)}\n`);
const savePreview = async (name, document) => writeFile(new URL(`public/examples/${name}`, root), writePng(document.width, document.height, renderFrame(document, document.frames[0].id)));
const saveGif = async (name, document) => writeFile(new URL(`public/examples/${name}`, root), encodeGif(document.frames.map((frame) => ({ width: document.width, height: document.height, durationMs: frame.durationMs, rgba: renderFrame(document, frame.id) }))));

const shapeDocument = createDocument({ id: 'isometric-shapes-example', name: 'Isometric Shape Foundation', width: 128, height: 96 });
const shapeBatch = await readBatch('isometric-shapes.json');
const shapeResult = shapeBatch.reduce((document, command) => applyCommand(document, command), shapeDocument);
await saveProject('isometric-shapes.pixelwall', shapeResult);
await savePreview('isometric-shapes-preview.png', shapeResult);

const waterDocument = createDocument({ id: 'isometric-water-example', name: 'Isometric Stream', width: 96, height: 80 });
const waterBatch = await readBatch('isometric-water.json');
const waterResult = waterBatch.reduce((document, command) => applyCommand(document, command), waterDocument);
await saveProject('isometric-water.pixelwall', waterResult);
await savePreview('isometric-water-preview.png', waterResult);
await saveGif('isometric-water-preview.gif', waterResult);

console.log('Exported isometric shape and water examples to public/examples/.');
