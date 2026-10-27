"use client";
/* Focused, evidence-oriented animation review. It reports diagnostics and renders are supplied by the host. */
import { useEffect, useMemo, useRef, useState } from "react";
import { diagnoseAnimation } from "./animation-review.mjs";

function Raster({ result, label }) { const ref = useRef(null); useEffect(() => { const canvas = ref.current; if (!canvas || !result?.rgba || !result.width || !result.height) return; canvas.width = result.width; canvas.height = result.height; const context = canvas.getContext("2d"); context.imageSmoothingEnabled = false; context.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0); }, [result]); return result?.rgba ? <figure><canvas ref={ref} aria-label={label} role="img" /><figcaption>{label} · {result.width}×{result.height}</figcaption></figure> : null; }

export default function AnimationReviewPanel({ document, baseline = null, onPreview, onCompare, onBake, previewResult = null, baselinePreviewResult = null, wrapResult = null, disabled = false }) {
  const [clipId, setClipId] = useState(document?.clips?.[0]?.id ?? "");
  const [anchoredLayers, setAnchoredLayers] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [compareCount, setCompareCount] = useState(2);
  const report = useMemo(() => document ? diagnoseAnimation(document, { clipId: clipId || undefined, anchoredLayers, exclusions }) : null, [document, clipId, anchoredLayers, exclusions]);
  if (!document) return null;
  const imageLayers = document.layers.filter(layer => layer.type !== "group");
  const toggle = (id) => setAnchoredLayers(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  return <section className="animation-review-panel" aria-label="Animation review">
    <h2>Animation review</h2>
    <label>Clip <select value={clipId} disabled={disabled} onChange={event => setClipId(event.target.value)}><option value="">All frames</option>{(document.clips ?? []).map(clip => <option key={clip.id} value={clip.id}>{clip.name || clip.id}</option>)}</select></label>
    <fieldset><legend>Anchored layers</legend>{imageLayers.map(layer => <label key={layer.id}><input type="checkbox" checked={anchoredLayers.includes(layer.id)} disabled={disabled} onChange={() => toggle(layer.id)} /> {layer.name || layer.id}</label>)}</fieldset>
    {report && <div role="status"><strong>{report.warnings.length ? `${report.warnings.length} review warning${report.warnings.length === 1 ? "" : "s"}` : "No review warnings"}</strong><ul>{report.warnings.map((warning, index) => <li key={`${warning.code}-${warning.frameId ?? "all"}-${index}`}><code>{warning.code}</code> — {warning.message}<button type="button" onClick={() => setExclusions(current => current.includes(warning.code) ? current : [...current, warning.code])}>Exclude this check</button></li>)}</ul></div>}
    <div className="animation-review-actions"><button type="button" disabled={disabled} onClick={() => onPreview?.({ clipId: clipId || undefined, native: true, scale: 1 })}>Native-size playback</button><button type="button" disabled={disabled} onClick={() => onPreview?.({ clipId: clipId || undefined, native: false, scale: 4, contactSheet: true })}>Integer contact sheet</button>{baseline && <><label>Wrap frames <input type="number" min="1" max="8" value={compareCount} onChange={event => setCompareCount(Math.max(1, Math.min(8, Number(event.target.value) || 1)))} /></label><button type="button" disabled={disabled} onClick={() => onCompare?.({ clipId: clipId || undefined, compareCount })}>Compare wrap</button></>}{onBake && <button type="button" disabled={disabled} onClick={() => onBake?.({ pinnedLayers: anchoredLayers, period: document.frames.length })}>Bake motion from settings</button>}</div>
    {(previewResult || baselinePreviewResult) && <div className="animation-review-views" aria-label="Side-by-side animation views"><Raster result={previewResult} label="Current animation" /><Raster result={baselinePreviewResult} label="Saved baseline animation" /></div>}
    {wrapResult?.pairs && <ol aria-label="Wrap transition results">{wrapResult.pairs.map(pair => <li key={`${pair.fromFrameId}-${pair.toFrameId}`}>Frame {pair.fromFrameId} → {pair.toFrameId}: {pair.changedPixels} changed pixels{pair.wraps ? " (loop seam)" : ""}</li>)}</ol>}
  </section>;
}
