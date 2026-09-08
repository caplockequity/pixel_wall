"use client";

import { makeDemoPixels } from "./demo-art.mjs";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  spriteFrameFilename,
} from "./sprite-export.mjs";
import { createSpriteExportPlan, exportFileStem } from "./sprite-export-core.mjs";
import { createTilemapExportPlan } from "./tilemap-export-core.mjs";
import { createBlankProject, parseProject, stringifyProject } from "./project-format.mjs";
import { HelpTip, OnboardingGuide, type GuideTarget } from "./onboarding";
import { NewProjectDialog } from "./new-project";
import { ExportPresets } from "./export-presets";
import { ProDialog, useProAccess } from "./pro-access";
import { DownloadReady, useDownload } from "./use-download";
import { CELL_SIZES, useCanvasView } from "./use-canvas-view";
import { captureAnalyticsEvent, getAnalyticsConsentStatus, isAnalyticsConfigured } from "./analytics";
import { AnalyticsConsent } from "./analytics-consent";
import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Copy,
  Crosshair,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FileImage,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Grid2X2,
  Hand,
  ImagePlus,
  Layers,
  Lock,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Move,
  MousePointer2,
  PaintBucket,
  PackageOpen,
  Pause,
  Pencil,
  Pipette,
  Play,
  Plus,
  Redo2,
  Repeat2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Unlock,
  Upload,
} from "lucide-react";

type Pixel = string | null;
type Tool = "pencil" | "eraser" | "fill" | "picker" | "select" | "pivot" | "hand";
type ArtLayer = {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
};
type ArtFrame = {
  id: number;
  durationMs: number;
  cels: Record<string, Pixel[]>;
  pivot?: Pivot;
};
type AnimationDirection = "forward" | "reverse" | "pingpong" | "pingpong_reverse";
type AnimationClip = {
  id: number;
  name: string;
  frameIds: number[];
  direction: AnimationDirection;
  loop: boolean;
};
type Pivot = { x: number; y: number };
type TileSettings = { preview: boolean; linkEdges: boolean };
type TilemapDocument = { width: number; height: number; cells: Array<number | null> };
type ProjectSnapshot = {
  projectName: string;
  frames: ArtFrame[];
  layers: ArtLayer[];
  clips: AnimationClip[];
  slices: NamedSlice[];
  palette: string[];
  selectedColor: string;
  size: number;
  activeFrame: number;
  activeLayerId: number;
  activeClipId: number;
  pivot: Pivot;
  tile: TileSettings;
  tilemap: TilemapDocument;
  reference: string | null;
  referenceName: string;
  referenceMime: string;
  referenceDimensions: ReferenceDimensions | null;
  referenceTile: number;
  referencePixelFit: boolean;
  referenceOpacity: number;
  referenceTransform: ReferenceTransform;
};
type CelHistoryEntry = { kind: "cel"; frameId: number; layerId: number; size: number; pixels: Pixel[] };
type ProjectHistoryEntry = { kind: "project"; snapshot: ProjectSnapshot };
type HistoryEntry = CelHistoryEntry | ProjectHistoryEntry;
type ReferenceTransform = { x: number; y: number; scale: number };
type ReferenceDimensions = { width: number; height: number };
type SpriteSheetInfo = {
  direction: "horizontal" | "vertical";
  frameCount: number;
  frameSize: number;
};
type EyeDropperApi = { open: () => Promise<{ sRGBHex: string }> };
type EyeDropperWindow = Window & { EyeDropper?: new () => EyeDropperApi };
type SelectionRect = { x: number; y: number; width: number; height: number };
type SelectionClipboard = { width: number; height: number; pixels: Pixel[] };
type SheetLayout = "horizontal" | "vertical" | "grid";
type AnalyticsInputMethod = "pointer" | "keyboard" | "toolbar";
type NamedSlice = { id: number; name: string; bounds: SelectionRect; pivot?: Pivot };
type PortablePivot = { x: number; y: number; unit: "pixels" | "normalized" };
type PortableSlice = { id: number; name: string; bounds: SelectionRect; pivot?: PortablePivot };
type PortableFrame = {
  id: number;
  durationMs: number;
  cels: Array<{ layerId: number; pixels: Pixel[] }>;
  pivot?: PortablePivot;
};
type PortableProject = {
  name: string;
  size: number;
  layers: ArtLayer[];
  frames: PortableFrame[];
  clips: AnimationClip[];
  palette: string[];
  slices: PortableSlice[];
  pivot: PortablePivot;
  tile: { enabled: boolean; seamlessPreview: boolean; wrapDrawing: boolean };
  tilemap: TilemapDocument;
  projector: {
    opacity: number;
    transform: ReferenceTransform;
    reference?: {
      name: string;
      mime: string;
      width: number;
      height: number;
      tileIndex: number;
      pixelFit: boolean;
      dataUrl?: string;
    };
  };
};
type PortableEditor = {
  activeFrameId: number;
  activeLayerId: number;
  activeClipId: number;
  selectedColor: string;
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
const REFERENCE_SCALE_MIN = 1;
const REFERENCE_SCALE_MAX = 10_000;
const REFERENCE_POSITION_MAX = 5_000;
const MAX_HISTORY = 40;
const HISTORY_CELL_BUDGET = 4_000_000;
const MAX_FRAMES = 64;
const MAX_LAYERS = 4;
const MAX_CLIPS = 256;
const MAX_SLICES = 256;
const STORAGE_KEY = "pixelwall-project-v3";
const V2_STORAGE_KEY = "pixelwall-project-v2";
const LEGACY_STORAGE_KEY = "pixelwall-project-v1";
const ONBOARDING_STORAGE_KEY = "pixelwall-onboarding-v1";
const DEFAULT_REFERENCE_TRANSFORM: ReferenceTransform = { x: 0, y: 0, scale: 100 };
const DEFAULT_LAYER: ArtLayer = { id: 1, name: "PIXELS", visible: true, locked: false, opacity: 100 };

function fileSizeBucket(bytes: number) {
  if (bytes < 256 * 1024) return "under_256kb";
  if (bytes < 1024 * 1024) return "256kb_to_1mb";
  if (bytes < 5 * 1024 * 1024) return "1mb_to_5mb";
  if (bytes < 20 * 1024 * 1024) return "5mb_to_20mb";
  return "20mb_plus";
}

function tilemapCellSummary(cells: Array<number | null>) {
  const placedCells = cells.reduce<number>((total, cell) => total + (cell === null ? 0 : 1), 0);
  const tileTypes = new Set(cells.filter((cell): cell is number => cell !== null)).size;
  return { placedCells, tileTypes };
}

function pivotInPixels(value: PortablePivot | undefined, size: number, fallback: Pivot): Pivot {
  if (!value) return { ...fallback };
  return value.unit === "normalized"
    ? { x: value.x * size, y: value.y * size }
    : { x: value.x, y: value.y };
}


function makeFrame(id: number, pixels: Pixel[], layerId = 1, durationMs = 125): ArtFrame {
  return { id, durationMs, cels: { [String(layerId)]: [...pixels] } };
}

function blankFrame(id: number, durationMs = 125): ArtFrame {
  return { id, durationMs, cels: {} };
}

function cloneFrames(frames: ArtFrame[]) {
  return frames.map((frame) => ({
    ...frame,
    ...(frame.pivot ? { pivot: { ...frame.pivot } } : {}),
    cels: Object.fromEntries(Object.entries(frame.cels).map(([layerId, pixels]) => [layerId, [...pixels]])),
  }));
}

function cloneLayers(layers: ArtLayer[]) {
  return layers.map((layer) => ({ ...layer }));
}

function cloneClips(clips: AnimationClip[]) {
  return clips.map((clip) => ({ ...clip, frameIds: [...clip.frameIds] }));
}

function celPixels(frame: ArtFrame | undefined, layerId: number, size: number) {
  return frame?.cels[String(layerId)] ?? Array<Pixel>(size * size).fill(null);
}

function setCelPixels(frame: ArtFrame, layerId: number, pixels: Pixel[]) {
  const key = String(layerId);
  const empty = pixels.every((pixel) => pixel === null);
  const nextCels = { ...frame.cels };
  if (empty) delete nextCels[key];
  else nextCels[key] = pixels;
  return { ...frame, cels: nextCels };
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

function floodFill(pixels: Pixel[], size: number, start: number, color: Pixel, wrap = false) {
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
    if (wrap || x > 0) stack.push(y * size + ((x - 1 + size) % size));
    if (wrap || x < size - 1) stack.push(y * size + ((x + 1) % size));
    if (wrap || y > 0) stack.push(((y - 1 + size) % size) * size + x);
    if (wrap || y < size - 1) stack.push(((y + 1) % size) * size + x);
  }
  return next;
}

function linkedEdgeCells(indices: number[], size: number) {
  const result = new Set(indices);
  indices.forEach((index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const xs = x === 0 ? [0, size - 1] : x === size - 1 ? [size - 1, 0] : [x];
    const ys = y === 0 ? [0, size - 1] : y === size - 1 ? [size - 1, 0] : [y];
    xs.forEach((nextX) => ys.forEach((nextY) => result.add(nextY * size + nextX)));
  });
  return [...result];
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

function selectionFromPoints(startX: number, startY: number, endX: number, endY: number): SelectionRect {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX) + 1,
    height: Math.abs(endY - startY) + 1,
  };
}

function pointInSelection(x: number, y: number, selection: SelectionRect) {
  return x >= selection.x && x < selection.x + selection.width && y >= selection.y && y < selection.y + selection.height;
}

function extractSelection(pixels: Pixel[], size: number, selection: SelectionRect): SelectionClipboard {
  const result: Pixel[] = [];
  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      result.push(pixels[(selection.y + y) * size + selection.x + x] ?? null);
    }
  }
  return { width: selection.width, height: selection.height, pixels: result };
}

function stampSelection(
  pixels: Pixel[],
  size: number,
  selection: SelectionRect,
  buffer: SelectionClipboard,
  clearSource: SelectionRect | null,
) {
  const next = [...pixels];
  if (clearSource) {
    for (let y = 0; y < clearSource.height; y += 1) {
      for (let x = 0; x < clearSource.width; x += 1) {
        next[(clearSource.y + y) * size + clearSource.x + x] = null;
      }
    }
  }
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const targetX = selection.x + x;
      const targetY = selection.y + y;
      if (targetX >= 0 && targetX < size && targetY >= 0 && targetY < size) {
        next[targetY * size + targetX] = buffer.pixels[y * buffer.width + x] ?? null;
      }
    }
  }
  return next;
}

function flippedSelection(buffer: SelectionClipboard, horizontal: boolean) {
  const pixels = Array<Pixel>(buffer.pixels.length).fill(null);
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const sourceX = horizontal ? buffer.width - 1 - x : x;
      const sourceY = horizontal ? y : buffer.height - 1 - y;
      pixels[y * buffer.width + x] = buffer.pixels[sourceY * buffer.width + sourceX] ?? null;
    }
  }
  return { ...buffer, pixels };
}

function hexToRgb(color: string) {
  const hex = color.replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((character) => character + character).join("")
    : hex.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
}

