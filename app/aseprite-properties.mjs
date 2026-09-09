/** Native property maps from the published Aseprite file format; bounded JSON value subset. */
const MAX_BYTES = 1024 * 1024, MAX_ITEMS = 16384, MAX_DEPTH = 24;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const fail = message => { throw Error(`Sprite properties: ${message}`); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function decodeAsepriteProperties(input) {
  if (input == null) return {};
  if (!Array.isArray(input) && !(input instanceof Uint8Array)) fail('expected bytes.');
  if (input.length > MAX_BYTES || !Array.from(input).every(v => Number.isInteger(v) && v >= 0 && v <= 255)) fail('invalid bytes or size limit.');
  const bytes = Uint8Array.from(input), view = new DataView(bytes.buffer); let at = 0, items = 0;
  const take = n => { if (n < 0 || at + n > bytes.length) fail('truncated data.'); const start = at; at += n; return start; };
  const u8 = () => view.getUint8(take(1)), u16 = () => view.getUint16(take(2), true), u32 = () => view.getUint32(take(4), true);
  // Keep the length read separate: subarray must begin after the length field.
  const text = () => { const length = u16(); return decoder.decode(bytes.subarray(take(length), at)); };
  function value(type, depth) {
    if (++items > MAX_ITEMS || depth > MAX_DEPTH) fail('item or nesting limit.');
    let result;
    if (type === 1) return u8() !== 0;
    if (type === 2) return view.getInt8(take(1)); if (type === 3) return u8();
    if (type === 4) return view.getInt16(take(2), true); if (type === 5) return u16();
    if (type === 6) return view.getInt32(take(4), true); if (type === 7) return u32();
    if (type === 8 || type === 9) { const offset = take(8), big = type === 8 ? view.getBigInt64(offset, true) : view.getBigUint64(offset, true); result = Number(big); if (!Number.isSafeInteger(result)) fail('64-bit integer exceeds exact JavaScript range.'); return result; }
    if (type === 10) return view.getInt32(take(4), true) / 65536;
    if (type === 11 || type === 12) { result = type === 11 ? view.getFloat32(take(4), true) : view.getFloat64(take(8), true); if (!Number.isFinite(result)) fail('nonfinite number.'); return result; }
    if (type === 13) return text();
    if (type === 17) { const count = u32(), elementType = u16(); if (count > MAX_ITEMS - items) fail('vector item limit.'); return Array.from({ length: count }, () => value(elementType || u16(), depth + 1)); }
    if (type === 18) return map(depth + 1);
    fail(`unsupported value type 0x${type.toString(16)}; existing bytes are preserved until this object is edited.`);
  }
  function map(depth) { if (depth > MAX_DEPTH) fail('nesting limit.'); const count = u32(), result = Object.create(null); if (count > MAX_ITEMS - items) fail('map item limit.'); for (let i = 0; i < count; i++) { const key = text(); if (Object.hasOwn(result, key)) fail('duplicate property name.'); result[key] = value(u16(), depth); } return result; }
  if (u32() !== bytes.length) fail('declared block size mismatch.');
  const count = u32(), result = Object.create(null); if (count > MAX_ITEMS) fail('too many property maps.');
  for (let i = 0; i < count; i++) { const key = u32(); if (Object.hasOwn(result, key)) fail('duplicate property map.'); result[key] = map(0); }
  if (at !== bytes.length) fail('trailing data.'); return result;
}
export function encodeAsepriteProperties(maps) {
  if (!plain(maps)) fail('expected property maps.');
  const out = []; let items = 0;
  const raw = bytes => { if (out.length + bytes.length > MAX_BYTES) fail('byte limit.'); for (const byte of bytes) out.push(byte); };
  const numeric = (n, size, setter) => { const bytes = new Uint8Array(size); new DataView(bytes.buffer)[setter](0, n, true); raw(bytes); };
  const u16 = n => numeric(n, 2, 'setUint16'), u32 = n => numeric(n, 4, 'setUint32');
  const text = value => { const bytes = encoder.encode(value); if (bytes.length > 65535) fail('string exceeds native limit.'); u16(bytes.length); raw(bytes); };
  function value(v, depth) {
    if (++items > MAX_ITEMS || depth > MAX_DEPTH) fail('item or nesting limit.');
    if (typeof v === 'boolean') { u16(1); raw([Number(v)]); }
    else if (typeof v === 'number') { if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) fail('nonfinite or inexact number.'); if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) { u16(6); numeric(v, 4, 'setInt32'); } else { u16(12); numeric(v, 8, 'setFloat64'); } }
    else if (typeof v === 'string') { u16(13); text(v); }
    else if (Array.isArray(v)) { u16(17); u32(v.length); u16(0); for (const item of v) value(item, depth + 1); }
    else if (plain(v)) { u16(18); map(v, depth + 1); }
    else fail('only booleans, exact numbers, strings, vectors and maps are supported.');
  }
  function map(values, depth) { if (depth > MAX_DEPTH) fail('nesting limit.'); if (!plain(values)) fail('expected a property map.'); const entries = Object.entries(values); if (entries.length > MAX_ITEMS - items) fail('item limit.'); u32(entries.length); for (const [key, v] of entries) { text(key); value(v, depth); } }
  u32(0); const entries = Object.entries(maps); u32(entries.length);
  for (const [key, values] of entries) { const id = Number(key); if (!Number.isInteger(id) || id < 0 || id > 0xffffffff || String(id) !== key) fail('invalid map ID.'); u32(id); map(values, 0); }
  const result = Uint8Array.from(out); new DataView(result.buffer).setUint32(0, result.length, true); return Array.from(result);
}
export function validateAsepriteUserData(value) {
  if (!plain(value) || Object.keys(value).some(key => !['text', 'color', 'propertiesBytes'].includes(key))) fail('invalid user data fields.');
  if (value.text != null && (typeof value.text !== 'string' || encoder.encode(value.text).length > 65535)) fail('text exceeds native limit.');
  if (value.color != null && (typeof value.color !== 'string' || !/^#[0-9a-f]{8}$/i.test(value.color))) fail('invalid user color.');
  if (value.propertiesBytes != null) decodeAsepriteProperties(value.propertiesBytes);
  return structuredClone(value);
}
