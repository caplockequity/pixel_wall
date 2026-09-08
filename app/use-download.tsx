"use client";

import { useEffect, useRef, useState } from "react";

type ReadyFile = { url: string; filename: string };

export function useDownload() {
  const [readyFile, setReadyFile] = useState<ReadyFile | null>(null);
  const currentUrl = useRef<string | null>(null);
  useEffect(() => () => { if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);

  function downloadBlob(blob: Blob, filename: string) {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    const url = URL.createObjectURL(blob);
    currentUrl.current = url;
    setReadyFile({ url, filename });
    // Try the usual automatic download, and retain a visible native link for
    // browsers that require a fresh user gesture after asynchronous exports.
    const link = document.createElement("a");
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
  }
  function dismissDownload() {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null; setReadyFile(null);
  }
  return { readyFile, downloadBlob, dismissDownload };
}

export function DownloadReady({ file, onDismiss }: { file: ReadyFile | null; onDismiss: () => void }) {
  if (!file) return null;
  return <aside className="download-ready ph-no-capture" aria-label="Your download">
    <button type="button" onClick={onDismiss} aria-label="Dismiss download">×</button>
    <p role="status">Your file is ready</p>
    <small>{file.filename}</small>
    <a href={file.url} download={file.filename}>DOWNLOAD FILE</a>
    <span>Use this if the download hasn’t started.</span>
  </aside>;
}
