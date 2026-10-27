import test from "node:test";
import assert from "node:assert/strict";
import { createBlankProject, stringifyProject, stringifyProjectBytes, parseProject, parseProjectBytes, encodeProjectContainer, decodeProjectContainer, isProjectContainer } from "../app/project-format.mjs";

test("compact project container round-trips the runtime project and is smaller than JSON", () => {
  const { project, editor } = createBlankProject({ size: 64, name: "Layered river" });
  const json = stringifyProject(project, editor);
  const bytes = stringifyProjectBytes(project, editor);
  assert.equal(isProjectContainer(bytes), true);
  assert.ok(bytes.byteLength < Buffer.byteLength(json), `${bytes.byteLength} should be less than ${json.length}`);
  const reopened = parseProjectBytes(bytes);
  assert.deepEqual(reopened.project, parseProject(json).project);
  assert.deepEqual(reopened.editor, parseProject(json).editor);
});

test("legacy JSON bytes remain readable", () => {
  const { project, editor } = createBlankProject({ size: 8, name: "Legacy" });
  const legacy = stringifyProject(project, editor, { pretty: true });
  const decoded = parseProjectBytes(new TextEncoder().encode(legacy));
  assert.equal(decoded.project.name, "Legacy");
  assert.equal(decoded.migratedFrom, 3);
  assert.equal(parseProject(new TextEncoder().encode(legacy)).project.name, "Legacy");
});

test("container rejects truncation, corruption, and oversized declarations", () => {
  const source = encodeProjectContainer({ format: "pixelwall-document", version: 4, name: "safe" });
  assert.throws(() => decodeProjectContainer(source.subarray(0, source.length - 1)), /corrupt|incomplete|integrity|payload/i);
  const corrupt = new Uint8Array(source);
  corrupt[corrupt.length - 1] ^= 0xff;
  assert.throws(() => decodeProjectContainer(corrupt), /corrupt|integrity/i);
  const oversized = new Uint8Array(source);
  new DataView(oversized.buffer).setUint32(8, 0xffffffff, true);
  assert.throws(() => decodeProjectContainer(oversized), /unsupported uncompressed size/i);
  assert.throws(() => decodeProjectContainer(new Uint8Array(65 * 1024 * 1024)), /exceeds the supported size limit/i);
  assert.throws(() => encodeProjectContainer({ ok: true }, { maxBytes: 20 }), /Compressed project exceeds the supported size limit/i);
  const expanded = new Uint8Array(encodeProjectContainer({ payload: "x".repeat(4096) }));
  const expandedView = new DataView(expanded.buffer);
  expandedView.setUint32(8, 1, true);
  expandedView.setUint32(12, 0x00620062, true); // Adler-32 for the first JSON byte, while compressed data still expands fully.
  assert.throws(() => decodeProjectContainer(expanded), /expands beyond its declared size/i);
});

test("large repetitive layered payload compresses substantially", () => {
  const layers = Array.from({ length: 7 }, (_, layer) => ({ id: `layer-${layer}`, name: `Layer ${layer}`, visible: true, opacity: 100 }));
  const frames = Array.from({ length: 4 }, (_, frame) => ({ id: `frame-${frame}`, cels: Object.fromEntries(layers.map(layer => [layer.id, { imageId: `${layer.id}-${frame}`, pixels: ["#70d6b2ff"] }])) }));
  const value = { format: "pixelwall-document", version: 4, width: 600, height: 350, layers, frames, filler: "river".repeat(10000) };
  const json = new TextEncoder().encode(JSON.stringify(value));
  const packed = encodeProjectContainer(value);
  assert.ok(packed.length < json.length / 4, `${packed.length} should be less than one quarter of ${json.length}`);
  assert.deepEqual(decodeProjectContainer(packed), value);
});
