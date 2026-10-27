"use client";
/* eslint react/prop-types: "off", react-hooks/set-state-in-effect: "off" -- Document changes must clear stale frame/layer selections before rendering. */

import { useEffect, useMemo, useState } from "react";

/** Purely callback-driven preview controls; rendering stays in preview-render.mjs. */
export default function PreviewPanel({ document, beforeDocument = null, onRender, result = null }) {
  const [frameId, setFrameId] = useState(document?.frames?.[0]?.id ?? "");
  const [layerIds, setLayerIds] = useState(() => document?.layers?.filter(layer => layer.visible !== false && layer.type !== "group").map(layer => layer.id) ?? []);
  const [contactSheet, setContactSheet] = useState(false);
  const [compare, setCompare] = useState(false);
  const [crop, setCrop] = useState({ x: "", y: "", width: "", height: "" });
  const layers = useMemo(() => document?.layers?.filter(layer => layer.type !== "group") ?? [], [document]);
  useEffect(() => {
    if (!document) return;
    const validFrames = new Set(document.frames.map(frame => frame.id));
    const validLayers = new Set(document.layers.filter(layer => layer.type !== "group").map(layer => layer.id));
    setFrameId(current => validFrames.has(current) ? current : document.frames[0]?.id ?? "");
    setLayerIds(current => {
      const valid = current.filter(id => validLayers.has(id));
      return valid.length ? valid : document.layers.filter(layer => layer.visible !== false && layer.type !== "group").map(layer => layer.id);
    });
  }, [document]);
  if (!document) return null;
  function toggleLayer(id) { setLayerIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  function render() {
    if (!layerIds.length) return;
    const numericCrop = Object.values(crop).every(value => value !== "") ? Object.fromEntries(Object.entries(crop).map(([key, value]) => [key, Number(value)])) : undefined;
    const beforeFrameId = beforeDocument?.frames?.some(frame => frame.id === frameId) ? frameId : beforeDocument?.frames?.[0]?.id;
    const beforeLayerIds = beforeDocument ? layerIds.filter(id => beforeDocument.layers.some(layer => layer.id === id && layer.type !== "group")) : undefined;
    onRender?.({ frameId, layerIds, crop: numericCrop, contactSheet, compare: compare && !!beforeDocument && !!beforeFrameId, beforeFrameId, beforeLayerIds: beforeLayerIds?.length ? beforeLayerIds : undefined });
  }
  return <section className="preview-panel" aria-label="Preview controls">
    <h2>Preview</h2>
    <label>Frame <select value={frameId} onChange={event => setFrameId(event.target.value)}>{document.frames.map((frame, index) => <option key={frame.id} value={frame.id}>{index + 1}: {frame.id}</option>)}</select></label>
    <fieldset><legend>Layers</legend>{layers.map(layer => <label key={layer.id}><input type="checkbox" checked={layerIds.includes(layer.id)} onChange={() => toggleLayer(layer.id)} /> {layer.name || layer.id}</label>)}{!layerIds.length && <p role="alert">Select at least one layer.</p>}</fieldset>
    <fieldset><legend>Crop</legend>{Object.keys(crop).map(key => <label key={key}>{key} <input inputMode="numeric" value={crop[key]} onChange={event => setCrop(current => ({ ...current, [key]: event.target.value }))} /></label>)}</fieldset>
    <label><input type="checkbox" checked={contactSheet} onChange={event => setContactSheet(event.target.checked)} /> Animation contact sheet</label>
    {beforeDocument && <label><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} /> Compare with previous version</label>}
    <button type="button" onClick={render}>Render preview</button>
    {result && <p role="status">{result.kind === "comparison" ? `${result.changedPixels} changed pixels` : `${result.width} × ${result.height} preview ready`}</p>}
  </section>;
}
