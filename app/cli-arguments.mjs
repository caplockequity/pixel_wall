/** CLI parsing preserves option/file order separately from output-wide options. */
import { validateExportScale } from './export-scale.mjs';
import { MAX_ORDERED_SCALES } from './export-transform.mjs';
const SCOPED = new Set(['layer', 'ignore-layer', 'all-layers', 'split-layers', 'split-tags', 'play-subtags', 'split-slices', 'split-grid', 'clip', 'tag', 'frame-tag', 'frame-range', 'frame', 'slice', 'grid']);
const BOOLEAN = new Set(['help', 'include-reference-layers', 'trim', 'trim-sprite', 'ignore-empty', 'all-layers', 'split-layers', 'split-tags', 'play-subtags', 'split-slices', 'split-grid', 'power-of-two', 'power-of-two-size', 'ordered-inputs']);
const REPEAT = new Set(['layer', 'ignore-layer']);
const fail = message => { throw Error(message); };

/** Global behavior is unchanged unless --ordered-inputs is explicitly enabled.
 * Ordered selectors persist for following inputs; scalar/boolean values replace,
 * repeated layer selectors accumulate, and each input owns a defensive snapshot. */
export function parseCliArguments(argv) {
  const args = { _: [] }, events = [];
  const positional = value => { args._.push(value); events.push({ filename: value }); };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--') { argv.slice(i + 1).forEach(positional); break; }
    if (!value.startsWith('--')) { positional(value); continue; }
    const eq = value.indexOf('='), rawKey = value.slice(2, eq < 0 ? undefined : eq), key = rawKey === 'import-layer' ? 'layer' : rawKey;
    if (!key || ['__proto__', 'prototype', 'constructor', '_'].includes(key)) fail('Invalid option.');
    let parsed;
    if (BOOLEAN.has(key)) {
      const next = eq >= 0 ? value.slice(eq + 1) : ['true', 'false'].includes(argv[i + 1]) ? argv[++i] : true;
      if (![true, 'true', 'false'].includes(next)) fail(`--${key} requires true or false.`);
      parsed = next === true || next === 'true';
    } else if (eq >= 0) parsed = value.slice(eq + 1);
    else if (key === 'extrude' && (!argv[i + 1] || !/^\d+$/.test(argv[i + 1]))) parsed = true;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) parsed = argv[++i];
    else fail(`--${key} requires a value.`);
    if (REPEAT.has(key)) (args[key] ??= []).push(parsed); else args[key] = parsed;
    events.push({ key, value: parsed });
  }
  const orderedInputs = args['ordered-inputs'] === true;
  if (orderedInputs && args._[0] !== 'export' && args._[0] !== 'help' && !args.help) fail('--ordered-inputs is available for export only.');
  if (!orderedInputs) return { args, orderedInputs: false, inputs: args._.slice(1).map(filename => ({ filename, options: {} })) };
  const state = {}, inputs = [];
  let commandSeen = false, orderedScaleCount = 0;
  for (const event of events) {
    if (event.filename !== undefined) {
      if (!commandSeen) commandSeen = true;
      else inputs.push({ filename: event.filename, options: structuredClone(state), transforms: [] });
    } else if (event.key === 'scale') {
      const factor = validateExportScale(event.value);
      if (++orderedScaleCount > MAX_ORDERED_SCALES) fail(`Ordered exports allow at most ${MAX_ORDERED_SCALES} scale operations.`);
      for (const input of inputs) input.transforms.push({ type: 'scale', factor });
    } else if (SCOPED.has(event.key)) {
      const key = ['clip', 'frame-tag'].includes(event.key) ? 'tag' : event.key;
      if (REPEAT.has(key)) (state[key] ??= []).push(event.value); else state[key] = event.value;
      if (key === 'split-grid' && event.value === false) delete state.grid;
    }
  }
  for (const key of SCOPED) delete args[key];
  delete args.scale;
  return { args, orderedInputs: true, inputs, orderedScaleCount };
}
