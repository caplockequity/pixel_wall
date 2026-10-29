"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { captureHomepageDemoEvent } from "./analytics";
import { createDemoPixels, DEMO_PALETTE, DEMO_SIZE, paintDemoStroke, renderDemoPng } from "./homepage-demo-core.mjs";

type Pixel = string | null;
type Point = { x: number; y: number };
type Stroke = { pointer: number; last: Point; before: Pixel[] };

export default function HomepageDemoEditor() {
  const [pixels, setPixels] = useState<Pixel[]>(createDemoPixels);
  const pixelsRef = useRef(pixels);
  const [color, setColor] = useState<string>("#ffe66d");
  const [eraser, setEraser] = useState(false);
  const [history, setHistory] = useState<Pixel[][]>([]);
  const [focus, setFocus] = useState(0);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const stroke = useRef<Stroke | null>(null);
  const opened = useRef(false), edited = useRef(false);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const [status, setStatus] = useState("Choose a color, then draw on the sunset.");
  const [download, setDownload] = useState<string | null>(null);
  const downloadRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!opened.current) { opened.current = true; captureHomepageDemoEvent("opened"); }
    return () => {
      mounted.current = false;
      if (downloadRef.current) URL.revokeObjectURL(downloadRef.current);
    };
  }, []);

  function update(next: Pixel[]) {
    pixelsRef.current = next; setPixels(next);
  }
  function paint(from: Point, to: Point) {
    const next = paintDemoStroke(pixelsRef.current, from, to, eraser ? null : color);
    if (next === pixelsRef.current) return;
    update(next);
    if (!edited.current) { edited.current = true; captureHomepageDemoEvent("edited"); }
    setStatus("Your changes stay on this page. Export PNG to keep them.");
  }
  function point(event: PointerEvent<HTMLDivElement>): Point | null {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) / bounds.width * DEMO_SIZE);
    const y = Math.floor((event.clientY - bounds.top) / bounds.height * DEMO_SIZE);
    return x >= 0 && y >= 0 && x < DEMO_SIZE && y < DEMO_SIZE ? { x, y } : null;
  }
  function finishStroke() {
    if (stroke.current && stroke.current.before !== pixelsRef.current) {
      const before = stroke.current.before;
      setHistory(previous => [...previous.slice(-19), before]);
    }
    stroke.current = null;
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || stroke.current) return;
    const current = point(event); if (!current) return;
    event.preventDefault();
    stroke.current = { pointer: event.pointerId, last: current, before: pixelsRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = current.y * DEMO_SIZE + current.x;
    setFocus(index); cells.current[index]?.focus({ preventScroll: true });
    paint(current, current);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = stroke.current;
    if (!active || active.pointer !== event.pointerId) return;
    const current = point(event);
    if (!current) return;
    paint(active.last, current); active.last = current;
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const x = index % DEMO_SIZE, y = Math.floor(index / DEMO_SIZE);
    const next = event.key === "ArrowLeft" ? y * DEMO_SIZE + Math.max(0, x - 1)
      : event.key === "ArrowRight" ? y * DEMO_SIZE + Math.min(DEMO_SIZE - 1, x + 1)
      : event.key === "ArrowUp" ? Math.max(0, y - 1) * DEMO_SIZE + x
      : event.key === "ArrowDown" ? Math.min(DEMO_SIZE - 1, y + 1) * DEMO_SIZE + x : null;
    if (next !== null) { event.preventDefault(); setFocus(next); cells.current[next]?.focus({ preventScroll: true }); }
  }
  function keyboardPaint(index: number) {
    const before = pixelsRef.current;
    const current = { x: index % DEMO_SIZE, y: Math.floor(index / DEMO_SIZE) };
    paint(current, current);
    if (before !== pixelsRef.current) setHistory(previous => [...previous.slice(-19), before]);
  }
  async function exportPng() {
    if (exportingRef.current) return;
    finishStroke(); exportingRef.current = true; setExporting(true);
    try {
      const blob = await renderDemoPng([...pixelsRef.current]) as Blob;
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      if (downloadRef.current) URL.revokeObjectURL(downloadRef.current);
      downloadRef.current = url; setDownload(url);
      captureHomepageDemoEvent("exported");
      setStatus("Your 16 × 16 PNG is ready. Use the download link below if needed.");
      const link = document.createElement("a");
      link.href = url; link.download = "pixelwall-tiny-sunset.png";
      document.body.append(link);
      try { link.click(); } catch { /* The visible download link remains available. */ } finally { link.remove(); }
    } catch {
      if (mounted.current) { captureHomepageDemoEvent("export_failed"); setStatus("The PNG couldn’t be generated. Your drawing is still here; please try again."); }
    } finally {
      exportingRef.current = false;
      if (mounted.current) setExporting(false);
    }
  }

  return <div className="tiny-editor ph-no-capture">
    <div className="demo-toolbar" aria-label="Drawing tools">
      <button type="button" aria-pressed={!eraser} onClick={() => setEraser(false)}>Pencil</button>
      <button type="button" aria-pressed={eraser} onClick={() => setEraser(true)}>Eraser</button>
      <button type="button" disabled={!history.length} onClick={() => { finishStroke(); const previous = history.at(-1); if (previous) { update(previous); setHistory(history.slice(0, -1)); setStatus("Last stroke undone."); } }}>Undo</button>
      <button type="button" onClick={() => { finishStroke(); const next = createDemoPixels(); const before = pixelsRef.current; if (next.every((pixel: Pixel, index: number) => pixel === before[index])) return; setHistory(previous => [...previous.slice(-19), before]); update(next); setStatus("Starter restored. Undo brings your drawing back."); }}>Reset</button>
    </div>
    <div className="demo-palette" aria-label="Color palette">{DEMO_PALETTE.map((swatch: string) => <button type="button" key={swatch} aria-label={`Draw with ${swatch}`} aria-pressed={!eraser && color === swatch} style={{ "--swatch": swatch } as CSSProperties} onClick={() => { setColor(swatch); setEraser(false); }} />)}</div>
    <div className="demo-pixels" role="grid" aria-label="16 by 16 editable pixel canvas" aria-describedby="demo-keyboard-help" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finishStroke} onPointerCancel={finishStroke} onLostPointerCapture={finishStroke}>
      {Array.from({ length: DEMO_SIZE }, (_, y) => <div role="row" key={y}>{pixels.slice(y * DEMO_SIZE, (y + 1) * DEMO_SIZE).map((pixel, x) => {
        const index = y * DEMO_SIZE + x;
        return <button type="button" role="gridcell" key={x} ref={element => { cells.current[index] = element; }} tabIndex={index === focus ? 0 : -1} aria-label={`Row ${y + 1}, column ${x + 1}, ${pixel ?? "transparent"}`} style={{ backgroundColor: pixel ?? "transparent" }} onFocus={() => setFocus(index)} onKeyDown={event => keyboard(event, index)} onClick={event => { if (event.detail === 0) keyboardPaint(index); }} />;
      })}</div>)}
    </div>
    <div className="demo-export"><button type="button" className="site-button small" onClick={exportPng} disabled={exporting}>{exporting ? "Preparing PNG…" : "Export PNG ↓"}</button><span>16 × 16 · transparent PNG</span></div>
    <p className="demo-status" role="status">{status}</p>
    {download && <a className="demo-download" href={download} download="pixelwall-tiny-sunset.png">Download your PNG again ↓</a>}
    <p className="demo-help" id="demo-keyboard-help">Click or drag to draw. Keyboard: arrows to move, Enter or Space to paint.</p>
  </div>;
}
