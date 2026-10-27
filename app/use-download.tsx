"use client";

import { useEffect, useRef, useState } from "react";
import { createExportResult } from "./export-result.mjs";
import { openArtifactStore } from "./export-artifacts.mjs";

type DownloadItem = { url: string; filename: string; mime?: string; bytes?: number };
type ReadyFile = DownloadItem & { companions?: DownloadItem[] };
type ArtifactMetadata = { artifactId: string; name: string; mime: string; bytes: number; sha256: string; createdAt: number; expiresAt: number; storedAt: number; lifecycle: { producedAt: number; savedAt: number; downloadRequestedAt: number | null; downloadCompletedAt: null } };
type ArtifactStoreApi = {
  putArtifact(options: { artifactId?: string; name: string; mime?: string; data?: Blob | ArrayBuffer | Uint8Array; bytes?: Blob | ArrayBuffer | Uint8Array; ttlMs?: number }): Promise<ArtifactMetadata>;
  listArtifacts(): Promise<ArtifactMetadata[]>;
  getArtifact(artifactId: string): Promise<{ metadata: ArtifactMetadata; blob: Blob } | null>;
  markDownloadRequested(artifactId: string, requestedAt?: number): Promise<ArtifactMetadata>;
  removeArtifact(artifactId: string): Promise<boolean>;
  close(): void;
};

