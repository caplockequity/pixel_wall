"use client";

import { useEffect, useRef, useState } from "react";

type DownloadItem = { url: string; filename: string };
type ReadyFile = DownloadItem & { companions?: DownloadItem[] };

export function useDownload() {
  const [readyFile, setReadyFile] = useState<ReadyFile | null>(null);
  const currentUrls = useRef<string[]>([]);
  useEffect(() => () => { currentUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

  function downloadBlob(blob: Blob, filename: string) {
    downloadFiles([{blob,filename}]);
  }
  function downloadFiles(files: {blob: Blob; filename: string}[]) {
    if (!files.length) return;
    currentUrls.current.forEach(url => URL.revokeObjectURL(url));
    const items = files.map(({blob,filename}) => ({url: URL.createObjectURL(blob),filename}));
    currentUrls.current = items.map(item => item.url);
    setReadyFile({...items[0],companions:items.slice(1)});
    // Try the usual automatic download, and retain a visible native link for
    // browsers that require a fresh user gesture after asynchronous exports.
    for (const {url,filename} of items) {
      const link = document.createElement("a");
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
    }
  }
  function dismissDownload() {
    currentUrls.current.forEach(url => URL.revokeObjectURL(url));
    currentUrls.current = []; setReadyFile(null);
  }
  return { readyFile, downloadBlob, downloadFiles, dismissDownload };
}

export function DownloadReady({ file, onDismiss }: { file: ReadyFile | null; onDismiss: () => void }) {
  if (!file) return null;
  return <aside className="download-ready ph-no-capture" aria-label="Your download">
    <button type="button" onClick={onDismiss} aria-label="Dismiss download">×</button>
    <p role="status">Your file is ready</p>
    <small>{file.filename}</small>
    <a href={file.url} download={file.filename}>DOWNLOAD FILE</a>
    {file.companions?.map(item => <a key={item.url} href={item.url} download={item.filename}>DOWNLOAD {item.filename}</a>)}
    <span>Use this if the download hasn’t started.</span>
  </aside>;
}
