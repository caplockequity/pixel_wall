/** Data-only Dialog boundary. No Lua callbacks, DOM, or JavaScript objects cross it. */
export const LUA_DIALOG_LIMITS = Object.freeze({ controls: 64, bytes: 65536, requests: 32, waitMs: 120000, totalWaitMs: 300000 });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = text => { throw Error(`Lua Dialog: ${text}`); };
function object(value, label) { if (!record(value)) fail(`${label} must be an object.`); return value; }
function keys(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unsupported ${label} property: ${key}.`); }
function text(value, label, max = 512) { if (typeof value !== 'string' || new TextEncoder().encode(value).length > max || value.includes('\0')) fail(`${label} must be text of at most ${max} bytes.`); return value; }
function bool(value, label, fallback = false) { if (value === undefined) return fallback; if (typeof value !== 'boolean') fail(`${label} must be a boolean.`); return value; }
function number(value, label, integer = false) { if (!Number.isFinite(value) || Math.abs(value) > 1e9 || (integer && !Number.isInteger(value))) fail(`${label} must be ${integer ? 'an integer' : 'a finite number'} within ±1000000000.`); return value; }
function color(value) { if (!Array.isArray(value) || value.length !== 4 || value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) fail('Color must contain four RGBA bytes.'); return [...value]; }
function size(value) { let serialized; try { serialized = JSON.stringify(value); } catch { fail('Dialog data must be serializable.'); } if (!serialized || new TextEncoder().encode(serialized).length > LUA_DIALOG_LIMITS.bytes) fail('Dialog data exceeds 64 KiB.'); }
const dataTypes = new Set(['entry', 'number', 'slider', 'check', 'combobox', 'color', 'button', 'label']);
export function validateDialogSchema(input) {
  object(input, 'schema'); size(input); keys(input, ['title', 'controls'], 'schema');
  const controls = Array.isArray(input.controls) ? input.controls : record(input.controls) && !Object.keys(input.controls).length ? [] : fail('Controls must be an array.');
  if (controls.length > LUA_DIALOG_LIMITS.controls) fail('A dialog supports at most 64 controls.');
  const seen = new Set(), ids = new Set();
  return { title: text(input.title ?? '', 'title'), controls: controls.map(raw => {
    object(raw, 'control');
    keys(raw, ['key', 'id', 'type', 'label', 'text', 'enabled', 'visible', 'focus', 'hexpand', 'vexpand', 'value', 'min', 'max', 'decimals', 'options', 'callback', 'always'], 'control');
    if (!dataTypes.has(raw.type) && !['separator', 'newrow'].includes(raw.type)) fail(`Unsupported control: ${String(raw.type)}.`);
    const key = text(raw.key, 'control key', 80); if (seen.has(key) || !/^w[1-9]\d*$/.test(key)) fail('Control keys must be unique internal widget identifiers.'); seen.add(key);
    const control = { key, type: raw.type, label: text(raw.label ?? '', 'label'), text: text(raw.text ?? '', 'text', raw.type === 'entry' ? 16384 : 512), enabled: bool(raw.enabled, 'enabled', true), visible: bool(raw.visible, 'visible', true), focus: bool(raw.focus, 'focus'), hexpand: bool(raw.hexpand, 'hexpand', true), vexpand: bool(raw.vexpand, 'vexpand') };
    if (raw.id !== undefined) { const id = text(raw.id, 'id', 128); if (!id || ids.has(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) fail('Widget IDs must be unique nonempty safe strings.'); ids.add(id); control.id = id; }
    if (raw.type === 'entry') control.value = text(raw.value ?? '', 'entry', 16384);
    if (raw.type === 'label') control.value = text(raw.value ?? raw.text ?? '', 'label text');
    if (raw.type === 'number') { control.decimals = number(raw.decimals ?? 0, 'decimals', true); if (control.decimals < 0 || control.decimals > 6) fail('Number fields support 0–6 decimal places.'); const factor = 10 ** control.decimals; control.value = Math.round(number(raw.value ?? 0, 'number') * factor) / factor; }
    if (raw.type === 'slider') { control.min = number(raw.min ?? 0, 'minimum', true); control.max = number(raw.max ?? 100, 'maximum', true); if (control.min > control.max) fail('Slider minimum exceeds maximum.'); control.value = number(raw.value ?? control.min, 'slider', true); if (control.value < control.min || control.value > control.max) fail('Slider value is outside its range.'); }
    if (['check', 'button'].includes(raw.type)) control.value = bool(raw.value, 'selected');
    if (raw.type === 'button') control.callback = bool(raw.callback, 'button callback');
    if (raw.type === 'newrow') control.always = bool(raw.always, 'always');
    if (raw.type === 'color') control.value = color(raw.value ?? [0, 0, 0, 255]);
    if (raw.type === 'combobox') { if (!Array.isArray(raw.options) || !raw.options.length || raw.options.length > 128) fail('Combobox requires 1–128 options.'); control.options = raw.options.map(option => text(option, 'option')); control.value = text(raw.value ?? control.options[0], 'selected option'); if (!control.options.includes(control.value)) fail('Combobox selection is not an available option.'); }
    return control;
  }) };
}
export function validateDialogResponse(input, schema) {
  object(input, 'response'); size(input); keys(input, ['action', 'button', 'values'], 'response');
  if (!['button', 'close'].includes(input.action)) fail('Response action must be button or close.');
  const controls = new Map(schema.controls.map(control => [control.key, control]));
  const button = input.action === 'button' ? controls.get(input.button) : null;
  if (input.action === 'button' && (!button || button.type !== 'button' || !button.visible || !button.enabled)) fail('The response button is unavailable.');
  if (input.action === 'close' && input.button !== undefined) fail('A close response cannot press a button.');
  const supplied = input.values ?? {}; object(supplied, 'values');
  for (const key of Object.keys(supplied)) if (!controls.has(key)) fail(`Unknown response control: ${key}.`);
  const values = {};
  for (const control of schema.controls) {
    let value = control.value;
    if (control.type === 'button') value = control.key === button?.key;
    if (own(supplied, control.key)) {
      if (['button', 'label', 'separator', 'newrow'].includes(control.type) || !control.enabled || !control.visible) fail('The response cannot change a disabled, hidden or read-only control.');
      value = supplied[control.key];
      if (control.type === 'entry') value = text(value, 'entry', 16384);
      if (control.type === 'number') { value = number(value, 'number'); const factor = 10 ** control.decimals; value = Math.round(value * factor) / factor; }
      if (control.type === 'slider') { value = number(value, 'slider', true); if (value < control.min || value > control.max) fail('Slider response is outside its range.'); }
      if (control.type === 'check') value = bool(value, 'check');
      if (control.type === 'combobox') { value = text(value, 'option'); if (!control.options.includes(value)) fail('Combobox response is not an available option.'); }
      if (control.type === 'color') value = color(value);
    }
    if (own(supplied, control.key)) values[control.key] = structuredClone(value);
  }
  return { action: input.action, ...(button ? { button: button.key } : {}), values };
}