export function useDownload() {
  const [readyFile, setReadyFile] = useState<ReadyFile | null>(null);
  const [lastResult, setLastResult] = useState<ReturnType<typeof createExportResult> | null>(null);
  const lastResultRef = useRef<ReturnType<typeof createExportResult> | null>(null);
  const currentUrls = useRef<string[]>([]);
  const sequence = useRef(0);
  const artifactStoreRef = useRef<ArtifactStoreApi | null>(null);
  const artifactStorePromiseRef = useRef<Promise<ArtifactStoreApi> | null>(null);
  const disposedRef = useRef(false);
  const artifactUrls = useRef<string[]>([]);
  useEffect(() => () => { currentUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => () => {
    disposedRef.current = true;
    artifactUrls.current.forEach(url => URL.revokeObjectURL(url));
    const store = artifactStoreRef.current;
    if (store) store.close();
    else artifactStorePromiseRef.current?.then(opened => opened.close()).catch(() => {});
  }, []);

  function downloadBlob(blob: Blob, filename: string) {
    downloadFiles([{blob,filename}]);
  }
  function downloadFiles(files: {blob: Blob; filename: string}[], { request = true }: { request?: boolean } = {}) {
    if (!files.length) return null;
    currentUrls.current.forEach(url => URL.revokeObjectURL(url));
    const items = files.map(({blob,filename}) => ({url: URL.createObjectURL(blob),filename,mime:blob.type || "application/octet-stream",bytes:blob.size}));
    currentUrls.current = items.map(item => item.url);
    setReadyFile({...items[0],companions:items.slice(1)});
    // Try the usual automatic download, and retain a visible native link for
    // browsers that require a fresh user gesture after asynchronous exports.
    const requestedAt = new Date().toISOString();
    let requested = false;
    const requestedFiles: string[] = [];
    for (const {url,filename} of request ? items : []) {
      const link = document.createElement("a");
      link.href = url; link.download = filename;
      document.body.append(link);
      try { link.click(); requested = true; requestedFiles.push(filename); } catch { /* Keep the visible handoff link. */ }
      link.remove();
    }
    const result = createExportResult({
      id: `export-${Date.now().toString(36)}-${(++sequence.current).toString(36)}`,
      files: items,
      requested,
      requestedAt: requested ? requestedAt : null,
      requestedFiles,
    });
    lastResultRef.current = result;
    setLastResult(result);
    return result;
  }
  function dismissDownload() {
    currentUrls.current.forEach(url => URL.revokeObjectURL(url));
    currentUrls.current = []; lastResultRef.current = null; setReadyFile(null); setLastResult(null);
  }
  async function artifactStore() {
    if (artifactStoreRef.current) return artifactStoreRef.current;
    if (!artifactStorePromiseRef.current) {
      artifactStorePromiseRef.current = (openArtifactStore() as unknown as Promise<ArtifactStoreApi>).then(store => {
        if (disposedRef.current) { store.close(); throw new Error("The download surface has been closed."); }
        artifactStoreRef.current = store;
        return store;
      }).catch(error => { artifactStorePromiseRef.current = null; throw error; });
    }
    return artifactStorePromiseRef.current;
  }
  /** Persist generated files without changing the synchronous download handoff. */
  async function persistFiles(files: { blob: Blob; filename: string }[], options: { ttlMs?: number } = {}) {
    if (!files.length) return { status: "persisted" as const, artifacts: [] };
    const created: ArtifactMetadata[] = [];
    try {
      const store = await artifactStore();
      for (const file of files) created.push(await store.putArtifact({ name: file.filename, mime: file.blob.type || "application/octet-stream", data: file.blob, ttlMs: options.ttlMs }));
      return { status: "persisted" as const, artifacts: created };
    } catch (error) {
      await Promise.all(created.map(item => artifactStoreRef.current?.removeArtifact(item.artifactId))).catch(() => {});
      return { status: "failed" as const, artifacts: [], error: { code: error instanceof Error && "code" in error ? String((error as Error & { code?: unknown }).code) : "ARTIFACT_STORE_FAILED", message: error instanceof Error ? error.message : String(error) } };
    }
  }
  async function artifacts() { return (await artifactStore()).listArtifacts(); }
  async function artifact(artifactId: string) { return (await artifactStore()).getArtifact(artifactId).then(result => result?.metadata ?? null); }
  async function readArtifact({ artifactId, offset = 0, length = 1024 * 1024 }: { artifactId: string; offset?: number; length?: number }) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 1024 * 1024) throw new Error("Artifact reads require a nonnegative offset and a 1 MiB maximum chunk.");
    const result = await (await artifactStore()).getArtifact(artifactId);
    if (!result) return null;
    const end = Math.min(result.metadata.bytes, offset + length);
    const bytes = new Uint8Array(await result.blob.slice(offset, end).arrayBuffer());
    return { metadata: result.metadata, offset, length: bytes.byteLength, done: end >= result.metadata.bytes, bytes: Array.from(bytes) };
  }
  async function removeArtifact(artifactId: string) { return (await artifactStore()).removeArtifact(artifactId); }
  async function downloadArtifact(artifactId: string) {
    const result = await (await artifactStore()).getArtifact(artifactId);
    if (!result) return { status: "missing" as const };
    const url = URL.createObjectURL(result.blob); artifactUrls.current.push(url);
    while (artifactUrls.current.length > 8) URL.revokeObjectURL(artifactUrls.current.shift()!);
    const link = document.createElement("a"); link.href = url; link.download = result.metadata.name; document.body.append(link);
    let requested = false; try { link.click(); requested = true; } catch { /* The visible library link remains the fallback. */ } finally { link.remove(); }
    if (requested) await artifactStoreRef.current?.markDownloadRequested(artifactId);
    return { status: requested ? "requested" as const : "not_requested" as const, metadata: result.metadata, url };
  }
  async function publishFiles(files: { blob: Blob; filename: string }[], { request = true, ttlMs }: { request?: boolean; ttlMs?: number } = {}) {
    const persistence = await persistFiles(files, { ttlMs });
    const result = downloadFiles(files, { request });
    if (!result) return null;
    if (persistence.status === "persisted" && request) {
      const requested = new Set(result.download.files.filter(file => file.status === "requested").map(file => file.filename));
      await Promise.all(persistence.artifacts.filter(item => requested.has(item.name)).map(item => artifactStoreRef.current?.markDownloadRequested(item.artifactId)));
    }
    const enriched = createExportResult({
      id: result.id,
      files: result.generated.files.map(file => ({ filename: file.filename, url: file.url, mime: file.mime, ...(file.bytes === null ? {} : { bytes: file.bytes }) })),
      requested: result.download.status === "requested",
      requestedAt: result.download.requestedAt,
      requestedFiles: result.download.files.filter(file => file.status === "requested").map(file => file.filename),
      artifacts: persistence.status === "persisted" ? persistence.artifacts : [],
      persistence,
    });
    lastResultRef.current = enriched;
    setLastResult(enriched);
    return enriched;
  }
  function releaseArtifactUrl(url: string) {
    const index = artifactUrls.current.indexOf(url);
    if (index >= 0) artifactUrls.current.splice(index, 1);
    URL.revokeObjectURL(url);
  }
  return { readyFile, lastResult, getLastResult: () => lastResultRef.current, downloadBlob, downloadFiles, publishFiles, dismissDownload, persistFiles, artifacts, artifact, readArtifact, removeArtifact, downloadArtifact, releaseArtifactUrl };
}

export function DownloadReady({ file, onDismiss }: { file: ReadyFile | null; onDismiss: () => void }) {
  if (!file) return null;
  return <aside className="download-ready ph-no-capture" aria-label="Your download">
    <button type="button" onClick={onDismiss} aria-label="Dismiss download">×</button>
    <p role="status">File generated: {file.filename}</p>
    <small>{file.filename}</small>
    <a href={file.url} download={file.filename}>DOWNLOAD FILE</a>
    {file.companions?.map(item => <a key={item.url} href={item.url} download={item.filename}>DOWNLOAD {item.filename}</a>)}
    <span>Use the link to start a browser download. The browser does not report download completion here.</span>
  </aside>;
}
