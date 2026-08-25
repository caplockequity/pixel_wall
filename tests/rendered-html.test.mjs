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
  assert.match(html, /MOVE IMAGE/i);
  assert.match(html, /aria-label="Pick a color from the canvas"/i);
  assert.match(html, /aria-label="Choose a custom color"/i);
  assert.match(html, /class="projection-dock"/i);
  assert.match(html, /EXPORT PNG/i);
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
