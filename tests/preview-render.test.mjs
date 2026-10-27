import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, applyCommand } from "../app/editor-core.mjs";
import { renderPreview, renderPreviewContactSheet, renderPreviewComparison } from "../app/preview-render.mjs";

const red = "#ff0000ff", blue = "#0000ffff";
const painted = (color = red) => applyCommand(createDocument({ width: 4, height: 3 }), { type: "draw.stroke", frameId: "frame-1", points: [{ x: 1, y: 1 }], color });

test("preview renders selected layer and crop with bounded nearest-neighbor scale", () => {
  let document = painted();
  document = applyCommand(document, { type: "layer.add", layer: { id: "blue" } });
  document = applyCommand(document, { type: "draw.stroke", frameId: "frame-1", layerId: "blue", points: [{ x: 3, y: 2 }], color: blue });
  const preview = renderPreview(document, { layerIds: ["layer-1"], crop: { x: 0, y: 0, width: 2, height: 2 }, scale: 2 });
  assert.equal(preview.width, 4); assert.equal(preview.height, 4); assert.equal(preview.rgba[(2 * 4 + 2) * 4 + 3], 255);
  assert.equal(preview.rgba[3], 0);
});

test("contact sheets preserve frame order and comparison reports changed pixels", () => {
  let before = painted();
  before = applyCommand(before, { type: "frame.duplicate", linked: false });
  const sheet = renderPreviewContactSheet(before, { frameIds: ["frame-1", "frame-2"], columns: 2, gap: 1 });
  assert.equal(sheet.kind, "contact-sheet"); assert.equal(sheet.columns, 2); assert.equal(sheet.rows, 1); assert.equal(sheet.width, 9); assert.equal(sheet.height, 3);
  const after = applyCommand(before, { type: "draw.stroke", frameId: "frame-2", points: [{ x: 0, y: 0 }], color: blue });
  const comparison = renderPreviewComparison(before, after, { frameId: "frame-2" });
  assert.equal(comparison.kind, "comparison"); assert.equal(comparison.changedPixels, 1); assert.equal(comparison.totalPixels, 12);
});

test("comparison honors independent baseline frame and layer selections", () => {
  let before = painted();
  before = applyCommand(before, { type: "layer.add", layer: { id: "old-layer" } });
  const after = applyCommand(before, { type: "layer.add", layer: { id: "new-layer" } });
  const selections = [];
  const comparison = renderPreviewComparison(before, after, {
    frameId: "frame-1",
    layerIds: ["new-layer"],
    beforeFrameId: "frame-1",
    beforeLayerIds: ["old-layer"],
    renderFrame: (document, frameId) => {
      selections.push({ frameId, visible: document.layers.filter(layer => layer.visible).map(layer => layer.id) });
      return new Uint8ClampedArray(document.width * document.height * 4);
    },
  });
  assert.equal(comparison.totalPixels, 12);
  assert.equal(comparison.changedPixels, 0);
  assert.deepEqual(selections, [
    { frameId: "frame-1", visible: ["old-layer"] },
    { frameId: "frame-1", visible: ["new-layer"] },
  ]);
});

test("preview rejects invalid crop, layer, frame, and scale requests", () => {
  const document = painted();
  assert.throws(() => renderPreview(document, { layerIds: ["missing"] }), /layer not found/);
  assert.throws(() => renderPreview(document, { frameId: "missing" }), /Frame not found/);
  assert.throws(() => renderPreview(document, { crop: { x: 9, y: 9, width: 1, height: 1 } }), /does not intersect/);
  assert.throws(() => renderPreview(document, { scale: 9 }), /scale/);
});

test("preview keeps reference layers out by default and preserves selected group visibility", () => {
  let document = painted();
  const cel = document.frames[0].cels["layer-1"];
  document = {
    ...document,
    layers: [
      { id: "group", type: "group", visible: true },
      { ...document.layers[0], id: "child", parentId: "group", visible: true },
      { ...document.layers[0], id: "reference", type: "reference", visible: true },
    ],
    frames: [{ ...document.frames[0], cels: { child: cel, reference: cel } }],
  };
  let inspected;
  renderPreview(document, { layerIds: ["group"], renderFrame: (selected) => {
    inspected = selected.layers.map(layer => [layer.id, layer.visible]);
    return new Uint8ClampedArray(document.width * document.height * 4);
  } });
  assert.deepEqual(inspected, [["group", true], ["child", true], ["reference", false]]);
});

test("explicitly selected hidden layers render even when a parent group is hidden", () => {
  let document = painted();
  const cel = document.frames[0].cels["layer-1"];
  document = {
    ...document,
    layers: [
      { id: "group", type: "group", visible: false },
      { ...document.layers[0], id: "hidden-child", parentId: "group", visible: false },
    ],
    frames: [{ ...document.frames[0], cels: { "hidden-child": cel } }],
  };
  let inspected;
  renderPreview(document, { layerIds: ["hidden-child"], renderFrame: selected => {
    inspected = selected.layers.map(layer => [layer.id, layer.visible]);
    return new Uint8ClampedArray(document.width * document.height * 4);
  } });
  assert.deepEqual(inspected, [["group", true], ["hidden-child", true]]);
});

test("contact-sheet geometry is rejected before any frame renderer runs", () => {
  const document = { ...painted(), width: 4096, height: 4096, frames: [{ ...painted().frames[0] }, { ...painted().frames[0], id: "frame-2" }] };
  let renders = 0;
  assert.throws(() => renderPreviewContactSheet(document, { columns: 2, renderFrame: () => { renders++; return new Uint8ClampedArray(); } }), /Contact sheet exceeds/);
  assert.equal(renders, 0);
});

