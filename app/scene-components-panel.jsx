"use client";
/* eslint react/prop-types: "off", react-hooks/exhaustive-deps: "off" -- panel inputs are validated by the generator; primitive controls are listed explicitly. */
import { useEffect, useMemo, useRef, useState } from "react";
import { generateSceneComponent, listSceneComponentPresets, previewSceneComponentReplacement, SCENE_COMPONENT_KINDS, SCENE_COMPONENT_STYLES } from "./scene-components.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const rgba = value => { const hex = value.slice(1); return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8) || "ff", 16)]; };

function Preview({ component }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current, context = canvas?.getContext("2d");
    if (!context || !component) return;
    const scale = Math.max(1, Math.floor(192 / Math.max(component.width, component.height)));
    canvas.width = component.width * scale; canvas.height = component.height * scale;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of component.layers) for (let i = 0; i < layer.pixels.length; i++) {
      const color = layer.pixels[i]; if (!color) continue;
      const x = i % component.width, y = Math.floor(i / component.width), [r, g, b, a] = rgba(color);
      context.fillStyle = `rgba(${r},${g},${b},${a / 255})`; context.fillRect(x * scale, y * scale, scale, scale);
    }
  }, [component]);
  return <canvas ref={ref} className="wb-scene-component-preview" aria-label={`${component.kind} component preview`} role="img" />;
}

