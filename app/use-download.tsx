"use client";

import { useEffect, useRef, useState } from "react";
import { createExportResult } from "./export-result.mjs";

type DownloadItem = { url: string; filename: string; mime?: string; bytes?: number };
type ReadyFile = DownloadItem & { companions?: DownloadItem[] };

export function useDownload() {
  const [readyFile, setReadyFile] = useState<ReadyFile | null>(null);
  const [lastResult, setLastResult] = useState<ReturnType<typeof createExportResult> | null>(null);
  const lastResultRef = useRef<ReturnType<typeof createExportResult> | null>(null);
  const currentUrls = useRef<string[]>([]);
  const sequence = useRef(0);
  useEffect(() => () => { currentUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

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
  return { readyFile, lastResult, getLastResult: () => lastResultRef.current, downloadBlob, downloadFiles, dismissDownload };
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
