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
  assert.match(html, /CURRENT FRAME/i);
  assert.match(html, /SPRITE PACKAGE/i);
  assert.match(html, /SHEET \+ JSON/i);
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
  assert.match(pageSource, /SPRITE \{referenceTile \+ 1\}\/\{spriteSheet\.frameCount\}/);
  assert.match(pageSource, /\{cellSize\} PX\/CELL/);
  assert.match(cssSource, /--font-geist-sans:\s*ui-sans-serif/);
  assert.match(cssSource, /--font-geist-mono:\s*ui-monospace/);
  assert.match(cssSource, /\.sprite-stepper strong\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(cssSource, /\.zoom-control strong\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(cssSource, /\.wall-stage\.reference-live\s*\{\s*min-height:\s*780px/);
  assert.match(cssSource, /background-size:\s*calc\(200% \/ var\(--grid-size\)\)/);
  assert.doesNotMatch(cssSource, /background-size:\s*18px 18px/);
});

test("builds a native horizontal sprite-sheet manifest", async () => {
  const {
    buildSpriteSheetMetadata,
    SPRITE_DATA_FILENAME,
    SPRITE_SHEET_FILENAME,
  } = await import(new URL("../app/sprite-export.mjs", import.meta.url));
  const metadata = buildSpriteSheetMetadata(16, 3, 8);

  assert.equal(SPRITE_SHEET_FILENAME, "pixelwall-sprites.png");
  assert.equal(SPRITE_DATA_FILENAME, "pixelwall-sprites.json");
  assert.deepEqual(metadata.meta.size, { w: 48, h: 16 });
  assert.equal(metadata.meta.image, SPRITE_SHEET_FILENAME);
  assert.deepEqual(metadata.frames["0"].frame, { x: 0, y: 0, w: 16, h: 16 });
  assert.deepEqual(metadata.frames["2"].frame, { x: 32, y: 0, w: 16, h: 16 });
  assert.equal(metadata.frames["1"].duration, 125);
  assert.equal(metadata.frames["1"].trimmed, false);
  assert.deepEqual(metadata.animations.default, ["0", "1", "2"]);
  assert.deepEqual(metadata.meta.frameTags, [{ name: "default", from: 0, to: 2, direction: "forward" }]);
});
