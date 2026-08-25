import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the PixelWall studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>PixelWall — Pixel Art Maker<\/title>/i);
  assert.match(html, />PIXELWALL</i);
  assert.match(html, /aria-label="Drawing tools"/i);
  assert.match(html, /aria-label="Pixel art canvas mounted in a projector beam"/i);
  assert.match(html, />256<!-- --> × <!-- -->256</i);
  assert.match(html, /IMAGE SCALE/i);
  assert.match(html, /aria-label="Decrease image scale by 1 percent"/i);
  assert.match(html, /aria-label="Image scale percent"/i);
  assert.match(html, /aria-label="Increase image scale by 1 percent"/i);
  assert.match(html, /MOVE IMAGE/i);
  assert.match(html, /aria-label="Pick a color from the canvas"/i);
  assert.match(html, /aria-label="Choose a custom color"/i);
  assert.match(html, /class="projection-dock"/i);
  assert.match(html, /aria-label="Open export options"/i);
  assert.match(html, /aria-label="Open PixelWall project"/i);
  assert.match(html, /aria-label="Save portable PixelWall project"/i);
  assert.match(html, /CURRENT FRAME/i);
  assert.match(html, /SPRITE PACKAGE/i);
  assert.match(html, /SHEET \+ JSON<!-- --> \+ PNGS/i);
  assert.match(html, /aria-label="Artwork layers"/i);
  assert.match(html, /SEAM CHECK/i);
  assert.match(html, /LINK EDGES/i);
  assert.match(html, /TILEMAP LAB/i);
  assert.match(html, /TRIM TRANSPARENT EDGES/i);
  assert.match(html, /aria-label="Animation clip controls"/i);
  assert.match(html, /aria-label="Set export pivot tool"/i);
  assert.match(html, /aria-label="Select and move tool"/i);
  assert.doesNotMatch(
    html,
    /codex-preview|Your site is taking shape|react-loading-skeleton/i,
  );
});

test("contains no disposable starter preview", async () => {
  const packageJson = await readFile(
    new URL("package.json", projectRoot),
    "utf8",
  );

  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview/", projectRoot)));
});