function renderFrameBitmap(
  canvas: HTMLCanvasElement | null,
  frame: ArtFrame | undefined,
  layers: ArtLayer[],
  size: number,
) {
  if (!canvas) return;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(size, size);
  if (frame) {
    layers.forEach((layer) => {
      if (!layer.visible || layer.opacity <= 0) return;
      const pixels = frame.cels[String(layer.id)];
      if (!pixels) return;
      const sourceAlpha = layer.opacity / 100;
      pixels.forEach((color, index) => {
        if (!color) return;
        const [red, green, blue] = hexToRgb(color);
        const offset = index * 4;
        const destinationAlpha = image.data[offset + 3] / 255;
        const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
        image.data[offset] = Math.round((red * sourceAlpha + image.data[offset] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
        image.data[offset + 1] = Math.round((green * sourceAlpha + image.data[offset + 1] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
        image.data[offset + 2] = Math.round((blue * sourceAlpha + image.data[offset + 2] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
        image.data[offset + 3] = Math.round(outputAlpha * 255);
      });
    });
  }
  context.putImageData(image, 0, 0);
}

function createFrameCanvas(frame: ArtFrame | undefined, layers: ArtLayer[], size: number) {
  const canvas = document.createElement("canvas");
  renderFrameBitmap(canvas, frame, layers, size);
  return canvas;
}

function opaqueBounds(canvas: HTMLCanvasElement, size: number) {
  const data = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, size, size).data;
  if (!data) return { x: 0, y: 0, w: size, h: size };
  let left = size;
  let top = size;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < size * size; index += 1) {
    if (data[index * 4 + 3] === 0) continue;
    const x = index % size;
    const y = Math.floor(index / size);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function imageDataToPixels(imageData: ImageData) {
  const pixels: Pixel[] = Array(imageData.width * imageData.height).fill(null);
  let flattenedAlpha = false;
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    const alpha = imageData.data[offset + 3];
    if (alpha === 0) continue;
    if (alpha < 255) flattenedAlpha = true;
    pixels[index] = `#${[imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]]
      .map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return { pixels, flattenedAlpha };
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG encoding failed"));
    }, "image/png");
  });
}

function yieldForPaint() {
  return new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallback);
      resolve();
    };
    const fallback = window.setTimeout(finish, 80);
    window.requestAnimationFrame(() => window.setTimeout(finish, 0));
  });
}

const FrameBitmap = memo(function FrameBitmap({
  frame,
  layers,
  size,
  className,
}: {
  frame: ArtFrame | undefined;
  layers: ArtLayer[];
  size: number;
  className: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => renderFrameBitmap(ref.current, frame, layers, size), [frame, layers, size]);
  return <canvas ref={ref} className={`${className} ph-no-capture`} width={size} height={size} aria-hidden="true" />;
});

const FrameThumbnail = memo(function FrameThumbnail({
  frame,
  layers,
  size,
}: {
  frame: ArtFrame;
  layers: ArtLayer[];
  size: number;
}) {
  return <FrameBitmap frame={frame} layers={layers} size={size} className="pixel-thumb" />;
});

const SeamPreviewBitmap = memo(function SeamPreviewBitmap({
  frame,
  layers,
  size,
}: {
  frame: ArtFrame | undefined;
  layers: ArtLayer[];
  size: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    const context = target?.getContext("2d");
    if (!target || !context) return;
    const source = createFrameCanvas(frame, layers, size);
    context.clearRect(0, 0, target.width, target.height);
    context.imageSmoothingEnabled = false;
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) context.drawImage(source, x * size, y * size);
    }
  }, [frame, layers, size]);
  return <canvas ref={ref} className="seam-tiles ph-no-capture" width={size * 3} height={size * 3} aria-hidden="true" />;
});

const TilemapBitmap = memo(function TilemapBitmap({
  tilemap,
  frames,
  layers,
  size,
  activeFrameId,
  erase,
  onStrokeStart,
  onPaint,
  onStrokeEnd,
}: {
  tilemap: TilemapDocument;
  frames: ArtFrame[];
  layers: ArtLayer[];
  size: number;
  activeFrameId: number;
  erase: boolean;
  onStrokeStart: () => void;
  onPaint: (index: number, eraseCell: boolean) => void;
  onStrokeEnd: (
    action: "paint" | "erase",
    inputMethod: "pointer" | "keyboard",
    changedCells: number,
    placedCells: number,
    tileTypes: number,
  ) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lastCell = useRef(-1);
  const changedCells = useRef(0);
  const strokeErasing = useRef(false);
  const strokeCells = useRef<Array<number | null> | null>(null);
  const bitmapCache = useRef<{
    frames: ArtFrame[];
    layers: ArtLayer[];
    size: number;
    bitmaps: Map<number, HTMLCanvasElement>;
  } | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const safeCursorX = Math.min(cursor.x, tilemap.width - 1);
  const safeCursorY = Math.min(cursor.y, tilemap.height - 1);
  const safeCursor = safeCursorY * tilemap.width + safeCursorX;
  const cursorRow = safeCursorY + 1;
  const cursorColumn = safeCursorX + 1;
  const cursorFrame = tilemap.cells[safeCursor];
  const modeLabel = erase ? "Erase" : `Paint frame ${activeFrameId}`;
  const renderSize = Math.min(48, Math.max(32, size));
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = tilemap.width * renderSize;
    canvas.height = tilemap.height * renderSize;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    if (bitmapCache.current?.frames !== frames || bitmapCache.current.layers !== layers || bitmapCache.current.size !== size) {
      const bitmaps = new Map<number, HTMLCanvasElement>();
      frames.forEach((frame) => bitmaps.set(frame.id, createFrameCanvas(frame, layers, size)));
      bitmapCache.current = { frames, layers, size, bitmaps };
    }
    const bitmaps = bitmapCache.current.bitmaps;
    tilemap.cells.forEach((frameId, index) => {
      if (!frameId) return;
      const bitmap = bitmaps.get(frameId);
      if (!bitmap) return;
      const x = (index % tilemap.width) * renderSize;
      const y = Math.floor(index / tilemap.width) * renderSize;
      context.drawImage(bitmap, x, y, renderSize, renderSize);
    });
    context.strokeStyle = "rgba(22,21,43,.24)";
    context.lineWidth = 1;
    for (let x = 1; x < tilemap.width; x += 1) {
      context.beginPath();
      context.moveTo(x * renderSize + 0.5, 0);
      context.lineTo(x * renderSize + 0.5, canvas.height);
      context.stroke();
    }
    for (let y = 1; y < tilemap.height; y += 1) {
      context.beginPath();
      context.moveTo(0, y * renderSize + 0.5);
      context.lineTo(canvas.width, y * renderSize + 0.5);
      context.stroke();
    }
    const cursorX = (safeCursor % tilemap.width) * renderSize;
    const cursorY = Math.floor(safeCursor / tilemap.width) * renderSize;
    context.strokeStyle = "#ff6b57";
    context.lineWidth = Math.max(1, Math.min(3, renderSize / 5));
    context.strokeRect(cursorX + 1, cursorY + 1, Math.max(1, renderSize - 2), Math.max(1, renderSize - 2));
  }, [frames, layers, renderSize, safeCursor, size, tilemap]);

  function cellFromPointer(clientX: number, clientY: number) {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return -1;
    const x = Math.floor(((clientX - bounds.left) / bounds.width) * tilemap.width);
    const y = Math.floor(((clientY - bounds.top) / bounds.height) * tilemap.height);
    if (x < 0 || y < 0 || x >= tilemap.width || y >= tilemap.height) return -1;
    return y * tilemap.width + x;
  }

  function paintPointer(event: ReactPointerEvent<HTMLCanvasElement>, begin = false) {
    const index = cellFromPointer(event.clientX, event.clientY);
    if (index < 0 || (!begin && index === lastCell.current)) return;
    if (begin) {
      event.currentTarget.setPointerCapture(event.pointerId);
      changedCells.current = 0;
      strokeCells.current = [...tilemap.cells];
    }
    lastCell.current = index;
    setCursor({ x: index % tilemap.width, y: Math.floor(index / tilemap.width) });
    const eraseCell = erase || event.button === 2 || (event.buttons & 2) === 2;
    const nextValue = eraseCell ? null : activeFrameId;
    const workingCells = strokeCells.current ?? [...tilemap.cells];
    strokeCells.current = workingCells;
    if (workingCells[index] === nextValue) return;
    if (changedCells.current === 0) onStrokeStart();
    strokeErasing.current = eraseCell;
    workingCells[index] = nextValue;
    changedCells.current += 1;
    onPaint(index, eraseCell);
  }

  function finishPointerStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    lastCell.current = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (changedCells.current > 0 && strokeCells.current) {
      const summary = tilemapCellSummary(strokeCells.current);
      onStrokeEnd(
        strokeErasing.current ? "erase" : "paint",
        "pointer",
        changedCells.current,
        summary.placedCells,
        summary.tileTypes,
      );
    }
    changedCells.current = 0;
    strokeCells.current = null;
  }

  const status = `${modeLabel}. Row ${cursorRow}, column ${cursorColumn}. ${cursorFrame ? `Frame ${cursorFrame}` : "Empty cell"}.`;
  return (
    <>
      <canvas
        ref={ref}
        className="tilemap-canvas ph-no-capture"
        tabIndex={0}
        aria-label={`${tilemap.width} by ${tilemap.height} tilemap. ${status} Arrow keys move; Space ${erase ? "erases" : "paints"}; Delete erases.`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => { if (event.button === 0 || event.button === 2) paintPointer(event, true); }}
        onPointerMove={(event) => { if (event.buttons) paintPointer(event); }}
        onPointerUp={finishPointerStroke}
        onPointerCancel={finishPointerStroke}
        onKeyDown={(event) => {
          const arrowKey = event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown";
          if (arrowKey) {
            event.preventDefault();
            const nextX = event.key === "ArrowLeft" ? Math.max(0, safeCursorX - 1)
              : event.key === "ArrowRight" ? Math.min(tilemap.width - 1, safeCursorX + 1)
                : safeCursorX;
            const nextY = event.key === "ArrowUp" ? Math.max(0, safeCursorY - 1)
              : event.key === "ArrowDown" ? Math.min(tilemap.height - 1, safeCursorY + 1)
                : safeCursorY;
            setCursor({ x: nextX, y: nextY });
          } else if (event.key === " " || event.key === "Enter" || event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            if (event.repeat) return;
            const eraseCell = erase || event.key === "Delete" || event.key === "Backspace";
            const nextValue = eraseCell ? null : activeFrameId;
            if (tilemap.cells[safeCursor] === nextValue) return;
            onStrokeStart();
            onPaint(safeCursor, eraseCell);
            const nextCells = [...tilemap.cells];
            nextCells[safeCursor] = nextValue;
            const summary = tilemapCellSummary(nextCells);
            onStrokeEnd(
              eraseCell ? "erase" : "paint",
              "keyboard",
              1,
              summary.placedCells,
              summary.tileTypes,
            );
          }
        }}
      />
      <span className="visually-hidden" aria-live="polite">{status}</span>
    </>
  );
});

function historyCost(entry: HistoryEntry) {
  return entry.kind === "cel"
    ? entry.pixels.length
    : entry.snapshot.frames.reduce(
      (total, frame) => total + Object.values(frame.cels).reduce((frameTotal, pixels) => frameTotal + pixels.length, 0),
      0,
    );
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
    if (frameCount >= 2 && frameCount <= MAX_FRAMES) return { direction: "horizontal", frameCount, frameSize: height };
  }
  if (height > width && height % width === 0) {
    const frameCount = height / width;
    if (frameCount >= 2 && frameCount <= MAX_FRAMES) return { direction: "vertical", frameCount, frameSize: width };
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

function clipPlaybackFrameIds(clip: AnimationClip | undefined, frames: ArtFrame[]) {
  const existing = new Set(frames.map((frame) => frame.id));
  const forward = (clip?.frameIds ?? frames.map((frame) => frame.id)).filter((id) => existing.has(id));
  if (!forward.length) return frames.map((frame) => frame.id);
  if (clip?.direction === "reverse") return [...forward].reverse();
  if (clip?.direction === "pingpong" && forward.length > 1) {
    return [...forward, ...forward.slice(1, -1).reverse()];
  }
  if (clip?.direction === "pingpong_reverse" && forward.length > 1) {
    const reverse = [...forward].reverse();
    return [...reverse, ...forward.slice(1, -1)];
  }
  return forward;
}

export default function Studio() {
  const proAccess = useProAccess();
  const { readyFile, downloadBlob, dismissDownload } = useDownload();
  const [size, setSize] = useState(16);
  const [frames, setFrames] = useState<ArtFrame[]>(() => [
    makeFrame(1, makeDemoPixels(16, 0)),
    makeFrame(2, makeDemoPixels(16, 0.45)),
    makeFrame(3, makeDemoPixels(16, 0.9)),
  ]);
  const [layers, setLayers] = useState<ArtLayer[]>([DEFAULT_LAYER]);
  const [clips, setClips] = useState<AnimationClip[]>([
    { id: 1, name: "default", frameIds: [1, 2, 3], direction: "forward", loop: true },
  ]);
  const [activeFrame, setActiveFrame] = useState(0);
  const [activeLayerId, setActiveLayerId] = useState(1);
  const [activeClipId, setActiveClipId] = useState(1);
  const [projectName, setProjectName] = useState("DESERT SIGNAL");
  const [tool, setTool] = useState<Tool>("pencil");
  const [selectedColor, setSelectedColor] = useState("#ff6b57");
  const [palette, setPalette] = useState(STARTER_PALETTE);
  const [showGrid, setShowGrid] = useState(true);
  const [showOnion, setShowOnion] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [referenceName, setReferenceName] = useState("reference.png");
  const [referenceMime, setReferenceMime] = useState("image/png");
  const [referenceDimensions, setReferenceDimensions] = useState<ReferenceDimensions | null>(null);
  const [referenceTile, setReferenceTile] = useState(0);
  const [referencePixelFit, setReferencePixelFit] = useState(false);
  const [referenceOpacity, setReferenceOpacity] = useState(38);
  const [referenceTransform, setReferenceTransform] = useState<ReferenceTransform>(DEFAULT_REFERENCE_TRANSFORM);
  const [adjustingReference, setAdjustingReference] = useState(false);
  const [projectorExpanded, setProjectorExpanded] = useState(false);
  const [cellSize, setCellSize] = useState(24);
  const [playing, setPlaying] = useState(false);
  const [playbackCursor, setPlaybackCursor] = useState(0);
  const [pivot, setPivot] = useState<Pivot>({ x: 8, y: 16 });
  const [tileSettings, setTileSettings] = useState<TileSettings>({ preview: false, linkEdges: false });
  const [tilemap, setTilemap] = useState<TilemapDocument>({ width: 8, height: 8, cells: Array(64).fill(null) });
  const [tilemapErase, setTilemapErase] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selectionClipboard, setSelectionClipboard] = useState<SelectionClipboard | null>(null);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState(true);
  const [saveFailed, setSaveFailed] = useState(false);
  const [samplingColor, setSamplingColor] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<"frame" | "package" | "sheet" | "gif" | "tilemap" | null>(null);
  const [gifScale, setGifScale] = useState(4);
  const [exportLayout, setExportLayout] = useState<SheetLayout>("horizontal");
  const [exportClipId, setExportClipId] = useState<number | "all">("all");
  const [exportIndividualFrames, setExportIndividualFrames] = useState(true);
  const [exportPadding, setExportPadding] = useState(0);
  const [exportTrim, setExportTrim] = useState(false);
  const [slices, setSlices] = useState<NamedSlice[]>([]);
  const [notice, setNotice] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const tilemapWidthInputRef = useRef<HTMLInputElement>(null);
  const tilemapHeightInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportFirstOptionRef = useRef<HTMLButtonElement>(null);
  const projectorToggleRef = useRef<HTMLButtonElement>(null);
  const referenceLayerRef = useRef<HTMLButtonElement>(null);
  const activePointer = useRef<number | null>(null);
  const { viewportRef, changeCellSize, fitCellSize, fitView, panning, panHandlers } = useCanvasView(
    canvasRef, activePointer, size, cellSize, setCellSize, tool === "hand",
  );
  const lastPainted = useRef<number | null>(null);
  const strokeRecorded = useRef(false);
  const activeFrameRef = useRef(activeFrame);
  const saveWarningShown = useRef(false);
  const autosaveFailureActive = useRef(false);
  const editorSource = useRef<"fresh_demo" | "restored_v3" | "upgraded_v2" | "upgraded_v1">("fresh_demo");
  const editorLoadedCaptured = useRef(false);
  const guideSource = useRef<"automatic" | "footer" | "toolbar">("automatic");
  const shouldRestoreExportFocus = useRef(false);
  const referenceDrag = useRef<null | {
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>(null);
  const selectionDrag = useRef<null | {
    mode: "marquee" | "move";
    pointerId: number;
    startX: number;
    startY: number;
    origin?: SelectionRect;
    current?: SelectionRect;
    pixels?: Pixel[];
  }>(null);

  const currentFrame = frames[activeFrame];
  const activePivot = currentFrame?.pivot ?? pivot;
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? layers[0];
  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? clips[0];
  const activeClipFrameIndices = (activeClip?.frameIds ?? [])
    .map((id) => frames.findIndex((frame) => frame.id === id))
    .filter((index) => index >= 0);
  const clipFrom = activeClipFrameIndices.length ? Math.min(...activeClipFrameIndices) : 0;
  const clipTo = activeClipFrameIndices.length ? Math.max(...activeClipFrameIndices) : Math.max(0, frames.length - 1);
  const activeClipFpsPreset = useMemo(() => {
    const durations = new Set((activeClip?.frameIds ?? []).map((id) => frames.find((frame) => frame.id === id)?.durationMs).filter(Boolean));
    if (durations.size !== 1) return "mixed";
    const duration = [...durations][0] as number;
    const fps = String(Math.round(1000 / duration));
    return ["4", "6", "8", "10", "12", "24"].includes(fps) ? fps : "mixed";
  }, [activeClip, frames]);
  const tilemapSummary = useMemo(() => tilemapCellSummary(tilemap.cells), [tilemap.cells]);
  const tilemapPlacedCells = tilemapSummary.placedCells;
  const tilemapTileTypes = tilemapSummary.tileTypes;
  const currentPixels = useMemo(
    () => celPixels(currentFrame, activeLayerId, size),
    [activeLayerId, currentFrame, size],
  );
  const previousFrame = useMemo(() => {
    if (frames.length < 2) return undefined;
    const previous = (activeFrame - 1 + frames.length) % frames.length;
    return frames[previous];
  }, [activeFrame, frames]);
  const spriteSheet = useMemo(() => detectSpriteSheet(referenceDimensions), [referenceDimensions]);
  const referenceScaleMax = useMemo(() => {
    if (!referenceDimensions) return 1600;
    const matchScale = (Math.max(referenceDimensions.width, referenceDimensions.height) / size) * 100;
    return Math.min(REFERENCE_SCALE_MAX, Math.max(1600, Math.ceil(matchScale / 100) * 100));
  }, [referenceDimensions, size]);
  const analyticsProjectShape = {
    canvas_size: size,
    frame_count: frames.length,
    layer_count: layers.length,
    clip_count: clips.length,
    slice_count: slices.length,
    has_reference: Boolean(reference),
    tilemap_width: tilemap.width,
    tilemap_height: tilemap.height,
    tilemap_placed_cells: tilemapPlacedCells,
  };

  function captureCanvasEdit(editType: string, inputMethod: AnalyticsInputMethod, changedCells?: number) {
    captureAnalyticsEvent("canvas_edit_committed", {
      ...analyticsProjectShape,
      edit_type: editType,
      tool,
      input_method: inputMethod,
      linked_edges: tileSettings.linkEdges,
      ...(changedCells === undefined ? {} : { changed_cells: changedCells }),
    });
  }

  function captureProjectStructure(
    resource: string,
    action: string,
    fromValue?: string | number | boolean,
    toValue?: string | number | boolean,
    shapeOverrides: Partial<typeof analyticsProjectShape> = {},
  ) {
    const resultingShape = { ...analyticsProjectShape, ...shapeOverrides };
    if (resource === "canvas" && action === "resize" && typeof toValue === "number") resultingShape.canvas_size = toValue;
    if (resource === "frame" && ["add", "duplicate", "delete"].includes(action) && typeof toValue === "number") resultingShape.frame_count = toValue;
    if (resource === "layer" && ["add", "delete"].includes(action) && typeof toValue === "number") resultingShape.layer_count = toValue;
    if (resource === "clip" && ["add", "delete"].includes(action) && typeof toValue === "number") resultingShape.clip_count = toValue;
    if (resource === "slice" && ["add", "delete"].includes(action) && typeof toValue === "number") resultingShape.slice_count = toValue;
    captureAnalyticsEvent("project_structure_changed", {
      ...resultingShape,
      resource,
      action,
      ...(fromValue === undefined ? {} : { from_value: fromValue }),
      ...(toValue === undefined ? {} : { to_value: toValue }),
    });
  }

  function portableProject(): PortableProject {
    return {
      name: projectName,
      size,
      layers: cloneLayers(layers),
      frames: frames.map((frame) => ({
        id: frame.id,
        durationMs: frame.durationMs,
        cels: Object.entries(frame.cels).map(([layerId, pixels]) => ({ layerId: Number(layerId), pixels: [...pixels] })),
        ...(frame.pivot ? { pivot: { ...frame.pivot, unit: "pixels" as const } } : {}),
      })),
      clips: cloneClips(clips),
      slices: slices.map((slice): PortableSlice => ({
        id: slice.id,
        name: slice.name,
        bounds: { ...slice.bounds },
        ...(slice.pivot ? { pivot: { ...slice.pivot, unit: "pixels" as const } } : {}),
      })),
      palette: [...palette],
      pivot: { ...pivot, unit: "pixels" },
      tile: {
        enabled: tileSettings.preview || tileSettings.linkEdges,
        seamlessPreview: tileSettings.preview,
        wrapDrawing: tileSettings.linkEdges,
      },
      tilemap: { ...tilemap, cells: [...tilemap.cells] },
      projector: {
        opacity: referenceOpacity,
        transform: { ...referenceTransform },
        ...(reference && referenceDimensions ? {
          reference: {
            name: referenceName,
            mime: referenceMime,
            width: referenceDimensions.width,
            height: referenceDimensions.height,
            tileIndex: referenceTile,
            pixelFit: referencePixelFit,
            dataUrl: reference,
          },
        } : {}),
      },
    };
  }

  function portableEditor(): PortableEditor {
    return {
      activeFrameId: frames[activeFrame]?.id ?? frames[0].id,
      activeLayerId,
      activeClipId,
      selectedColor,
    };
  }

  function loadPortableProject(project: PortableProject, editor: PortableEditor, message: string) {
    const nextFrames: ArtFrame[] = project.frames.map((frame) => ({
      id: frame.id,
      durationMs: frame.durationMs,
      cels: Object.fromEntries(frame.cels.map((cel) => [String(cel.layerId), [...cel.pixels]])),
      ...(frame.pivot ? { pivot: pivotInPixels(frame.pivot, project.size, { x: project.size / 2, y: project.size / 2 }) } : {}),
    }));
    setPlaying(false);
    setProjectName(project.name);
    setSize(project.size);
    setFrames(nextFrames);
    setLayers(cloneLayers(project.layers));
    setClips(cloneClips(project.clips));
    setSlices((project.slices ?? []).map((slice) => ({
      ...slice,
      bounds: { ...slice.bounds },
      ...(slice.pivot ? { pivot: pivotInPixels(slice.pivot, project.size, { x: project.size / 2, y: project.size / 2 }) } : {}),
    })));
    setActiveFrame(Math.max(0, nextFrames.findIndex((frame) => frame.id === editor.activeFrameId)));
    setActiveLayerId(editor.activeLayerId);
    setActiveClipId(editor.activeClipId);
    setExportClipId("all");
    setPalette([...project.palette]);
    setSelectedColor(editor.selectedColor);
    setPivot(pivotInPixels(project.pivot, project.size, { x: project.size / 2, y: project.size }));
    setTileSettings({ preview: project.tile.seamlessPreview, linkEdges: project.tile.wrapDrawing });
    setTilemap(project.tilemap
      ? { ...project.tilemap, cells: [...project.tilemap.cells] }
      : { width: 8, height: 8, cells: Array(64).fill(null) });
    setTilemapErase(false);
    setReferenceOpacity(project.projector.opacity);
    setReferenceTransform({ ...project.projector.transform });
    const asset = project.projector.reference;
    setReference(asset?.dataUrl ?? null);
    setReferenceDimensions(asset?.dataUrl ? { width: asset.width, height: asset.height } : null);
    setReferenceName(asset?.name ?? "reference.png");
    setReferenceMime(asset?.mime ?? "image/png");
    setReferenceTile(asset?.dataUrl ? asset.tileIndex : 0);
    setReferencePixelFit(Boolean(asset?.dataUrl && asset.pixelFit));
    setAdjustingReference(false);
    setProjectorExpanded(Boolean(asset?.dataUrl));
    setSelection(null);
    setSelectionClipboard(null);
    setUndoStack([]);
    setRedoStack([]);
    setCellSize(fitCellSize(project.size));
    setNotice(message);
  }

  useEffect(() => renderFrameBitmap(canvasRef.current, currentFrame, layers, size), [currentFrame, layers, size]);

  useEffect(() => {
    activeFrameRef.current = activeFrame;
  }, [activeFrame]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isAnalyticsConfigured() && getAnalyticsConsentStatus() === "pending") return;
      try {
        if (window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "done") {
          guideSource.current = "automatic";
          setGuideOpen(true);
        }
      } catch {
        guideSource.current = "automatic";
        setGuideOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setExportMenuOpen(false);
      exportTriggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    if (exporting !== null || !shouldRestoreExportFocus.current) return;
    shouldRestoreExportFocus.current = false;
    const animationFrame = window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement === document.body || exportMenuRef.current?.contains(activeElement)) {
        exportTriggerRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [exporting]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const currentDraft = window.localStorage.getItem(STORAGE_KEY);
        const v2Draft = window.localStorage.getItem(V2_STORAGE_KEY);
        const legacyDraft = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        const source = currentDraft ?? v2Draft ?? legacyDraft;
        if (source) {
          const loaded = parseProject(source, { name: "DESERT SIGNAL" }) as {
            project: PortableProject;
            editor: PortableEditor;
          };
          editorSource.current = currentDraft ? "restored_v3" : v2Draft ? "upgraded_v2" : "upgraded_v1";
          loadPortableProject(loaded.project, loaded.editor, currentDraft ? "Local project restored" : "Older project upgraded");
        }
      } catch {
        // A malformed local draft should never block the editor.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // The one-time loader intentionally captures the initial project adapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storageReady || editorLoadedCaptured.current) return;
    editorLoadedCaptured.current = true;
    captureAnalyticsEvent("editor_loaded", {
      ...analyticsProjectShape,
      project_source: editorSource.current,
    });
    // The initial editor state is captured once after local restoration completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady]);

  useEffect(() => {
    if (!guideOpen) return;
    captureAnalyticsEvent("quick_guide_viewed", {
      ...analyticsProjectShape,
      source: guideSource.current,
    });
    // Only the closed-to-open transition should create a guide view event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideOpen]);

  useEffect(() => {
    if (!storageReady) return;
    const savingTimer = window.setTimeout(() => {
      setSaved(false);
      setSaveFailed(false);
    }, 0);
    const timer = window.setTimeout(() => {
      try {
        const editor = portableEditor();
        editor.activeFrameId = frames[activeFrameRef.current]?.id ?? frames[0].id;
        const stored = stringifyProject(portableProject(), editor, { includeReference: false });
        window.localStorage.setItem(STORAGE_KEY, stored);
        setSaved(true);
        setSaveFailed(false);
        saveWarningShown.current = false;
        if (autosaveFailureActive.current) {
          autosaveFailureActive.current = false;
          captureAnalyticsEvent("autosave_recovered", analyticsProjectShape);
        }
      } catch {
        setSaved(false);
        setSaveFailed(true);
        if (!autosaveFailureActive.current) {
          autosaveFailureActive.current = true;
          captureAnalyticsEvent("autosave_failed", {
            ...analyticsProjectShape,
            reason: "browser_storage_unavailable",
          });
        }
        if (!saveWarningShown.current) {
          saveWarningShown.current = true;
          setNotice("Local autosave failed — save a portable project file to protect your work");
        }
      }
    }, 500);
    return () => {
      window.clearTimeout(savingTimer);
      window.clearTimeout(timer);
    };
    // The adapter functions are rebuilt from exactly the state listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClipId, activeFrame, activeLayerId, clips, frames, layers, palette, pivot, projectName, referenceDimensions,
    referenceMime, referenceName, referenceOpacity, referencePixelFit, referenceTile, referenceTransform,
    selectedColor, size, slices, storageReady, tileSettings, tilemap]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const sequence = clipPlaybackFrameIds(activeClip, frames);
    if (sequence.length < 2) return;
    const sequenceIndex = clamp(playbackCursor, 0, sequence.length - 1);
    const currentId = sequence[sequenceIndex];
    const currentIndex = frames.findIndex((frame) => frame.id === currentId);
    const duration = frames[currentIndex]?.durationMs ?? 125;
    const timer = window.setTimeout(() => {
      const atEnd = sequenceIndex === sequence.length - 1;
      if (atEnd && activeClip && !activeClip.loop) {
        setPlaybackCursor(0);
        setPlaying(false);
        captureAnalyticsEvent("animation_playback_changed", {
          ...analyticsProjectShape,
          action: "completed",
          clip_frame_count: activeClip.frameIds.length,
          direction: activeClip.direction,
          loop: activeClip.loop,
        });
        return;
      }
      const nextCursor = (sequenceIndex + 1) % sequence.length;
      const nextIndex = frames.findIndex((frame) => frame.id === sequence[nextCursor]);
      setPlaybackCursor(nextCursor);
      if (nextIndex >= 0) setActiveFrame(nextIndex);
    }, duration);
    return () => window.clearTimeout(timer);
    // Project analytics shape is intentionally sampled at completion, not used to schedule playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip, activeFrame, frames, playbackCursor, playing]);

  useEffect(() => {
    if (!notice || exporting) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [exporting, notice]);

  useEffect(() => {
    if (!adjustingReference) return;
    const timer = window.setTimeout(() => referenceLayerRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [adjustingReference]);

  function projectSnapshot(): ProjectSnapshot {
    return {
      projectName,
      frames: cloneFrames(frames),
      layers: cloneLayers(layers),
      clips: cloneClips(clips),
      slices: slices.map((slice) => ({ ...slice, bounds: { ...slice.bounds }, ...(slice.pivot ? { pivot: { ...slice.pivot } } : {}) })),
      palette: [...palette],
      selectedColor,
      size,
      activeFrame,
      activeLayerId,
      activeClipId,
      pivot: { ...pivot },
      tile: { ...tileSettings },
      tilemap: { ...tilemap, cells: [...tilemap.cells] },
      reference,
      referenceName,
      referenceMime,
      referenceDimensions: referenceDimensions ? { ...referenceDimensions } : null,
      referenceTile,
      referencePixelFit,
      referenceOpacity,
      referenceTransform: { ...referenceTransform },
    };
  }

  function pushHistory(entry: HistoryEntry) {
    setUndoStack((current) => trimHistory([...current, entry]));
    setRedoStack([]);
  }

  function recordCelHistory() {
    const frame = frames[activeFrame];
    if (!frame) return;
    pushHistory({ kind: "cel", frameId: frame.id, layerId: activeLayerId, size, pixels: [...currentPixels] });
  }

  function recordProjectHistory() {
    pushHistory({ kind: "project", snapshot: projectSnapshot() });
  }

  function inverseFor(entry: HistoryEntry): HistoryEntry | null {
    if (entry.kind === "project") return { kind: "project", snapshot: projectSnapshot() };
    const frame = frames.find((candidate) => candidate.id === entry.frameId);
    if (!frame) return null;
    return {
      kind: "cel",
      frameId: frame.id,
      layerId: entry.layerId,
      size,
      pixels: [...celPixels(frame, entry.layerId, size)],
    };
  }

  function applyHistory(entry: HistoryEntry) {
    setPlaying(false);
    if (entry.kind === "project") {
      setProjectName(entry.snapshot.projectName);
      setFrames(cloneFrames(entry.snapshot.frames));
      setLayers(cloneLayers(entry.snapshot.layers));
      setClips(cloneClips(entry.snapshot.clips));
      setExportClipId("all");
      setSlices(entry.snapshot.slices.map((slice) => ({ ...slice, bounds: { ...slice.bounds }, ...(slice.pivot ? { pivot: { ...slice.pivot } } : {}) })));
      setPalette([...entry.snapshot.palette]);
      setSelectedColor(entry.snapshot.selectedColor);
      setSize(entry.snapshot.size);
      if (referencePixelFit && referenceDimensions) {
        setReferenceTransform(pixelMatchedTransform(referenceDimensions, entry.snapshot.size, spriteSheet, referenceTile));
      }
      setActiveFrame(Math.min(entry.snapshot.activeFrame, entry.snapshot.frames.length - 1));
      setActiveLayerId(entry.snapshot.activeLayerId);
      setActiveClipId(entry.snapshot.activeClipId);
      setPivot({ ...entry.snapshot.pivot });
      setTileSettings({ ...entry.snapshot.tile });
      setTilemap({ ...entry.snapshot.tilemap, cells: [...entry.snapshot.tilemap.cells] });
      setReference(entry.snapshot.reference);
      setReferenceName(entry.snapshot.referenceName);
      setReferenceMime(entry.snapshot.referenceMime);
      setReferenceDimensions(entry.snapshot.referenceDimensions ? { ...entry.snapshot.referenceDimensions } : null);
      setReferenceTile(entry.snapshot.referenceTile);
      setReferencePixelFit(entry.snapshot.referencePixelFit);
      setReferenceOpacity(entry.snapshot.referenceOpacity);
      setReferenceTransform({ ...entry.snapshot.referenceTransform });
      setCursorIndex((current) => Math.min(current, entry.snapshot.size * entry.snapshot.size - 1));
      setSelection(null);
      return;
    }
    setFrames((current) => current.map((frame) =>
      frame.id === entry.frameId ? setCelPixels(frame, entry.layerId, [...entry.pixels]) : frame,
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
      index === activeFrame ? setCelPixels(frame, activeLayerId, update(celPixels(frame, activeLayerId, size))) : frame,
    ));
  }

  function activeLayerIsEditable(showMessage = true) {
    if (!activeLayer || activeLayer.locked || !activeLayer.visible) {
      if (showMessage) setNotice(activeLayer?.locked ? "Unlock this layer to edit it" : "Show this layer to edit it");
      return false;
    }
    return true;
  }

  function copySelection() {
    if (!selection) return;
    setSelectionClipboard(extractSelection(currentPixels, size, selection));
    setNotice(`Copied ${selection.width} × ${selection.height} pixels`);
  }

  function pasteSelection(inputMethod: AnalyticsInputMethod = "toolbar") {
    if (!selectionClipboard || !activeLayerIsEditable()) return;
    const baseX = selection ? selection.x + 1 : Math.floor((size - selectionClipboard.width) / 2);
    const baseY = selection ? selection.y + 1 : Math.floor((size - selectionClipboard.height) / 2);
    const nextSelection = {
      x: clamp(baseX, 0, Math.max(0, size - selectionClipboard.width)),
      y: clamp(baseY, 0, Math.max(0, size - selectionClipboard.height)),
      width: selectionClipboard.width,
      height: selectionClipboard.height,
    };
    recordCelHistory();
    updateActivePixels((pixels) => stampSelection(pixels, size, nextSelection, selectionClipboard, null));
    setSelection(nextSelection);
    setTool("select");
    setNotice("Pasted selection");
    captureCanvasEdit("selection_paste", inputMethod, selectionClipboard.width * selectionClipboard.height);
  }

  function moveSelection(dx: number, dy: number, inputMethod: AnalyticsInputMethod = "keyboard") {
    if (!selection || !activeLayerIsEditable()) return;
    const nextSelection = {
      ...selection,
      x: clamp(selection.x + dx, 0, size - selection.width),
      y: clamp(selection.y + dy, 0, size - selection.height),
    };
    if (nextSelection.x === selection.x && nextSelection.y === selection.y) return;
    const buffer = extractSelection(currentPixels, size, selection);
    recordCelHistory();
    updateActivePixels((pixels) => stampSelection(pixels, size, nextSelection, buffer, selection));
    setSelection(nextSelection);
    captureCanvasEdit("selection_move", inputMethod, selection.width * selection.height);
  }

  function flipActiveSelection(horizontal: boolean) {
    if (!selection || !activeLayerIsEditable()) return;
    const buffer = flippedSelection(extractSelection(currentPixels, size, selection), horizontal);
    recordCelHistory();
    updateActivePixels((pixels) => stampSelection(pixels, size, selection, buffer, selection));
    setNotice(horizontal ? "Selection flipped horizontally" : "Selection flipped vertically");
    captureCanvasEdit(horizontal ? "selection_flip_horizontal" : "selection_flip_vertical", "toolbar", selection.width * selection.height);
  }

  function clearSelectionPixels(inputMethod: AnalyticsInputMethod = "toolbar") {
    if (!selection || !activeLayerIsEditable()) return;
    recordCelHistory();
    updateActivePixels((pixels) => {
      const next = [...pixels];
      for (let y = 0; y < selection.height; y += 1) {
        for (let x = 0; x < selection.width; x += 1) {
          next[(selection.y + y) * size + selection.x + x] = null;
        }
      }
      return next;
    });
    setNotice("Selection cleared");
    captureCanvasEdit("selection_clear", inputMethod, selection.width * selection.height);
  }

  function saveSelectionAsSlice() {
    if (!selection) return;
    if (slices.length >= MAX_SLICES) {
      setNotice(`Slice limit is ${MAX_SLICES}`);
      return;
    }
    const id = Math.max(...slices.map((slice) => slice.id), 0) + 1;
    const names = new Set(slices.map((slice) => slice.name.toLowerCase()));
    let sequence = slices.length + 1;
    while (names.has(`slice-${sequence}`)) sequence += 1;
    recordProjectHistory();
    setSlices((current) => [...current, {
      id,
      name: `slice-${sequence}`,
      bounds: { ...selection },
      pivot: { ...activePivot },
    }]);
    setNotice(`Saved ${selection.width} × ${selection.height} slice`);
    captureProjectStructure("slice", "add", slices.length, slices.length + 1);
  }

  function renameSlice(sliceId: number, value: string) {
    const requested = value.trim().slice(0, 28);
    if (!requested || requested.toLowerCase() === "origin" || slices.some((slice) => slice.id !== sliceId && slice.name.toLowerCase() === requested.toLowerCase())) {
      setNotice("Slice names must be unique and cannot be blank");
      return;
    }
    setSlices((current) => current.map((slice) => slice.id === sliceId ? { ...slice, name: requested } : slice));
  }

  function deleteSlice(sliceId: number) {
    recordProjectHistory();
    setSlices((current) => current.filter((slice) => slice.id !== sliceId));
    captureProjectStructure("slice", "delete", slices.length, Math.max(0, slices.length - 1));
  }

  function applyTool(index: number, indices = [index]) {
    if (tool === "hand") return;
    if (tool === "picker") {
      const x = index % size;
      const y = Math.floor(index / size);
      const sampled = canvasRef.current?.getContext("2d")?.getImageData(x, y, 1, 1).data;
      const color = sampled && sampled[3] > 0
        ? `#${[sampled[0], sampled[1], sampled[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`
        : null;
      if (color) {
        addColorToRack(color);
      } else {
        setNotice("No painted color here — try another pixel");
      }
      return;
    }
    if (tool === "fill") {
      updateActivePixels((pixels) => floodFill(pixels, size, index, selectedColor, tileSettings.linkEdges));
      return;
    }
    const color = tool === "eraser" ? null : selectedColor;
    const targetIndices = tileSettings.linkEdges ? linkedEdgeCells(indices, size) : indices;
    updateActivePixels((pixels) => {
      const next = [...pixels];
      targetIndices.forEach((cell) => { next[cell] = color; });
      return next;
    });
  }

  function toolWouldChange(index: number, indices = [index]) {
    if (tool === "picker" || tool === "select" || tool === "pivot" || tool === "hand") return false;
    if (tool === "fill") return (currentPixels[index] ?? null) !== selectedColor;
    const color = tool === "eraser" ? null : selectedColor;
    const targetIndices = tileSettings.linkEdges ? linkedEdgeCells(indices, size) : indices;
    return targetIndices.some((cell) => (currentPixels[cell] ?? null) !== color);
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
    if (playing || adjustingReference || tool === "hand" || event.button !== 0 || !event.isPrimary || activePointer.current !== null) return;
    const index = indexFromPointer(event.clientX, event.clientY);
    if (index === null) return;
    setCursorIndex(index);
    const x = index % size;
    const y = Math.floor(index / size);
    if (tool === "pivot") {
      recordProjectHistory();
      setActiveFramePivot({ x: x + 0.5, y: y + 0.5 });
      setNotice(`Pivot set to ${x + 0.5}, ${y + 0.5}`);
      captureCanvasEdit("pivot_set", "pointer", 1);
      return;
    }
    if (tool === "select") {
      if (!activeLayerIsEditable()) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointer.current = event.pointerId;
      if (selection && pointInSelection(x, y, selection)) {
        recordCelHistory();
        selectionDrag.current = {
          mode: "move",
          pointerId: event.pointerId,
          startX: x,
          startY: y,
          origin: { ...selection },
          pixels: [...currentPixels],
        };
      } else {
        const nextSelection = { x, y, width: 1, height: 1 };
        setSelection(nextSelection);
        selectionDrag.current = { mode: "marquee", pointerId: event.pointerId, startX: x, startY: y };
      }
      return;
    }
    if (tool === "picker") {
      applyTool(index);
      return;
    }
    if (!activeLayerIsEditable()) return;
    strokeRecorded.current = false;
    if (toolWouldChange(index)) {
      recordCelHistory();
      strokeRecorded.current = true;
      applyTool(index);
      if (tool === "fill") captureCanvasEdit("fill", "pointer");
    }
    if (tool === "pencil" || tool === "eraser") {
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointer.current = event.pointerId;
      lastPainted.current = index;
    }
  }

  function continueStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = selectionDrag.current;
    if (drag?.pointerId === event.pointerId) {
      const index = indexFromPointer(event.clientX, event.clientY);
      if (index === null) return;
      const x = index % size;
      const y = Math.floor(index / size);
      if (drag.mode === "marquee") {
        setSelection(selectionFromPoints(drag.startX, drag.startY, x, y));
      } else if (drag.origin && drag.pixels) {
        const nextSelection = {
          ...drag.origin,
          x: clamp(drag.origin.x + x - drag.startX, 0, size - drag.origin.width),
          y: clamp(drag.origin.y + y - drag.startY, 0, size - drag.origin.height),
        };
        const buffer = extractSelection(drag.pixels, size, drag.origin);
        updateActivePixels(() => stampSelection(drag.pixels!, size, nextSelection, buffer, drag.origin!));
        drag.current = nextSelection;
        setSelection(nextSelection);
      }
      setCursorIndex(index);
      return;
    }
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
        recordCelHistory();
        strokeRecorded.current = true;
      }
      applyTool(index, path);
    }
    setCursorIndex(index);
    lastPainted.current = index;
  }

  function endStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId) return;
    const finishedSelectionDrag = selectionDrag.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (
      finishedSelectionDrag?.mode === "move"
      && finishedSelectionDrag.origin
      && finishedSelectionDrag.current
      && (
        finishedSelectionDrag.current.x !== finishedSelectionDrag.origin.x
        || finishedSelectionDrag.current.y !== finishedSelectionDrag.origin.y
      )
    ) {
      captureCanvasEdit("selection_move", "pointer", finishedSelectionDrag.origin.width * finishedSelectionDrag.origin.height);
    } else if (strokeRecorded.current && (tool === "pencil" || tool === "eraser")) {
      captureCanvasEdit(tool === "eraser" ? "erase" : "stroke", "pointer");
    }
    activePointer.current = null;
    selectionDrag.current = null;
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
    const commandKey = event.metaKey || event.ctrlKey;
    const lowerKey = event.key.toLowerCase();
    if (!commandKey && (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "0")) {
      event.preventDefault();
      if (event.key === "0") fitView();
      else changeCellSize(event.key === "-" ? -1 : 1);
      return;
    }
    if (tool === "hand" && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const distance = event.shiftKey ? 160 : 64;
      viewportRef.current?.scrollBy({
        left: event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0,
        top: event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0,
      });
      return;
    }
    if (commandKey && lowerKey === "a") {
      event.preventDefault();
      setTool("select");
      setSelection({ x: 0, y: 0, width: size, height: size });
      return;
    }
    if (commandKey && lowerKey === "c" && selection) {
      event.preventDefault();
      copySelection();
      return;
    }
    if (commandKey && lowerKey === "x" && selection) {
      event.preventDefault();
      copySelection();
      clearSelectionPixels("keyboard");
      return;
    }
    if (commandKey && lowerKey === "v" && selectionClipboard) {
      event.preventDefault();
      pasteSelection("keyboard");
      return;
    }
    if (event.key === "Escape" && selection) {
      event.preventDefault();
      setSelection(null);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selection) {
      event.preventDefault();
      clearSelectionPixels("keyboard");
      return;
    }
    if (tool === "select" && selection && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const amount = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft") moveSelection(-amount, 0);
      if (event.key === "ArrowRight") moveSelection(amount, 0);
      if (event.key === "ArrowUp") moveSelection(0, -amount);
      if (event.key === "ArrowDown") moveSelection(0, amount);
      return;
    }
    if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      void sampleVisibleColor();
      return;
    }
    const toolShortcut: Partial<Record<string, Tool>> = {
      p: "pencil",
      e: "eraser",
      f: "fill",
      s: "select",
      o: "pivot",
      h: "hand",
    };
    const shortcutTool = !commandKey && !event.altKey ? toolShortcut[event.key.toLowerCase()] : undefined;
    if (shortcutTool) {
      event.preventDefault();
      setTool(shortcutTool);
      stopReferenceAdjustment();
      return;
    }
    if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      const enabled = !showGrid;
      setShowGrid(enabled);
      captureAnalyticsEvent("feature_toggled", { ...analyticsProjectShape, feature: "grid", enabled, source: "keyboard" });
      return;
    }
    if (lowerKey === "t") {
      event.preventDefault();
      recordProjectHistory();
      const enabled = !tileSettings.preview;
      setTileSettings((current) => ({ ...current, preview: enabled }));
      captureAnalyticsEvent("feature_toggled", { ...analyticsProjectShape, feature: "seam_preview", enabled, source: "keyboard" });
      return;
    }
    if (lowerKey === "w") {
      event.preventDefault();
      recordProjectHistory();
      const enabled = !tileSettings.linkEdges;
      setTileSettings((current) => ({ ...current, linkEdges: enabled }));
      captureAnalyticsEvent("feature_toggled", { ...analyticsProjectShape, feature: "linked_edges", enabled, source: "keyboard" });
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
        if (!activeLayerIsEditable()) return;
        recordCelHistory();
        applyTool(cursorIndex);
        captureCanvasEdit(tool === "fill" ? "fill" : tool === "eraser" ? "erase" : "stroke", "keyboard");
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
      ...(frame.pivot ? {
        pivot: { x: (frame.pivot.x / size) * nextSize, y: (frame.pivot.y / size) * nextSize },
      } : {}),
      cels: Object.fromEntries(Object.entries(frame.cels).map(([layerId, pixels]) => [
        layerId,
        resizePixels(pixels, size, nextSize),
      ])),
    })));
    const offset = Math.floor((nextSize - size) / 2);
    setSlices((current) => current.flatMap((slice) => {
      const left = clamp(slice.bounds.x + offset, 0, nextSize);
      const top = clamp(slice.bounds.y + offset, 0, nextSize);
      const right = clamp(slice.bounds.x + slice.bounds.width + offset, 0, nextSize);
      const bottom = clamp(slice.bounds.y + slice.bounds.height + offset, 0, nextSize);
      if (right <= left || bottom <= top) return [];
      return [{
        ...slice,
        bounds: { x: left, y: top, width: right - left, height: bottom - top },
        ...(slice.pivot ? { pivot: { x: (slice.pivot.x / size) * nextSize, y: (slice.pivot.y / size) * nextSize } } : {}),
      }];
    }));
    setSize(nextSize);
    setPivot((current) => ({ x: (current.x / size) * nextSize, y: (current.y / size) * nextSize }));
    if (referencePixelFit && referenceDimensions) {
      setReferenceTransform(pixelMatchedTransform(referenceDimensions, nextSize, spriteSheet, referenceTile));
    }
    setCursorIndex(0);
    setSelection(null);
    setCellSize(fitCellSize(nextSize));
    setNotice(`Canvas resized to ${nextSize} × ${nextSize}`);
    captureProjectStructure("canvas", "resize", size, nextSize);
  }

  function addFrame() {
    if (frames.length >= MAX_FRAMES) {
      setNotice(`Frame limit is ${MAX_FRAMES}`);
      return;
    }
    recordProjectHistory();
    setPlaying(false);
    const nextId = Math.max(...frames.map((frame) => frame.id), 0) + 1;
    const insertAt = activeFrame + 1;
    setFrames((current) => [
      ...current.slice(0, insertAt),
      blankFrame(nextId, current[activeFrame]?.durationMs ?? 125),
      ...current.slice(insertAt),
    ]);
    setClips((current) => current.map((clip) => {
      if (clip.id !== activeClipId) return clip;
      const frameIds = [...clip.frameIds];
      const clipPosition = frameIds.indexOf(frames[activeFrame]?.id);
      frameIds.splice(clipPosition >= 0 ? clipPosition + 1 : frameIds.length, 0, nextId);
      return { ...clip, frameIds };
    }));
    setActiveFrame(insertAt);
    setSelection(null);
    captureProjectStructure("frame", "add", frames.length, frames.length + 1);
  }

  function duplicateFrame() {
    if (frames.length >= MAX_FRAMES) {
      setNotice(`Frame limit is ${MAX_FRAMES}`);
      return;
    }
    recordProjectHistory();
    setPlaying(false);
    const nextId = Math.max(...frames.map((frame) => frame.id), 0) + 1;
    const source = frames[activeFrame];
    const duplicate: ArtFrame = {
      id: nextId,
      durationMs: source?.durationMs ?? 125,
      cels: Object.fromEntries(Object.entries(source?.cels ?? {}).map(([layerId, pixels]) => [layerId, [...pixels]])),
      ...(source?.pivot ? { pivot: { ...source.pivot } } : {}),
    };
    setFrames((current) => [
      ...current.slice(0, activeFrame + 1),
      duplicate,
      ...current.slice(activeFrame + 1),
    ]);
    setClips((current) => current.map((clip) => {
      if (!source || !clip.frameIds.includes(source.id)) return clip;
      const frameIds = [...clip.frameIds];
      frameIds.splice(frameIds.indexOf(source.id) + 1, 0, nextId);
      return { ...clip, frameIds };
    }));
    setActiveFrame(activeFrame + 1);
    setSelection(null);
    captureProjectStructure("frame", "duplicate", frames.length, frames.length + 1);
  }

  function deleteFrame() {
    if (frames.length === 1) {
      setNotice("Keep at least one frame");
      return;
    }
    recordProjectHistory();
    setPlaying(false);
    const deletedId = frames[activeFrame].id;
    const fallbackId = frames[activeFrame === 0 ? 1 : activeFrame - 1].id;
    setFrames((current) => current.filter((_, index) => index !== activeFrame));
    setClips((current) => current.map((clip) => {
      const frameIds = clip.frameIds.filter((id) => id !== deletedId);
      return { ...clip, frameIds: frameIds.length ? frameIds : [fallbackId] };
    }));
    setTilemap((current) => ({
      ...current,
      cells: current.cells.map((frameId) => frameId === deletedId ? null : frameId),
    }));
    setActiveFrame((current) => Math.max(0, Math.min(current, frames.length - 2)));
    setSelection(null);
    const clearedTileCells = tilemap.cells.reduce<number>(
      (total, frameId) => total + Number(frameId === deletedId),
      0,
    );
    captureProjectStructure(
      "frame",
      "delete",
      frames.length,
      frames.length - 1,
      { tilemap_placed_cells: Math.max(0, tilemapPlacedCells - clearedTileCells) },
    );
  }

  function moveFrame(direction: -1 | 1) {
    const destination = activeFrame + direction;
    if (destination < 0 || destination >= frames.length) return;
    recordProjectHistory();
    setPlaying(false);
    const reordered = [...frames];
    [reordered[activeFrame], reordered[destination]] = [reordered[destination], reordered[activeFrame]];
    const order = new Map(reordered.map((frame, index) => [frame.id, index]));
    setFrames(reordered);
    setClips((current) => current.map((clip) => ({
      ...clip,
      frameIds: [...clip.frameIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    })));
    setActiveFrame(destination);
    setSelection(null);
    captureProjectStructure("frame", "reorder", activeFrame, destination);
  }

  function clearFrame() {
    if (currentPixels.every((pixel) => pixel === null)) {
      setNotice("Layer cel is already clear");
      return;
    }
    if (!activeLayerIsEditable()) return;
    recordCelHistory();
    updateActivePixels(() => Array(size * size).fill(null));
    setNotice("Active layer cleared in this frame");
    captureCanvasEdit(
      "frame_clear",
      "toolbar",
      currentPixels.reduce((total, pixel) => total + Number(pixel !== null), 0),
    );
    captureProjectStructure("frame", "clear_layer");
  }

  function addLayer() {
    if (layers.length >= MAX_LAYERS) {
      setNotice(`Layer limit is ${MAX_LAYERS}`);
      return;
    }
    recordProjectHistory();
    const id = Math.max(...layers.map((layer) => layer.id), 0) + 1;
    setLayers((current) => [...current, { id, name: `LAYER ${current.length + 1}`, visible: true, locked: false, opacity: 100 }]);
    setActiveLayerId(id);
    setSelection(null);
    captureProjectStructure("layer", "add", layers.length, layers.length + 1);
  }

  function deleteLayer(layerId = activeLayerId) {
    if (layers.length === 1) {
      setNotice("Keep at least one layer");
      return;
    }
    recordProjectHistory();
    const remaining = layers.filter((layer) => layer.id !== layerId);
    setLayers(remaining);
    setFrames((current) => current.map((frame) => {
      const cels = { ...frame.cels };
      delete cels[String(layerId)];
      return { ...frame, cels };
    }));
    if (activeLayerId === layerId) setActiveLayerId(remaining.at(-1)!.id);
    setSelection(null);
    captureProjectStructure("layer", "delete", layers.length, remaining.length);
  }

  function moveLayer(direction: -1 | 1) {
    const index = layers.findIndex((layer) => layer.id === activeLayerId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= layers.length) return;
    recordProjectHistory();
    const reordered = [...layers];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    setLayers(reordered);
    captureProjectStructure("layer", "reorder", index, destination);
  }

  function updateLayer(layerId: number, patch: Partial<Omit<ArtLayer, "id">>) {
    setLayers((current) => current.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer));
  }

  function addClip() {
    if (clips.length >= MAX_CLIPS) {
      setNotice(`Animation clip limit is ${MAX_CLIPS}`);
      return;
    }
    const id = Math.max(...clips.map((clip) => clip.id), 0) + 1;
    const frameId = frames[activeFrame]?.id;
    if (!frameId) return;
    const existingNames = new Set(clips.map((clip) => clip.name.toLowerCase()));
    let sequence = clips.length + 1;
    while (existingNames.has(`animation-${sequence}`)) sequence += 1;
    recordProjectHistory();
    setPlaying(false);
    setClips((current) => [...current, {
      id,
      name: `animation-${sequence}`,
      frameIds: [frameId],
      direction: "forward",
      loop: true,
    }]);
    setActiveClipId(id);
    captureProjectStructure("clip", "add", clips.length, clips.length + 1);
  }

  function activateClip(clipId: number) {
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    setPlaying(false);
    setActiveClipId(clipId);
    setPlaybackCursor(0);
    const firstId = clipPlaybackFrameIds(clip, frames)[0];
    const firstIndex = frames.findIndex((frame) => frame.id === firstId);
    if (firstIndex >= 0) setActiveFrame(firstIndex);
    setSelection(null);
  }

  function deleteClip() {
    if (clips.length === 1) {
      setNotice("Keep at least one animation clip");
      return;
    }
    recordProjectHistory();
    setPlaying(false);
    const remaining = clips.filter((clip) => clip.id !== activeClipId);
    setClips(remaining);
    setActiveClipId(remaining[0].id);
    if (exportClipId === activeClipId) setExportClipId("all");
    captureProjectStructure("clip", "delete", clips.length, remaining.length);
  }

  function updateClip(patch: Partial<Omit<AnimationClip, "id">>) {
    setClips((current) => current.map((clip) => clip.id === activeClipId ? { ...clip, ...patch } : clip));
  }

  function renameActiveClip(value: string) {
    const requested = value.slice(0, 28);
    if (!requested.trim()) {
      setNotice("Animation clip names cannot be blank");
      return;
    }
    const collision = requested.trim() && clips.some((clip) =>
      clip.id !== activeClipId && clip.name.trim().toLowerCase() === requested.trim().toLowerCase());
    if (collision) {
      setNotice("Animation clip names must be unique");
      return;
    }
    updateClip({ name: requested });
  }

  function finishClipRename() {
    if (activeClip?.name.trim()) updateClip({ name: activeClip.name.trim() });
  }

  function setClipRange(fromIndex: number, toIndex: number) {
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return;
    setPlaying(false);
    const from = clamp(Math.min(fromIndex, toIndex), 0, frames.length - 1);
    const to = clamp(Math.max(fromIndex, toIndex), 0, frames.length - 1);
    updateClip({ frameIds: frames.slice(from, to + 1).map((frame) => frame.id) });
    captureProjectStructure("clip", "range_change", activeClip?.frameIds.length ?? 0, to - from + 1);
  }

  function setFrameDuration(durationMs: number) {
    if (!Number.isFinite(durationMs)) return;
    const duration = clamp(Math.round(durationMs), 16, 10_000);
    setFrames((current) => current.map((frame, index) => index === activeFrame ? { ...frame, durationMs: duration } : frame));
  }

  function setActiveFramePivot(nextPivot: Pivot) {
    const safe = { x: clamp(nextPivot.x, 0, size), y: clamp(nextPivot.y, 0, size) };
    setFrames((current) => current.map((frame, index) => index === activeFrame ? { ...frame, pivot: safe } : frame));
  }

  function resizeTilemap(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const nextWidth = clamp(Math.round(width), 1, 64);
    const nextHeight = clamp(Math.round(height), 1, 64);
    setTilemap((current) => {
      if (current.width === nextWidth && current.height === nextHeight) return current;
      const cells = Array<number | null>(nextWidth * nextHeight).fill(null);
      for (let y = 0; y < Math.min(current.height, nextHeight); y += 1) {
        for (let x = 0; x < Math.min(current.width, nextWidth); x += 1) {
          cells[y * nextWidth + x] = current.cells[y * current.width + x] ?? null;
        }
      }
      return { width: nextWidth, height: nextHeight, cells };
    });
  }

  function setTilemapDimension(dimension: "width" | "height", requestedValue: number) {
    const currentValue = dimension === "width" ? tilemap.width : tilemap.height;
    if (!Number.isFinite(requestedValue)) return currentValue;
    const nextValue = clamp(Math.round(requestedValue), 1, 64);
    if (nextValue === currentValue) return currentValue;
    recordProjectHistory();
    const croppedTiles = tilemap.cells.reduce<number>((total, frameId, index) => {
      if (frameId === null) return total;
      const x = index % tilemap.width;
      const y = Math.floor(index / tilemap.width);
      return total + (dimension === "width" ? Number(x >= nextValue) : Number(y >= nextValue));
    }, 0);
    resizeTilemap(
      dimension === "width" ? nextValue : tilemap.width,
      dimension === "height" ? nextValue : tilemap.height,
    );
    const nextWidth = dimension === "width" ? nextValue : tilemap.width;
    const nextHeight = dimension === "height" ? nextValue : tilemap.height;
    captureProjectStructure(
      "tilemap",
      "resize",
      `${tilemap.width}x${tilemap.height}`,
      `${nextWidth}x${nextHeight}`,
      {
        tilemap_width: nextWidth,
        tilemap_height: nextHeight,
        tilemap_placed_cells: Math.max(0, tilemapPlacedCells - croppedTiles),
      },
    );
    if (croppedTiles) setNotice(`${croppedTiles} painted ${croppedTiles === 1 ? "tile" : "tiles"} cropped · Undo restores ${croppedTiles === 1 ? "it" : "them"}`);
    return nextValue;
  }

  function tilemapDimensionDraft(dimension: "width" | "height") {
    const input = dimension === "width" ? tilemapWidthInputRef.current : tilemapHeightInputRef.current;
    const inputValue = input?.valueAsNumber;
    return typeof inputValue === "number" && Number.isFinite(inputValue)
      ? inputValue
      : dimension === "width" ? tilemap.width : tilemap.height;
  }

  function adjustTilemapDimension(dimension: "width" | "height", direction: -1 | 1) {
    const input = dimension === "width" ? tilemapWidthInputRef.current : tilemapHeightInputRef.current;
    const committedValue = setTilemapDimension(dimension, tilemapDimensionDraft(dimension) + direction);
    if (input) input.value = String(committedValue);
  }

  function commitTilemapDimensionDraft(dimension: "width" | "height") {
    const input = dimension === "width" ? tilemapWidthInputRef.current : tilemapHeightInputRef.current;
    if (!input) return;
    input.value = String(setTilemapDimension(dimension, input.valueAsNumber));
  }

  function handleTilemapDimensionKey(event: ReactKeyboardEvent<HTMLButtonElement>, dimension: "width" | "height") {
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    const draftValue = tilemapDimensionDraft(dimension);
    const requestedValue = event.key === "Home" ? 1
      : event.key === "End" ? 64
        : event.key === "PageDown" ? draftValue - 8
          : event.key === "PageUp" ? draftValue + 8
            : event.key === "ArrowLeft" || event.key === "ArrowDown" ? draftValue - 1
              : event.key === "ArrowRight" || event.key === "ArrowUp" ? draftValue + 1
                : null;
    if (requestedValue === null) return;
    event.preventDefault();
    const input = dimension === "width" ? tilemapWidthInputRef.current : tilemapHeightInputRef.current;
    const committedValue = setTilemapDimension(dimension, requestedValue);
    if (input) input.value = String(committedValue);
  }

  function paintTilemapCell(index: number, eraseCell: boolean) {
    const frameId = frames[activeFrame]?.id;
    if (!frameId || index < 0 || index >= tilemap.cells.length) return;
    setTilemap((current) => {
      const value = eraseCell ? null : frameId;
      if (current.cells[index] === value) return current;
      const cells = [...current.cells];
      cells[index] = value;
      return { ...current, cells };
    });
  }

  function clearTilemap() {
    if (tilemap.cells.every((cell) => cell === null)) return;
    recordProjectHistory();
    setTilemap((current) => ({ ...current, cells: Array(current.width * current.height).fill(null) }));
    setNotice("Tilemap cleared");
    captureAnalyticsEvent("tilemap_edit_committed", {
      ...analyticsProjectShape,
      tilemap_placed_cells: 0,
      action: "clear",
      input_method: "toolbar",
      changed_cells: tilemapPlacedCells,
      map_width: tilemap.width,
      map_height: tilemap.height,
      placed_cells: 0,
      tile_types: 0,
    });
  }

  function useProjectPivot() {
    recordProjectHistory();
    setFrames((current) => current.map((frame, index) => {
      if (index !== activeFrame) return frame;
      const withoutPivot = { ...frame };
      delete withoutPivot.pivot;
      return withoutPivot;
    }));
    setNotice("Frame now uses the project pivot");
    captureProjectStructure("pivot", "use_default");
  }

  function makeActivePivotProjectDefault() {
    recordProjectHistory();
    setPivot({ ...activePivot });
    setFrames((current) => current.map((frame, index) => {
      if (index !== activeFrame) return frame;
      const withoutPivot = { ...frame };
      delete withoutPivot.pivot;
      return withoutPivot;
    }));
    setNotice("Project pivot updated from this frame");
    captureProjectStructure("pivot", "set_default");
  }

  function setClipFps(fps: number) {
    if (!Number.isFinite(fps) || fps <= 0) return;
    setPlaying(false);
    const durationMs = Math.round(1000 / Math.max(1, fps));
    const ids = new Set(activeClip?.frameIds ?? []);
    setFrames((current) => current.map((frame) => ids.has(frame.id) ? { ...frame, durationMs } : frame));
    setNotice(`${activeClip?.name ?? "Animation"} set to ${fps} FPS`);
    captureProjectStructure("clip", "timing_change", activeClipFpsPreset, fps);
  }

  function setClipDirection(direction: AnimationDirection) {
    if (!activeClip) return;
    setPlaying(false);
    const updated = { ...activeClip, direction };
    updateClip({ direction });
    setPlaybackCursor(0);
    const firstId = clipPlaybackFrameIds(updated, frames)[0];
    const firstIndex = frames.findIndex((frame) => frame.id === firstId);
    if (firstIndex >= 0) setActiveFrame(firstIndex);
    captureProjectStructure("clip", "direction_change", activeClip.direction, direction);
  }

  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      captureAnalyticsEvent("animation_playback_changed", {
        ...analyticsProjectShape,
        action: "paused",
        clip_frame_count: activeClip?.frameIds.length ?? 0,
        direction: activeClip?.direction ?? "forward",
        loop: activeClip?.loop ?? false,
      });
      return;
    }
    const sequence = clipPlaybackFrameIds(activeClip, frames);
    if (sequence.length < 2) return;
    const currentId = frames[activeFrame]?.id;
    let cursor = sequence[playbackCursor] === currentId ? playbackCursor : 0;
    if (cursor < 0 || (!activeClip?.loop && cursor === sequence.length - 1)) cursor = 0;
    setPlaybackCursor(cursor);
    const startIndex = frames.findIndex((frame) => frame.id === sequence[cursor]);
    if (startIndex >= 0) setActiveFrame(startIndex);
    setSelection(null);
    setPlaying(true);
    captureAnalyticsEvent("animation_playback_changed", {
      ...analyticsProjectShape,
      action: "started",
      clip_frame_count: activeClip?.frameIds.length ?? 0,
      direction: activeClip?.direction ?? "forward",
      loop: activeClip?.loop ?? false,
    });
  }

  function resetReferenceTransform() {
    setReferenceTransform(DEFAULT_REFERENCE_TRANSFORM);
    setReferencePixelFit(false);
    setReferenceTile(0);
    setNotice("Projector image centered");
    captureAnalyticsEvent("reference_action", { ...analyticsProjectShape, action: "center" });
  }

  function handleReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 48 * 1024 * 1024) {
      setNotice("Reference images must be 48 MB or smaller to fit in a portable project");
      captureAnalyticsEvent("reference_load_failed", {
        ...analyticsProjectShape,
        reason: "too_large",
        mime_type: file.type || "unknown",
        file_size_bucket: fileSizeBucket(file.size),
      });
      event.target.value = "";
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mimeByExtension: Record<string, string> = {
      avif: "image/avif",
      bmp: "image/bmp",
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    const mime = file.type.toLowerCase() || mimeByExtension[extension];
    if (!mime || !Object.values(mimeByExtension).includes(mime)) {
      setNotice("Use a PNG, JPEG, GIF, WebP, AVIF, or BMP reference image");
      captureAnalyticsEvent("reference_load_failed", {
        ...analyticsProjectShape,
        reason: "unsupported_type",
        mime_type: file.type || "unknown",
        file_size_bucket: fileSizeBucket(file.size),
      });
      event.target.value = "";
      return;
    }
    setProjectorExpanded(true);
    setReferenceName(file.name || "reference.png");
    setReferenceMime(mime);
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
          startReferenceAdjustment();
          setNotice(sheet
            ? `${sheet.frameCount}-frame ${sheet.frameSize} × ${sheet.frameSize} sheet detected · use its matching grid`
            : `${dimensions.width} × ${dimensions.height} reference loaded`);
        }
        captureAnalyticsEvent("reference_loaded", {
          ...analyticsProjectShape,
          has_reference: true,
          mime_type: mime,
          file_size_bucket: fileSizeBucket(file.size),
          image_width: dimensions.width,
          image_height: dimensions.height,
          sprite_sheet_detected: Boolean(sheet),
          ...(sheet ? {
            sheet_direction: sheet.direction,
            sheet_frame_count: sheet.frameCount,
            sheet_frame_size: sheet.frameSize,
          } : {}),
          pixel_fit_auto: Boolean(sheet && sheet.frameSize === size),
        });
      };
      image.onerror = () => {
        setReference(source);
        setReferenceDimensions(null);
        setReferenceTransform(DEFAULT_REFERENCE_TRANSFORM);
        setReferencePixelFit(false);
        startReferenceAdjustment();
        setNotice("Reference loaded — drag it into position");
        captureAnalyticsEvent("reference_load_failed", {
          ...analyticsProjectShape,
          reason: "decode_error",
          mime_type: mime,
          file_size_bucket: fileSizeBucket(file.size),
        });
      };
      image.src = source;
    };
    reader.onerror = () => {
      setNotice("Reference image could not be read");
      captureAnalyticsEvent("reference_load_failed", {
        ...analyticsProjectShape,
        reason: "read_error",
        mime_type: mime,
        file_size_bucket: fileSizeBucket(file.size),
      });
    };
    reader.readAsDataURL(file.type ? file : file.slice(0, file.size, mime));
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

  function startReferenceAdjustment() {
    setProjectorExpanded(true);
    setAdjustingReference(true);
  }

  function toggleProjectorControls() {
    if (projectorExpanded) {
      stopReferenceAdjustment();
      window.requestAnimationFrame(() => projectorToggleRef.current?.focus());
    }
    setProjectorExpanded((expanded) => !expanded);
  }

  function removeReference() {
    setReference(null);
    setReferenceDimensions(null);
    setReferenceTile(0);
    setReferencePixelFit(false);
    setReferenceName("reference.png");
    setReferenceMime("image/png");
    stopReferenceAdjustment();
    setReferenceTransform(DEFAULT_REFERENCE_TRANSFORM);
    setProjectorExpanded(false);
    window.requestAnimationFrame(() => projectorToggleRef.current?.focus());
    captureAnalyticsEvent("reference_action", {
      ...analyticsProjectShape,
      has_reference: false,
      action: "remove",
    });
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
    captureAnalyticsEvent("reference_action", {
      ...analyticsProjectShape,
      action: "match_pixels",
      ...(sheet ? {
        sheet_direction: sheet.direction,
        sheet_frame_count: sheet.frameCount,
        sheet_frame_size: sheet.frameSize,
      } : {}),
    });
  }

  function useDetectedSpriteGrid() {
    if (!spriteSheet || !GRID_SIZES.includes(spriteSheet.frameSize)) return;
    if (size !== spriteSheet.frameSize) changeSize(spriteSheet.frameSize);
    setCellSize(Math.max(comfortableTraceCellSize(spriteSheet.frameSize), fitCellSize(spriteSheet.frameSize)));
    matchReferencePixels(spriteSheet.frameSize, 0);
    captureAnalyticsEvent("reference_action", {
      ...analyticsProjectShape,
      canvas_size: spriteSheet.frameSize,
      action: "use_detected_grid",
      sheet_direction: spriteSheet.direction,
      sheet_frame_count: spriteSheet.frameCount,
      sheet_frame_size: spriteSheet.frameSize,
    });
  }

  function showReferenceTile(nextTile: number) {
    if (!spriteSheet || !referenceDimensions) return;
    const safeTile = clamp(nextTile, 0, spriteSheet.frameCount - 1);
    setReferenceTile(safeTile);
    setReferenceTransform(pixelMatchedTransform(referenceDimensions, size, spriteSheet, safeTile));
    setReferencePixelFit(true);
    stopReferenceAdjustment();
    setNotice(`Sprite ${safeTile + 1} of ${spriteSheet.frameCount} aligned to the grid`);
    captureAnalyticsEvent("reference_action", {
      ...analyticsProjectShape,
      action: safeTile > referenceTile ? "next_sprite" : "previous_sprite",
      sheet_direction: spriteSheet.direction,
      sheet_frame_count: spriteSheet.frameCount,
      sheet_frame_size: spriteSheet.frameSize,
    });
  }

  async function importDetectedSpriteSheet() {
    if (!reference || !spriteSheet || !GRID_SIZES.includes(spriteSheet.frameSize)) return;
    if (spriteSheet.frameCount > MAX_FRAMES) {
      setNotice(`This sheet has more than the ${MAX_FRAMES}-frame project limit`);
      captureAnalyticsEvent("sprite_sheet_imported", {
        ...analyticsProjectShape,
        outcome: "failure",
        reason: "frame_limit",
        sheet_direction: spriteSheet.direction,
        sheet_frame_count: spriteSheet.frameCount,
        sheet_frame_size: spriteSheet.frameSize,
      });
      return;
    }
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = reject;
        candidate.src = reference;
      });
      const canvas = document.createElement("canvas");
      canvas.width = spriteSheet.frameSize;
      canvas.height = spriteSheet.frameSize;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      context.imageSmoothingEnabled = false;
      let flattenedAlpha = false;
      const importedFrames = Array.from({ length: spriteSheet.frameCount }, (_, index) => {
        const sourceX = spriteSheet.direction === "horizontal" ? index * spriteSheet.frameSize : 0;
        const sourceY = spriteSheet.direction === "vertical" ? index * spriteSheet.frameSize : 0;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          image,
          sourceX,
          sourceY,
          spriteSheet.frameSize,
          spriteSheet.frameSize,
          0,
          0,
          spriteSheet.frameSize,
          spriteSheet.frameSize,
        );
        const converted = imageDataToPixels(context.getImageData(0, 0, canvas.width, canvas.height));
        flattenedAlpha ||= converted.flattenedAlpha;
        return makeFrame(index + 1, converted.pixels, 1, 125);
      });
      recordProjectHistory();
      setPlaying(false);
      setSize(spriteSheet.frameSize);
      setFrames(importedFrames);
      setLayers([{ ...DEFAULT_LAYER, name: "IMPORTED SPRITES" }]);
      setClips([{
        id: 1,
        name: "default",
        frameIds: importedFrames.map((frame) => frame.id),
        direction: "forward",
        loop: true,
      }]);
      setSlices([]);
      setTilemap({ width: 8, height: 8, cells: Array(64).fill(null) });
      setActiveFrame(0);
      setActiveLayerId(1);
      setActiveClipId(1);
      setExportClipId("all");
      setPivot({ x: spriteSheet.frameSize / 2, y: spriteSheet.frameSize });
      setProjectName(referenceName.replace(/\.[^.]+$/, "") || "IMPORTED SPRITES");
      const importedColors = new Set(importedFrames.flatMap((frame) => Object.values(frame.cels).flat()).filter(Boolean) as string[]);
      setPalette((current) => [...new Set([...current, ...importedColors])].slice(0, 64));
      setSelection(null);
      setCellSize(Math.max(comfortableTraceCellSize(spriteSheet.frameSize), fitCellSize(spriteSheet.frameSize)));
      setReferenceTile(0);
      setReferenceTransform(pixelMatchedTransform(
        { width: image.naturalWidth, height: image.naturalHeight },
        spriteSheet.frameSize,
        spriteSheet,
        0,
      ));
      setReferencePixelFit(true);
      setNotice(`${spriteSheet.frameCount} editable frames imported${flattenedAlpha ? " · partial alpha flattened" : ""}`);
      captureAnalyticsEvent("sprite_sheet_imported", {
        ...analyticsProjectShape,
        canvas_size: spriteSheet.frameSize,
        frame_count: importedFrames.length,
        layer_count: 1,
        clip_count: 1,
        slice_count: 0,
        has_reference: true,
        tilemap_width: 8,
        tilemap_height: 8,
        tilemap_placed_cells: 0,
        outcome: "success",
        sheet_direction: spriteSheet.direction,
        sheet_frame_count: spriteSheet.frameCount,
        sheet_frame_size: spriteSheet.frameSize,
        partial_alpha_flattened: flattenedAlpha,
      });
    } catch {
      setNotice("Sprite sheet import failed");
      captureAnalyticsEvent("sprite_sheet_imported", {
        ...analyticsProjectShape,
        outcome: "failure",
        reason: "processing_error",
        sheet_direction: spriteSheet.direction,
        sheet_frame_count: spriteSheet.frameCount,
        sheet_frame_size: spriteSheet.frameSize,
      });
    }
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
      changeReferenceScale(referenceTransform.scale + 1);
      moved = true;
    }
    if (["-", "_", "["].includes(event.key)) {
      changeReferenceScale(referenceTransform.scale - 1);
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

  function saveProjectFile() {
    try {
      const source = stringifyProject(portableProject(), portableEditor(), { includeReference: true, pretty: true });
      downloadBlob(new Blob([source], { type: "application/json" }), `${exportFileStem(projectName, "pixelwall-project")}.pixelwall`);
      setNotice("Portable project ready · reference included");
      captureAnalyticsEvent("project_file_operation", {
        ...analyticsProjectShape,
        operation: "save",
        outcome: "success",
      });
      return true;
    } catch {
      setNotice("Project file could not be created");
      captureAnalyticsEvent("project_file_operation", {
        ...analyticsProjectShape,
        operation: "save",
        outcome: "failure",
        reason: "serialization_error",
      });
      return false;
    }
  }

  function navigateWorkspace(target: GuideTarget) {
    if (target === "export") {
      window.scrollTo({ top: 0, behavior: "instant" });
      setExportMenuOpen(true);
      window.setTimeout(() => exportFirstOptionRef.current?.focus(), 0);
      return;
    }
    if (target === "reference") setProjectorExpanded(true);
    window.requestAnimationFrame(() => {
      const element = document.getElementById(target === "reference" ? "projector-controls" : `workspace-${target}`);
      element?.scrollIntoView({ block: "start", behavior: "instant" });
      element?.focus({ preventScroll: true });
    });
  }

  function startBlankProject(name: string, nextSize: number, backup: boolean) {
    if (backup && !saveProjectFile()) return false;
    const previous = projectSnapshot();
    const blank = createBlankProject({ name, size: nextSize, palette: STARTER_PALETTE }) as { project: PortableProject; editor: PortableEditor };
    loadPortableProject(blank.project, blank.editor, "New project ready · Undo restores your previous project");
    setUndoStack([{ kind: "project", snapshot: previous }]);
    setTool("pencil");
    setShowOnion(false);
    setCursorIndex(0);
    setNewProjectOpen(false);
    navigateWorkspace("draw");
    return true;
  }

  async function openProjectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const loaded = parseProject(await file.text()) as { project: PortableProject; editor: PortableEditor };
      if (!GRID_SIZES.includes(loaded.project.size) || loaded.project.frames.length > MAX_FRAMES || loaded.project.layers.length > MAX_LAYERS) {
        throw new Error("Project exceeds editor limits");
      }
      loadPortableProject(loaded.project, loaded.editor, `${loaded.project.name} opened`);
      const openedTilemap = tilemapCellSummary(loaded.project.tilemap.cells);
      captureAnalyticsEvent("project_file_operation", {
        ...analyticsProjectShape,
        canvas_size: loaded.project.size,
        frame_count: loaded.project.frames.length,
        layer_count: loaded.project.layers.length,
        clip_count: loaded.project.clips.length,
        slice_count: loaded.project.slices.length,
        has_reference: Boolean(loaded.project.projector.reference?.dataUrl),
        tilemap_width: loaded.project.tilemap.width,
        tilemap_height: loaded.project.tilemap.height,
        tilemap_placed_cells: openedTilemap.placedCells,
        operation: "open",
        outcome: "success",
      });
    } catch {
      setNotice("That project file is damaged or unsupported");
      captureAnalyticsEvent("project_file_operation", {
        ...analyticsProjectShape,
        operation: "open",
        outcome: "failure",
        reason: "invalid_or_unsupported",
      });
    }
  }

  function toggleExportMenu() {
    if (exporting) return;
    const nextOpen = !exportMenuOpen;
    setExportMenuOpen(nextOpen);
    if (nextOpen) window.setTimeout(() => exportFirstOptionRef.current?.focus(), 0);
  }

  async function exportCurrentFrame() {
    if (exporting) return;
    const startedAt = performance.now();
    shouldRestoreExportFocus.current = true;
    setExportMenuOpen(false);
    setPlaying(false);
    setExporting("frame");
    setNotice("Exporting current frame…");
    exportTriggerRef.current?.focus();
    const frameNumber = activeFrame + 1;
    const frame = currentFrame ? cloneFrames([currentFrame])[0] : undefined;
    const layerSnapshot = cloneLayers(layers);
    captureAnalyticsEvent("export_started", {
      ...analyticsProjectShape,
      export_type: "frame_png",
      exported_frame_count: 1,
    });
    await yieldForPaint();
    try {
      const blob = await canvasToPngBlob(createFrameCanvas(frame, layerSnapshot, size));
      downloadBlob(blob, `pixelwall-${spriteFrameFilename(activeFrame, frames.length)}`);
      setNotice(`Frame ${frameNumber} ready · ${size} × ${size}px PNG`);
      captureAnalyticsEvent("export_completed", {
        ...analyticsProjectShape,
        export_type: "frame_png",
        exported_frame_count: 1,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch {
      setNotice("PNG export failed — try again");
      captureAnalyticsEvent("export_failed", {
        ...analyticsProjectShape,
        export_type: "frame_png",
        reason: "render_or_download_error",
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } finally {
      setExporting(null);
    }
  }

  async function exportAnimatedGif() {
    if (exporting) return;
    if (!await proAccess.requestAccess()) { setExportMenuOpen(false); return; }
    const startedAt = performance.now();
    const frameSnapshot = cloneFrames(frames);
    const layerSnapshot = cloneLayers(layers);
    const clipSnapshot = activeClip ? { ...activeClip, frameIds: [...activeClip.frameIds] } : undefined;
    const properties = { ...analyticsProjectShape, export_type: "animated_gif", clip_scope: "single" };
    shouldRestoreExportFocus.current = true;
    setExportMenuOpen(false);
    setPlaying(false);
    setExporting("gif");
    setNotice("Preparing animated GIF…");
    exportTriggerRef.current?.focus();
    captureAnalyticsEvent("export_started", properties);
    await yieldForPaint();
    try {
      const { animationExportPlan, encodeAnimationGif } = await import("./animation-export.mjs");
      const plan = animationExportPlan(frameSnapshot, clipSnapshot, size, gifScale);
      const bytes = await encodeAnimationGif(plan, (frame: ArtFrame) => {
        const canvas = createFrameCanvas(frame, layerSnapshot, size);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("The browser could not render the animation");
        return context.getImageData(0, 0, size, size).data;
      }, async (done: number, total: number) => {
        setNotice(`Building GIF · ${done} of ${total} frames`);
        await yieldForPaint();
      });
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      downloadBlob(new Blob([buffer], { type: "image/gif" }), `${exportFileStem(projectName)}-${exportFileStem(clipSnapshot?.name, "animation")}.gif`);
      setNotice(`GIF ready · ${plan.width} × ${plan.height}px · ${plan.sequence.length} frames`);
      captureAnalyticsEvent("export_completed", { ...properties, exported_frame_count: plan.sequence.length, duration_ms: Math.round(performance.now() - startedAt) });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "GIF export failed. Try a smaller scale.");
      captureAnalyticsEvent("export_failed", { ...properties, reason: "render_or_encode_error", duration_ms: Math.round(performance.now() - startedAt) });
    } finally { setExporting(null); }
  }

  async function exportSpritePackage(format: "package" | "sheet" = "package") {
    if (exporting) return;
    if (!await proAccess.requestAccess()) { setExportMenuOpen(false); return; }
    const startedAt = performance.now();
    shouldRestoreExportFocus.current = true;
    setExportMenuOpen(false);
    setPlaying(false);
    setExporting(format);
    setNotice(format === "sheet" ? "Building sprite sheet…" : "Building sprite package…");
    exportTriggerRef.current?.focus();
    const frameSnapshot = cloneFrames(frames);
    const layerSnapshot = cloneLayers(layers);
    const clipSnapshot = cloneClips(clips);
    const shouldTrim = format === "package" && exportTrim;
    const exportProperties = {
      ...analyticsProjectShape,
      export_type: format === "sheet" ? "sprite_sheet_png" : "sprite_package",
      clip_scope: exportClipId === "all" ? "all" : "single",
      layout: exportLayout,
      padding: exportPadding,
      trim: shouldTrim,
      include_individual_frames: format === "package" && exportIndividualFrames,
    };
    captureAnalyticsEvent("export_started", exportProperties);
    await yieldForPaint();
    try {
      const renderedFrames = frameSnapshot.map((frame) => createFrameCanvas(frame, layerSnapshot, size));
      const selectedClip = exportClipId === "all" ? null : clipSnapshot.find((clip) => clip.id === exportClipId)?.name ?? null;
      const plan = createSpriteExportPlan({
        frames: frameSnapshot.map((frame, index) => ({
          id: frame.id,
          durationMs: frame.durationMs,
          ...(shouldTrim ? { trimBounds: opaqueBounds(renderedFrames[index], size) } : {}),
          ...(frame.pivot ? { pivot: { ...frame.pivot, unit: "pixels" } } : {}),
        })),
        size,
        clips: clipSnapshot.map((clip) => ({ ...clip })),
        selectedClip,
        layout: exportLayout === "grid"
          ? { type: "grid", columns: Math.ceil(Math.sqrt(selectedClip
            ? clipSnapshot.find((clip) => clip.name === selectedClip)?.frameIds.length ?? frameSnapshot.length
            : frameSnapshot.length)) }
          : exportLayout,
        defaultPivot: { ...pivot, unit: "pixels" },
        slices: slices.map((slice) => ({
          name: slice.name,
          bounds: { ...slice.bounds },
          pivot: { ...(slice.pivot ?? pivot), unit: "pixels" },
        })),
        padding: exportPadding,
        trim: shouldTrim,
        tilemap: selectedClip === null ? { ...tilemap, cells: [...tilemap.cells] } : undefined,
        basename: projectName,
        app: window.location.origin,
        includeIndividualFrames: format === "package" && exportIndividualFrames,
        maxTextureSize: 16_384,
        maxSheetPixels: 16_777_216,
      });
      const sheet = document.createElement("canvas");
      sheet.width = plan.sheet.width;
      sheet.height = plan.sheet.height;
      const context = sheet.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.imageSmoothingEnabled = false;
      plan.frames.forEach((entry) => {
        context.drawImage(
          renderedFrames[entry.sourceIndex],
          entry.sourceRect.x,
          entry.sourceRect.y,
          entry.sourceRect.w,
          entry.sourceRect.h,
          entry.rect.x,
          entry.rect.y,
          entry.rect.w,
          entry.rect.h,
        );
      });

      if (format === "sheet") {
        downloadBlob(await canvasToPngBlob(sheet), plan.files.sheet);
        setNotice(`Sprite sheet ready · ${plan.sheet.width} × ${plan.sheet.height}px PNG · ${plan.frames.length} frames`);
        captureAnalyticsEvent("export_completed", { ...exportProperties, exported_frame_count: plan.frames.length, duration_ms: Math.round(performance.now() - startedAt) });
        return;
      }

      const [sheetBlob, archiveTools, individualBlobs] = await Promise.all([
        canvasToPngBlob(sheet),
        import("fflate"),
        exportIndividualFrames
          ? Promise.all(plan.frames.map((entry) => canvasToPngBlob(
            renderedFrames[entry.sourceIndex],
          )))
          : Promise.resolve([]),
      ]);
      const archiveFiles: Record<string, Uint8Array> = {
        [plan.files.sheet]: new Uint8Array(await sheetBlob.arrayBuffer()),
        [plan.files.data]: archiveTools.strToU8(JSON.stringify(plan.metadata, null, 2)),
      };
      if (exportIndividualFrames) {
        await Promise.all(individualBlobs.map(async (blob, index) => {
          archiveFiles[plan.frames[index].filename] = new Uint8Array(await blob.arrayBuffer());
        }));
      }
      const archive = archiveTools.zipSync(archiveFiles, { level: 0 });
      const archiveBytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      downloadBlob(
        new Blob([archiveBytes], { type: "application/zip" }),
        plan.files.archive,
      );
      setNotice(`Sprite package ready · ${plan.frames.length} frames + sheet + JSON${exportIndividualFrames ? " + PNGs" : ""}`);
      captureAnalyticsEvent("export_completed", {
        ...exportProperties,
        exported_frame_count: plan.frames.length,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch {
      setNotice(`${format === "sheet" ? "Sprite sheet" : "Sprite package"} export failed — try fewer or smaller frames`);
      captureAnalyticsEvent("export_failed", {
        ...exportProperties,
        reason: "render_or_package_error",
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } finally {
      setExporting(null);
    }
  }

  async function exportTilemapPackage() {
    if (exporting) return;
    if (!tilemapPlacedCells) {
      setNotice("Paint at least one tile in Tilemap Lab before exporting");
      captureAnalyticsEvent("export_blocked", {
        ...analyticsProjectShape,
        export_type: "tilemap_package",
        reason: "empty_tilemap",
        map_width: tilemap.width,
        map_height: tilemap.height,
        placed_cells: 0,
        tile_types: 0,
      });
      return;
    }
    if (!await proAccess.requestAccess()) { setExportMenuOpen(false); return; }
    const startedAt = performance.now();
    shouldRestoreExportFocus.current = true;
    setExportMenuOpen(false);
    setPlaying(false);
    setExporting("tilemap");
    setNotice(`Building ${tilemap.width} × ${tilemap.height} tilemap package…`);
    exportTriggerRef.current?.focus();
    const frameSnapshot = cloneFrames(frames);
    const layerSnapshot = cloneLayers(layers);
    const tilemapSnapshot = { ...tilemap, cells: [...tilemap.cells] };
    const sizeSnapshot = size;
    const projectNameSnapshot = projectName;
    const exportProperties = {
      ...analyticsProjectShape,
      export_type: "tilemap_package",
      map_width: tilemap.width,
      map_height: tilemap.height,
      placed_cells: tilemapPlacedCells,
      tile_types: tilemapTileTypes,
    };
    captureAnalyticsEvent("export_started", exportProperties);
    await yieldForPaint();
    try {
      const plan = createTilemapExportPlan({
        tilemap: tilemapSnapshot,
        frames: frameSnapshot.map((frame) => ({ id: frame.id })),
        tileSize: sizeSnapshot,
        basename: projectNameSnapshot,
        layerName: "Tile Layer 1",
        previewMaxDimension: 2048,
      });
      const renderedTiles = new Map<number, HTMLCanvasElement>();
      plan.tiles.forEach((entry) => {
        renderedTiles.set(
          Number(entry.sourceId),
          createFrameCanvas(frameSnapshot[entry.sourceIndex], layerSnapshot, sizeSnapshot),
        );
      });

      const tileset = document.createElement("canvas");
      tileset.width = plan.sheet.width;
      tileset.height = plan.sheet.height;
      const tilesetContext = tileset.getContext("2d");
      if (!tilesetContext) throw new Error("Canvas unavailable");
      tilesetContext.imageSmoothingEnabled = false;
      plan.tiles.forEach((entry) => {
        const bitmap = renderedTiles.get(Number(entry.sourceId));
        if (!bitmap) throw new Error(`Missing tile ${entry.sourceId}`);
        tilesetContext.drawImage(bitmap, entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h);
      });

      const preview = document.createElement("canvas");
      preview.width = plan.preview.width;
      preview.height = plan.preview.height;
      const previewContext = preview.getContext("2d");
      if (!previewContext) throw new Error("Canvas unavailable");
      previewContext.imageSmoothingEnabled = false;
      tilemapSnapshot.cells.forEach((frameId, index) => {
        if (frameId === null) return;
        const bitmap = renderedTiles.get(frameId);
        if (!bitmap) throw new Error(`Missing tile ${frameId}`);
        const column = index % tilemapSnapshot.width;
        const row = Math.floor(index / tilemapSnapshot.width);
        const left = Math.round((column * plan.preview.width) / tilemapSnapshot.width);
        const right = Math.round(((column + 1) * plan.preview.width) / tilemapSnapshot.width);
        const top = Math.round((row * plan.preview.height) / tilemapSnapshot.height);
        const bottom = Math.round(((row + 1) * plan.preview.height) / tilemapSnapshot.height);
        previewContext.drawImage(bitmap, left, top, right - left, bottom - top);
      });

      const archiveToolsPromise = import("fflate");
      const tilesetBlob = await canvasToPngBlob(tileset);
      const previewBlob = await canvasToPngBlob(preview);
      const archiveTools = await archiveToolsPromise;
      const archiveFiles: Record<string, Uint8Array> = {
        [plan.files.tilesetImage]: new Uint8Array(await tilesetBlob.arrayBuffer()),
        [plan.files.previewImage]: new Uint8Array(await previewBlob.arrayBuffer()),
        [plan.files.map]: archiveTools.strToU8(JSON.stringify(plan.tiled, null, 2)),
        [plan.files.mapping]: archiveTools.strToU8(JSON.stringify(plan.pixelwall, null, 2)),
      };
      const archive = archiveTools.zipSync(archiveFiles, { level: 0 });
      const archiveBytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      downloadBlob(new Blob([archiveBytes], { type: "application/zip" }), plan.files.archive);
      setNotice(`Tilemap package ready · ${tilemapSnapshot.width} × ${tilemapSnapshot.height} · ${tilemapPlacedCells} cells · ${tilemapTileTypes} used tiles`);
      captureAnalyticsEvent("export_completed", {
        ...exportProperties,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch {
      setNotice("Tilemap export failed — check the map and try again");
      captureAnalyticsEvent("export_failed", {
        ...exportProperties,
        reason: "render_or_package_error",
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } finally {
      setExporting(null);
    }
  }

  function dismissGuide(method: "got_it" | "escape") {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "done");
    } catch {
      // The guide can still close when browser storage is unavailable.
    }
    setGuideOpen(false);
    captureAnalyticsEvent("quick_guide_dismissed", {
      ...analyticsProjectShape,
      source: guideSource.current,
      method,
    });
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
  const selectionStyle = selection ? {
    left: `${(selection.x / size) * 100}%`,
    top: `${(selection.y / size) * 100}%`,
    width: `${(selection.width / size) * 100}%`,
    height: `${(selection.height / size) * 100}%`,
  } : undefined;
  const pivotStyle = {
    left: `${(activePivot.x / size) * 100}%`,
    top: `${(activePivot.y / size) * 100}%`,
  };

  return (
    <>
      <main className="studio-shell">
      <h1 className="visually-hidden">PixelWall pixel art editor</h1>
      <header className="topbar">
        <a className="brand" href="/" target="_blank" rel="noopener" aria-label="PixelWall home (opens in a new tab)">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>PIXELWALL</span>
        </a>

        <div className="project-title ph-no-capture" aria-live="polite">
          <span className={`status-dot ${saved ? "" : saveFailed ? "save-failed" : "saving"}`} />
          <input
            className="project-name-input"
            value={projectName}
            maxLength={48}
            onFocus={recordProjectHistory}
            onChange={(event) => setProjectName(event.target.value)}
            aria-label="Project name"
          />
          <span className="saved-label">{!storageReady ? "Loading project…" : saved ? "Autosaved in this browser" : saveFailed ? "Autosave failed" : "Autosaving…"}</span>
          <HelpTip
            id="local-save-tip"
            label="How saving works"
            text="Your edits autosave in this browser. Clearing browser data can remove them. Save Project downloads an editable .pixelwall backup, including your reference image. Export downloads artwork as PNG, GIF, or a game package."
          />
        </div>

        <div className="header-actions">
          <input ref={projectInputRef} hidden type="file" accept=".pixelwall,.json,application/json" onChange={openProjectFile} />
          <button className="icon-button project-file-button" onClick={() => projectInputRef.current?.click()} aria-label="Open PixelWall project" title="Open project"><FolderOpen size={17} /></button>
          <button className="icon-button project-file-button" onClick={saveProjectFile} aria-label="Save portable PixelWall project" title="Save project"><Save size={17} /></button>
          <label className="size-select-wrap">
            <span>CANVAS</span>
            <select value={size} onChange={(event) => changeSize(Number(event.target.value))}>
              {GRID_SIZES.map((option) => <option key={option} value={option}>{option} × {option}</option>)}
            </select>
          </label>
          <button className="icon-button" onClick={undo} disabled={!undoStack.length} aria-label="Undo"><Undo2 size={18} /></button>
          <button className="icon-button" onClick={redo} disabled={!redoStack.length} aria-label="Redo"><Redo2 size={18} /></button>
          <div ref={exportMenuRef} className={`export-menu ${exportMenuOpen ? "open" : ""}`} aria-busy={exporting !== null}>
            <button
              ref={exportTriggerRef}
              className="export-button"
              onClick={toggleExportMenu}
              aria-disabled={exporting !== null}
              aria-label={exporting === "tilemap" ? "Exporting tilemap package" : exporting ? "Exporting artwork" : "Open export options"}
              aria-haspopup="dialog"
              aria-expanded={exportMenuOpen}
              aria-controls="export-options"
            >
              <Download size={17} /><span>{exporting ? "EXPORTING…" : "EXPORT"}</span><ChevronDown className="export-chevron" size={14} />
            </button>
            <div id="export-options" className="export-popover" role="dialog" aria-label="Export artwork" aria-busy={exporting !== null} hidden={!exportMenuOpen}>
              <button ref={exportFirstOptionRef} onClick={exportCurrentFrame} disabled={exporting !== null}>
                <FileImage size={19} />
                <span><strong>CURRENT FRAME</strong><small>PNG · {size} × {size} PX</small></span>
              </button>
              <button onClick={exportAnimatedGif} disabled={exporting !== null}>
                <Play size={19} />
                <span className="ph-no-capture"><strong>ANIMATED GIF <em className="pro-badge">PRO</em></strong><small>{activeClip?.name ?? "Animation"} · {size * gifScale} × {size * gifScale} PX</small></span>
              </button>
              <button onClick={() => exportSpritePackage("sheet")} disabled={exporting !== null}>
                <Grid2X2 size={19} />
                <span><strong>SPRITE SHEET <em className="pro-badge">PRO</em></strong><small>PNG · FULL-SIZE FRAME CELLS</small></span>
              </button>
              <button onClick={() => exportSpritePackage("package")} disabled={exporting !== null}>
                <PackageOpen size={19} />
                <span><strong>SPRITE PACKAGE <em className="pro-badge">PRO</em></strong><small>ZIP · SHEET + JSON{exportIndividualFrames ? " + PNGS" : ""}</small></span>
              </button>
              <button
                onClick={exportTilemapPackage}
                disabled={exporting !== null}
                aria-disabled={!tilemapPlacedCells || exporting !== null}
                aria-label={`Export Tilemap Lab package, ${tilemap.width} by ${tilemap.height} map, Tiled JSON, tileset PNG, and preview PNG. ${tilemapPlacedCells ? `${tilemapPlacedCells} placed cells using ${tilemapTileTypes} tile types.` : "Paint at least one tile to enable."}`}
              >
                <MapIcon size={19} />
                <span>
                  <strong>TILEMAP PACKAGE <em className="pro-badge">PRO</em></strong>
                  <small>ZIP · TILED MAP + TILESET + PREVIEW</small>
                  {!tilemapPlacedCells && <small className="export-disabled-reason">PAINT IN TILEMAP LAB TO ENABLE</small>}
                </span>
              </button>
              <div className="gif-export-settings">
                <label>GIF SIZE<select value={gifScale} onChange={(event) => setGifScale(Number(event.target.value))}>
                  {[1, 2, 4, 8].map((scale) => <option key={scale} value={scale}>{scale}× · {size * scale} × {size * scale} px</option>)}
                </select></label>
                <small>GIF follows the active animation’s timing, direction, and loop setting. Up to 256 colors; transparency is on or off.</small>
              </div>
              <details className="export-settings-group">
                <summary id="sprite-package-settings-title">SPRITE SHEET &amp; PACKAGE SETTINGS</summary>
                <div className="export-settings ph-no-capture" role="group" aria-labelledby="sprite-package-settings-title">
                <label>
                  <span>ANIMATION</span>
                  <select value={exportClipId} onChange={(event) => setExportClipId(event.target.value === "all" ? "all" : Number(event.target.value))}>
                    <option value="all">ALL CLIPS</option>
                    {clips.map((clip) => <option key={clip.id} value={clip.id}>{clip.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>LAYOUT</span>
                  <select value={exportLayout} onChange={(event) => setExportLayout(event.target.value as SheetLayout)}>
                    <option value="horizontal">HORIZONTAL</option>
                    <option value="vertical">VERTICAL</option>
                    <option value="grid">COMPACT GRID</option>
                  </select>
                </label>
                <label className="export-number">
                  <span>PADDING PX</span>
                  <input type="number" min="0" max="64" step="1" value={exportPadding} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) setExportPadding(clamp(Math.round(event.target.valueAsNumber), 0, 64)); }} />
                </label>
                <label className="export-check">
                  <input type="checkbox" checked={exportTrim} onChange={(event) => setExportTrim(event.target.checked)} />
                  <span>TRIM TRANSPARENT EDGES</span>
                </label>
                <label className="export-check">
                  <input type="checkbox" checked={exportIndividualFrames} onChange={(event) => setExportIndividualFrames(event.target.checked)} />
                  <span>INCLUDE INDIVIDUAL PNGS</span>
                </label>
                <small>PIVOT {Math.round(activePivot.x * 10) / 10}, {Math.round(activePivot.y * 10) / 10} · PHASER / PIXI / ASEPRITE JSON</small>
                <small>Trimming and individual PNGs apply to the ZIP. Sheet PNGs keep full canvas cells.</small>
                </div>
              </details>
              <ExportPresets authorize={async () => { const allowed = await proAccess.requestAccess(); if (!allowed) setExportMenuOpen(false); return allowed; }} settings={{ layout: exportLayout, padding: exportPadding, trim: exportTrim, individualFrames: exportIndividualFrames, gifScale }} onApply={(settings) => {
                setExportLayout(settings.layout);
                setExportPadding(settings.padding);
                setExportTrim(settings.trim);
                setExportIndividualFrames(settings.individualFrames);
                setGifScale(settings.gifScale);
              }} />
            </div>
          </div>
        </div>
      </header>

      <nav className="workspace-nav" aria-label="Studio navigation">
        <div className="workspace-links">
          <button type="button" onClick={() => navigateWorkspace("draw")}><Pencil size={16} /> DRAW</button>
          <button type="button" onClick={() => navigateWorkspace("layers")}><Layers size={16} /> LAYERS</button>
          <button type="button" onClick={() => navigateWorkspace("animate")}><Play size={16} /> ANIMATE</button>
          <button type="button" onClick={() => navigateWorkspace("tilemap")}><MapIcon size={16} /> TILEMAP</button>
          <button type="button" onClick={() => navigateWorkspace("reference")}><ImagePlus size={16} /> REFERENCE</button>
        </div>
        <div className="workspace-links">
          <button type="button" className="pro-nav" onClick={proAccess.show}>{proAccess.pro ? "PRO ACTIVE" : "GET PRO"}</button>
          <button type="button" disabled={!storageReady || exporting !== null} onClick={() => setNewProjectOpen(true)}><Plus size={16} /> NEW PROJECT</button>
          <button type="button" onClick={() => { guideSource.current = "toolbar"; setGuideOpen(true); }}><span className="guide-nav-icon" aria-hidden="true">?</span> GUIDE</button>
        </div>
      </nav>

      <section id="workspace-draw" tabIndex={-1} className={`wall-stage ${reference ? "reference-live" : ""} ${projectorExpanded ? "projector-open" : "projector-closed"}`} aria-label="Pixel art canvas mounted in a projector beam">
        <div className="projector-beam" />

        <aside className="tool-rail" aria-label="Drawing tools">
          {([
            ["pencil", Pencil, "Pencil", "P"],
            ["eraser", Eraser, "Eraser", "E"],
            ["fill", PaintBucket, "Fill", "F"],
            ["picker", Pipette, "Sample color", "I"],
            ["select", MousePointer2, "Select and move", "S"],
            ["pivot", Crosshair, "Set export pivot", "O"],
            ["hand", Hand, "Hand — drag to move canvas", "H"],
          ] as const).map(([value, Icon, label, shortcut]) => (
            <button
              key={value}
              className={`tool ${tool === value || value === "picker" && samplingColor ? "active" : ""}`}
              onClick={() => {
                if (value === "picker") void sampleVisibleColor();
                else {
                  setTool(value);
                  stopReferenceAdjustment();
                }
                canvasRef.current?.focus({ preventScroll: true });
              }}
              title={`${label} (${shortcut})`}
              aria-label={`${label} tool`}
              aria-pressed={tool === value || value === "picker" && samplingColor}
            >
              <Icon size={19} />
              <span>{shortcut}</span>
            </button>
          ))}
        </aside>

        <div className="canvas-zone">
          <div className="canvas-toolbar">
            <div className="canvas-color-rack ph-no-capture" role="group" aria-label="Color rack">
              <div className="current-color" style={{ "--swatch": selectedColor } as CSSProperties}>
                <span aria-hidden="true" />
                <code>{selectedColor.toUpperCase()}</code>
              </div>
              <div className="canvas-swatches">
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
                <label className="add-swatch" aria-label="Choose a custom color" title="Choose a custom color">
                  <Plus size={16} />
                  <input type="color" value={selectedColor} onChange={addCustomColor} />
                </label>
              </div>
            </div>

            <div className="canvas-view-bar" role="group" aria-label="Canvas view controls">
              <span className="canvas-bar-label">
                VIEW
                <HelpTip id="canvas-help-tip" label="Canvas help" text="Use + and − to zoom. Select Hand (H) and drag to move around, then Pencil (P) to draw. You can also middle-drag or scroll to move, and Ctrl/⌘ + scroll to zoom at the pointer. Fit (0) shows the whole canvas. Zoom does not change your artwork’s size." />
              </span>
              <button className={showGrid ? "active" : ""} onClick={() => {
                const enabled = !showGrid;
                setShowGrid(enabled);
                captureAnalyticsEvent("feature_toggled", { ...analyticsProjectShape, feature: "grid", enabled, source: "toolbar" });
              }} aria-pressed={showGrid} aria-label="Toggle pixel grid">
                <Grid2X2 size={15} /><span>GRID</span>
              </button>
              <button className={showOnion ? "active" : ""} onClick={() => {
                const enabled = !showOnion;
                setShowOnion(enabled);
                captureAnalyticsEvent("feature_toggled", { ...analyticsProjectShape, feature: "onion_skin", enabled, source: "toolbar" });
              }} aria-pressed={showOnion} aria-label="Toggle onion skin">
                {showOnion ? <Eye size={15} /> : <EyeOff size={15} />}<span>ONION</span>
              </button>
              <div className="view-zoom" aria-label="Canvas zoom">
                <button onClick={() => changeCellSize(-1)} disabled={cellSize === CELL_SIZES[0]} aria-label="Zoom out" title="Zoom out (−)"><Minus size={14} /></button>
                <strong title={`Each artwork pixel is displayed ${cellSize} pixels wide`}>{cellSize}× ZOOM</strong>
                <button onClick={() => changeCellSize(1)} disabled={cellSize === CELL_SIZES.at(-1)} aria-label="Zoom in" title="Zoom in (+)"><Plus size={14} /></button>
              </div>
              <button className="view-fit" onClick={fitView} title="Fit the whole canvas (0)"><LocateFixed size={14} /><span>FIT</span></button>
            </div>
          </div>
          <div ref={viewportRef} className={`canvas-viewport ${tool === "hand" ? "hand-active" : ""} ${panning ? "is-panning" : ""}`} {...panHandlers}>
            <div className="canvas-workspace">
              <div className="frame-rig">
                <span className="frame-screw screw-a" /><span className="frame-screw screw-b" />
                <span className="frame-screw screw-c" /><span className="frame-screw screw-d" />
                <div className="art-surface ph-no-capture" style={surfaceStyle}>
                  <div className="transparent-grid" />
                  {reference && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="projection-image ph-no-capture" src={reference} alt="Projected reference" style={referenceStyle} />
                  )}
                  {showOnion && frames.length > 1 && (
                    <FrameBitmap frame={previousFrame} layers={layers} size={size} className="onion-layer" />
                  )}
                  <canvas
                    ref={canvasRef}
                    className={`pixel-canvas ph-no-capture ${tool === "picker" ? "picker-active" : ""} ${tool === "select" ? "select-active" : ""}`}
                    width={size}
                    height={size}
                    aria-label={`${size} by ${size} pixel editor`}
                    aria-describedby="canvas-keyboard-help canvas-cursor-status"
                    tabIndex={0}
                    onPointerDown={beginStroke}
                    onPointerMove={continueStroke}
                    onPointerUp={endStroke}
                    onPointerCancel={endStroke}
                    onLostPointerCapture={() => { activePointer.current = null; lastPainted.current = null; strokeRecorded.current = false; selectionDrag.current = null; }}
                    onKeyDown={handleCanvasKey}
                  />
                  <span id="canvas-cursor-status" className="visually-hidden" aria-live="polite">
                    Row {Math.floor(cursorIndex / size) + 1}, column {(cursorIndex % size) + 1}. {tool} tool. {currentPixels[cursorIndex] ?? "transparent"}.
                  </span>
                  {showGrid && <div className="grid-overlay" aria-hidden="true" />}
                  <div className="keyboard-cursor" style={keyboardCursorStyle} aria-hidden="true" />
                  {selection && <div className="selection-outline" style={selectionStyle} aria-hidden="true" />}
                  {tool === "pivot" && <div className="pivot-marker" style={pivotStyle} aria-label={`Export pivot at ${activePivot.x}, ${activePivot.y}`}><Crosshair size={15} /></div>}
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
          </div>
          <p id="canvas-keyboard-help" className="canvas-hint">
            {adjustingReference
              ? referencePixelFit ? "PIXEL LOCK ON · DRAG OR ARROWS MOVE ONE CELL · ESC DONE" : "DRAG IMAGE · ARROWS NUDGE · + / − SCALE 1% · ESC DONE"
              : tool === "hand" ? "Hand: Drag or use Arrow Keys to move · P to draw"
                : "Paint: Drag or use Arrow Keys + Space"}
            {!adjustingReference && <span>Zoom: + / − · Move: Hand (H) · Show all: Fit (0)</span>}
          </p>
          {selection && (
            <div className="selection-toolbar" aria-label="Selection actions">
              <button onClick={copySelection}><Copy size={14} /> COPY</button>
              <button onClick={() => pasteSelection()} disabled={!selectionClipboard}><CopyPlus size={14} /> PASTE</button>
              <button onClick={() => flipActiveSelection(true)}><FlipHorizontal size={14} /> FLIP H</button>
              <button onClick={() => flipActiveSelection(false)}><FlipVertical size={14} /> FLIP V</button>
              <button onClick={saveSelectionAsSlice} disabled={slices.length >= MAX_SLICES}><Crosshair size={14} /> SAVE SLICE</button>
              <button onClick={() => clearSelectionPixels()}><Trash2 size={14} /> CLEAR</button>
              <button onClick={() => setSelection(null)}>DONE</button>
            </div>
          )}
          {tileSettings.preview && (
            <div className="seam-preview" aria-label="Three by three seamless tile preview">
              <span>SEAM CHECK · 3 × 3</span>
              <SeamPreviewBitmap frame={currentFrame} layers={layers} size={size} />
            </div>
          )}
        </div>

        <div className={`projection-dock ${projectorExpanded ? "expanded" : "collapsed"}`}>
          <button
            ref={projectorToggleRef}
            type="button"
            className="projector-unit projector-disclosure"
            onClick={toggleProjectorControls}
            aria-label={`${projectorExpanded ? "Collapse" : "Expand"} projector controls`}
            aria-expanded={projectorExpanded}
            aria-controls="projector-controls"
            title={`${projectorExpanded ? "Collapse" : "Open"} projector controls`}
          >
            <span className="lens" aria-hidden="true" /><span className="projector-slot" aria-hidden="true" />
            <ChevronDown className="projector-unit-chevron" size={14} aria-hidden="true" />
          </button>
          <aside className="projection-panel" aria-label="Projection controls">
            <div className="projection-title">
              <span className="panel-label-with-help">
                <span className="panel-kicker">PROJECTOR</span>
                <HelpTip id="projector-help-tip" label="Projector help" text="Load an image to trace or import." />
              </span>
              <span className="projection-summary">
                <span className={`projection-light ${reference ? "live-light" : ""}`} aria-hidden="true" />
                <span>{reference ? "LIVE" : "READY"}</span>
              </span>
            </div>
            <input ref={fileInputRef} hidden type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp" onChange={handleReference} />
            <div id="projector-controls" tabIndex={-1} className="projection-controls" hidden={!projectorExpanded}>
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
                  <span className="projection-action-label">
                    {spriteSheet && GRID_SIZES.includes(spriteSheet.frameSize) && size !== spriteSheet.frameSize
                      ? `USE ${spriteSheet.frameSize} × ${spriteSheet.frameSize} GRID`
                      : "MATCH 1:1 PIXELS"}
                  </span>
                </button>
              )}

              {spriteSheet && GRID_SIZES.includes(spriteSheet.frameSize) && (
                <button className="import-sheet-action" onClick={importDetectedSpriteSheet}>
                  <Layers size={14} /> <span className="projection-action-label">IMPORT {spriteSheet.frameCount} EDITABLE FRAMES</span>
                </button>
              )}

              {reference && (
                <button
                  className="trace-frame-action"
                  onClick={() => {
                    addFrame();
                    setNotice("Blank trace frame added");
                    captureAnalyticsEvent("reference_action", {
                      ...analyticsProjectShape,
                      frame_count: frames.length + 1,
                      action: "add_trace_frame",
                    });
                  }}
                  disabled={frames.length >= MAX_FRAMES}
                  aria-label="Add blank trace frame"
                >
                  <ImagePlus size={14} /> <span className="projection-action-label">ADD TRACE FRAME</span>
                </button>
              )}

              {spriteSheet && size === spriteSheet.frameSize && (
                <div className="sprite-stepper" aria-label="Sprite sheet frame">
                  <button onClick={() => showReferenceTile(referenceTile - 1)} disabled={referenceTile === 0} aria-label="Previous sprite">‹</button>
                  <strong>SPRITE {referenceTile + 1}/{spriteSheet.frameCount}</strong>
                  <button onClick={() => showReferenceTile(referenceTile + 1)} disabled={referenceTile === spriteSheet.frameCount - 1} aria-label="Next sprite">›</button>
                </div>
              )}

              <label className={`projection-slider ${reference ? "" : "disabled"}`}>
                <span>OPACITY</span><strong>{referenceOpacity}%</strong>
                <input type="range" min="0" max="100" value={referenceOpacity} onChange={(event) => setReferenceOpacity(Number(event.target.value))} disabled={!reference} />
              </label>
              <div className={`projection-slider ${reference ? "" : "disabled"}`}>
                <span>IMAGE SCALE</span><strong>{Math.round(referenceTransform.scale * 100) / 100}%</strong>
                <input
                  type="range"
                  aria-label="Image scale slider"
                  min={REFERENCE_SCALE_MIN}
                  max={referenceScaleMax}
                  step="1"
                  value={referenceTransform.scale}
                  onChange={(event) => changeReferenceScale(Number(event.target.value))}
                  disabled={!reference}
                />
                <div className="scale-stepper">
                  <button
                    type="button"
                    onClick={() => changeReferenceScale(referenceTransform.scale - 1)}
                    disabled={!reference || referenceTransform.scale <= REFERENCE_SCALE_MIN}
                    aria-label="Decrease image scale by 1 percent"
                    title="Decrease image scale by 1%"
                  >
                    <Minus size={14} />
                  </button>
                  <label className="scale-value-input">
                    <span className="visually-hidden">Image scale percent</span>
                    <input
                      type="number"
                      min={REFERENCE_SCALE_MIN}
                      max={referenceScaleMax}
                      step="any"
                      value={Math.round(referenceTransform.scale * 100) / 100}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => {
                        const nextScale = event.currentTarget.valueAsNumber;
                        if (Number.isFinite(nextScale)) changeReferenceScale(nextScale);
                      }}
                      disabled={!reference}
                      aria-label="Image scale percent"
                    />
                    <span aria-hidden="true">%</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => changeReferenceScale(referenceTransform.scale + 1)}
                    disabled={!reference || referenceTransform.scale >= referenceScaleMax}
                    aria-label="Increase image scale by 1 percent"
                    title="Increase image scale by 1%"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <button
                className={`project-toggle move-toggle ${adjustingReference ? "active" : ""}`}
                onClick={() => {
                  if (!reference) return;
                  if (adjustingReference) stopReferenceAdjustment();
                  else startReferenceAdjustment();
                }}
                disabled={!reference}
                aria-pressed={adjustingReference}
              >
                <Move size={15} /> MOVE IMAGE <span>{adjustingReference ? "DONE" : "ADJUST"}</span>
              </button>
              {reference && (
                <div
                  className="position-readout"
                  aria-live="polite"
                  aria-label={`Reference position. ${referencePixelFit ? "Pixel lock on. " : ""}X ${Math.round(referenceTransform.x)}, Y ${Math.round(referenceTransform.y)}.`}
                >
                  X {Math.round(referenceTransform.x)} · Y {Math.round(referenceTransform.y)}
                </div>
              )}
              {reference && (
                <div className="reference-actions">
                  <button onClick={resetReferenceTransform}><LocateFixed size={13} /> CENTER</button>
                  <button onClick={removeReference}>REMOVE</button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      <section className="control-deck">
        <div id="workspace-layers" tabIndex={-1} className="layers-panel">
          <div className="layers-heading">
            <span className="panel-label-with-help">
              <span className="panel-kicker">LAYERS <b>{String(layers.length).padStart(2, "0")}</b></span>
              <HelpTip id="layers-help-tip" label="Layers help" text="Top covers bottom. Eye hides. Lock protects." />
            </span>
            <div className="layer-actions">
              <button onClick={() => moveLayer(1)} disabled={layers.at(-1)?.id === activeLayerId} aria-label="Move layer up">↑</button>
              <button onClick={() => moveLayer(-1)} disabled={layers[0]?.id === activeLayerId} aria-label="Move layer down">↓</button>
              <button onClick={addLayer} disabled={layers.length >= MAX_LAYERS} aria-label="Add layer"><Plus size={14} /></button>
              <button onClick={clearFrame} aria-label="Clear active layer" title="Clear active layer"><RotateCcw size={14} /></button>
              <button onClick={() => deleteLayer()} disabled={layers.length === 1} aria-label="Delete active layer"><Trash2 size={14} /></button>
            </div>
          </div>
          <div className="layer-list ph-no-capture" aria-label="Artwork layers">
            {[...layers].reverse().map((layer) => (
              <div
                key={layer.id}
                className={`layer-row ${layer.id === activeLayerId ? "active" : ""}`}
                onPointerDown={() => { setActiveLayerId(layer.id); setSelection(null); }}
                onFocusCapture={() => { setActiveLayerId(layer.id); setSelection(null); }}
              >
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    recordProjectHistory();
                    updateLayer(layer.id, { visible: !layer.visible });
                    captureProjectStructure("layer", "visibility_toggle", layer.visible ? 1 : 0, layer.visible ? 0 : 1);
                  }}
                  aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <input
                  value={layer.name}
                  maxLength={24}
                  onClick={(event) => event.stopPropagation()}
                  onFocus={recordProjectHistory}
                  onChange={(event) => updateLayer(layer.id, { name: event.target.value })}
                  aria-label={`Layer name ${layer.name}`}
                />
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    recordProjectHistory();
                    updateLayer(layer.id, { locked: !layer.locked });
                    captureProjectStructure("layer", "lock_toggle", layer.locked ? 1 : 0, layer.locked ? 0 : 1);
                  }}
                  aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
                >
                  {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
              </div>
            ))}
          </div>
          <label className="layer-opacity">
            <span>ACTIVE OPACITY</span><strong>{Math.round(activeLayer?.opacity ?? 100)}%</strong>
            <input
              type="range"
              min="0"
              max="100"
              value={activeLayer?.opacity ?? 100}
              onFocus={recordProjectHistory}
              onChange={(event) => updateLayer(activeLayerId, { opacity: Number(event.target.value) })}
            />
          </label>
          <div className="production-tools">
            <button
              className={tileSettings.preview ? "active" : ""}
              onClick={() => {
                recordProjectHistory();
                const enabled = !tileSettings.preview;
                setTileSettings((current) => ({ ...current, preview: enabled }));
                captureAnalyticsEvent("feature_toggled", { ...analyticsProjectShape, feature: "seam_preview", enabled, source: "toolbar" });
              }}
              aria-pressed={tileSettings.preview}
            ><Grid2X2 size={14} /> SEAM CHECK</button>
            <button
              className={tileSettings.linkEdges ? "active" : ""}
              onClick={() => {
                recordProjectHistory();
                const enabled = !tileSettings.linkEdges;
                setTileSettings((current) => ({ ...current, linkEdges: enabled }));
                captureAnalyticsEvent("feature_toggled", { ...analyticsProjectShape, feature: "linked_edges", enabled, source: "toolbar" });
              }}
              aria-pressed={tileSettings.linkEdges}
            ><Repeat2 size={14} /> LINK EDGES</button>
          </div>
          <div className="slice-list ph-no-capture" aria-label="Named export slices">
            <span>NAMED SLICES <b>{slices.length}</b></span>
            {slices.length === 0 ? <small>SELECT AN AREA, THEN SAVE SLICE</small> : slices.map((slice) => (
              <div key={slice.id}>
                <input value={slice.name} maxLength={28} onFocus={recordProjectHistory} onChange={(event) => renameSlice(slice.id, event.target.value)} aria-label={`Slice name ${slice.name}`} />
                <code>{slice.bounds.width}×{slice.bounds.height}</code>
                <button onClick={() => deleteSlice(slice.id)} aria-label={`Delete slice ${slice.name}`}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <div className="pivot-controls" aria-label="Export pivot coordinates">
            <span><Crosshair size={13} /> {currentFrame?.pivot ? "FRAME PIVOT" : "PROJECT PIVOT"}</span>
            <label>X <input type="number" min="0" max={size} step="0.5" value={activePivot.x} onFocus={recordProjectHistory} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) setActiveFramePivot({ ...activePivot, x: event.target.valueAsNumber }); }} /></label>
            <label>Y <input type="number" min="0" max={size} step="0.5" value={activePivot.y} onFocus={recordProjectHistory} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) setActiveFramePivot({ ...activePivot, y: event.target.valueAsNumber }); }} /></label>
            <button onClick={() => {
              recordProjectHistory();
              setActiveFramePivot({ x: size / 2, y: size });
              captureProjectStructure("pivot", "bottom_center");
            }}>BOTTOM CENTER</button>
            <button onClick={makeActivePivotProjectDefault}>MAKE DEFAULT</button>
            {currentFrame?.pivot && <button onClick={useProjectPivot}>USE DEFAULT</button>}
          </div>
          <div className="mobile-project-actions">
            <button onClick={() => projectInputRef.current?.click()}><FolderOpen size={15} /> OPEN PROJECT</button>
            <button onClick={saveProjectFile}><Save size={15} /> SAVE PROJECT</button>
          </div>
        </div>

        <div id="workspace-animate" tabIndex={-1} className="frames-panel">
          <div className="frames-heading">
            <span className="panel-label-with-help">
              <span className="panel-kicker">FRAMES <b>{String(frames.length).padStart(2, "0")}</b></span>
              <HelpTip id="frames-help-tip" label="Frames help" text="One picture each. Set time. Press play." />
            </span>
            <div className="frame-settings">
              <label>DURATION <input type="number" min="16" max="10000" step="1" value={currentFrame?.durationMs ?? 125} onFocus={recordProjectHistory} onChange={(event) => setFrameDuration(event.target.valueAsNumber)} /><span>MS</span></label>
              <button onClick={() => moveFrame(-1)} disabled={activeFrame === 0} aria-label="Move frame left" title="Move frame left"><ChevronLeft size={16} /></button>
              <button onClick={() => moveFrame(1)} disabled={activeFrame === frames.length - 1} aria-label="Move frame right" title="Move frame right"><ChevronRight size={16} /></button>
              <button onClick={duplicateFrame} aria-label="Duplicate active frame" title="Duplicate frame"><CopyPlus size={16} /></button>
              <button onClick={deleteFrame} aria-label="Delete active frame" title="Delete frame"><Trash2 size={16} /></button>
            </div>
          </div>
          <div className="animation-bar ph-no-capture" aria-label="Animation clip controls">
            <label>CLIP
              <select value={activeClipId} onChange={(event) => activateClip(Number(event.target.value))}>
                {clips.map((clip) => <option key={clip.id} value={clip.id}>{clip.name}</option>)}
              </select>
            </label>
            <label>NAME <input value={activeClip?.name ?? ""} maxLength={28} onFocus={recordProjectHistory} onChange={(event) => renameActiveClip(event.target.value)} onBlur={finishClipRename} /></label>
            <label>FROM <input type="number" min="1" max={frames.length} value={clipFrom + 1} onFocus={recordProjectHistory} onChange={(event) => setClipRange(event.target.valueAsNumber - 1, clipTo)} /></label>
            <label>TO <input type="number" min="1" max={frames.length} value={clipTo + 1} onFocus={recordProjectHistory} onChange={(event) => setClipRange(clipFrom, event.target.valueAsNumber - 1)} /></label>
            <label>PLAY
              <select value={activeClip?.direction ?? "forward"} onFocus={recordProjectHistory} onChange={(event) => setClipDirection(event.target.value as AnimationDirection)}>
                <option value="forward">FORWARD</option>
                <option value="reverse">REVERSE</option>
                <option value="pingpong">PING-PONG</option>
                <option value="pingpong_reverse">PING-PONG REV</option>
              </select>
            </label>
            <label>FPS
              <select value={activeClipFpsPreset} onFocus={recordProjectHistory} onChange={(event) => setClipFps(Number(event.target.value))}>
                <option value="mixed" disabled>MIXED</option>
                <option>4</option><option>6</option><option>8</option><option>10</option><option>12</option><option>24</option>
              </select>
            </label>
            <button className={activeClip?.loop ? "active" : ""} onClick={() => {
              recordProjectHistory();
              const enabled = !activeClip?.loop;
              updateClip({ loop: enabled });
              captureProjectStructure("clip", "loop_toggle", activeClip?.loop ? 1 : 0, enabled ? 1 : 0);
            }} aria-pressed={activeClip?.loop}>LOOP</button>
            <button onClick={addClip} disabled={clips.length >= MAX_CLIPS} aria-label="Add animation clip"><Plus size={14} /></button>
            <button onClick={deleteClip} disabled={clips.length === 1} aria-label="Delete animation clip"><Trash2 size={14} /></button>
          </div>
          <div className="timeline">
            <button className={`play-button ${playing ? "playing" : ""}`} disabled={!playing && (activeClip?.frameIds.length ?? 0) < 2} onClick={togglePlayback} aria-label={playing ? "Pause animation" : "Play animation"}>
              {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
            </button>
            {frames.map((frame, index) => (
              <button
                key={frame.id}
                className={`frame-card ${index === activeFrame ? "active" : ""} ${activeClip?.frameIds.includes(frame.id) ? "in-clip" : "out-of-clip"}`}
                onClick={() => {
                  setPlaying(false);
                  setActiveFrame(index);
                  setPlaybackCursor(Math.max(0, clipPlaybackFrameIds(activeClip, frames).indexOf(frame.id)));
                  setSelection(null);
                }}
                aria-label={`Select frame ${index + 1}`}
                aria-pressed={index === activeFrame}
              >
                <FrameThumbnail frame={frame} layers={layers} size={size} />
                <span>{String(index + 1).padStart(2, "0")}</span>
                <small>{frame.durationMs}ms</small>
              </button>
            ))}
            <button className="new-frame" onClick={addFrame} aria-label="Add a blank frame"><ImagePlus size={20} /><span>NEW FRAME</span></button>
          </div>
        </div>

        <div id="workspace-tilemap" tabIndex={-1} className="tilemap-panel">
          <div className="tilemap-heading">
            <span className="panel-label-with-help">
              <span className="panel-kicker">TILEMAP LAB</span>
              <HelpTip id="tilemap-help-tip" label="Tilemap Lab help" text="Pick a frame. Paint with it." />
            </span>
            <small>ACTIVE TILE · FRAME {activeFrame + 1}</small>
          </div>
          <div className="tilemap-controls">
            <div className="tilemap-dimension" role="group" aria-labelledby="tilemap-width-label">
              <span id="tilemap-width-label">WIDTH</span>
              <div className="tilemap-stepper" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commitTilemapDimensionDraft("width"); }}>
                <button type="button" onClick={() => adjustTilemapDimension("width", -1)} onKeyDown={(event) => handleTilemapDimensionKey(event, "width")} aria-label="Decrease tilemap width"><Minus size={16} /></button>
                <input
                  ref={tilemapWidthInputRef}
                  key={`tilemap-width-${tilemap.width}`}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="64"
                  defaultValue={tilemap.width}
                  aria-label="Tilemap width"
                  aria-live="polite"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.currentTarget.value = String(tilemap.width);
                      event.currentTarget.blur();
                    }
                  }}
                />
                <button type="button" onClick={() => adjustTilemapDimension("width", 1)} onKeyDown={(event) => handleTilemapDimensionKey(event, "width")} aria-label="Increase tilemap width"><Plus size={16} /></button>
              </div>
            </div>
            <div className="tilemap-dimension" role="group" aria-labelledby="tilemap-height-label">
              <span id="tilemap-height-label">HEIGHT</span>
              <div className="tilemap-stepper" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commitTilemapDimensionDraft("height"); }}>
                <button type="button" onClick={() => adjustTilemapDimension("height", -1)} onKeyDown={(event) => handleTilemapDimensionKey(event, "height")} aria-label="Decrease tilemap height"><Minus size={16} /></button>
                <input
                  ref={tilemapHeightInputRef}
                  key={`tilemap-height-${tilemap.height}`}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="64"
                  defaultValue={tilemap.height}
                  aria-label="Tilemap height"
                  aria-live="polite"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.currentTarget.value = String(tilemap.height);
                      event.currentTarget.blur();
                    }
                  }}
                />
                <button type="button" onClick={() => adjustTilemapDimension("height", 1)} onKeyDown={(event) => handleTilemapDimensionKey(event, "height")} aria-label="Increase tilemap height"><Plus size={16} /></button>
              </div>
            </div>
            <button type="button" className={!tilemapErase ? "active" : ""} onClick={() => setTilemapErase(false)} aria-pressed={!tilemapErase}><Pencil size={16} /> PAINT</button>
            <button type="button" className={tilemapErase ? "active" : ""} onClick={() => setTilemapErase(true)} aria-pressed={tilemapErase}><Eraser size={16} /> ERASE</button>
            <button type="button" className="tilemap-clear" onClick={clearTilemap}><Trash2 size={16} /> CLEAR MAP</button>
          </div>
          <div className="tilemap-workspace">
            <div className="tilemap-scroll">
              <TilemapBitmap
                tilemap={tilemap}
                frames={frames}
                layers={layers}
                size={size}
                activeFrameId={frames[activeFrame]?.id ?? frames[0].id}
                erase={tilemapErase}
                onStrokeStart={recordProjectHistory}
                onPaint={paintTilemapCell}
                onStrokeEnd={(action, inputMethod, changedCells, placedCells, tileTypes) => {
                  captureAnalyticsEvent("tilemap_edit_committed", {
                    ...analyticsProjectShape,
                    tilemap_placed_cells: placedCells,
                    action,
                    input_method: inputMethod,
                    changed_cells: changedCells,
                    map_width: tilemap.width,
                    map_height: tilemap.height,
                    placed_cells: placedCells,
                    tile_types: tileTypes,
                  });
                }}
              />
            </div>
            <p>Choose a frame above, then paint a level. Right-click erases.</p>
          </div>
        </div>
      </section>

        <DownloadReady file={readyFile} onDismiss={dismissDownload} />
        {notice && <div className="toast ph-no-capture" role="status">{notice}</div>}
      </main>
      <footer className="studio-footer">
        <span>© 2026 CapLock</span>
        <a href="/guides/getting-started" target="_blank" rel="noopener">GUIDES<span className="visually-hidden"> (opens in a new tab)</span></a>
        <a href="/pricing" target="_blank" rel="noopener">PRICING<span className="visually-hidden"> (opens in a new tab)</span></a>
        <a href="/privacy" target="_blank" rel="noopener">PRIVACY<span className="visually-hidden"> (opens in a new tab)</span></a>
        <a href="mailto:contact@caplock.ai">contact@caplock.ai</a>
        <button type="button" onClick={() => { guideSource.current = "footer"; setGuideOpen(true); }}>QUICK GUIDE</button>
      </footer>
      <ProDialog access={proAccess} beforeCheckout={() => {
        try {
          if (!storageReady) throw new Error("Project still loading");
          // Flush the latest artwork and reference immediately before leaving.
          window.localStorage.setItem(STORAGE_KEY, stringifyProject(portableProject(), portableEditor(), { includeReference: true }));
        } catch {
          const error = new Error("Your project could not be saved before checkout. Use Save Project to make a backup, then free some browser storage and try again. You haven’t been charged.");
          error.name = "ProjectSaveError";
          throw error;
        }
      }} />
      <AnalyticsConsent onInitialPromptClosed={() => {
        try {
          if (window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "done") return;
        } catch {
          // The guide remains available when browser storage is unavailable.
        }
        guideSource.current = "automatic";
        setGuideOpen(true);
      }} />
      <OnboardingGuide open={guideOpen} onDismiss={dismissGuide} onExplore={(target) => { dismissGuide("got_it"); window.setTimeout(() => navigateWorkspace(target), 0); }} />
      <NewProjectDialog open={newProjectOpen} sizes={GRID_SIZES} onClose={() => setNewProjectOpen(false)} onCreate={startBlankProject} />
    </>
  );
}
