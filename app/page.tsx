"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  CopyPlus,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Grid2X2,
  ImagePlus,
  Minus,
  PaintBucket,
  Pause,
  Pencil,
  Pipette,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";

type Pixel = string | null;
type Tool = "pencil" | "eraser" | "fill" | "picker";
type ArtFrame = { id: number; pixels: Pixel[] };
type Snapshot = { frames: ArtFrame[]; size: number; activeFrame: number };

const STARTER_PALETTE = [
  "#16152b",
  "#3c315f",
  "#7059c7",
  "#ff6b57",
  "#ffb34b",
  "#ffe66d",
  "#70d6b2",
  "#218c89",
  "#f8f0df",
];
const GRID_SIZES = [8, 16, 24, 32];
const MAX_HISTORY = 40;
const MAX_FRAMES = 12;

function makeDemoPixels(size: number, shift = 0): Pixel[] {
  return Array.from({ length: size * size }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const scale = size / 16;
    const px = x / scale;
    const py = y / scale + shift;
    const sun = Math.hypot(px - 11.5, py - 4.5);
    if (sun < 2.4) return sun < 1.55 ? "#ffe66d" : "#ffb34b";
    if (py >= 11 + Math.abs(px - 4) * 0.42) return "#218c89";
    if (py >= 9 + Math.abs(px - 4) * 0.56) return "#ff6b57";
    if (py >= 10 + Math.abs(px - 11) * 0.48) return "#7059c7";
    if (
      (Math.round(px) === 2 && Math.round(py) === 3) ||
      (Math.round(px) === 5 && Math.round(py) === 2) ||
      (Math.round(px) === 8 && Math.round(py) === 5)
    ) {
      return "#f8f0df";
    }
    return py < 7 ? "#262447" : "#3c315f";
  });
}

function cloneFrames(frames: ArtFrame[]) {
  return frames.map((frame) => ({ ...frame, pixels: [...frame.pixels] }));
}

function resizePixels(pixels: Pixel[], oldSize: number, newSize: number) {
  const next = Array<Pixel>(newSize * newSize).fill(null);
  const offset = Math.floor((newSize - oldSize) / 2);
  for (let y = 0; y < oldSize; y += 1) {
    for (let x = 0; x < oldSize; x += 1) {
      const nextX = x + offset;
      const nextY = y + offset;
      if (nextX >= 0 && nextX < newSize && nextY >= 0 && nextY < newSize) {
        next[nextY * newSize + nextX] = pixels[y * oldSize + x] ?? null;
      }
    }
  }
  return next;
}

function floodFill(pixels: Pixel[], size: number, start: number, color: Pixel) {
  const target = pixels[start] ?? null;
  if (target === color) return pixels;
  const next = [...pixels];
  const stack = [start];
  const visited = new Set<number>();
  while (stack.length) {
    const index = stack.pop()!;
    if (visited.has(index) || (next[index] ?? null) !== target) continue;
    visited.add(index);
    next[index] = color;
    const x = index % size;
    const y = Math.floor(index / size);
    if (x > 0) stack.push(index - 1);
    if (x < size - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - size);
    if (y < size - 1) stack.push(index + size);
  }
  return next;
}

function cellsBetween(from: number, to: number, size: number) {
  let x0 = from % size;
  let y0 = Math.floor(from / size);
  const x1 = to % size;
  const y1 = Math.floor(to / size);
  const result: number[] = [];
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    result.push(y0 * size + x0);
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x0 += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += sy;
    }
  }
  return result;
}

function FrameThumbnail({ pixels, size }: { pixels: Pixel[]; size: number }) {
  return (
    <div
      className="pixel-thumb"
      style={{ "--grid-size": size } as CSSProperties}
      aria-hidden="true"
    >
      {pixels.map((color, index) => (
        <span key={index} style={{ background: color ?? "transparent" }} />
      ))}
    </div>
  );
}