test("keeps tracing visuals locked to logical pixels", async () => {
  const [pageSource, cssSource] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  assert.match(pageSource, /MATCH 1:1 PIXELS/);
  assert.match(pageSource, /SPRITE \{referenceTile \+ 1\}/);
  assert.match(pageSource, /WORKSPACE PIXEL SIZE/);
  assert.match(pageSource, /ADD TRACE FRAME/);
  assert.match(pageSource, /IMPORT \{spriteSheet\.frameCount\} EDITABLE FRAMES/);
  assert.match(pageSource, /Portable project saved/);
  assert.match(pageSource, /PHASER \/ PIXI \/ ASEPRITE JSON/);
  assert.match(pageSource, /SEAM CHECK/);
  assert.match(pageSource, /LINK EDGES/);
  assert.match(pageSource, /SAVE SLICE/);
  assert.match(pageSource, /TILEMAP LAB/);
  assert.match(pageSource, /SPRITE \{referenceTile \+ 1\}\/\{spriteSheet\.frameCount\}/);
  assert.match(pageSource, /\{cellSize\} PX\/CELL/);
  assert.match(cssSource, /--font-geist-sans:\s*ui-sans-serif/);
  assert.match(cssSource, /--font-geist-mono:\s*ui-monospace/);
  assert.match(cssSource, /\.sprite-stepper strong\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(cssSource, /\.zoom-control strong\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(cssSource, /\.wall-stage\.reference-live\s*\{\s*min-height:\s*840px/);
  assert.match(cssSource, /background-size:\s*calc\(200% \/ var\(--grid-size\)\)/);
  assert.doesNotMatch(cssSource, /background-size:\s*18px 18px/);
});

test("keeps native frame filenames stable", async () => {
  const { buildSpriteSheetMetadata, spriteFrameFilename } = await import(new URL("../app/sprite-export.mjs", import.meta.url));
  assert.equal(spriteFrameFilename(0, 3), "frame-001.png");
  assert.equal(spriteFrameFilename(11, 12), "frame-012.png");
  const legacyManifest = buildSpriteSheetMetadata(16, 3, 8);
  assert.deepEqual(legacyManifest.meta.size, { w: 48, h: 16 });
  assert.equal(legacyManifest.frames["1"].duration, 125);
  assert.equal(legacyManifest.meta.app, "PixelWall");
});

test("builds clip-aware engine metadata with layouts and pivots", async () => {
  const { createSpriteExportPlan } = await import(new URL("../app/sprite-export-core.mjs", import.meta.url));
  const plan = createSpriteExportPlan({
    frames: [
      { id: 10, durationMs: 80 },
      { id: 20, durationMs: 140 },
      { id: 30, durationMs: 220 },
    ],
    size: 16,
    clips: [{ id: 1, name: "run", frameIds: [20, 10], direction: "forward", loop: true }],
    selectedClip: "run",
    layout: { type: "grid", columns: 2 },
    defaultPivot: { x: 8, y: 16, unit: "pixels" },
    basename: "Purple Bandit",
  });

  assert.deepEqual(plan.sheet, { type: "grid", columns: 2, rows: 1, width: 32, height: 16 });
  assert.deepEqual(plan.frames.map((frame) => frame.sourceId), [20, 10]);
  assert.equal(plan.frames[0].durationMs, 140);
  assert.deepEqual(plan.frames[0].pivot.normalized, { x: 0.5, y: 1 });
  assert.deepEqual(plan.metadata.animations.run, plan.files.frames);
  assert.equal(plan.metadata.phaser.animations[0].key, "run");
  assert.equal(plan.metadata.meta.slices[0].keys[0].pivot.y, 16);
});

test("exports trimmed padded atlases, named slices, and tilemaps", async () => {
  const { createSpriteExportPlan } = await import(new URL("../app/sprite-export-core.mjs", import.meta.url));
  const plan = createSpriteExportPlan({
    frames: [
      { id: 1, durationMs: 100, trimBounds: { x: 2, y: 2, w: 4, h: 4 } },
      { id: 2, durationMs: 200, trimBounds: { x: 0, y: 0, w: 8, h: 8 } },
    ],
    size: 8,
    padding: 2,
    trim: true,
    includeIndividualFrames: false,
    slices: [{ name: "hitbox", bounds: { x: 1, y: 1, width: 6, height: 6 }, pivot: { x: 4, y: 7 } }],
    tilemap: { width: 2, height: 2, cells: [1, 2, null, 1] },
  });

  assert.deepEqual(plan.sheet, { type: "horizontal", columns: 2, rows: 1, width: 18, height: 12 });
  assert.deepEqual(plan.frames[0].rect, { x: 2, y: 2, w: 4, h: 4 });
  assert.equal(plan.metadata.frames[plan.frames[0].filename].trimmed, true);
  assert.deepEqual(plan.files.frames, []);
  assert.equal(plan.metadata.meta.slices[1].name, "hitbox");
  assert.deepEqual(plan.metadata.phaser.tilemap.data, [1, 2, 0, 1]);
  assert.equal(plan.metadata.pixelwall.tilemap.cells[1].frameId, 2);
});

test("round-trips portable layered PixelWall projects and upgrades legacy drafts", async () => {
  const { parseProject, stringifyProject } = await import(new URL("../app/project-format.mjs", import.meta.url));
  const pixels = Array(64).fill(null);
  pixels[9] = "#ff6b57";
  const project = {
    name: "Bandit",
    size: 8,
    layers: [
      { id: 1, name: "Body", visible: true, locked: false, opacity: 100 },
      { id: 2, name: "FX", visible: true, locked: false, opacity: 70 },
    ],
    frames: [
      { id: 10, durationMs: 90, cels: [{ layerId: 1, pixels }], pivot: { x: 2, y: 7, unit: "pixels" } },
      { id: 20, durationMs: 180, cels: [] },
    ],
    clips: [{ id: 4, name: "idle", frameIds: [10, 20], direction: "pingpong", loop: true }],
    palette: ["#ff6b57", "#16152b"],
    slices: [{ id: 1, name: "hurtbox", bounds: { x: 1, y: 1, width: 6, height: 7 }, pivot: { x: 4, y: 7, unit: "pixels" } }],
    pivot: { x: 4, y: 8, unit: "pixels" },
    tile: { enabled: true, seamlessPreview: true, wrapDrawing: true },
    tilemap: { width: 2, height: 2, cells: [10, 20, null, 10] },
    projector: { opacity: 42, transform: { x: 0, y: 0, scale: 100 } },
  };
  const editor = { activeFrameId: 20, activeLayerId: 2, activeClipId: 4, selectedColor: "#ff6b57" };
  const decoded = parseProject(stringifyProject(project, editor, { pretty: true }));

  assert.equal(decoded.project.layers.length, 2);
  assert.equal(decoded.project.frames[0].cels[0].pixels[9], "#ff6b57");
  assert.equal(decoded.project.frames[1].durationMs, 180);
  assert.equal(decoded.project.frames[0].pivot.y, 7);
  assert.deepEqual(decoded.project.clips[0].frameIds, [10, 20]);
  assert.deepEqual(decoded.project.pivot, { x: 4, y: 8, unit: "pixels" });
  assert.equal(decoded.project.tile.wrapDrawing, true);
  assert.equal(decoded.project.slices[0].name, "hurtbox");
  assert.deepEqual(decoded.project.slices[0].pivot, { x: 4, y: 7, unit: "pixels" });
  assert.deepEqual(decoded.project.tilemap.cells, [10, 20, null, 10]);
  assert.equal(decoded.editor.activeLayerId, 2);

  const legacyPixels = Array(64).fill(null);
  legacyPixels[0] = "#16152b";
  const legacy = parseProject(JSON.stringify({
    version: 1,
    size: 8,
    frames: [{ id: 7, pixels: legacyPixels }],
    activeFrame: 0,
    palette: ["#16152b"],
    selectedColor: "#16152b",
  }));
  assert.equal(legacy.migratedFrom, 1);
  assert.equal(legacy.project.frames[0].cels[0].layerId, 1);
  assert.deepEqual(legacy.project.clips[0].frameIds, [7]);
});
