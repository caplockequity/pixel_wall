import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { parseCliArguments } from '../app/cli-arguments.mjs';
import { buildCliExportOutputs, main } from '../app/cli.mjs';
import { readAseprite, readPng } from '../app/formats.mjs';
const folder = new URL('./fixtures/cli-scopes/', import.meta.url);
const oracle = JSON.parse(await readFile(new URL('oracle.json', folder), 'utf8'));
const documents = Object.fromEntries(await Promise.all(['alpha.aseprite', 'beta.aseprite'].map(async name => [name, readAseprite(await readFile(new URL(name, folder))).document])));
for (const job of oracle.jobs) test(`native Aseprite ordered options: ${job.name}`, () => {
  const { args, inputs } = parseCliArguments(['export', '--ordered-inputs', ...job.argv, '--format', 'atlas', '--out', 'atlas.png', '--trim=false', '--padding', '0', '--filename-format', '{title}|{layer}|{frame}']);
  const { plan } = buildCliExportOutputs(inputs.map(input => ({ ...input, document: documents[input.filename] })), args);
  assert.equal(plan.entries.length, job.expected.length);
  plan.entries.forEach((entry, index) => {
    const expected = job.expected[index];
    assert.equal(inputs[entry.inputIndex].filename, expected.source);
    assert.equal(entry.width, expected.width); assert.equal(entry.height, expected.height); assert.equal(entry.durationMs, expected.durationMs);
    assert.deepEqual([...entry.rgba], expected.rgba, `every pixel in entry ${index}`);
  });
});

test('default global behavior and explicit false preserve existing trailing-flag commands', () => {
  for (const extra of [[], ['--ordered-inputs=false']]) {
    const result = parseCliArguments(['export', ...extra, 'alpha.aseprite', 'beta.aseprite', '--layer', 'base', '--tag', 'late']);
    assert.equal(result.orderedInputs, false); assert.deepEqual(result.args.layer, ['base']); assert.equal(result.args.tag, 'late');
    assert.deepEqual(result.inputs.map(input => input.options), [{}, {}]);
  }
});

test('scalar aliases replace in token order, booleans can reset, and snapshots never share arrays', () => {
  const { args, inputs } = parseCliArguments(['export', '--ordered-inputs', '--all-layers', '--clip', 'early', '--layer', 'base', 'alpha.aseprite', '--tag', 'late', '--all-layers=false', '--import-layer', 'hat', 'beta.aseprite', '--scale', '2', '--crop', '0,0,1,1', '--out', 'sheet.png']);
  assert.equal(inputs[0].options.tag, 'early'); assert.equal(inputs[1].options.tag, 'late');
  assert.equal(inputs[0].options['all-layers'], true); assert.equal(inputs[1].options['all-layers'], false);
  assert.deepEqual(inputs[0].options.layer, ['base']); assert.deepEqual(inputs[1].options.layer, ['base', 'hat']);
  inputs[1].options.layer.push('hidden'); assert.deepEqual(inputs[0].options.layer, ['base']);
  assert.equal(args.layer, undefined); assert.equal(args.tag, undefined); assert.equal(args.clip, undefined);
  assert.equal(args.scale, undefined); assert.deepEqual(inputs.map(input => input.transforms), [[{type:'scale',factor:2}],[{type:'scale',factor:2}]]); assert.equal(args.crop, '0,0,1,1'); assert.equal(args.out, 'sheet.png');
});

test('option parsing keeps file operands intact and blocks ambiguous/unsafe option keys', () => {
  const result = parseCliArguments(['--ordered-inputs', 'export', '--split-layers', 'alpha.aseprite', '--', '--beta.aseprite']);
  assert.deepEqual(result.args._, ['export', 'alpha.aseprite', '--beta.aseprite']);
  assert.equal(result.inputs[1].options['split-layers'], true);
  for (const argv of [['export', '--ordered-inputs=perhaps'], ['export', '--constructor', 'x'], ['render', '--ordered-inputs', 'a.pixelwall'], ['export', '--layer']]) assert.throws(() => parseCliArguments(argv));
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pixelwall-cli-scopes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = [];
  for (const [name, document] of Object.entries(documents)) { const file = join(directory, basename(name, '.aseprite') + '.pixelwall'); await writeFile(file, JSON.stringify(document)); files.push(file); }
  return { directory, files };
}
const pixel = image => [...image.rgba.slice(0, 4)];
test('real driver applies separate input ranges and does not inject frame zero over a scoped selection', async t => {
  const { directory, files } = await fixture(t), output = join(directory, 'frames');
  await main(['export', '--ordered-inputs', '--frame-range', '0,0', files[0], '--frame-range', '2,2', files[1], '--format', 'png', '--out-dir', output]);
  assert.deepEqual((await readdir(output)).sort(), ['alpha.png', 'beta.png']);
  assert.deepEqual(pixel(readPng(await readFile(join(output, 'alpha.png')))), [30, 50, 10, 255]);
  assert.deepEqual(pixel(readPng(await readFile(join(output, 'beta.png')))), [60, 150, 10, 255]);
  const single = join(directory, 'late.png');
  await main(['export', '--ordered-inputs', '--frame-range', '2,2', files[0], '--format', 'png', '--out', single]);
  assert.deepEqual(pixel(readPng(await readFile(single))), [30, 150, 10, 255]);
});

test('real driver can split only later inputs and keeps output collision protection', async t => {
  const { directory, files } = await fixture(t), output = join(directory, 'frames');
  await main(['export', '--ordered-inputs', '--frame', '0', files[0], '--split-layers', files[1], '--format', 'png', '--out-dir', output]);
  assert.deepEqual((await readdir(output)).sort(), ['alpha.png', 'beta (base).png', 'beta (hat).png']);
  const protectedOutput = join(directory, 'protected'); await mkdir(protectedOutput); await writeFile(join(protectedOutput, 'alpha.png'), 'retain original');
  await assert.rejects(main(['export', '--ordered-inputs', '--frame', '0', files[0], files[1], '--format', 'png', '--out-dir', protectedOutput]), /already exists/);
  assert.deepEqual(await readdir(protectedOutput), ['alpha.png']);
  assert.equal(await readFile(join(protectedOutput, 'alpha.png'), 'utf8'), 'retain original');
});

test('native editable output rejects scoped selections and paid formats still fail closed', async t => {
  const { directory, files } = await fixture(t);
  const native = join(directory, 'scoped.aseprite');
  await assert.rejects(main(['export', '--ordered-inputs', '--layer', 'hat', files[0], '--format', 'aseprite', '--out', native]), /preserve the complete project/);
  await assert.rejects(access(native));
  const previousLicense = process.env.PIXELWALL_PRO_LICENSE; process.env.PIXELWALL_PRO_LICENSE = '';
  t.after(() => previousLicense === undefined ? delete process.env.PIXELWALL_PRO_LICENSE : process.env.PIXELWALL_PRO_LICENSE = previousLicense);
  for (const format of ['gif', 'sheet', 'atlas', 'zip']) {
    const out = join(directory, `${format}-blocked`);
    await assert.rejects(main(['export', '--ordered-inputs', '--tag', 'early', files[0], '--tag', 'late', files[1], '--format', format, '--out', out]), /valid PixelWall Pro license/);
    await assert.rejects(access(out));
  }
});
