/** Portable lossless project container shared by web, CLI, and packaged desktop. */
import { strToU8, Unzlib, zlibSync } from "fflate";

export const PROJECT_CONTAINER_VERSION = 1;
export const PROJECT_CONTAINER_MAGIC = "PWPZ";
export const MAX_PROJECT_CONTAINER_BYTES = 64 * 1024 * 1024;
const PROJECT_CONTAINER_HEADER_BYTES = 20;
const PROJECT_CONTAINER_MAGIC_BYTES = strToU8(PROJECT_CONTAINER_MAGIC);

function checksum(bytes) {
  let a = 1, b = 0;
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

export class ProjectFormatError extends Error {
  constructor(message, code = "INVALID_PROJECT") {
    super(message);
    this.name = "ProjectFormatError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProjectFormatError(message, code);
}

function parseInput(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    fail("Project file is not valid JSON", "INVALID_JSON");
  }
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail("Project data must be text or bytes", "INVALID_PROJECT_DATA");
}

function hasContainerMagic(bytes) {
  return bytes.length >= PROJECT_CONTAINER_MAGIC_BYTES.length && PROJECT_CONTAINER_MAGIC_BYTES.every((byte, index) => bytes[index] === byte);
}

/** Return true for the compact native container, without parsing its payload. */
export function isProjectContainer(value) {
  try { return hasContainerMagic(asBytes(value)); } catch { return false; }
}

/** Encode any JSON-compatible PixelWall payload in the compact native container. */
export function encodeProjectContainer(value, options = {}) {
  let text;
  try { text = JSON.stringify(value); } catch (error) { fail(`Project data could not be serialized: ${error.message}`, "INVALID_PROJECT_DATA"); }
  if (typeof text !== "string") fail("Project data could not be serialized", "INVALID_PROJECT_DATA");
  const raw = strToU8(text);
  const limit = options.maxBytes ?? MAX_PROJECT_CONTAINER_BYTES;
  if (raw.length > limit) fail(`Project data exceeds the ${Math.round(limit / 1024 / 1024)} MB limit`, "PROJECT_TOO_LARGE");
  const compressed = zlibSync(raw, { level: options.level ?? 9 });
  if (compressed.length + PROJECT_CONTAINER_HEADER_BYTES > limit) fail("Compressed project exceeds the supported size limit", "PROJECT_TOO_LARGE");
  const bytes = new Uint8Array(PROJECT_CONTAINER_HEADER_BYTES + compressed.length);
  bytes.set(PROJECT_CONTAINER_MAGIC_BYTES, 0);
  bytes[4] = PROJECT_CONTAINER_VERSION;
  bytes[5] = 0;
  new DataView(bytes.buffer).setUint32(8, raw.length, true);
  new DataView(bytes.buffer).setUint32(12, checksum(raw), true);
  new DataView(bytes.buffer).setUint32(16, checksum(compressed), true);
  bytes.set(compressed, PROJECT_CONTAINER_HEADER_BYTES);
  return bytes;
}

function boundedUnzlib(bytes, maximum) {
  const chunks = [];
  let length = 0;
  const stream = new Unzlib((chunk) => {
    if (length + chunk.length > maximum) fail("Project container expands beyond its declared size", "PROJECT_TOO_LARGE");
    if (chunk.length) { chunks.push(chunk); length += chunk.length; }
  });
  // Limit each inflate step to a small bounded expansion before its callback.
  const chunkSize = 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize);
    stream.push(bytes.subarray(offset, end), end === bytes.length);
  }
  if (bytes.length === 0) fail("Project container payload is invalid", "INVALID_CONTAINER");
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/** Decode compact or legacy project bytes, validating bounds, compression and JSON. */
export function decodeProjectContainer(value, options = {}) {
  const bytes = asBytes(value);
  const limit = options.maxBytes ?? MAX_PROJECT_CONTAINER_BYTES;
  if (bytes.length > limit) fail("Project file exceeds the supported size limit", "PROJECT_TOO_LARGE");
  if (!hasContainerMagic(bytes)) {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { fail("Project file is not valid UTF-8", "INVALID_ENCODING"); }
    return parseInput(text);
  }
  if (bytes.length < PROJECT_CONTAINER_HEADER_BYTES) fail("Project container header is truncated", "INVALID_CONTAINER");
  if (bytes[4] !== PROJECT_CONTAINER_VERSION) fail(`Project container version ${bytes[4]} is not supported`, "UNSUPPORTED_CONTAINER");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedLength = view.getUint32(8, true);
  const expectedChecksum = view.getUint32(12, true);
  const expectedCompressedChecksum = view.getUint32(16, true);
  if (!expectedLength || expectedLength > limit) fail("Project container declares an unsupported uncompressed size", "PROJECT_TOO_LARGE");
  const compressed = bytes.subarray(PROJECT_CONTAINER_HEADER_BYTES);
  if (!compressed.length || compressed.length > limit) fail("Project container payload is invalid", "INVALID_CONTAINER");
  if (checksum(compressed) !== expectedCompressedChecksum) fail("Project container integrity check failed", "INVALID_CONTAINER");
  let raw;
  try { raw = boundedUnzlib(compressed, expectedLength); }
  catch (error) {
    if (error instanceof ProjectFormatError) throw error;
    fail("Project container is corrupt or incomplete", "INVALID_CONTAINER");
  }
  if (raw.length !== expectedLength) fail("Project container integrity check failed", "INVALID_CONTAINER");
  if (checksum(raw) !== expectedChecksum) fail("Project container integrity check failed", "INVALID_CONTAINER");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { fail("Project container payload is not valid UTF-8", "INVALID_ENCODING"); }
  return parseInput(text);
}

