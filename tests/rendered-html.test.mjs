import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  posthogRequestHeaders,
  posthogResponseHeaders,
  posthogUpstreamUrl,
} from "../app/posthog-proxy-core.mjs";

const projectRoot = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
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

test("serves billing status without exposing unconfigured server secrets", async () => {
  const response = await render("/api/billing/status");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { pro: false, checkoutAvailable: false, mode: "test" });
});

test("server-renders the PixelWall studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>PixelWall — Pixel Art Maker<\/title>/i);
  assert.match(html, /pixelwall-mark\.svg[^>]*rel="shortcut icon"|rel="shortcut icon"[^>]*pixelwall-mark\.svg/i);
  assert.match(html, /pixelwall\.webmanifest/i);
  assert.doesNotMatch(html, /\[object Object\]/i);
  assert.match(html, />PIXELWALL</i);
  assert.match(html, /aria-label="Drawing tools"/i);
  assert.match(html, /aria-label="Pixel art canvas mounted in a projector beam"/i);
  assert.match(html, /id="quick-guide-title"[^>]*>QUICK START</i);
  assert.doesNotMatch(html, /<dialog[^>]*\sopen(?:\s|>)/i);
  assert.match(html, /aria-label="Layers help"/i);
  assert.match(html, /aria-label="Frames help"/i);
  assert.match(html, /aria-label="Tilemap Lab help"/i);
  assert.match(html, /href="mailto:contact@caplock\.ai"/i);
  assert.match(html, /© 2026 CapLock/i);
  assert.match(html, />QUICK GUIDE</i);
  assert.match(html, />256<!-- --> × <!-- -->256</i);
  assert.match(html, /IMAGE SCALE/i);
  assert.match(html, /aria-label="Decrease image scale by 1 percent"/i);
  assert.match(html, /aria-label="Image scale percent"/i);
  assert.match(html, /aria-label="Increase image scale by 1 percent"/i);
  assert.match(html, /MOVE IMAGE/i);
  assert.match(html, /aria-label="Sample color tool"/i);
  assert.match(html, /aria-label="Choose a custom color"/i);
  assert.match(html, /aria-label="Color rack"/i);
  assert.match(html, /aria-label="Canvas view controls"/i);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="Toggle pixel grid"/i);
  assert.match(html, /aria-pressed="false"[^>]*aria-label="Toggle onion skin"/i);
  assert.match(html, /aria-label="Expand projector controls"[^>]*aria-expanded="false"[^>]*aria-controls="projector-controls"/i);
  assert.match(html, /id="projector-controls"[^>]*hidden/i);
  assert.equal((html.match(/aria-controls="projector-controls"/gi) ?? []).length, 1);
  assert.match(html, /aria-label="Open export options"/i);
  assert.match(html, /aria-label="Open PixelWall project"/i);
  assert.match(html, /aria-label="Save portable PixelWall project"/i);
  assert.match(html, /CURRENT FRAME/i);
  assert.match(html, /SPRITE PACKAGE/i);
  assert.match(html, /TILEMAP PACKAGE/i);
  assert.match(html, /TILED MAP \+ TILESET \+ PREVIEW/i);
  assert.match(html, /SHEET \+ JSON<!-- --> \+ PNGS/i);
  assert.match(html, /aria-label="Artwork layers"/i);
  assert.match(html, /SEAM CHECK/i);
  assert.match(html, /LINK EDGES/i);
  assert.match(html, /TILEMAP LAB/i);
  assert.match(html, /Paint: Drag or use Arrow Keys \+ Space/);
  assert.match(html, /aria-label="Decrease tilemap width"/i);
  assert.match(html, /aria-label="Increase tilemap width"/i);
  assert.match(html, /aria-label="Decrease tilemap height"/i);
  assert.match(html, /aria-label="Increase tilemap height"/i);
  assert.match(html, /TRIM TRANSPARENT EDGES/i);
  assert.match(html, /aria-label="Animation clip controls"/i);
  assert.match(html, /aria-label="Set export pivot tool"/i);
  assert.match(html, /aria-label="Select and move tool"/i);
  assert.doesNotMatch(
    html,
    /codex-preview|Your site is taking shape|react-loading-skeleton/i,
  );
});

