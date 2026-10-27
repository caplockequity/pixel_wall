import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { openArtifactStore } from "../app/export-artifacts.mjs";

const open = (indexedDB, options = {}) => openArtifactStore({ indexedDB, name: "artifact-tests", ...options });

test("artifacts persist with metadata, digest, lifecycle state, and retrievable bytes", async () => {
  const indexedDB = new IDBFactory();
  let now = 1000;
  let store = await open(indexedDB, { now: () => now });
  const created = await store.putArtifact({ name: "hero.png", mime: "image/png", data: Uint8Array.from([1, 2, 3]), ttlMs: 1000 });
  assert.equal(created.bytes, 3);
  assert.equal(created.sha256, "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
  assert.equal(created.lifecycle.producedAt, 1000);
  assert.equal(created.lifecycle.savedAt, 1000);
  assert.equal(created.lifecycle.downloadRequestedAt, null);
  assert.equal((await store.markDownloadRequested(created.artifactId, 1010)).lifecycle.downloadRequestedAt, 1010);
  store.close();
  store = await open(indexedDB, { now: () => now });
  const listed = await store.listArtifacts();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].artifactId, created.artifactId);
  assert.equal(listed[0].lifecycle.downloadCompletedAt, null);
  const loaded = await store.getArtifact(created.artifactId);
  assert.deepEqual(Array.from(new Uint8Array(await loaded.blob.arrayBuffer())), [1, 2, 3]);
  assert.equal(loaded.metadata.sha256, created.sha256);
  store.close();
});

test("expired artifacts are removed on access and bounded retention removes oldest entries", async () => {
  const indexedDB = new IDBFactory(); let now = 0;
  const store = await open(indexedDB, { now: () => now, maxArtifacts: 2, budgetBytes: 5, ttlMs: 100 });
  const first = await store.putArtifact({ name: "first", data: Uint8Array.of(1) });
  now = 1; const second = await store.putArtifact({ name: "second", data: Uint8Array.of(2, 3) });
  now = 2; await store.putArtifact({ name: "third", data: Uint8Array.of(4, 5) });
  assert.equal(await store.getArtifact(first.artifactId), null);
  assert.deepEqual((await store.listArtifacts()).map(item => item.name), ["third", "second"]);
  now = 101; assert.equal(await store.getArtifact(second.artifactId), null);
  assert.deepEqual((await store.listArtifacts()).map(item => item.name), ["third"]);
  store.close();
});

test("artifact size and budget limits reject without deleting existing artifacts", async () => {
  const store = await open(new IDBFactory(), { budgetBytes: 2, maxArtifacts: 4 });
  const saved = await store.putArtifact({ name: "kept", data: Uint8Array.of(1, 2) });
  await assert.rejects(store.putArtifact({ name: "too-large", data: Uint8Array.of(1, 2, 3) }), { code: "BUDGET_EXCEEDED" });
  assert.equal((await store.listArtifacts())[0].artifactId, saved.artifactId);
  assert.equal(await store.removeArtifact(saved.artifactId), true);
  assert.equal(await store.removeArtifact(saved.artifactId), false);
  store.close();
});

test("artifact names are reduced to a safe filename leaf", async () => {
  const store = await openArtifactStore({ indexedDB: new IDBFactory(), name: "artifact-name-test" });
  const item = await store.putArtifact({ name: "../nested\\hero.png", data: Uint8Array.of(1) });
  assert.equal(item.name, "hero.png");
  store.close();
});