export default function Home() {
  const [size, setSize] = useState(16);
  const [frames, setFrames] = useState<ArtFrame[]>(() => [
    { id: 1, pixels: makeDemoPixels(16, 0) },
    { id: 2, pixels: makeDemoPixels(16, 0.45) },
    { id: 3, pixels: makeDemoPixels(16, 0.9) },
  ]);
  const [activeFrame, setActiveFrame] = useState(0);
  const [tool, setTool] = useState<Tool>("pencil");
  const [selectedColor, setSelectedColor] = useState("#ff6b57");
  const [palette, setPalette] = useState(STARTER_PALETTE);
  const [showGrid, setShowGrid] = useState(true);
  const [showOnion, setShowOnion] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [referenceOpacity, setReferenceOpacity] = useState(38);
  const [zoom, setZoom] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const [saved, setSaved] = useState(true);
  const [notice, setNotice] = useState("");
  const [storageReady, setStorageReady] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activePointer = useRef<number | null>(null);
  const lastPainted = useRef<number | null>(null);
  const strokeRecorded = useRef(false);

  const currentPixels = frames[activeFrame]?.pixels ?? [];
  const previousPixels = useMemo(() => {
    if (frames.length < 2) return [];
    const previous = (activeFrame - 1 + frames.length) % frames.length;
    return frames[previous]?.pixels ?? [];
  }, [activeFrame, frames]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedProject = window.localStorage.getItem("pixelwall-project-v1");
        if (savedProject) {
          const parsed = JSON.parse(savedProject) as Partial<{
            size: number;
            frames: ArtFrame[];
            activeFrame: number;
            palette: string[];
            selectedColor: string;
          }>;
          if (
            parsed.size &&
            GRID_SIZES.includes(parsed.size) &&
            Array.isArray(parsed.frames) &&
            parsed.frames.length > 0 &&
            parsed.frames.every((frame) => frame.pixels?.length === parsed.size! * parsed.size!)
          ) {
            setSize(parsed.size);
            setFrames(cloneFrames(parsed.frames));
            setActiveFrame(Math.min(parsed.activeFrame ?? 0, parsed.frames.length - 1));
            if (Array.isArray(parsed.palette) && parsed.palette.length) setPalette(parsed.palette);
            if (parsed.selectedColor) setSelectedColor(parsed.selectedColor);
          }
        }
      } catch {
        // A malformed local draft should never block the editor.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const savingTimer = window.setTimeout(() => setSaved(false), 0);
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(
        "pixelwall-project-v1",
        JSON.stringify({ size, frames, activeFrame, palette, selectedColor }),
      );
      setSaved(true);
    }, 450);
    return () => {
      window.clearTimeout(savingTimer);
      window.clearTimeout(timer);
    };
  }, [activeFrame, frames, palette, selectedColor, size, storageReady]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveFrame((current) => (current + 1) % frames.length);
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [fps, frames.length, playing]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function snapshot(): Snapshot {
    return { frames: cloneFrames(frames), size, activeFrame };
  }

  function pushHistory() {
    const nextSnapshot = snapshot();
    setUndoStack((current) => [...current.slice(-(MAX_HISTORY - 1)), nextSnapshot]);
    setRedoStack([]);
  }

  function restoreSnapshot(next: Snapshot) {
    setFrames(cloneFrames(next.frames));
    setSize(next.size);
    setActiveFrame(Math.min(next.activeFrame, next.frames.length - 1));
    setCursorIndex((current) => Math.min(current, next.size * next.size - 1));
    setPlaying(false);
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((current) => [...current.slice(-(MAX_HISTORY - 1)), snapshot()]);
    setUndoStack((current) => current.slice(0, -1));
    restoreSnapshot(previous);
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((current) => [...current.slice(-(MAX_HISTORY - 1)), snapshot()]);
    setRedoStack((current) => current.slice(0, -1));
    restoreSnapshot(next);
  }

  function updateActivePixels(update: (pixels: Pixel[]) => Pixel[]) {
    setFrames((current) =>
      current.map((frame, index) =>
        index === activeFrame ? { ...frame, pixels: update(frame.pixels) } : frame,
      ),
    );
  }

  function applyTool(index: number, indices = [index]) {
    if (tool === "picker") {
      const color = currentPixels[index];
      if (color) {
        setSelectedColor(color);
        setTool("pencil");
        setNotice(`Picked ${color.toUpperCase()}`);
      }
      return;
    }
    if (tool === "fill") {
      updateActivePixels((pixels) => floodFill(pixels, size, index, selectedColor));
      return;
    }
    const color = tool === "eraser" ? null : selectedColor;
    updateActivePixels((pixels) => {
      const next = [...pixels];
      indices.forEach((cell) => { next[cell] = color; });
      return next;
    });
  }

  function toolWouldChange(index: number, indices = [index]) {
    if (tool === "picker") return false;
    if (tool === "fill") return (currentPixels[index] ?? null) !== selectedColor;
    const color = tool === "eraser" ? null : selectedColor;
    return indices.some((cell) => (currentPixels[cell] ?? null) !== color);
  }

  function indexFromPointer(clientX: number, clientY: number) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    if (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height) return null;
    const x = Math.min(size - 1, Math.floor((localX / bounds.width) * size));
    const y = Math.min(size - 1, Math.floor((localY / bounds.height) * size));
    return y * size + x;
  }

  function beginStroke(event: ReactPointerEvent<HTMLDivElement>) {
    if (playing || event.button !== 0 || !event.isPrimary || activePointer.current !== null) return;
    const index = indexFromPointer(event.clientX, event.clientY);
    if (index === null) return;
    setCursorIndex(index);
    strokeRecorded.current = false;
    if (tool === "picker") {
      applyTool(index);
      return;
    }
    if (toolWouldChange(index)) {
      pushHistory();
      strokeRecorded.current = true;
      applyTool(index);
    }
    if (tool === "pencil" || tool === "eraser") {
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointer.current = event.pointerId;
      lastPainted.current = index;
    }
  }

  function continueStroke(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId || lastPainted.current === null) return;
    const index = indexFromPointer(event.clientX, event.clientY);
    if (index === null || index === lastPainted.current) return;
    const path = cellsBetween(lastPainted.current, index, size);
    if (toolWouldChange(index, path)) {
      if (!strokeRecorded.current) {
        pushHistory();
        strokeRecorded.current = true;
      }
      applyTool(index, path);
    }
    setCursorIndex(index);
    lastPainted.current = index;
  }

  function endStroke(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointer.current = null;
    lastPainted.current = null;
    strokeRecorded.current = false;
  }

  function handleCanvasKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    const toolShortcut: Partial<Record<string, Tool>> = {
      p: "pencil",
      e: "eraser",
      f: "fill",
      i: "picker",
    };
    const shortcutTool = toolShortcut[event.key.toLowerCase()];
    if (shortcutTool) {
      event.preventDefault();
      setTool(shortcutTool);
      return;
    }
    if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      setShowGrid((value) => !value);
      return;
    }
    let next = cursorIndex;
    const cursorX = cursorIndex % size;
    if (event.key === "ArrowLeft" && cursorX > 0) next = cursorIndex - 1;
    if (event.key === "ArrowRight" && cursorX < size - 1) next = cursorIndex + 1;
    if (event.key === "ArrowUp") next = Math.max(0, cursorIndex - size);
    if (event.key === "ArrowDown") next = Math.min(size * size - 1, cursorIndex + size);
    if (next !== cursorIndex) {
      event.preventDefault();
      setCursorIndex(next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (event.repeat || playing) return;
      if (tool === "picker") applyTool(cursorIndex);
      else if (toolWouldChange(cursorIndex)) {
        pushHistory();
        applyTool(cursorIndex);
      }
    }
  }

  function changeSize(nextSize: number) {
    if (nextSize === size) return;
    pushHistory();
    setFrames((current) =>
      current.map((frame) => ({
        ...frame,
        pixels: resizePixels(frame.pixels, size, nextSize),
      })),
    );
    setSize(nextSize);
    setCursorIndex(0);
    setNotice(`Canvas resized to ${nextSize} × ${nextSize}`);
  }

  function addFrame() {
    if (frames.length >= MAX_FRAMES) {
      setNotice(`Frame limit is ${MAX_FRAMES}`);
      return;
    }
    pushHistory();
    const nextId = Math.max(...frames.map((frame) => frame.id), 0) + 1;
    setFrames((current) => [...current, { id: nextId, pixels: Array(size * size).fill(null) }]);
    setActiveFrame(frames.length);
  }

  function duplicateFrame() {
    if (frames.length >= MAX_FRAMES) {
      setNotice(`Frame limit is ${MAX_FRAMES}`);
      return;
    }
    pushHistory();
    const nextId = Math.max(...frames.map((frame) => frame.id), 0) + 1;
    const duplicate = { id: nextId, pixels: [...currentPixels] };
    setFrames((current) => [
      ...current.slice(0, activeFrame + 1),
      duplicate,
      ...current.slice(activeFrame + 1),
    ]);
    setActiveFrame(activeFrame + 1);
  }

  function deleteFrame() {
    if (frames.length === 1) {
      setNotice("Keep at least one frame");
      return;
    }
    pushHistory();
    if (frames.length === 2) setPlaying(false);
    setFrames((current) => current.filter((_, index) => index !== activeFrame));
    setActiveFrame((current) => Math.max(0, Math.min(current, frames.length - 2)));
  }

  function clearFrame() {
    if (currentPixels.every((pixel) => pixel === null)) {
      setNotice("Frame is already clear");
      return;
    }
    pushHistory();
    updateActivePixels(() => Array(size * size).fill(null));
    setNotice("Frame cleared");
  }

  function handleReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setReference(String(reader.result));
      setNotice("Reference projected onto the wall");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function addCustomColor(event: ChangeEvent<HTMLInputElement>) {
    const color = event.target.value;
    setSelectedColor(color);
    setPalette((current) => current.includes(color) ? current : [...current, color]);
  }

  function exportPng() {
    const scale = 16;
    const canvas = document.createElement("canvas");
    canvas.width = size * scale;
    canvas.height = size * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    currentPixels.forEach((color, index) => {
      if (!color) return;
      context.fillStyle = color;
      context.fillRect((index % size) * scale, Math.floor(index / size) * scale, scale, scale);
    });
    const link = document.createElement("a");
    link.download = `pixelwall-frame-${String(activeFrame + 1).padStart(2, "0")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setNotice(`Frame ${activeFrame + 1} exported at ${canvas.width} × ${canvas.height}px`);
  }

  const surfaceStyle = { "--grid-size": size } as CSSProperties;

  return (
    <main className="studio-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="PixelWall home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>PIXELWALL</span>
        </Link>

        <div className="project-title" aria-live="polite">
          <span className={`status-dot ${saved ? "" : "saving"}`} />
          <strong>DESERT SIGNAL</strong>
          <span className="saved-label">{saved ? "SAVED LOCALLY" : "SAVING…"}</span>
        </div>

        <div className="header-actions">
          <label className="size-select-wrap">
            <span>CANVAS</span>
            <select value={size} onChange={(event) => changeSize(Number(event.target.value))}>
              {GRID_SIZES.map((option) => <option key={option} value={option}>{option} × {option}</option>)}
            </select>
          </label>
          <button className="icon-button" onClick={undo} disabled={!undoStack.length} aria-label="Undo"><Undo2 size={18} /></button>
          <button className="icon-button" onClick={redo} disabled={!redoStack.length} aria-label="Redo"><Redo2 size={18} /></button>
          <button className="export-button" onClick={exportPng}><Download size={17} /><span>EXPORT PNG</span></button>
        </div>
      </header>

      <section className={`wall-stage ${reference ? "reference-live" : ""}`} aria-label="Pixel art canvas mounted in a projector beam">
        <div className="projector-beam" />
        <div className="projector-unit" aria-hidden="true"><span className="lens" /><span className="projector-slot" /></div>

        <aside className="tool-rail" aria-label="Drawing tools">
          {([
            ["pencil", Pencil, "Pencil", "P"],
            ["eraser", Eraser, "Eraser", "E"],
            ["fill", PaintBucket, "Fill", "F"],
            ["picker", Pipette, "Pick color", "I"],
          ] as const).map(([value, Icon, label, shortcut]) => (
            <button
              key={value}
              className={`tool ${tool === value ? "active" : ""}`}
              onClick={() => setTool(value)}
              aria-label={`${label} tool`}
              aria-pressed={tool === value}
            >
              <Icon size={19} />
              <span>{shortcut}</span>
            </button>
          ))}
        </aside>

        <div className="canvas-zone">
          <div className="size-chip">{size} × {size}</div>
          <div className="canvas-viewport">
          <div className={`frame-rig zoom-${zoom}`}>
            <span className="frame-screw screw-a" /><span className="frame-screw screw-b" />
            <span className="frame-screw screw-c" /><span className="frame-screw screw-d" />
            <div className="art-surface" style={surfaceStyle}>
              <div className="transparent-grid" />
              {reference && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="projection-image"
                  src={reference}
                  alt="Projected reference"
                  style={{ opacity: referenceOpacity / 100 }}
                />
              )}
              {showOnion && frames.length > 1 && (
                <div className="onion-layer" aria-hidden="true">
                  {previousPixels.map((color, index) => <span key={index} style={{ background: color ?? "transparent" }} />)}
                </div>
              )}
              <div
                ref={canvasRef}
                className={`pixel-canvas ${showGrid ? "show-grid" : ""}`}
                role="grid"
                aria-label={`${size} by ${size} editable pixel canvas. Use arrow keys to move and Space to paint.`}
                tabIndex={0}
                onPointerDown={beginStroke}
                onPointerMove={continueStroke}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onLostPointerCapture={() => { activePointer.current = null; lastPainted.current = null; strokeRecorded.current = false; }}
                onKeyDown={handleCanvasKey}
              >
                {currentPixels.map((color, index) => (
                  <span
                    key={index}
                    className={index === cursorIndex ? "keyboard-cell" : ""}
                    style={{ background: color ?? "transparent" }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
          </div>
          </div>
          <p className="canvas-hint">DRAG TO PAINT · ARROW KEYS + SPACE WORK TOO</p>
        </div>

        <aside className="projection-panel" aria-label="Projection controls">
          <div className="projection-title"><span className="panel-kicker">PROJECTOR</span><span className={reference ? "live-light" : ""} /></div>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleReference} />
          <button className="project-action" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> {reference ? "CHANGE IMAGE" : "LOAD IMAGE"}</button>
          <label className={`opacity-control ${reference ? "" : "disabled"}`}>
            <span>LIGHT</span><strong>{referenceOpacity}%</strong>
            <input type="range" min="0" max="100" value={referenceOpacity} onChange={(event) => setReferenceOpacity(Number(event.target.value))} disabled={!reference} />
          </label>
          <button className={`project-toggle ${showGrid ? "active" : ""}`} onClick={() => setShowGrid((value) => !value)} aria-pressed={showGrid}>
            <Grid2X2 size={15} /> GRID <span>{showGrid ? "ON" : "OFF"}</span>
          </button>
          <button className={`project-toggle ${showOnion ? "active" : ""}`} onClick={() => setShowOnion((value) => !value)} aria-pressed={showOnion}>
            {showOnion ? <Eye size={15} /> : <EyeOff size={15} />} ONION <span>{showOnion ? "ON" : "OFF"}</span>
          </button>
          <div className="zoom-control" aria-label="Canvas zoom">
            <button onClick={() => setZoom((value) => Math.max(100, value - 50))} disabled={zoom === 100} aria-label="Zoom out"><Minus size={14} /></button>
            <strong>{zoom}%</strong>
            <button onClick={() => setZoom((value) => Math.min(200, value + 50))} disabled={zoom === 200} aria-label="Zoom in"><Plus size={14} /></button>
          </div>
          {reference && <button className="remove-reference" onClick={() => setReference(null)}>REMOVE IMAGE</button>}
          <button className="clear-action" onClick={clearFrame}><RotateCcw size={14} /> CLEAR FRAME</button>
        </aside>
      </section>

      <section className="control-deck">
        <div className="palette-panel">
          <div className="panel-row"><span className="panel-kicker">COLOR RACK</span><code>{selectedColor.toUpperCase()}</code></div>
          <div className="palette-row">
            {palette.map((color) => (
              <button
                key={color}
                className={`swatch ${selectedColor.toLowerCase() === color.toLowerCase() ? "selected" : ""}`}
                style={{ "--swatch": color } as CSSProperties}
                onClick={() => { setSelectedColor(color); setTool("pencil"); }}
                aria-label={`Select color ${color}`}
                aria-pressed={selectedColor.toLowerCase() === color.toLowerCase()}
              />
            ))}
            <label className="add-swatch" aria-label="Add a custom color"><Plus size={16} /><input type="color" value={selectedColor} onChange={addCustomColor} /></label>
          </div>
        </div>

        <div className="frames-panel">
          <div className="frames-heading">
            <span className="panel-kicker">FRAMES <b>{String(frames.length).padStart(2, "0")}</b></span>
            <div className="frame-settings">
              <label>FPS <select value={fps} onChange={(event) => setFps(Number(event.target.value))}><option>4</option><option>8</option><option>12</option></select></label>
              <button onClick={duplicateFrame} aria-label="Duplicate active frame" title="Duplicate frame"><CopyPlus size={16} /></button>
              <button onClick={deleteFrame} aria-label="Delete active frame" title="Delete frame"><Trash2 size={16} /></button>
            </div>
          </div>
          <div className="timeline">
            <button className={`play-button ${playing ? "playing" : ""}`} disabled={frames.length < 2} onClick={() => { if (frames.length > 1) setPlaying((value) => !value); }} aria-label={playing ? "Pause animation" : "Play animation"}>
              {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
            </button>
            {frames.map((frame, index) => (
              <button
                key={frame.id}
                className={`frame-card ${index === activeFrame ? "active" : ""}`}
                onClick={() => { setPlaying(false); setActiveFrame(index); }}
                aria-label={`Select frame ${index + 1}`}
                aria-pressed={index === activeFrame}
              >
                <FrameThumbnail pixels={frame.pixels} size={size} />
                <span>{String(index + 1).padStart(2, "0")}</span>
              </button>
            ))}
            <button className="new-frame" onClick={addFrame} aria-label="Add a blank frame"><ImagePlus size={20} /><span>NEW FRAME</span></button>
          </div>
        </div>
      </section>

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