test("keeps optional analytics private and content-safe", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(
    html,
    /class="(?=[^"]*\bart-surface\b)(?=[^"]*\bph-no-capture\b)[^"]*"/i,
  );

  const [envExample, instrumentationSource, analyticsSource, pageSource, proxyCoreSource, proxyRouteSource, nextConfigSource] = await Promise.all([
    readFile(new URL(".env.example", projectRoot), "utf8"),
    readFile(new URL("instrumentation-client.ts", projectRoot), "utf8"),
    readFile(new URL("app/analytics.ts", projectRoot), "utf8"),
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/posthog-proxy-core.mjs", projectRoot), "utf8"),
    readFile(new URL("app/beam/[...path]/route.ts", projectRoot), "utf8"),
    readFile(new URL("next.config.ts", projectRoot), "utf8"),
  ]);

  assert.match(envExample, /^NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=\s*$/m);
  assert.match(
    instrumentationSource,
    /if\s*\(\s*isAnalyticsConfigured\(\)\s*\)\s*\{\s*initializeAnalytics\(\);?\s*\}/s,
  );
  const initializationSource = analyticsSource.slice(
    analyticsSource.indexOf("export function initializeAnalytics"),
    analyticsSource.indexOf("export function getAnalyticsConsentStatus"),
  );
  assert.match(initializationSource, /storedAnalyticsConsent\(\)\s*!==\s*"granted"/);
  assert.ok(
    initializationSource.indexOf('storedAnalyticsConsent() !== "granted"')
      < initializationSource.indexOf("posthog.init"),
  );

  const artSurfaceStart = pageSource.indexOf('className="art-surface ph-no-capture"');
  assert.notEqual(artSurfaceStart, -1);
  const artSurfaceSource = pageSource.slice(artSurfaceStart, artSurfaceStart + 3_000);
  assert.match(
    artSurfaceSource,
    /<img\s+className="(?=[^"]*\bprojection-image\b)(?=[^"]*\bph-no-capture\b)[^"]*"[^>]*\ssrc=\{reference\}/s,
  );
  assert.match(
    artSurfaceSource,
    /className=\{`(?=[^`]*\bpixel-canvas\b)(?=[^`]*\bph-no-capture\b)[^`]*`\}/s,
  );
  assert.match(pageSource, /className=\{`\$\{className\}\s+ph-no-capture`\}/);
  assert.match(pageSource, /className="seam-tiles ph-no-capture"/);
  assert.match(pageSource, /className="tilemap-canvas ph-no-capture"/);

  const allowlistStart = analyticsSource.indexOf("EVENT_PROPERTY_ALLOWLIST");
  const sanitizerStart = analyticsSource.indexOf("sanitizeEventProperties", allowlistStart);
  assert.notEqual(allowlistStart, -1);
  assert.notEqual(sanitizerStart, -1);
  const allowlistSource = analyticsSource.slice(allowlistStart, sanitizerStart);
  const eventNames = [
    "editor_loaded",
    "quick_guide_viewed",
    "quick_guide_dismissed",
    "canvas_edit_committed",
    "project_structure_changed",
    "feature_toggled",
    "animation_playback_changed",
    "reference_loaded",
    "reference_load_failed",
    "reference_action",
    "sprite_sheet_imported",
    "tilemap_edit_committed",
    "project_file_operation",
    "autosave_failed",
    "autosave_recovered",
    "export_started",
    "export_completed",
    "export_failed",
    "export_blocked",
    "analytics_consent_updated",
  ];
  for (const eventName of eventNames) {
    assert.match(allowlistSource, new RegExp(`["']?${eventName}["']?\\s*:`));
  }
  assert.doesNotMatch(
    allowlistSource,
    /["'](?:name|project_name|file_name|filename|layer_name|clip_name|slice_name|color|colors|pixels|pixel_data|data_url|reference_url|content)["']/i,
  );

  const captureStart = analyticsSource.indexOf("captureAnalyticsEvent");
  assert.notEqual(captureStart, -1);
  const captureSource = analyticsSource.slice(captureStart);
  assert.match(captureSource, /sanitizeEventProperties\(\s*event\s*,\s*properties\s*\)/s);
  assert.doesNotMatch(captureSource, /posthog\.capture\(\s*event\s*,\s*properties\s*\)/s);

  assert.doesNotMatch(nextConfigSource, /\brewrites\s*\(/);
  const requestAllowlist = proxyCoreSource.slice(
    proxyCoreSource.indexOf("REQUEST_HEADER_ALLOWLIST"),
    proxyCoreSource.indexOf("RESPONSE_HEADER_ALLOWLIST"),
  );
  assert.match(requestAllowlist, /"content-type"/);
  assert.doesNotMatch(requestAllowlist, /cookie|authorization|referer|origin|x-api-key/i);
  const responseAllowlist = proxyCoreSource.slice(
    proxyCoreSource.indexOf("RESPONSE_HEADER_ALLOWLIST"),
    proxyCoreSource.indexOf("function copyAllowedHeaders"),
  );
  assert.match(responseAllowlist, /"cache-control"/);
  assert.doesNotMatch(responseAllowlist, /set-cookie/i);
  assert.match(proxyRouteSource, /body:\s*hasBody\s*\?\s*await request\.arrayBuffer\(\)/s);
});

test("relays PostHog without forwarding site credentials", async () => {
  const sourceHeaders = new Headers({
    authorization: "Bearer private",
    cookie: "private-cookie=1",
    "content-encoding": "gzip",
    "content-type": "text/plain",
    origin: "https://private.example",
    referer: "https://private.example/project?secret=1",
    "x-api-key": "private-key",
  });
  const upstreamHeaders = posthogRequestHeaders(sourceHeaders);
  assert.equal(upstreamHeaders.get("content-type"), "text/plain");
  assert.equal(upstreamHeaders.get("content-encoding"), "gzip");
  assert.equal(upstreamHeaders.get("accept-encoding"), "identity");
  for (const name of ["authorization", "cookie", "origin", "referer", "x-api-key"]) {
    assert.equal(upstreamHeaders.get(name), null);
  }

  const upstream = posthogUpstreamUrl(
    "https://pixelwall.example/beam/e/?v=1",
    "https://us.i.posthog.com",
  );
  assert.equal(upstream.href, "https://us.i.posthog.com/e/?v=1");
  assert.equal(
    posthogUpstreamUrl("https://pixelwall.example/beam/array/token/config", "https://eu.i.posthog.com").href,
    "https://eu-assets.i.posthog.com/array/token/config",
  );
  assert.equal(
    posthogUpstreamUrl("https://pixelwall.example/beam//untrusted.example/path", "https://us.i.posthog.com").hostname,
    "us.i.posthog.com",
  );

  const returnedHeaders = posthogResponseHeaders(new Headers({
    "cache-control": "public, max-age=60",
    "content-type": "text/plain",
    "set-cookie": "should-not-return=1",
  }));
  assert.equal(returnedHeaders.get("set-cookie"), null);
  assert.equal(returnedHeaders.get("cache-control"), "public, max-age=60");
});

test("contains no disposable starter preview", async () => {
  const packageJson = await readFile(
    new URL("package.json", projectRoot),
    "utf8",
  );

  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview/", projectRoot)));
});

test("ships cache-busted PixelWall icon assets", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("public/pixelwall.webmanifest", projectRoot), "utf8"),
  );

  assert.equal(manifest.short_name, "PixelWall");
  assert.equal(manifest.icons[0].src, "/pixelwall-mark.svg");
  await Promise.all([
    access(new URL("public/pixelwall-mark.svg", projectRoot)),
    access(new URL("public/pixelwall-mark-32.png", projectRoot)),
    access(new URL("public/pixelwall-apple-touch.png", projectRoot)),
    access(new URL("public/pixelwall-icon-192.png", projectRoot)),
    access(new URL("public/pixelwall-icon-512.png", projectRoot)),
    access(new URL("public/favicon.ico", projectRoot)),
  ]);
});

