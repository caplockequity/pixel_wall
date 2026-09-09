/** UI colors cross the worker boundary as copied, unambiguous RGBA byte arrays. */
export function validateLuaColor(value, label = 'Lua color') {
  if (!Array.isArray(value) || value.length !== 4 || Array.from(value).some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255))
    throw Error(`${label} must be an RGBA array of four integers from 0 to 255.`);
  return [...value];
}
