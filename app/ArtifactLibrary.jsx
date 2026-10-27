"use client";
/* eslint react/prop-types: "off" -- Durable artifact metadata is validated by the store contract. */

import { useEffect, useRef, useState } from "react";

/** Callback-driven artifact browser. The parent owns the durable store and download policy. */
export default function ArtifactLibrary({ listArtifacts, onDownload, onRemove, onReleaseUrl, refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [fallbacks, setFallbacks] = useState({});
  const fallbackUrls = useRef([]);
  const releaseUrlRef = useRef(onReleaseUrl);
  useEffect(() => { releaseUrlRef.current = onReleaseUrl; }, [onReleaseUrl]);
  useEffect(() => () => { fallbackUrls.current.forEach(url => releaseUrlRef.current?.(url)); }, []);
  useEffect(() => {
    let alive = true;
    if (typeof listArtifacts !== "function") return undefined;
    Promise.resolve().then(() => listArtifacts()).then(value => { if (alive) { setError(""); setItems(Array.isArray(value) ? value : []); } }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [listArtifacts, refreshKey]);
  async function download(item) {
    setError("");
    try {
      const outcome = await onDownload?.(item.artifactId);
      if (outcome?.status === "not_requested" && outcome.url) {
        fallbackUrls.current.push(outcome.url);
        while (fallbackUrls.current.length > 8) onReleaseUrl?.(fallbackUrls.current.shift());
        setFallbacks(current => ({ ...current, [item.artifactId]: outcome.url }));
      } else if (outcome?.status === "missing") {
        setItems(current => current.filter(candidate => candidate.artifactId !== item.artifactId));
        setError("That saved copy has expired. Refresh the list to see current files.");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function remove(item) {
    setError("");
    try {
      await onRemove?.(item.artifactId);
      const url = fallbacks[item.artifactId];
      if (url) { onReleaseUrl?.(url); fallbackUrls.current = fallbackUrls.current.filter(value => value !== url); }
      setFallbacks(current => { const next = { ...current }; delete next[item.artifactId]; return next; });
      setItems(current => current.filter(candidate => candidate.artifactId !== item.artifactId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <section className="artifact-library" aria-label="Generated artifacts">
    <h2>Saved export copies</h2>
    {busy && <p role="status">Loading generated files…</p>}
    {error && <p role="alert">Could not load generated files: {error}</p>}
    {!busy && !error && !items.length && <p>No generated files are saved yet.</p>}
    <ul>
      {items.map(item => <li key={item.artifactId}>
        <span><strong>{item.name}</strong> <small>{item.bytes.toLocaleString()} bytes · expires {new Date(item.expiresAt).toLocaleString()}</small></span>
        <button type="button" onClick={() => download(item)}>Download</button>
        {fallbacks[item.artifactId] && <a href={fallbacks[item.artifactId]} download={item.name}>Use download link</a>}
        <button type="button" onClick={() => remove(item)}>Delete saved copy</button>
      </li>)}
    </ul>
  </section>;
}
