/** Image-only clipboard limits, shared by renderer codecs and the main process. */
export const CLIPBOARD_MAX_PIXELS = 4 * 1024 * 1024;
export const CLIPBOARD_MAX_BYTES = 32 * 1024 * 1024;
export function clipboardDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > CLIPBOARD_MAX_PIXELS) throw new Error('Clipboard images must contain at most 4 million pixels.');
  return { width, height };
}
export function clipboardBytes(value, { copy = false, maxBytes = CLIPBOARD_MAX_BYTES } = {}) {
  const bytes = value instanceof Uint8Array || value instanceof Uint8ClampedArray ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  if (!bytes || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error('Clipboard image bytes are missing, shared, or exceed the size limit.');
  return copy ? new Uint8Array(bytes) : bytes;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n; for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0;
});
function checksum(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
/** Validate dimensions BEFORE native decoding or PNG inflation. Never inflate here. */
export function inspectClipboardPng(input, { requireSrgb = false } = {}) {
  const bytes = clipboardBytes(input);
  if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) throw new Error('The clipboard image must be a PNG.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw new Error('Invalid clipboard PNG header.');
  const { width, height } = clipboardDimensions(view.getUint32(16), view.getUint32(20));
  const depth = bytes[24], color = bytes[25];
  if (!({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] })[color]?.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) throw new Error('Unsupported clipboard PNG encoding.');
  let offset = 8, count = 0, ended = false, imageData = false, hasIcc = false, hasSrgb = false;
  while (offset < bytes.length) {
    if (++count > 4096 || offset + 12 > bytes.length) throw new Error('Clipboard PNG contains too many or incomplete chunks.');
    const size = view.getUint32(offset), end = offset + size + 12;
    if (end > bytes.length) throw new Error('Truncated clipboard PNG.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || checksum(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error('Clipboard PNG checksum or chunk type is invalid.');
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('The image clipboard supports one PNG image at a time.');
    if (type === 'IHDR' && offset !== 8) throw new Error('Duplicate clipboard PNG header.');
    if (type === 'IDAT') imageData = true;
    if (type === 'iCCP') hasIcc = true;
    if (type === 'sRGB') { if (size !== 1 || bytes[offset + 8] > 3) throw new Error('Invalid clipboard PNG color space.'); hasSrgb = true; }
    if (type === 'IEND') { if (size !== 0 || end !== bytes.length) throw new Error('Unexpected bytes after clipboard PNG end.'); ended = true; }
    if (/^[A-Z]/.test(type) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) throw new Error('Unsupported critical clipboard PNG chunk.');
    offset = end;
  }
  if (!ended || !imageData) throw new Error('Incomplete clipboard PNG.');
  if (requireSrgb && (!hasSrgb || hasIcc)) throw new Error('Convert clipboard pixels to sRGB before copying.');
  return { width, height, hasIcc, hasSrgb };
}
