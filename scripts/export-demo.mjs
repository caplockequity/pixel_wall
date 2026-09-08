import { mkdir, writeFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { makeDemoPixels } from "../app/demo-art.mjs";
import { createBlankProject, stringifyProject, parseProject } from "../app/project-format.mjs";
import { createSpriteExportPlan } from "../app/sprite-export-core.mjs";
import { animationExportPlan, encodeAnimationGif } from "../app/animation-export.mjs";

// Export the existing studio example. These files are built once, not in visitors' browsers.
const directory = new URL("../public/examples/", import.meta.url);
await mkdir(directory, { recursive: true });
const size = 16;
const pixels = [0, 0.45, 0.9].map((shift) => makeDemoPixels(size, shift));
const frames = pixels.map((colors, index) => ({ id: index + 1, durationMs: 125, cels: [{ layerId: 1, pixels: colors }] }));
const { project, editor } = createBlankProject({ name: "DESERT SIGNAL", size });
project.frames = frames;
project.clips[0].frameIds = [1, 2, 3];
const portable = stringifyProject(project, editor);
assert.equal(parseProject(portable).project.frames.length, 3);

function rgba(colors) {
  return Uint8Array.from(colors.flatMap((hex) => hex ? [...[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)), 255] : [0, 0, 0, 0]));
}
function chunk(type, bytes) {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}
function png(width, height, data) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row++) Buffer.from(data.slice(row * width * 4, (row + 1) * width * 4)).copy(scanlines, row * (1 + width * 4) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
}
const plan = createSpriteExportPlan({ basename: "desert-signal", frameWidth: size, frameHeight: size, frames, clips: project.clips, layout: "horizontal", padding: 0, includeIndividualFrames: true, app: "https://www.pixelwall.dev" });
const sheet = new Uint8Array(plan.sheet.width * plan.sheet.height * 4);
for (const entry of plan.frames) {
  const data = rgba(pixels[entry.sourceIndex]);
  for (let row = 0; row < size; row++) sheet.set(data.slice(row * size * 4, (row + 1) * size * 4), ((entry.rect.y + row) * plan.sheet.width + entry.rect.x) * 4);
}
const files = {
  "desert-signal.pixelwall": strToU8(portable),
  [plan.files.sheet]: png(plan.sheet.width, plan.sheet.height, sheet),
  [plan.files.data]: strToU8(JSON.stringify(plan.metadata, null, 2)),
  "desert-signal.png": png(size, size, rgba(pixels[0])),
};
for (const entry of plan.frames) files[entry.filename] = png(size, size, rgba(pixels[entry.sourceIndex]));
files["desert-signal.gif"] = await encodeAnimationGif(animationExportPlan(frames, project.clips[0], size, 4), (frame) => rgba(pixels[frame.id - 1]));
files["README.txt"] = strToU8("Desert Signal — PixelWall starter example\n\nThree 16x16 frames, one layer, 125 ms per frame.\nOpen desert-signal.pixelwall with Open Project in https://www.pixelwall.dev/editor. Save your current work first.\nThe PNGs, GIF and JSON are example exports; editing and PNG export are free, while exporting your own GIFs or sprite packages requires Pro.\n\nYou may use and modify this sample artwork in personal and commercial projects. Attribution to PixelWall is appreciated but not required. This permission covers this example artwork, not the PixelWall application source.\n");
for (const [name, data] of Object.entries(files)) await writeFile(new URL(name, directory), data);
await writeFile(new URL("desert-signal-example.zip", directory), zipSync(files));
console.log(`Exported ${Object.keys(files).length} starter files and the example ZIP.`);
