import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("download hook publishes through durable artifacts before the browser handoff", async () => {
  const source = await readFile(new URL("../app/use-download.tsx", import.meta.url), "utf8");
  const persistAt = source.indexOf("const persistence = await persistFiles");
  const downloadAt = source.indexOf("const result = downloadFiles(files", persistAt);
  assert.ok(persistAt >= 0 && downloadAt > persistAt);
  assert.match(source, /function publishFiles\(files/);
  assert.match(source, /artifacts: persistence\.status === "persisted" \? persistence\.artifacts : \[\]/);
  assert.match(source, /if \(requested\) await artifactStoreRef\.current\?\.markDownloadRequested/);
});

test("artifact reads use bounded Blob slices and JSON-safe byte arrays", async () => {
  const source = await readFile(new URL("../app/use-download.tsx", import.meta.url), "utf8");
  assert.match(source, /blob\.slice\(offset, end\)\.arrayBuffer\(\)/);
  assert.match(source, /bytes: Array\.from\(bytes\)/);
  assert.match(source, /length > 1024 \* 1024/);
});
