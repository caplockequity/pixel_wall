"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  LocateFixed,
  Minus,
  Move,
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
type ProjectSnapshot = { frames: ArtFrame[]; size: number; activeFrame: number };
type FrameHistoryEntry = { kind: "frame"; frameId: number; size: number; pixels: Pixel[] };
type ProjectHistoryEntry = { kind: "project"; snapshot: ProjectSnapshot };
type HistoryEntry = FrameHistoryEntry | ProjectHistoryEntry;
type ReferenceTransform = { x: number; y: number; scale: number };
type ReferenceDimensions = { width: number; height: number };
type SpriteSheetInfo = {
  direction: "horizontal" | "vertical";
  frameCount: number;
  frameSize: number;
};
type EyeDropperApi = { open: () => Promise<{ sRGBHex: string }> };
type EyeDropperWindow = Window & { EyeDropper?: new () => EyeDropperApi };

type LoadedProject = {
  size: number;
  frames: ArtFrame[];
  activeFrame: number;
  palette: string[];
  selectedColor: string;
  referenceOpacity?: number;
  referenceTransform?: ReferenceTransform;
};

type StoredFrameV2 = { id: number; bytesPerIndex: 1 | 2; data: string };
type StoredProjectV2 = {
  version: 2;
  size: number;
  frames: StoredFrameV2[];
  activeFrame: number;
  palette: string[];
  selectedColor: string;
  colors: string[];
  projector: { opacity: number; transform: ReferenceTransform };
};

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
const GRID_SIZES = [8, 16, 24, 32, 48, 64, 96, 128, 256];
const CELL_SIZES = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64];
const REFERENCE_SCALE_MIN = 1;
const REFERENCE_SCALE_MAX = 10_000;
const REFERENCE_POSITION_MAX = 5_000;
const MAX_HISTORY = 40;
const HISTORY_CELL_BUDGET = 4_000_000;
const MAX_FRAMES = 12;
const STORAGE_KEY = "pixelwall-project-v2";
const LEGACY_STORAGE_KEY = "pixelwall-project-v1";
const DEFAULT_REFERENCE_TRANSFORM: ReferenceTransform = { x: 0, y: 0, scale: 100 };

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
  const visited = new Uint8Array(pixels.length);
  while (stack.length) {
    const index = stack.pop()!;
    if (visited[index] || (next[index] ?? null) !== target) continue;
    visited[index] = 1;
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

function hexToRgb(color: string) {
  const hex = color.replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((character) => character + character).join("")
    : hex.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
}

function renderPixelBitmap(canvas: HTMLCanvasElement | null, pixels: Pixel[], size: number) {
  if (!canvas) return;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(size, size);
  for (let index = 0; index < pixels.length; index += 1) {
    const color = pixels[index];
    if (!color) continue;
    const [red, green, blue] = hexToRgb(color);
    const offset = index * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

const PixelBitmap = memo(function PixelBitmap({
  pixels,
  size,
  className,
}: {
  pixels: Pixel[];
  size: number;
  className: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => renderPixelBitmap(ref.current, pixels, size), [pixels, size]);
  return <canvas ref={ref} className={className} width={size} height={size} aria-hidden="true" />;
});

const FrameThumbnail = memo(function FrameThumbnail({ pixels, size }: { pixels: Pixel[]; size: number }) {
  return <PixelBitmap pixels={pixels} size={size} className="pixel-thumb" />;
});

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeStoredProject(project: LoadedProject): StoredProjectV2 {
  const colors: string[] = [];
  const colorIndex = new Map<string, number>();
  project.frames.forEach((frame) => {
    frame.pixels.forEach((color) => {
      if (color && !colorIndex.has(color)) {
        colors.push(color);
        colorIndex.set(color, colors.length);
      }
    });
  });
  const bytesPerIndex: 1 | 2 = colors.length <= 255 ? 1 : 2;
  const storedFrames = project.frames.map((frame) => {
    const bytes = new Uint8Array(frame.pixels.length * bytesPerIndex);
    frame.pixels.forEach((color, index) => {
      const value = color ? colorIndex.get(color) ?? 0 : 0;
      if (bytesPerIndex === 1) bytes[index] = value;
      else {
        bytes[index * 2] = value & 255;
        bytes[index * 2 + 1] = value >> 8;
      }
    });
    return { id: frame.id, bytesPerIndex, data: bytesToBase64(bytes) };
  });
  return {
    version: 2,
    size: project.size,
    frames: storedFrames,
    activeFrame: project.activeFrame,
    palette: project.palette,
    selectedColor: project.selectedColor,
    colors,
    projector: {
      opacity: project.referenceOpacity ?? 38,
      transform: project.referenceTransform ?? DEFAULT_REFERENCE_TRANSFORM,
    },
  };
}

function decodeStoredProject(parsed: unknown): LoadedProject | null {
  if (!parsed || typeof parsed !== "object") return null;
  const project = parsed as Partial<StoredProjectV2>;
  if (
    project.version !== 2 ||
    !project.size ||
    !GRID_SIZES.includes(project.size) ||
    !Array.isArray(project.frames) ||
    project.frames.length < 1 ||
    project.frames.length > MAX_FRAMES ||
    !Array.isArray(project.colors) ||
    !project.colors.every((color) => typeof color === "string")
  ) return null;
  const total = project.size * project.size;
  try {
    const frames = project.frames.map((frame, frameIndex) => {
      if (!frame || (frame.bytesPerIndex !== 1 && frame.bytesPerIndex !== 2) || typeof frame.data !== "string") {
        throw new Error("Invalid frame");
      }
      const bytes = base64ToBytes(frame.data);
      if (bytes.length !== total * frame.bytesPerIndex) throw new Error("Invalid frame size");
      const pixels = Array<Pixel>(total).fill(null);
      for (let index = 0; index < total; index += 1) {
        const value = frame.bytesPerIndex === 1
          ? bytes[index]
          : bytes[index * 2] | (bytes[index * 2 + 1] << 8);
        if (value > 0) pixels[index] = project.colors?.[value - 1] ?? null;
      }
      return { id: Number.isFinite(frame.id) ? frame.id : frameIndex + 1, pixels };
    });
    const projector = project.projector;
    const transform = projector?.transform;
    return {
      size: project.size,
      frames,
      activeFrame: Math.max(0, Math.min(project.activeFrame ?? 0, frames.length - 1)),
      palette: Array.isArray(project.palette) && project.palette.length ? project.palette : STARTER_PALETTE,
      selectedColor: typeof project.selectedColor === "string" ? project.selectedColor : "#ff6b57",
      referenceOpacity: typeof projector?.opacity === "number" ? clamp(projector.opacity, 0, 100) : 38,
      referenceTransform: {
        x: typeof transform?.x === "number" ? clamp(transform.x, -REFERENCE_POSITION_MAX, REFERENCE_POSITION_MAX) : 0,
        y: typeof transform?.y === "number" ? clamp(transform.y, -REFERENCE_POSITION_MAX, REFERENCE_POSITION_MAX) : 0,
        scale: typeof transform?.scale === "number" ? clamp(transform.scale, REFERENCE_SCALE_MIN, REFERENCE_SCALE_MAX) : 100,
      },
    };
  } catch {
    return null;
  }
}

function decodeLegacyProject(parsed: unknown): LoadedProject | null {
  if (!parsed || typeof parsed !== "object") return null;
  const project = parsed as Partial<LoadedProject>;
  if (
    !project.size ||
    !GRID_SIZES.includes(project.size) ||
    !Array.isArray(project.frames) ||
    project.frames.length < 1 ||
    project.frames.length > MAX_FRAMES ||
    !project.frames.every((frame) =>
      Array.isArray(frame.pixels) &&
      frame.pixels.length === project.size! * project.size! &&
      frame.pixels.every((color) => color === null || typeof color === "string"),
    )
  ) return null;
  return {
    size: project.size,
    frames: cloneFrames(project.frames),
    activeFrame: Math.max(0, Math.min(project.activeFrame ?? 0, project.frames.length - 1)),
    palette: Array.isArray(project.palette) && project.palette.length ? project.palette : STARTER_PALETTE,
    selectedColor: project.selectedColor ?? "#ff6b57",
  };
}

function historyCost(entry: HistoryEntry) {
  return entry.kind === "frame"
    ? entry.pixels.length
    : entry.snapshot.frames.reduce((total, frame) => total + frame.pixels.length, 0);
}

function trimHistory(entries: HistoryEntry[]) {
  const kept: HistoryEntry[] = [];
  let cells = 0;
  for (let index = entries.length - 1; index >= 0 && kept.length < MAX_HISTORY; index -= 1) {
    const cost = historyCost(entries[index]);
    if (kept.length > 0 && cells + cost > HISTORY_CELL_BUDGET) break;
    kept.push(entries[index]);
    cells += cost;
  }
  return kept.reverse();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function detectSpriteSheet(dimensions: ReferenceDimensions | null): SpriteSheetInfo | null {
  if (!dimensions) return null;
  const { width, height } = dimensions;
  if (width > height && width % height === 0) {
    const frameCount = width / height;
    if (frameCount >= 2 && frameCount <= 32) return { direction: "horizontal", frameCount, frameSize: height };
  }
  if (height > width && height % width === 0) {
    const frameCount = height / width;
    if (frameCount >= 2 && frameCount <= 32) return { direction: "vertical", frameCount, frameSize: width };
  }
  return null;
}

function referenceTravelLimit(scale: number) {
  return Math.min(REFERENCE_POSITION_MAX, Math.max(200, (scale - 100) / 2));
}

function comfortableTraceCellSize(gridSize: number) {
  if (gridSize <= 16) return 32;
  if (gridSize <= 32) return 16;
  if (gridSize <= 64) return 8;
  if (gridSize <= 128) return 4;
  return 2;
}

function pixelMatchedTransform(
  dimensions: ReferenceDimensions,
  canvasSize: number,
  sheet: SpriteSheetInfo | null,
  tileIndex: number,
): ReferenceTransform {
  const scale = clamp(
    (Math.max(dimensions.width, dimensions.height) / canvasSize) * 100,
    REFERENCE_SCALE_MIN,
    REFERENCE_SCALE_MAX,
  );
  const tileLeft = sheet?.direction === "horizontal" ? sheet.frameSize * tileIndex : 0;
  const tileTop = sheet?.direction === "vertical" ? sheet.frameSize * tileIndex : 0;
  const x = ((dimensions.width / 2 - tileLeft - canvasSize / 2) / canvasSize) * 100;
  const y = ((dimensions.height / 2 - tileTop - canvasSize / 2) / canvasSize) * 100;
  const travel = referenceTravelLimit(scale);
  return { scale, x: clamp(x, -travel, travel), y: clamp(y, -travel, travel) };
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
  const [referenceDimensions, setReferenceDimensions] = useState<ReferenceDimensions | null>(null);
  const [referenceTile, setReferenceTile] = useState(0);
  const [referencePixelFit, setReferencePixelFit] = useState(false);
  const [referenceOpacity, setReferenceOpacity] = useState(38);
  const [referenceTransform, setReferenceTransform] = useState<ReferenceTransform>(DEFAULT_REFERENCE_TRANSFORM);
  const [adjustingReference, setAdjustingReference] = useState(false);
  const [cellSize, setCellSize] = useState(24);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState(true);
  const [saveFailed, setSaveFailed] = useState(false);
  const [samplingColor, setSamplingColor] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageReady, setStorageReady] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceLayerRef = useRef<HTMLButtonElement>(null);
  const activePointer = useRef<number | null>(null);
  const lastPainted = useRef<number | null>(null);
  const strokeRecorded = useRef(false);
  const activeFrameRef = useRef(activeFrame);
  const saveWarningShown = useRef(false);
  const referenceDrag = useRef<null | {
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>(null);

  const currentPixels = useMemo(() => frames[activeFrame]?.pixels ?? [], [activeFrame, frames]);
  const previousPixels = useMemo(() => {
    if (frames.length < 2) return [];
    const previous = (activeFrame - 1 + frames.length) % frames.length;
    return frames[previous]?.pixels ?? [];
  }, [activeFrame, frames]);
  const spriteSheet = useMemo(() => detectSpriteSheet(referenceDimensions), [referenceDimensions]);
  const referenceScaleMax = useMemo(() => {
    if (!referenceDimensions) return 1600;
    const matchScale = (Math.max(referenceDimensions.width, referenceDimensions.height) / size) * 100;
    return Math.min(REFERENCE_SCALE_MAX, Math.max(1600, Math.ceil(matchScale / 100) * 100));
  }, [referenceDimensions, size]);

  useEffect(() => renderPixelBitmap(canvasRef.current, currentPixels, size), [currentPixels, size]);

  useEffect(() => {
    activeFrameRef.current = activeFrame;
  }, [activeFrame]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const currentDraft = window.localStorage.getItem(STORAGE_KEY);
        const legacyDraft = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        const loaded = currentDraft
          ? decodeStoredProject(JSON.parse(currentDraft))
          : legacyDraft
            ? decodeLegacyProject(JSON.parse(legacyDraft))
            : null;
        if (loaded) {
          setSize(loaded.size);
          setFrames(cloneFrames(loaded.frames));
          setActiveFrame(loaded.activeFrame);
          setPalette(loaded.palette);
          setSelectedColor(loaded.selectedColor);
          if (loaded.referenceOpacity !== undefined) setReferenceOpacity(loaded.referenceOpacity);
          if (loaded.referenceTransform) setReferenceTransform(loaded.referenceTransform);
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
    const savingTimer = window.setTimeout(() => {
      setSaved(false);
      setSaveFailed(false);
    }, 0);
    const timer = window.setTimeout(() => {
      try {
        const stored = encodeStoredProject({
          size,
          frames,
          activeFrame: activeFrameRef.current,
          palette,
          selectedColor,
          referenceOpacity,
          referenceTransform,
        });
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        setSaved(true);
        setSaveFailed(false);
        saveWarningShown.current = false;
      } catch {
        setSaved(false);
        setSaveFailed(true);
        if (!saveWarningShown.current) {
          saveWarningShown.current = true;
          setNotice("This project is too large for local autosave — export important frames");
        }
      }
    }, 500);
    return () => {
      window.clearTimeout(savingTimer);
      window.clearTimeout(timer);
    };
  }, [frames, palette, referenceOpacity, referenceTransform, selectedColor, size, storageReady]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveFrame((current) => (current + 1) % frames.length);
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [fps, frames.length, playing]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!adjustingReference) return;
    const timer = window.setTimeout(() => referenceLayerRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [adjustingReference]);

  function projectSnapshot(): ProjectSnapshot {
    return { frames: cloneFrames(frames), size, activeFrame };
  }

  function pushHistory(entry: HistoryEntry) {
    setUndoStack((current) => trimHistory([...current, entry]));
    setRedoStack([]);
  }

  function recordFrameHistory() {
    const frame = frames[activeFrame];
    if (!frame) return;
    pushHistory({ kind: "frame", frameId: frame.id, size, pixels: [...frame.pixels] });
  }

  function recordProjectHistory() {
    pushHistory({ kind: "project", snapshot: projectSnapshot() });
  }

  function inverseFor(entry: HistoryEntry): HistoryEntry | null {
    if (entry.kind === "project") return { kind: "project", snapshot: projectSnapshot() };
    const frame = frames.find((candidate) => candidate.id === entry.frameId);
    if (!frame) return null;
    return { kind: "frame", frameId: frame.id, size, pixels: [...frame.pixels] };
  }

  function applyHistory(entry: HistoryEntry) {
    setPlaying(false);
    if (entry.kind === "project") {
      setFrames(cloneFrames(entry.snapshot.frames));
      setSize(entry.snapshot.size);
      if (referencePixelFit && referenceDimensions) {
        setReferenceTransform(pixelMatchedTransform(referenceDimensions, entry.snapshot.size, spriteSheet, referenceTile));
      }
      setActiveFrame(Math.min(entry.snapshot.activeFrame, entry.snapshot.frames.length - 1));
      setCursorIndex((current) => Math.min(current, entry.snapshot.size * entry.snapshot.size - 1));
      return;
    }
    setFrames((current) => current.map((frame) =>
      frame.id === entry.frameId ? { ...frame, pixels: [...entry.pixels] } : frame,
    ));
    const frameIndex = frames.findIndex((frame) => frame.id === entry.frameId);
    if (frameIndex >= 0) setActiveFrame(frameIndex);
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const inverse = inverseFor(previous);
    if (!inverse) return;
    setRedoStack((current) => trimHistory([...current, inverse]));
    setUndoStack((current) => current.slice(0, -1));
    applyHistory(previous);
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next) return;
    const inverse = inverseFor(next);
    if (!inverse) return;
    setUndoStack((current) => trimHistory([...current, inverse]));
    setRedoStack((current) => current.slice(0, -1));
    applyHistory(next);
  }

  function updateActivePixels(update: (pixels: Pixel[]) => Pixel[]) {
    setFrames((current) => current.map((frame, index) =>
      index === activeFrame ? { ...frame, pixels: update(frame.pixels) } : frame,
    ));
  }

  function applyTool(index: number, indices = [index]) {
    if (tool === "picker") {
      const color = currentPixels[index];
      if (color) {
        addColorToRack(color);
      } else {
        setNotice("No painted color here — try another pixel");
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

  function beginStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (playing || adjustingReference || event.button !== 0 || !event.isPrimary || activePointer.current !== null) return;
    const index = indexFromPointer(event.clientX, event.clientY);
    if (index === null) return;
    setCursorIndex(index);
    strokeRecorded.current = false;
    if (tool === "picker") {
      applyTool(index);
      return;
    }
    if (toolWouldChange(index)) {
      recordFrameHistory();
      strokeRecorded.current = true;
      applyTool(index);
    }
    if (tool === "pencil" || tool === "eraser") {
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointer.current = event.pointerId;
      lastPainted.current = index;
    }
  }

  function continueStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (tool === "picker" && activePointer.current === null) {
      const hoveredIndex = indexFromPointer(event.clientX, event.clientY);
      if (hoveredIndex !== null) setCursorIndex(hoveredIndex);
      return;
    }
    if (activePointer.current !== event.pointerId || lastPainted.current === null) return;
    const index = indexFromPointer(event.clientX, event.clientY);
    if (index === null || index === lastPainted.current) return;
    const path = cellsBetween(lastPainted.current, index, size);
    if (toolWouldChange(index, path)) {
      if (!strokeRecorded.current) {
        recordFrameHistory();
        strokeRecorded.current = true;
      }
      applyTool(index, path);
    }
    setCursorIndex(index);
    lastPainted.current = index;
  }

  function endStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointer.current = null;
    lastPainted.current = null;
    strokeRecorded.current = false;
  }

  function handleCanvasKey(event: ReactKeyboardEvent<HTMLCanvasElement>) {
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
        recordFrameHistory();
        applyTool(cursorIndex);
      }
    }
  }

  function changeSize(nextSize: number) {
    if (nextSize === size || !GRID_SIZES.includes(nextSize)) return;
    recordProjectHistory();
    setPlaying(false);
    activePointer.current = null;
    lastPainted.current = null;
    strokeRecorded.current = false;
    setFrames((current) => current.map((frame) => ({
      ...frame,
      pixels: resizePixels(frame.pixels, size, nextSize),
    })));
    setSize(nextSize);
    if (referencePixelFit && referenceDimensions) {
      setReferenceTransform(pixelMatchedTransform(referenceDimensions, nextSize, spriteSheet, referenceTile));
    }
    setCursorIndex(0);
    setCellSize(fitCellSize(nextSize));
    setNotice(`Canvas resized to ${nextSize} × ${nextSize}`);
  }

  function fitCellSize(targetSize = size) {
    const viewportWidth = window.innerWidth;
    const availableWidth = viewportWidth <= 560
      ? viewportWidth - 115
      : viewportWidth <= 800
        ? viewportWidth - 270
        : viewportWidth <= 1050
          ? viewportWidth - 325
          : viewportWidth - 370;
    const availableHeight = viewportWidth <= 560 ? 350 : viewportWidth <= 800 ? 470 : 520;
    const drawableSpace = Math.max(120, Math.min(availableWidth, availableHeight));
    const ideal = Math.max(1, Math.floor(drawableSpace / targetSize));
    return CELL_SIZES.filter((option) => option <= ideal).at(-1) ?? CELL_SIZES[0];
  }

  function addFrame() {
    if (frames.length >= MAX_FRAMES) {
      setNotice(`Frame limit is ${MAX_FRAMES}`);
      return;
    }
    recordProjectHistory();
    const nextId = Math.max(...frames.map((frame) => frame.id), 0) + 1;
    setFrames((current) => [...current, { id: nextId, pixels: Array(size * size).fill(null) }]);
    setActiveFrame(frames.length);
  }

  function duplicateFrame() {
    if (frames.length >= MAX_FRAMES) {
      setNotice(`Frame limit is ${MAX_FRAMES}`);
      return;
    }
    recordProjectHistory();
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
    recordProjectHistory();
    if (frames.length === 2) setPlaying(false);
    setFrames((current) => current.filter((_, index) => index !== activeFrame));
    setActiveFrame((current) => Math.max(0, Math.min(current, frames.length - 2)));
  }

  function clearFrame() {
    if (currentPixels.every((pixel) => pixel === null)) {
      setNotice("Frame is already clear");
      return;
    }
    recordFrameHistory();
    updateActivePixels(() => Array(size * size).fill(null));
    setNotice("Frame cleared");
  }

  function resetReferenceTransform() {
    setReferenceTransform(DEFAULT_REFERENCE_TRANSFORM);
    setReferencePixelFit(false);
    setReferenceTile(0);
    setNotice("Projector image centered");
  }

  function handleReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const source = String(reader.result);
      const image = new Image();
      image.onload = () => {
        const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        const sheet = detectSpriteSheet(dimensions);
        setReference(source);
        setReferenceDimensions(dimensions);
        setReferenceTile(0);
        if (sheet && sheet.frameSize === size) {
          const needsBlankFrame = currentPixels.every((pixel) => pixel !== null) && frames.length < MAX_FRAMES;
          if (needsBlankFrame) addFrame();
          setReferenceTransform(pixelMatchedTransform(dimensions, size, sheet, 0));
          setReferencePixelFit(true);
          setAdjustingReference(false);
          setCellSize((current) => Math.max(current, comfortableTraceCellSize(size)));
          setNotice(needsBlankFrame
            ? `${sheet.frameCount}-frame sheet aligned · blank trace frame ready`
            : `${sheet.frameCount}-frame ${sheet.frameSize} × ${sheet.frameSize} sheet aligned · sprite 1 ready`);
        } else {
          setReferenceTransform(DEFAULT_REFERENCE_TRANSFORM);
          setReferencePixelFit(false);
          setAdjustingReference(true);
          setNotice(sheet
            ? `${sheet.frameCount}-frame ${sheet.frameSize} × ${sheet.frameSize} sheet detected · use its matching grid`
            : `${dimensions.width} × ${dimensions.height} reference loaded`);
        }
      };
      image.onerror = () => {
        setReference(source);
        setReferenceDimensions(null);
        setReferenceTransform(DEFAULT_REFERENCE_TRANSFORM);
        setReferencePixelFit(false);
        setAdjustingReference(true);
        setNotice("Reference loaded — drag it into position");
      };
      image.src = source;
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function stopReferenceAdjustment() {
    const drag = referenceDrag.current;
    const layer = referenceLayerRef.current;
    if (drag && layer?.hasPointerCapture(drag.pointerId)) {
      layer.releasePointerCapture(drag.pointerId);
    }
    referenceDrag.current = null;
    setAdjustingReference(false);
  }

  function removeReference() {
    setReference(null);
    setReferenceDimensions(null);
    setReferenceTile(0);
    setReferencePixelFit(false);
    stopReferenceAdjustment();
    setReferenceTransform(DEFAULT_REFERENCE_TRANSFORM);
  }

  function matchReferencePixels(targetSize = size, tileIndex = referenceTile) {
    if (!referenceDimensions) return;
    const sheet = detectSpriteSheet(referenceDimensions);
    const safeTile = sheet ? clamp(tileIndex, 0, sheet.frameCount - 1) : 0;
    setReferenceTile(safeTile);
    setReferenceTransform(pixelMatchedTransform(referenceDimensions, targetSize, sheet, safeTile));
    setReferencePixelFit(true);
    stopReferenceAdjustment();
    setNotice(sheet
      ? `Sprite ${safeTile + 1} of ${sheet.frameCount} · 1 image pixel = 1 canvas cell`
      : "1 image pixel = 1 canvas cell");
  }

  function useDetectedSpriteGrid() {
    if (!spriteSheet || !GRID_SIZES.includes(spriteSheet.frameSize)) return;
    if (size !== spriteSheet.frameSize) changeSize(spriteSheet.frameSize);
    setCellSize(Math.max(comfortableTraceCellSize(spriteSheet.frameSize), fitCellSize(spriteSheet.frameSize)));
    matchReferencePixels(spriteSheet.frameSize, 0);
  }

  function showReferenceTile(nextTile: number) {
    if (!spriteSheet || !referenceDimensions) return;
    const safeTile = clamp(nextTile, 0, spriteSheet.frameCount - 1);
    setReferenceTile(safeTile);
    setReferenceTransform(pixelMatchedTransform(referenceDimensions, size, spriteSheet, safeTile));
    setReferencePixelFit(true);
    stopReferenceAdjustment();
    setNotice(`Sprite ${safeTile + 1} of ${spriteSheet.frameCount} aligned to the grid`);
  }

  function changeReferenceScale(nextScale: number) {
    const scale = clamp(nextScale, REFERENCE_SCALE_MIN, referenceScaleMax);
    const travel = referenceTravelLimit(scale);
    setReferencePixelFit(false);
    setReferenceTransform((current) => ({
      ...current,
      scale,
      x: clamp(current.x, -travel, travel),
      y: clamp(current.y, -travel, travel),
    }));
  }

  function beginReferenceDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || referenceDrag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    referenceDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: referenceTransform.x,
      originY: referenceTransform.y,
    };
  }

  function continueReferenceDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = referenceDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startX) / bounds.width) * 100;
    const deltaY = ((event.clientY - drag.startY) / bounds.height) * 100;
    setReferenceTransform((current) => {
      const travel = referenceTravelLimit(current.scale);
      const snapStep = 100 / size;
      const x = clamp(drag.originX + deltaX, -travel, travel);
      const y = clamp(drag.originY + deltaY, -travel, travel);
      return {
        ...current,
        x: referencePixelFit ? Math.round(x / snapStep) * snapStep : x,
        y: referencePixelFit ? Math.round(y / snapStep) * snapStep : y,
      };
    });
  }

  function endReferenceDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (referenceDrag.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    referenceDrag.current = null;
  }

  function handleReferenceKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = referencePixelFit ? (100 / size) * (event.shiftKey ? 5 : 1) : event.shiftKey ? 5 : 1;
    let moved = false;
    if (event.key === "ArrowLeft") {
      setReferenceTransform((current) => {
        const travel = referenceTravelLimit(current.scale);
        return { ...current, x: clamp(current.x - step, -travel, travel) };
      });
      moved = true;
    }
    if (event.key === "ArrowRight") {
      setReferenceTransform((current) => {
        const travel = referenceTravelLimit(current.scale);
        return { ...current, x: clamp(current.x + step, -travel, travel) };
      });
      moved = true;
    }
    if (event.key === "ArrowUp") {
      setReferenceTransform((current) => {
        const travel = referenceTravelLimit(current.scale);
        return { ...current, y: clamp(current.y - step, -travel, travel) };
      });
      moved = true;
    }
    if (event.key === "ArrowDown") {
      setReferenceTransform((current) => {
        const travel = referenceTravelLimit(current.scale);
        return { ...current, y: clamp(current.y + step, -travel, travel) };
      });
      moved = true;
    }
    if (["+", "=", "]"].includes(event.key)) {
      setReferencePixelFit(false);
      setReferenceTransform((current) => ({ ...current, scale: clamp(current.scale + 5, REFERENCE_SCALE_MIN, referenceScaleMax) }));
      moved = true;
    }
    if (["-", "_", "["].includes(event.key)) {
      setReferencePixelFit(false);
      setReferenceTransform((current) => ({ ...current, scale: clamp(current.scale - 5, REFERENCE_SCALE_MIN, referenceScaleMax) }));
      moved = true;
    }
    if (event.key === "0") {
      resetReferenceTransform();
      moved = true;
    }
    if (event.key === "Escape") {
      stopReferenceAdjustment();
      canvasRef.current?.focus();
      moved = true;
    }
    if (moved) event.preventDefault();
  }

  function addColorToRack(color: string) {
    const normalized = color.toLowerCase();
    const alreadyInRack = palette.some((item) => item.toLowerCase() === normalized);
    setSelectedColor(normalized);
    setPalette((current) => current.some((item) => item.toLowerCase() === normalized)
      ? current
      : [...current, normalized]);
    setTool("pencil");
    setNotice(alreadyInRack ? `Selected ${normalized.toUpperCase()}` : `Added ${normalized.toUpperCase()} to color rack`);
  }

  function addCustomColor(event: ChangeEvent<HTMLInputElement>) {
    addColorToRack(event.target.value);
  }

  function activateCanvasPicker(message = "Click a painted pixel to add its color") {
    setPlaying(false);
    stopReferenceAdjustment();
    setTool("picker");
    setNotice(message);
    window.setTimeout(() => canvasRef.current?.focus(), 0);
  }

  async function sampleVisibleColor() {
    if (samplingColor) return;
    setPlaying(false);
    stopReferenceAdjustment();
    const EyeDropper = (window as EyeDropperWindow).EyeDropper;
    if (!EyeDropper) {
      activateCanvasPicker();
      return;
    }
    setSamplingColor(true);
    try {
      const result = await new EyeDropper().open();
      addColorToRack(result.sRGBHex);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        activateCanvasPicker("Screen picker unavailable — click a painted pixel instead");
      }
    } finally {
      setSamplingColor(false);
    }
  }

  function changeCellSize(direction: -1 | 1) {
    const currentIndex = CELL_SIZES.indexOf(cellSize);
    const normalizedIndex = currentIndex >= 0 ? currentIndex : CELL_SIZES.findIndex((option) => option > cellSize) - 1;
    const nextIndex = clamp(normalizedIndex + direction, 0, CELL_SIZES.length - 1);
    setCellSize(CELL_SIZES[nextIndex]);
  }

  function exportPng() {
    const scale = Math.max(1, Math.min(16, Math.floor(4096 / size)));
    const source = document.createElement("canvas");
    renderPixelBitmap(source, currentPixels, size);
    const canvas = document.createElement("canvas");
    canvas.width = size * scale;
    canvas.height = size * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setNotice("PNG export failed — try a smaller canvas");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `pixelwall-frame-${String(activeFrame + 1).padStart(2, "0")}.png`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(`Frame ${activeFrame + 1} exported at ${canvas.width} × ${canvas.height}px`);
    }, "image/png");
  }

  const surfaceStyle = {
    "--grid-size": size,
    "--grid-opacity": cellSize <= 2 ? 0 : size >= 128 ? 0.12 : size >= 64 ? 0.22 : 0.42,
    width: `${size * cellSize}px`,
    height: `${size * cellSize}px`,
  } as CSSProperties;
  const referenceStyle = {
    opacity: referenceOpacity / 100,
    transform: `translate3d(${referenceTransform.x}%, ${referenceTransform.y}%, 0) scale(${referenceTransform.scale / 100})`,
  };
  const keyboardCursorStyle = {
    left: `${((cursorIndex % size) / size) * 100}%`,
    top: `${(Math.floor(cursorIndex / size) / size) * 100}%`,
    width: `${100 / size}%`,
    height: `${100 / size}%`,
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="PixelWall home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>PIXELWALL</span>
        </Link>

        <div className="project-title" aria-live="polite">
          <span className={`status-dot ${saved ? "" : saveFailed ? "save-failed" : "saving"}`} />
          <strong>DESERT SIGNAL</strong>
          <span className="saved-label">{saved ? "SAVED LOCALLY" : saveFailed ? "NOT SAVED" : "SAVING…"}</span>
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
              onClick={() => { setTool(value); stopReferenceAdjustment(); }}
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
            <div className="frame-rig">
              <span className="frame-screw screw-a" /><span className="frame-screw screw-b" />
              <span className="frame-screw screw-c" /><span className="frame-screw screw-d" />
              <div className="art-surface" style={surfaceStyle}>
                <div className="transparent-grid" />
                {reference && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="projection-image" src={reference} alt="Projected reference" style={referenceStyle} />
                )}
                {showOnion && frames.length > 1 && (
                  <PixelBitmap pixels={previousPixels} size={size} className="onion-layer" />
                )}
                <canvas
                  ref={canvasRef}
                  className={`pixel-canvas ${tool === "picker" ? "picker-active" : ""}`}
                  width={size}
                  height={size}
                  role="grid"
                  aria-label={`${size} by ${size} editable pixel canvas. Use arrow keys to move and Space to paint.`}
                  tabIndex={0}
                  onPointerDown={beginStroke}
                  onPointerMove={continueStroke}
                  onPointerUp={endStroke}
                  onPointerCancel={endStroke}
                  onLostPointerCapture={() => { activePointer.current = null; lastPainted.current = null; strokeRecorded.current = false; }}
                  onKeyDown={handleCanvasKey}
                />
                {showGrid && <div className="grid-overlay" aria-hidden="true" />}
                <div className="keyboard-cursor" style={keyboardCursorStyle} aria-hidden="true" />
                {reference && adjustingReference && (
                  <button
                    type="button"
                    ref={referenceLayerRef}
                    className="projection-adjust-layer"
                    aria-label={`Move projected image. Scale ${referenceTransform.scale} percent, X ${Math.round(referenceTransform.x)}, Y ${Math.round(referenceTransform.y)}.`}
                    onPointerDown={beginReferenceDrag}
                    onPointerMove={continueReferenceDrag}
                    onPointerUp={endReferenceDrag}
                    onPointerCancel={endReferenceDrag}
                    onLostPointerCapture={() => { referenceDrag.current = null; }}
                    onKeyDown={handleReferenceKey}
                  >
                    <span><Move size={14} /> DRAG IMAGE</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="canvas-hint">
            {adjustingReference
              ? referencePixelFit ? "PIXEL LOCK ON · DRAG OR ARROWS MOVE ONE CELL · ESC DONE" : "DRAG IMAGE TO POSITION · ARROWS NUDGE · ESC DONE"
              : referencePixelFit ? "1 IMAGE PIXEL = 1 CANVAS CELL · READY TO TRACE" : "DRAG TO PAINT · ARROW KEYS + SPACE WORK TOO"}
          </p>
        </div>

        <div className="projection-dock">
          <div className="projector-unit" aria-hidden="true"><span className="lens" /><span className="projector-slot" /></div>
          <aside className="projection-panel" aria-label="Projection controls">
            <div className="projection-title"><span className="panel-kicker">PROJECTOR</span><span className={reference ? "live-light" : ""} /></div>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleReference} />
            <button className="project-action" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> {reference ? "CHANGE IMAGE" : "LOAD IMAGE"}</button>

            {referenceDimensions && (
              <div className="source-info" aria-live="polite">
                <span>{referenceDimensions.width} × {referenceDimensions.height} SOURCE</span>
                {spriteSheet && <strong>{spriteSheet.frameCount} SPRITES · {spriteSheet.frameSize} × {spriteSheet.frameSize}</strong>}
              </div>
            )}

            {referenceDimensions && (
              <button
                className={`pixel-match-action ${referencePixelFit ? "active" : ""}`}
                onClick={spriteSheet && GRID_SIZES.includes(spriteSheet.frameSize) && size !== spriteSheet.frameSize
                  ? useDetectedSpriteGrid
                  : () => matchReferencePixels()}
              >
                <Grid2X2 size={14} />
                {spriteSheet && GRID_SIZES.includes(spriteSheet.frameSize) && size !== spriteSheet.frameSize
                  ? `USE ${spriteSheet.frameSize} × ${spriteSheet.frameSize} GRID`
                  : "MATCH 1:1 PIXELS"}
              </button>
            )}

            {reference && (
              <button
                className="trace-frame-action"
                onClick={() => {
                  addFrame();
                  setNotice("Blank trace frame added");
                }}
                disabled={frames.length >= MAX_FRAMES}
              >
                <ImagePlus size={14} /> ADD BLANK TRACE FRAME
              </button>
            )}

            {spriteSheet && size === spriteSheet.frameSize && (
              <div className="sprite-stepper" aria-label="Sprite sheet frame">
                <button onClick={() => showReferenceTile(referenceTile - 1)} disabled={referenceTile === 0} aria-label="Previous sprite">‹</button>
                <strong>SPRITE {referenceTile + 1} / {spriteSheet.frameCount}</strong>
                <button onClick={() => showReferenceTile(referenceTile + 1)} disabled={referenceTile === spriteSheet.frameCount - 1} aria-label="Next sprite">›</button>
              </div>
            )}

            <label className={`projection-slider ${reference ? "" : "disabled"}`}>
              <span>OPACITY</span><strong>{referenceOpacity}%</strong>
              <input type="range" min="0" max="100" value={referenceOpacity} onChange={(event) => setReferenceOpacity(Number(event.target.value))} disabled={!reference} />
            </label>
            <label className={`projection-slider ${reference ? "" : "disabled"}`}>
              <span>IMAGE SCALE</span><strong>{Math.round(referenceTransform.scale * 100) / 100}%</strong>
              <input
                type="range"
                min={REFERENCE_SCALE_MIN}
                max={referenceScaleMax}
                step="1"
                value={referenceTransform.scale}
                onChange={(event) => changeReferenceScale(Number(event.target.value))}
                disabled={!reference}
              />
            </label>
            <button
              className={`project-toggle move-toggle ${adjustingReference ? "active" : ""}`}
              onClick={() => {
                if (!reference) return;
                if (adjustingReference) stopReferenceAdjustment();
                else setAdjustingReference(true);
              }}
              disabled={!reference}
              aria-pressed={adjustingReference}
            >
              <Move size={15} /> MOVE IMAGE <span>{adjustingReference ? "DONE" : "ADJUST"}</span>
            </button>
            {reference && (
              <div className="position-readout" aria-live="polite">
                {referencePixelFit ? "PIXEL LOCK · " : ""}X {Math.round(referenceTransform.x)} · Y {Math.round(referenceTransform.y)}
              </div>
            )}
            <button className={`project-toggle ${showGrid ? "active" : ""}`} onClick={() => setShowGrid((value) => !value)} aria-pressed={showGrid}>
              <Grid2X2 size={15} /> GRID <span>{showGrid ? "ON" : "OFF"}</span>
            </button>
            <button className={`project-toggle ${showOnion ? "active" : ""}`} onClick={() => setShowOnion((value) => !value)} aria-pressed={showOnion}>
              {showOnion ? <Eye size={15} /> : <EyeOff size={15} />} ONION <span>{showOnion ? "ON" : "OFF"}</span>
            </button>

            <div className="canvas-zoom-block">
              <span>WORKSPACE PIXEL SIZE</span>
              <div className="zoom-control" aria-label="Workspace pixel size">
                <button onClick={() => changeCellSize(-1)} disabled={cellSize === CELL_SIZES[0]} aria-label="Make workspace pixels smaller"><Minus size={14} /></button>
                <strong>{cellSize} PX / CELL</strong>
                <button onClick={() => changeCellSize(1)} disabled={cellSize === CELL_SIZES.at(-1)} aria-label="Make workspace pixels larger"><Plus size={14} /></button>
              </div>
              <button className="fit-view-action" onClick={() => setCellSize(fitCellSize())}>FIT WHOLE CANVAS</button>
            </div>
            {reference && (
              <div className="reference-actions">
                <button onClick={resetReferenceTransform}><LocateFixed size={13} /> CENTER</button>
                <button onClick={removeReference}>REMOVE</button>
              </div>
            )}
            <button className="clear-action" onClick={clearFrame}><RotateCcw size={14} /> CLEAR FRAME</button>
          </aside>
        </div>
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
                onClick={() => { setSelectedColor(color); setTool("pencil"); stopReferenceAdjustment(); }}
                aria-label={`Select color ${color}`}
                aria-pressed={selectedColor.toLowerCase() === color.toLowerCase()}
              />
            ))}
            <button
              className={`rack-picker ${samplingColor || tool === "picker" ? "active" : ""}`}
              type="button"
              onClick={sampleVisibleColor}
              aria-label="Pick a color from the canvas"
              aria-pressed={samplingColor || tool === "picker"}
              title="Pick a color from the canvas"
            >
              <Pipette size={14} /><span>{samplingColor ? "PICKING" : "SAMPLE"}</span>
            </button>
            <label className="add-swatch" aria-label="Choose a custom color" title="Choose a custom color"><Plus size={16} /><input type="color" value={selectedColor} onChange={addCustomColor} /></label>
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
