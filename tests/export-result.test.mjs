import test from "node:test";
import assert from "node:assert/strict";
import { createExportResult } from "../app/export-result.mjs";

test("export handoff distinguishes generated files from an unobservable browser download", () => {
  const result = createExportResult({
    id: "export-1",
    files: [{ filename: "hero.png", mime: "image/png", bytes: 42, url: "blob:hero" }],
    requested: true,
    requestedAt: "2026-10-26T12:00:00.000Z",
  });
  assert.equal(result.generated.status, "generated");
  assert.match(result.generated.urlLifetime, /next export/);
  assert.equal(result.generated.files[0].url, "blob:hero");
  assert.equal(result.download.status, "requested");
  assert.equal(result.download.completedAt, null);
  assert.equal(result.download.completion, "unobservable");
  assert.deepEqual(result.download.files, [{ filename: "hero.png", status: "requested", completedAt: null }]);
});

test("an export can be handed off without claiming a download was requested", () => {
  const result = createExportResult({ id: "export-2", files: [], requested: false });
  assert.equal(result.generated.status, "generated");
  assert.equal(result.download.status, "not_requested");
});

test("persistent artifact metadata is attached to generated files without changing download truth", () => {
  const result = createExportResult({
    files: [{ filename: "hero.png", url: "blob:hero" }],
    requested: false,
    artifacts: [{ name: "hero.png", artifactId: "artifact-1", sha256: "abc", expiresAt: 123 }],
    persistence: { status: "persisted" },
  });
  assert.deepEqual(result.generated.files[0], { filename: "hero.png", mime: "application/octet-stream", bytes: null, url: "blob:hero", artifactId: "artifact-1", sha256: "abc", expiresAt: 123 });
  assert.equal(result.download.status, "not_requested");
  assert.equal(result.persistence.status, "persisted");
});
