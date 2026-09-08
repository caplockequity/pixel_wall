import assert from "node:assert/strict";
import test from "node:test";
import omggif from "omggif";
import { animationExportPlan, encodeAnimationGif, indexedGifFrame } from "../app/animation-export.mjs";

const frames = [{ id: 11, durationMs: 125 }, { id: 23, durationMs: 80 }, { id: 34, durationMs: 190 }];
const clip = { frameIds: [11, 23, 34], direction: "forward", loop: true };

test("GIF playback respects clip order, reverse, ping-pong, and one-frame clips", () => {
  for (const [direction, expected] of [
    ["forward", [11, 23, 34]], ["reverse", [34, 23, 11]],
    ["pingpong", [11, 23, 34, 23]], ["pingpong_reverse", [34, 23, 11, 23]],
  ]) {
    const plan = animationExportPlan(frames, { ...clip, direction }, 2);
    assert.deepEqual(plan.sequence.map(({ frame }) => frame.id), expected);
    const originalTime = plan.sequence.reduce((total, { frame }) => total + frame.durationMs, 0);
    const gifTime = plan.sequence.reduce((total, { delay }) => total + delay, 0);
    assert.ok(Math.abs(originalTime - gifTime) <= 5);
  }
  assert.equal(animationExportPlan(frames, { ...clip, frameIds: [23], direction: "pingpong" }, 2).sequence.length, 1);
});

test("an independent decoder reads correct colors, transparency, scaling, frame delays and looping", async () => {
  const plan = animationExportPlan(frames, { ...clip, direction: "pingpong" }, 2, 2);
  const pixels = new Map([
    [11, new Uint8Array([254, 107, 87, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
    [23, new Uint8Array([0, 0, 0, 0, 112, 214, 178, 255, 0, 0, 0, 0, 0, 0, 0, 0])],
    [34, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 112, 89, 199, 255])],
  ]);
  const progress = [];
  const bytes = await encodeAnimationGif(plan, (frame) => pixels.get(frame.id), (done) => { progress.push(done); });
  const reader = new omggif.GifReader(bytes);
  assert.equal(reader.width, 4);
  assert.equal(reader.height, 4);
  assert.equal(reader.numFrames(), 4);
  assert.equal(reader.loopCount(), 0);
  assert.deepEqual(progress, [1, 2, 3, 4]);
  for (let i = 0; i < 4; i++) {
    const info = reader.frameInfo(i);
    assert.equal(info.delay * 10, plan.sequence[i].delay);
    assert.equal(info.disposal, 2, "clear previous frame to avoid animation trails");
    const decoded = new Uint8Array(4 * 4 * 4);
    reader.decodeAndBlitFrameRGBA(i, decoded);
    const source = pixels.get(plan.sequence[i].frame.id);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const offset = (Math.floor(y / 2) * 2 + Math.floor(x / 2)) * 4;
      assert.deepEqual([...decoded.slice((y * 4 + x) * 4, (y * 4 + x + 1) * 4)], [...source.slice(offset, offset + 4)]);
    }
  }
  const once = animationExportPlan(frames, { ...clip, loop: false }, 2);
  const onceReader = new omggif.GifReader(await encodeAnimationGif(once, (frame) => pixels.get(frame.id)));
  assert.equal(onceReader.loopCount(), null);
});

test("GIF palettes keep opaque black separate from transparent pixels and handle color reduction", () => {
  const exact = indexedGifFrame(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0, 1, 2, 3, 100, 1, 2, 3, 200]), 2, 1);
  assert.notEqual(exact.indices[0], 0);
  assert.deepEqual([...exact.indices.slice(1, 3)], [0, 0]);
  assert.notEqual(exact.indices[3], 0);
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < 1024; i++) rgba.set([i % 256, Math.floor(i / 256) * 60, (i * 43) % 256, i === 0 ? 0 : 255], i * 4);
  const reduced = indexedGifFrame(rgba, 32, 1);
  assert.ok(reduced.palette.length <= 256);
  assert.equal(reduced.indices[0], 0);
  assert.ok([...reduced.indices.slice(1)].every((value) => value > 0 && value < reduced.palette.length));
  const empty = indexedGifFrame(new Uint8Array(16), 2, 1);
  assert.equal(empty.palette.length, 2);
  assert.ok([...empty.indices].every((value) => value === 0));
});

test("GIF rejects invalid frames and excessive output before allocating large buffers", () => {
  assert.throws(() => animationExportPlan(frames, { ...clip, frameIds: [99] }, 16), /missing frame/);
  assert.throws(() => animationExportPlan([], clip, 16), /Add a frame/);
  assert.throws(() => animationExportPlan(frames, clip, 16, 3), /supported/);
  assert.throws(() => animationExportPlan(frames, { ...clip, frameIds: Array(64).fill(11) }, 256, 8), /too large/);
  assert.throws(() => animationExportPlan([{ id: 11, durationMs: NaN }], { ...clip, frameIds: [11] }, 16), /timing/);
  assert.throws(() => indexedGifFrame(new Uint8Array(4), 2, 1), /dimensions/);
});