export default function SceneComponentsPanel({ document: doc = null, onStamp, onReplace, disabled = false }) {
  const presets = useMemo(() => listSceneComponentPresets(), []);
  const [kind, setKind] = useState("tree"), [style, setStyle] = useState("woodland"), [seed, setSeed] = useState(1);
  const preset = presets.find(value => value.kind === kind);
  const [width, setWidth] = useState(preset.size.width), [height, setHeight] = useState(preset.size.height), [x, setX] = useState(0), [y, setY] = useState(0), [componentId, setComponentId] = useState("hero-prop");
  const existing = doc?.metadata?.sceneComponents ?? [], [existingId, setExistingId] = useState(existing[0]?.componentId ?? ""), [preserveManual, setPreserveManual] = useState(false);
  const [crownAspectRatio, setCrownAspectRatio] = useState(1), [asymmetry, setAsymmetry] = useState(0), [trunkBend, setTrunkBend] = useState(0), [rootSpread, setRootSpread] = useState(1), [lightDirection, setLightDirection] = useState("left"), [clusterGap, setClusterGap] = useState(0);
  const changeKind = value => { const next = presets.find(item => item.kind === value); setKind(value); setWidth(next.size.width); setHeight(next.size.height); };
  const artDirection = { crownAspectRatio, asymmetry, trunkBend, rootSpread, lightDirection, clusterGap };
  const component = useMemo(() => { try { return generateSceneComponent({ kind, style, seed, componentId, size: { width, height }, position: { x, y }, artDirection }); } catch { return null; } }, [kind, style, seed, componentId, width, height, x, y, crownAspectRatio, asymmetry, trunkBend, rootSpread, lightDirection, clusterGap]);
  const selectedExisting = existing.find(value => value.componentId === existingId);
  const replacement = useMemo(() => { try { return selectedExisting ? generateSceneComponent({ ...selectedExisting.recipe, style, seed, artDirection }) : null; } catch { return null; } }, [selectedExisting, style, seed, crownAspectRatio, asymmetry, trunkBend, rootSpread, lightDirection, clusterGap]);
  const existingComponent = selectedExisting && doc?.frames?.[0] ? { componentId: selectedExisting.componentId, metadata: selectedExisting, layers: (selectedExisting.layerIds ?? []).map(id => { const cel = doc.frames[0].cels?.[id], image = cel && doc.images?.[cel.imageId]; return { id, pixels: image?.pixels ?? [], width: image?.width ?? 0, height: image?.height ?? 0 }; }) } : null;
  const replacementPreview = existingComponent && replacement ? previewSceneComponentReplacement(existingComponent, replacement) : null;
  return <section className="wb-scene-components" aria-label="Scene components">
    <header><h2>Scene components</h2><p>Stamp editable trees, rocks, banks, bridges and terrain.</p></header>
    <div className="wb-scene-component-controls">
      {existing.length > 0 && <><label>Existing component<select value={existingId} disabled={disabled} onChange={event => setExistingId(event.target.value)}>{existing.map(value => <option key={value.componentId} value={value.componentId}>{value.componentId}</option>)}</select></label><label><input type="checkbox" checked={preserveManual} disabled={disabled} onChange={event => setPreserveManual(event.target.checked)} /> Allow regeneration and preserve detected manual edits</label></>}
      <label>Kind<select value={kind} disabled={disabled} onChange={event => changeKind(event.target.value)}>{SCENE_COMPONENT_KINDS.map(value => <option key={value} value={value}>{value.replace("-", " ")}</option>)}</select></label>
      <label>Style<select value={style} disabled={disabled} onChange={event => setStyle(event.target.value)}>{SCENE_COMPONENT_STYLES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Seed<input type="number" min="0" max="4294967295" value={seed} disabled={disabled} onChange={event => setSeed(clamp(+event.target.value, 0, 4294967295))} /></label>
      <label>Width<input type="number" min="4" max="128" value={width} disabled={disabled} onChange={event => setWidth(clamp(+event.target.value, 4, 128))} /></label>
      <label>Height<input type="number" min="4" max="128" value={height} disabled={disabled} onChange={event => setHeight(clamp(+event.target.value, 4, 128))} /></label>
      <label>X<input type="number" min="-65535" max="65535" value={x} disabled={disabled} onChange={event => setX(clamp(+event.target.value, -65535, 65535))} /></label>
      <label>Y<input type="number" min="-65535" max="65535" value={y} disabled={disabled} onChange={event => setY(clamp(+event.target.value, -65535, 65535))} /></label>
      <label>Component ID<input value={componentId} maxLength={120} disabled={disabled} onChange={event => setComponentId(event.target.value)} /></label>
      {kind === "tree" && <><label>Crown aspect<input type="number" min=".55" max="1.6" step=".05" value={crownAspectRatio} disabled={disabled} onChange={event => setCrownAspectRatio(clamp(+event.target.value, .55, 1.6))} /></label><label>Asymmetry<input type="number" min="-.35" max=".35" step=".05" value={asymmetry} disabled={disabled} onChange={event => setAsymmetry(clamp(+event.target.value, -.35, .35))} /></label><label>Trunk bend<input type="number" min="-.25" max=".25" step=".05" value={trunkBend} disabled={disabled} onChange={event => setTrunkBend(clamp(+event.target.value, -.25, .25))} /></label><label>Root spread<input type="number" min=".5" max="1.5" step=".05" value={rootSpread} disabled={disabled} onChange={event => setRootSpread(clamp(+event.target.value, .5, 1.5))} /></label><label>Light<select value={lightDirection} disabled={disabled} onChange={event => setLightDirection(event.target.value)}><option value="left">Left</option><option value="right">Right</option></select></label><label>Cluster gap<input type="number" min="0" max="8" step="1" value={clusterGap} disabled={disabled} onChange={event => setClusterGap(clamp(+event.target.value, 0, 8))} /></label></>}
    </div>
    {component ? <><Preview component={component} /><p>{component.layers.length} editable layers · {component.width}×{component.height}</p></> : <p role="alert">Choose valid component dimensions.</p>}
    <button type="button" disabled={disabled || !component} onClick={() => component && onStamp?.({ type: "scene.component", kind, style, seed, componentId, position: { x, y }, size: { width, height }, artDirection })}>Stamp component</button>
    {selectedExisting && replacement && <div className="wb-scene-component-regeneration" aria-live="polite"><h3>Regeneration preview: {selectedExisting.componentId}</h3><Preview component={replacement} /><p>{replacementPreview?.affectedPixelCount ?? 0} changed pixels across {replacementPreview?.affectedLayers?.length ?? 0} layers. Manual layers recorded: {selectedExisting.manualLayerIds?.length ?? 0}.</p><button type="button" disabled={disabled} onClick={() => onReplace?.({ type: "scene.component.replace", componentId: selectedExisting.componentId, recipe: replacement.recipe, allowModified: preserveManual, preserveLayerIds: preserveManual ? (selectedExisting.manualLayerIds ?? []) : [] })}>Commit regeneration</button></div>}
  </section>;
}
