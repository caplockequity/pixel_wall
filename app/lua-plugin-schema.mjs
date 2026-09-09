/** Data-only package command boundary. Host options enable it; Lua input cannot. */
export const LUA_PLUGIN_LIMITS = Object.freeze({ commands: 32, bytes: 65536, preferenceNodes: 4096, preferenceDepth: 12, stringBytes: 16384 });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const fail = message => { throw Error(`Lua package: ${message}`); };
function object(value, label) { if (!record(value)) fail(`${label} must be a plain object.`); return value; }
function keys(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unsupported ${label} property: ${key}.`); }
function text(value, label, max = 512) { if (typeof value !== 'string' || new TextEncoder().encode(value).length > max || value.includes('\0') || [...value].some(character => { const point = character.codePointAt(0); return point >= 0xd800 && point <= 0xdfff; })) fail(`${label} must be UTF-8 text of at most ${max} bytes.`); return value; }
function size(value, label) { let json; try { json = JSON.stringify(value); } catch { fail(`${label} must be serializable.`); } if (!json || new TextEncoder().encode(json).length > LUA_PLUGIN_LIMITS.bytes) fail(`${label} exceeds 64 KiB.`); }

/** Safe to use before reading saved preferences into a worker. Empty arrays normalize
 * to empty Lua tables; null, sparse arrays, metatables/userdata and unsafe keys are unsupported. */
export function validatePluginPreferences(input = {}) {
  object(input, 'Preferences'); let nodes = 0; const ancestors = new Set();
  function copy(value, depth) {
    if (++nodes > LUA_PLUGIN_LIMITS.preferenceNodes || depth > LUA_PLUGIN_LIMITS.preferenceDepth) fail('Preferences exceed the depth or value-count limit.');
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return text(value, 'Preference string', LUA_PLUGIN_LIMITS.stringBytes);
    if (typeof value === 'number') { if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('Preference numbers must be finite and within the exact JavaScript range.'); return value; }
    if (!value || typeof value !== 'object' || !Array.isArray(value) && !record(value)) fail('Preferences support only plain Lua/JSON tables, strings, booleans and finite numbers.');
    if (ancestors.has(value)) fail('Preferences cannot be circular.'); ancestors.add(value);
    let output;
    if (Array.isArray(value)) {
      if (value.length > LUA_PLUGIN_LIMITS.preferenceNodes || Reflect.ownKeys(value).length !== value.length + 1) fail('Preference arrays must be dense and bounded.');
      output = value.length ? Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail('Preference arrays must have dense data values without accessors.');
        return copy(descriptor.value, depth + 1);
      }) : {};
    } else {
      output = {};
      const names = Reflect.ownKeys(value);
      if (names.some(key => typeof key !== 'string')) fail('Preference keys must be strings.');
      for (const key of names.sort()) {
        text(key, 'Preference key', 128); if (unsafe.has(key)) fail('Unsafe preference key.');
        const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail('Preference accessors and hidden properties are unsupported.');
        output[key] = copy(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(value); return output;
  }
  const result = copy(input, 0); size(result, 'Preferences'); return result;
}
export function validatePluginOptions(input) {
  object(input, 'Plugin options'); keys(input, ['name', 'displayName', 'version', 'preferences'], 'plugin option');
  const name = text(input.name, 'Package name', 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || unsafe.has(name)) fail('Package name is invalid.');
  const version = text(input.version, 'Package version', 80); if (!version) fail('Package version is required.');
  return { name, displayName: text(input.displayName ?? name, 'Package display name', 240), version, preferences: validatePluginPreferences(input.preferences) };
}
export function validatePluginCatalog(input, expected) {
  object(input, 'Command catalog'); size(input, 'Command catalog'); keys(input, ['name', 'displayName', 'version', 'commands'], 'command catalog');
  if (!expected || input.name !== expected.name || input.displayName !== expected.displayName || input.version !== expected.version) fail('Command catalog package identity does not match the selected package.');
  if (!Array.isArray(input.commands) || !input.commands.length || input.commands.length > LUA_PLUGIN_LIMITS.commands) fail('A package session must register 1–32 commands.');
  const ids = new Set();
  const commands = input.commands.map(raw => {
    object(raw, 'Command'); keys(raw, ['id', 'title', 'group', 'enabled', 'checked'], 'command');
    const id = text(raw.id, 'Command ID', 128); if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]*$/.test(id) || unsafe.has(id) || ids.has(id)) fail('Command IDs must be unique safe identifiers.'); ids.add(id);
    const title = text(raw.title ?? id, 'Command title', 512), group = text(raw.group ?? '', 'Command group', 256);
    if (typeof raw.enabled !== 'boolean' || own(raw, 'checked') && typeof raw.checked !== 'boolean') fail('Command enabled/checked states must be booleans.');
    return { id, title, group, enabled: raw.enabled, ...(own(raw, 'checked') ? { checked: raw.checked } : {}) };
  });
  return { name: expected.name, displayName: expected.displayName, version: expected.version, commands };
}
export function validatePluginChoice(input, catalog) {
  object(input, 'Command choice'); keys(input, ['action', 'commandId'], 'command choice');
  if (input.action === 'cancel') { if (own(input, 'commandId')) fail('A cancelled choice cannot execute a command.'); return { action: 'cancel' }; }
  if (input.action !== 'run' || typeof input.commandId !== 'string') fail('Choose one package command or cancel.');
  const command = catalog.commands.find(command => command.id === input.commandId);
  if (!command?.enabled) fail('The chosen command is missing or disabled.');
  return { action: 'run', commandId: command.id };
}
export function validatePluginResult(input, expected, commandId) {
  object(input, 'Plugin result'); keys(input, ['name', 'version', 'commandId', 'preferences', 'preferencesChanged'], 'plugin result');
  if (!expected || input.name !== expected.name || input.version !== expected.version || input.commandId !== commandId) fail('Plugin result does not match the chosen package command.');
  const preferences = validatePluginPreferences(input.preferences);
  return { name: expected.name, version: expected.version, commandId, preferences, preferencesChanged: JSON.stringify(preferences) !== JSON.stringify(validatePluginPreferences(expected.preferences)) };
}
