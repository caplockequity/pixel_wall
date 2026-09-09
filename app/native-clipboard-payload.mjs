/** Pure codecs. The host performs working-profile ↔ sRGB conversion before/after these calls. */
import { readPng, writePng } from './formats.mjs';
import { clipboardBytes, clipboardDimensions, inspectClipboardPng } from '../desktop/clipboard-payload.mjs';

/** Input RGBA must already be the final sRGB selection composite. Zero mask pixels become transparent. */
export function encodeClipboardImage({ width, height, rgba, mask = null }) {
  clipboardDimensions(width, height);
  const source = clipboardBytes(rgba);
  if (source.length !== width * height * 4) throw new Error('Clipboard RGBA length does not match image dimensions.');
  const selected = mask == null ? null : clipboardBytes(mask);
  if (selected && selected.length !== width * height) throw new Error('Clipboard selection mask length does not match image dimensions.');
  const pixels = new Uint8Array(source);
  if (selected) for (let i = 0; i < selected.length; i++) if (!selected[i]) pixels.fill(0, i * 4, i * 4 + 4);
  const bytes = writePng(width, height, pixels);
  inspectClipboardPng(bytes, { requireSrgb: true });
  return { format: 'png', width, height, bytes };
}

/** Preserve source colorProfile and decoder warnings. Untagged native images require the host's sRGB assumption. */
export function decodeClipboardImage(payload) {
  if (!payload || payload.format !== 'png' || payload.status && payload.status !== 'image') throw new Error('The clipboard does not contain a supported image.');
  const bytes = clipboardBytes(payload.bytes, { copy: true }), info = inspectClipboardPng(bytes);
  if (payload.width != null && payload.width !== info.width || payload.height != null && payload.height !== info.height) throw new Error('Clipboard image dimensions do not match the PNG.');
  const result = readPng(bytes);
  return { ...result, source: payload.source || 'png', profilePreserved: payload.profilePreserved !== false };
}
