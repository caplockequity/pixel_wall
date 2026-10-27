"use client";
/* eslint react/prop-types: "off" -- panel inputs are validated by the generator. */
import { useEffect, useMemo, useRef, useState } from "react";
import { generateSceneComponent, listSceneComponentPresets, SCENE_COMPONENT_KINDS, SCENE_COMPONENT_STYLES } from "./scene-components.mjs";

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

export default function SceneComponentsPanel({ onStamp, disabled = false }) {
  const presets = useMemo(() => listSceneComponentPresets(), []);
  const [kind, setKind] = useState("tree"), [style, setStyle] = useState("woodland"), [seed, setSeed] = useState(1);
  const preset = presets.find(value => value.kind === kind);
  const [width, setWidth] = useState(preset.size.width), [height, setHeight] = useState(preset.size.height), [x, setX] = useState(0), [y, setY] = useState(0);
  const changeKind = value => { const next = presets.find(item => item.kind === value); setKind(value); setWidth(next.size.width); setHeight(next.size.height); };
  const component = useMemo(() => { try { return generateSceneComponent({ kind, style, seed, size: { width, height }, position: { x, y } }); } catch { return null; } }, [kind, style, seed, width, height, x, y]);
  return <section className="wb-scene-components" aria-label="Scene components">
    <header><h2>Scene components</h2><p>Stamp editable trees, rocks, banks, bridges and terrain.</p></header>
    <div className="wb-scene-component-controls">
      <label>Kind<select value={kind} disabled={disabled} onChange={event => changeKind(event.target.value)}>{SCENE_COMPONENT_KINDS.map(value => <option key={value} value={value}>{value.replace("-", " ")}</option>)}</select></label>
      <label>Style<select value={style} disabled={disabled} onChange={event => setStyle(event.target.value)}>{SCENE_COMPONENT_STYLES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Seed<input type="number" min="0" max="4294967295" value={seed} disabled={disabled} onChange={event => setSeed(clamp(+event.target.value, 0, 4294967295))} /></label>
      <label>Width<input type="number" min="4" max="128" value={width} disabled={disabled} onChange={event => setWidth(clamp(+event.target.value, 4, 128))} /></label>
      <label>Height<input type="number" min="4" max="128" value={height} disabled={disabled} onChange={event => setHeight(clamp(+event.target.value, 4, 128))} /></label>
      <label>X<input type="number" min="-65535" max="65535" value={x} disabled={disabled} onChange={event => setX(clamp(+event.target.value, -65535, 65535))} /></label>
      <label>Y<input type="number" min="-65535" max="65535" value={y} disabled={disabled} onChange={event => setY(clamp(+event.target.value, -65535, 65535))} /></label>
    </div>
    {component ? <><Preview component={component} /><p>{component.layers.length} editable layers · {component.width}×{component.height}</p></> : <p role="alert">Choose valid component dimensions.</p>}
    <button type="button" disabled={disabled || !component} onClick={() => component && onStamp?.({ type: "scene.component", kind, style, seed, position: { x, y }, size: { width, height } })}>Stamp component</button>
  </section>;
}