test("keeps tracing visuals locked to logical pixels", async () => {
  const [pageSource, cssSource] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  assert.match(pageSource, /MATCH 1:1 PIXELS/);
  assert.match(pageSource, /pixelwall-onboarding-v1/);
  assert.match(pageSource, /SPRITE \{referenceTile \+ 1\}/);
  assert.match(pageSource, /aria-label="Canvas view controls"/);
  assert.match(pageSource, /ADD TRACE FRAME/);
  assert.match(pageSource, /IMPORT \{spriteSheet\.frameCount\} EDITABLE FRAMES/);
  assert.match(pageSource, /Portable project saved/);
  assert.match(pageSource, /PHASER \/ PIXI \/ ASEPRITE JSON/);
  assert.match(pageSource, /SEAM CHECK/);
  assert.match(pageSource, /LINK EDGES/);
  assert.match(pageSource, /SAVE SLICE/);
  assert.match(pageSource, /TILEMAP LAB/);
  assert.match(pageSource, /className="tilemap-stepper"/);
  assert.match(pageSource, /Paint: Drag or use Arrow Keys \+ Space/);
  assert.doesNotMatch(pageSource, /WORK TOO/);
  assert.match(pageSource, /SPRITE SHEET &amp; PACKAGE SETTINGS/);
  assert.match(pageSource, /createTilemapExportPlan/);
  assert.match(pageSource, /SPRITE \{referenceTile \+ 1\}\/\{spriteSheet\.frameCount\}/);
  assert.match(pageSource, /\{cellSize\}× ZOOM/);
  assert.match(cssSource, /--font-geist-sans:\s*ui-sans-serif/);
  assert.match(cssSource, /--font-geist-mono:\s*ui-monospace/);
  assert.match(cssSource, /--text-micro:\s*11px/);
  assert.match(cssSource, /--text-label:\s*12px/);
  assert.match(cssSource, /--text-control:\s*13px/);
  assert.match(cssSource, /--text-heading:\s*14px/);
  assert.match(cssSource, /\.canvas-view-bar > button\s*\{[^}]*font-size:\s*var\(--text-label\)/s);
  assert.match(cssSource, /\.projection-summary\s*\{[^}]*font-size:\s*var\(--text-micro\)/s);
  assert.match(cssSource, /\.animation-bar label\s*\{[^}]*font-size:\s*var\(--text-micro\)/s);
  assert.match(cssSource, /\.sprite-stepper strong\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(cssSource, /\.view-zoom strong\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(cssSource, /\.wall-stage\.projector-open\s*\{[^}]*grid-template-columns:/s);
  assert.match(cssSource, /\.projection-controls\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(pageSource, /className="palette-panel"/);
  assert.match(cssSource, /\.tilemap-heading \.panel-kicker\s*\{[^}]*font-size:\s*var\(--text-heading\)/s);
  assert.match(cssSource, /\.tilemap-workspace p\s*\{[^}]*font-size:\s*var\(--text-control\)/s);
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

test("builds a dedicated Tiled map package from painted Tilemap Lab cells", async () => {
  const { calculateTilemapPreview, createTilemapExportPlan } = await import(new URL("../app/tilemap-export-core.mjs", import.meta.url));
  const plan = createTilemapExportPlan({
    frames: [{ id: 30 }, { id: 10 }, { id: 20 }],
    tileSize: 16,
    tilemap: { width: 2, height: 2, cells: [20, null, 10, 20] },
    basename: "Dungeon Test",
  });

  assert.deepEqual(plan.tiles.map((tile) => tile.sourceId), [10, 20, 30]);
  assert.deepEqual(plan.tiles.map((tile) => tile.sourceIndex), [1, 2, 0]);
  assert.deepEqual(plan.gids, [2, 0, 1, 2]);
  assert.deepEqual(plan.sheet, {
    columns: 2,
    rows: 2,
    width: 32,
    height: 32,
    tileWidth: 16,
    tileHeight: 16,
    margin: 0,
    spacing: 0,
  });
  assert.equal(plan.tiled.type, "map");
  assert.equal(plan.tiled.orientation, "orthogonal");
  assert.deepEqual(plan.tiled.layers[0].data, [2, 0, 1, 2]);
  assert.equal(plan.tiled.tilesets[0].firstgid, 1);
  assert.equal(plan.tiled.tilesets[0].tiles[0].properties[0].value, 10);
  assert.deepEqual(plan.preview, {
    sourceWidth: 32,
    sourceHeight: 32,
    width: 32,
    height: 32,
    scale: 1,
    capped: false,
  });
  assert.equal(plan.files.archive, "dungeon-test-tilemap.zip");
  assert.deepEqual(calculateTilemapPreview(3, 2, 64, 100), {
    sourceWidth: 192,
    sourceHeight: 128,
    width: 99,
    height: 66,
    scale: 33 / 64,
    capped: true,
  });

  assert.throws(
    () => createTilemapExportPlan({ frames: [{ id: 10 }], tileSize: 16, tilemap: { width: 1, height: 1, cells: [99] } }),
    (error) => error?.code === "MISSING_FRAME",
  );
  assert.throws(
    () => createTilemapExportPlan({ frames: [{ id: 10 }], tileSize: 16, tilemap: { width: 1, height: 1, cells: [null] } }),
    (error) => error?.code === "EMPTY_TILEMAP",
  );
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
