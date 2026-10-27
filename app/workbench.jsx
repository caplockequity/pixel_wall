"use client";
/* eslint react/prop-types: "off", @next/next/no-img-element: "off" -- Editor documents are validated at the engine boundary; local PNG previews use data URLs. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocument,
  normalizeDocument,
  migrateLegacy,
  applyCommand,
  renderFrame,
  getCel,
  getFramePalette,
  getTile,
  pixelRGBA,
  describeDocument,
  buildSelection,
  COMMANDS,
  LIMITS,
} from "./editor-core.mjs";
import {
  readAseprite,
  writeAseprite,
  readPng,
  writePng,
  importGif,
  importSheet,
  packAtlas,
  readBmp,
  readTga,
  writeBmp,
  writeTga,
  makeGamePackage,
} from "./formats.mjs";
import { parseProject, encodeProjectContainer, decodeProjectContainer } from "./project-format.mjs";
import { openStore } from "./storage.mjs";
import { createHistory, historyValuesEqual } from "./history.mjs";
import { createDocumentHistoryCache } from "./history-cache.mjs";
import { editorUiContext } from "./editor-ui-context.mjs";
import { listExternalTilesets, resolveExternalTileset } from "./external-tilesets.mjs";
import { createAutomation, registerAutomation } from "./editor-automation.mjs";
import { captureCommands, preflightCommands, throwIfCancelled } from "./command-preflight.mjs";
import { renderPreview, renderPreviewContactSheet, renderPreviewComparison } from "./preview-render.mjs";
import SceneComponentsPanel from "./scene-components-panel.jsx";
import PreviewPanel from "./PreviewPanel.jsx";
import AnimationReviewPanel from "./AnimationReviewPanel.jsx";
import ArtifactLibrary from "./ArtifactLibrary.jsx";
import { validateExtension, parsePalette } from "./editor-extensions.mjs";
import { useProAccess, ProDialog } from "./pro-access";
import { useDownload, DownloadReady } from "./use-download";
import { encodeGif } from "./formats.mjs";
import TilePixelEditor from "./tile-pixel-editor";
import { registerOffline } from "./offline-client.mjs";
import { sameFrameRender } from "./frame-render-equality.mjs";
import SheetImportPreview from "./sheet-import-preview.jsx";
import { captureAnalyticsEvent, captureAnonymousCreation, captureAnonymousExportOutcome, captureAnonymousAutomationEdit, captureAnonymousAutomationOperation, getAnalyticsConsentStatus, isAnonymousTrafficEnabled, ANALYTICS_CONSENT_CHANGED_EVENT } from "./analytics";
import { createWorkbenchAnalytics, analyticsFormat } from "./workbench-analytics.mjs";
import { encodeClipboardImage, decodeClipboardImage } from "./native-clipboard-payload.mjs";
import { renderScaledExportFrame } from "./export-render.mjs";
import { validateExportScale, scaleExportSlices } from "./export-scale.mjs";
import { createDocumentPlayback, exportFrameTraversal } from "./frame-traversal.mjs";
import { diagnoseAnimation, compareAnimationWrap } from "./animation-review.mjs";
import { transferPixelColors } from "./color-transfer.mjs";
import { documentProfile, isSRGB } from "./color-management.mjs";
import { loadBrowserColorManager } from "./color-runtime.mjs";
import { runLuaScript } from "./lua-runner-browser.mjs";
import LuaDialogView, { useLuaDialog } from "./lua-dialog-view.jsx";
import LuaCommandView from "./lua-command-view.jsx";
import { assertPackageRunCurrent, capturePackageRun, packageRunSettings } from "./aseprite-package-session.mjs";
import { createNativeDocumentSession } from "./native-document-session.mjs";
import { createAsepriteExtensionRegistry } from "./aseprite-extensions.mjs";
import { isoProject, snapIso } from "./isometric.mjs";
import { isometricFaces } from "./isometric-shapes.mjs";
import { generateWaterScene } from "./water-generator.mjs";
import AsepritePackagesPanel from "./aseprite-packages-panel.jsx";
import {
  Pencil,
  Eraser,
  PaintBucket,
  Pipette,
  Move,
  Square,
  RectangleEllipsis,
  Circle,
  MousePointer2,
  Hand,
  Undo2,
  Redo2,
  Plus,
  Play,
  Pause,
  Save,
  FolderOpen,
  Download,
  Settings,
  Code2,
  Layers,
  Palette,
  Sparkles,
  Grid2X2,
  Type,
  FlipHorizontal,
  FlipVertical,
  Link2,
  Unlink,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronLeft,
  ChevronRight,
  X,
  ChevronUp,
  ChevronDown,
  Search,
  Scissors,
} from "lucide-react";

const TOOLS = [
  ["pencil", "Pencil", Pencil, "b"],
  ["eraser", "Eraser", Eraser, "e"],
  ["fill", "Fill", PaintBucket, "f"],
  ["picker", "Sample color", Pipette, "i"],
  ["line", "Line", Move, "l"],
  ["curve", "Curve", Move, "c"],
  ["rect", "Rectangle", Square, "u"],
  ["ellipse", "Ellipse", Circle, "o"],
  ["polygon", "Polygon", MousePointer2, "p"],
  ["gradient", "Gradient", Palette, "g"],
  ["text", "Text", Type, "t"],
  ["select", "Rectangular selection", RectangleEllipsis, "m"],
  ["ellipseSelect", "Ellipse selection", Circle, ""],
  ["lasso", "Lasso selection", Scissors, "q"],
  ["polygonSelect", "Polygon selection", MousePointer2, ""],
  ["wand", "Magic wand", Sparkles, "w"],
  ["hand", "Pan", Hand, "h"],
  ["tile", "Paint tiles", Grid2X2, ""],
  ["tilePixels", "Edit tile pixels", Pencil, ""],
];
const BLENDS = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "addition",
  "subtract",
  "divide",
];
const PAID_FORMATS = new Set(["gif", "sheet", "zip"]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const stem = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "pixelwall";
const hex = (p) =>
  "#" +
  Array.from(p)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
const deferred = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));
function bounds(mask, w) {
  let x = w,
    y = Infinity,
    r = -1,
    b = -1;
  mask?.forEach((v, i) => {
    if (v) {
      x = Math.min(x, i % w);
      y = Math.min(y, Math.floor(i / w));
      r = Math.max(r, i % w);
      b = Math.max(b, Math.floor(i / w));
    }
  });
  return r < 0 ? null : { x, y, width: r - x + 1, height: b - y + 1 };
}
function hasUncheckpointedWork(current, revision, mode, checkpoint, retained, savedDocuments) {
  const protectedDocument = (document, documentRevision, documentMode, receipt) =>
    !document ||
    (documentMode === "library" && historyValuesEqual(savedDocuments.get(document.id), document)) ||
    (receipt?.status === "verified" && receipt.documentId === document.id && receipt.revision === documentRevision);
  if (!protectedDocument(current, revision, mode, checkpoint)) return true;
  for (const entry of retained.values()) if (!protectedDocument(entry.document, entry.revision, entry.mode ?? "temporary", entry.checkpoint)) return true;
  return false;
}
function rgbaImage(rgba, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").putImageData(
    new ImageData(new Uint8ClampedArray(rgba), w, h),
    0,
    0,
  );
  return c;
}
const FIELD_HELP = {
  "Opacity": "Control how transparent the selected layer is",
  "Blend": "Choose how this layer mixes with the layers below it",
  "Group": "Place this layer inside a layer group",
  "Cel X": "Horizontal position of this layer’s artwork in the current frame",
  "Cel Y": "Vertical position of this layer’s artwork in the current frame",
  "Size": "Set the drawing tool’s size in pixels",
  "Layer name": "Rename the selected layer",
  "Stroke stabilization": "Smooth pointer movement while drawing",
};
function Field({ label, children, ...props }) {
  return (
    <label className="wb-field" title={FIELD_HELP[label] || label} {...props}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button title={label} aria-label={label} {...props}>
      <Icon size={17} />
    </button>
  );
}
function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`wb-dialog ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <h2>{title}</h2>
        <button title={`Close ${title}`} aria-label={`Close ${title}`} onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
function WaterPreview({ options, onValidityChange }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(true);
  const [repeat, setRepeat] = useState(1);
  const generated = useMemo(() => {
    try { return { scene: generateWaterScene(options), error: null }; }
    catch (error) { return { scene: null, error }; }
  }, [options]);
  const scene = generated.scene;
  useEffect(() => { onValidityChange?.(!generated.error && !!scene); }, [generated.error, scene, onValidityChange]);
  const renderedFrames = useMemo(() => scene ? scene.frames.map(frame => rgbaImage(renderFrame(scene, frame.id), scene.width, scene.height)) : [], [scene]);
  useEffect(() => {
    let index = 0, elapsed = 0, last = performance.now(), raf;
    const draw = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!scene) return;
      const now = performance.now();
      if (playing) { elapsed += now - last; if (elapsed >= (scene.frames[index]?.durationMs || 125)) { elapsed = 0; index = (index + 1) % scene.frames.length; } }
      last = now;
      ctx.imageSmoothingEnabled = false;
      const bitmap = renderedFrames[index];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let row = 0; row < repeat; row++) for (let col = 0; col < repeat; col++) ctx.drawImage(bitmap, col * scene.width, row * scene.height);
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [scene, playing, repeat, renderedFrames]);
  if (generated.error) return <div className="wb-water-preview-wrap" role="alert">{generated.error.message}</div>;
  if (!scene) return null;
  return <div className="wb-water-preview-wrap"><canvas className="wb-water-preview" ref={ref} width={scene.width * repeat} height={scene.height * repeat} aria-label="Animated generated water scene preview" /><div><button type="button" onClick={() => setPlaying(v => !v)} aria-pressed={playing}>{playing ? "Pause preview" : "Play preview"}</button> <button type="button" onClick={() => setRepeat(v => v === 1 ? 3 : 1)} aria-pressed={repeat === 3}>{repeat}× repeat</button></div></div>;
}
function IsoShapePreview({ options }) {
  const ref = useRef(null);
  const rendered = useMemo(() => {
    try {
      const points = isometricFaces(options).flatMap(face => face.points);
      const minX = Math.min(...points.map(point => point.x)), minY = Math.min(...points.map(point => point.y));
      const width = Math.max(...points.map(point => point.x)) - minX + 9, height = Math.max(...points.map(point => point.y)) - minY + 9;
      const base = createDocument({ width, height, name: "Isometric preview" });
      const next = applyCommand(base, { type: "draw.isometric", ...options, x: options.x - minX + 4, y: options.y - minY + 4 });
      return { pixels: renderFrame(next), width, height };
    } catch (error) { return { error: error.message }; }
  }, [options]);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = false;
    if (rendered.pixels) ctx.putImageData(new ImageData(new Uint8ClampedArray(rendered.pixels), rendered.width, rendered.height), 0, 0);
  }, [rendered]);
  return rendered.error ? <p role="alert">{rendered.error}</p> : <canvas className="wb-iso-preview" ref={ref} width={rendered.width} height={rendered.height} aria-label="Isometric shape preview" />;
}
function FrameThumb({ doc, frameId, repeat = 1, colorManager }) {
  const ref = useRef(null);
  const lastInputs = useRef(null);
  useEffect(() => {
    const previous = lastInputs.current;
    lastInputs.current = { doc, frameId, repeat, colorManager };
    if (
      previous?.frameId === frameId &&
      previous?.repeat === repeat &&
      previous?.colorManager === colorManager &&
      documentProfile(previous.doc) === documentProfile(doc) &&
      sameFrameRender(previous.doc, doc, frameId)
    )
      return;
    try {
      const ctx = ref.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 40 * repeat, 40 * repeat);
        ctx.imageSmoothingEnabled = false;
        if (!colorManager && !isSRGB(documentProfile(doc))) return;
        const s = Math.min(40 / doc.width, 40 / doc.height);
        const image = rgbaImage(
          colorManager ? colorManager.displayFrame(doc, frameId) : renderFrame(doc, frameId),
          doc.width,
          doc.height,
        );
        for (let y = 0; y < repeat; y++)
          for (let x = 0; x < repeat; x++)
            ctx.drawImage(
              image,
              (40 * repeat - doc.width * s * repeat) / 2 + x * doc.width * s,
              (40 * repeat - doc.height * s * repeat) / 2 + y * doc.height * s,
              doc.width * s,
              doc.height * s,
            );
      }
    } catch {
      /* Invalid thumbnails are reported by the editor renderer. */
    }
  }, [doc, frameId, repeat, colorManager]);
  return (
    <canvas
      ref={ref}
      width={40 * repeat}
      height={40 * repeat}
      aria-hidden="true"
    />
  );
}

export default function Workbench() {
  const [colorManager, setColorManager] = useState(null);
  const [scriptLanguage, setScriptLanguage] = useState("commands"),
    [luaSource, setLuaSource] = useState('local sprite = app.activeSprite\napp.transaction("Lua drawing", function()\n  local layer = sprite:newLayer()\n  layer.name = "Lua drawing"\n  local image = Image(sprite.width, sprite.height)\n  image:drawPixel(0, 0, app.pixelColor.rgba(255, 107, 87, 255))\n  sprite:newCel(layer, app.activeFrame, image, Point(0, 0))\nend)\nprint("Added a pixel on a new layer")'),
    [luaTimeout, setLuaTimeout] = useState(3000);
  const luaAbortRef = useRef(null), luaSavingRef = useRef(false);
  const [luaSaving, setLuaSaving] = useState(false);
  const luaDialog = useLuaDialog();
  const luaCommands = useLuaDialog();
  useEffect(() => () => luaAbortRef.current?.abort(), []);
  const [indexedOptions, setIndexedOptions] = useState({paletteMode:"existing",maxColors:256,quantization:"median-cut",rgbmap:"pixelwall",fitCriteria:"default",withAlpha:true,dithering:"none",ditherMatrix:"bayer4x4",ditherStrength:1});
  const [profileTarget, setProfileTarget] = useState("sRGB"),
    [importedProfile, setImportedProfile] = useState(null),
    [renderingIntent, setRenderingIntent] = useState(1),
    [paletteScope, setPaletteScope] = useState("all"),
    [shadeStep, setShadeStep] = useState(-1);
  const [extensions, setExtensions] = useState([]), [asepriteRegistry, setAsepriteRegistry] = useState(null);
  const [exportPresets, setExportPresets] = useState([]),
    [presetName, setPresetName] = useState("My export");
  const [tileDraft, setTileDraft] = useState(null);
  const [sliceDraft, setSliceDraft] = useState(null);
  const [pinnedPanels, setPinnedPanels] = useState([]);
  const panelDrag = useRef(null);
  const sidebarRef = useRef(null);
  const documentTabsRef = useRef(null);
  const [closedDocuments, setClosedDocuments] = useState([]);

  const [selectedLayers, setSelectedLayers] = useState([]);
  const [wrap, setWrap] = useState("none");
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [offlineStatus, setOfflineStatus] = useState("Online workspace");
  useEffect(() => registerOffline({ onStatus: setOfflineStatus }), []);
  const [doc, setDoc] = useState(null),
    [activeFrame, setActiveFrame] = useState(""),
    [activeLayer, setActiveLayer] = useState("");
  useEffect(() => {
    documentTabsRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({block:"nearest", inline:"nearest"});
  }, [doc?.id]);
  const [tool, setTool] = useState("pencil"),
    [color, setColor] = useState("#ffb34bff"),
    [bgColor, setBgColor] = useState("#ffffffff"),
    [endColor, setEndColor] = useState("#ff6b57ff");
  const [brush, setBrush] = useState(1),
    [brushShape, setBrushShape] = useState("square"),
    [customBrush, setCustomBrush] = useState(null),
    [symmetry, setSymmetry] = useState("none"),
    [pixelPerfect, setPixelPerfect] = useState(true),
    [filled, setFilled] = useState(true),
    [ink, setInk] = useState("paint"),
    [pressure, setPressure] = useState(true),
    [stabilize, setStabilize] = useState(0),
    [dither, setDither] = useState(false);
  const [zoom, setZoom] = useState(6),
    [grid, setGrid] = useState(false),
    [isometricGrid, setIsometricGrid] = useState(false),
    [isometricSnap, setIsometricSnap] = useState(false),
    [isometricTileWidth, setIsometricTileWidth] = useState(16),
    [seamless, setSeamless] = useState(false),
    [selection, setSelection] = useState(null),
    [selectionMode, setSelectionMode] = useState("replace"),
    [clipboard, setClipboard] = useState(null),
    [cursor, setCursor] = useState(null);
  const [playing, setPlaying] = useState(false),
    [onionBefore, setOnionBefore] = useState(0),
    [onionAfter, setOnionAfter] = useState(0),
    [onionOpacity, setOnionOpacity] = useState(0.2),
    [selectedFrames, setSelectedFrames] = useState([]),
    [clipId, setClipId] = useState(""),
    [timelinePage, setTimelinePage] = useState(0);
  const [panel, setPanel] = useState("layers"),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(""),
    [previewResult, setPreviewResult] = useState(null),
    [previewBaseline, setPreviewBaseline] = useState(null),
    [storageStats, setStorageStats] = useState(null),
    [storageBudgetInput, setStorageBudgetInput] = useState(""),
    [temporaryProjects, setTemporaryProjects] = useState([]),
    [agentConnection, setAgentConnection] = useState(null),
    [saveStatus, setSaveStatus] = useState("Opening your workspace…"),
    [documents, setDocuments] = useState([]),
    [revisions, setRevisions] = useState([]),
    [historyVersion, setHistoryVersion] = useState(0),
    [settings, setSettings] = useState({
      shortcuts: {},
      sidebar: "right",
      timelineHeight: 200,
    });
  const [text, setText] = useState("PIXELWALL"),
    [textScale, setTextScale] = useState(1),
    [effect, setEffect] = useState("outline"),
    [effectAmount, setEffectAmount] = useState(20),
    [kernel, setKernel] = useState("0,-1,0,-1,5,-1,0,-1,0"),
    [replaceColor, setReplaceColor] = useState("#16152bff");
  const [commandText, setCommandText] = useState(
      '[\n  {"type":"draw.ellipse","x":20,"y":20,"width":20,"height":20,"color":"#ffb34bff","filled":true}\n]',
    ),
    [commandResult, setCommandResult] = useState(""),
    [search, setSearch] = useState("");
  const [exportOptions, setExportOptions] = useState({
      format: "gif",
      scale: 4,
      layout: "packed",
      padding: 1,
      extrude: 1,
      trim: true,
      powerOfTwo: false,
      clipId: "",
    }),
    [busy, setBusyState] = useState(false);
  const [newOptions, setNewOptions] = useState({
      name: "Untitled",
      width: 64,
      height: 64,
      colorMode: "rgba",
      mode: "library",
    }),
    [resizeOptions, setResizeOptions] = useState({
      width: 64,
      height: 64,
      mode: "canvas",
      anchor: "center",
    }),
    [transformOptions, setTransformOptions] = useState({
      dx: 0,
      dy: 0,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
    });
  const [waterOptions, setWaterOptions] = useState({
    name: "Water study",
    width: 64,
    height: 48,
    scene: "pond",
    view: "isometric",
    seed: 1,
    waterSeed: 1,
    season: "summer",
    frames: 12,
    durationMs: 125,
    details: 2,
    palette: {},
    rippleDensity: .55,
    phaseOffset: 0,
  });
  const [waterPreviewValid, setWaterPreviewValid] = useState(true);
  const [isoShapeOptions, setIsoShapeOptions] = useState({ shape: "tile", x: 16, y: 16, width: 16, elevation: 0, direction: "right", color: "#247fa2ff", leftColor: "#17627aff", rightColor: "#9de2dcff", filled: true });
  const [rotationMethod, setRotationMethod] = useState("rotsprite");
  const [paletteText, setPaletteText] = useState(""),
    [importKind, setImportKind] = useState("document"),
    [sheetOptions, setSheetOptions] = useState({
      frameWidth: 32,
      frameHeight: 32,
      padding: 0,
      spacing: 0,
      columns: 0,
      count: undefined,
      order: "row",
    }),
    [pendingImage, setPendingImage] = useState(null),
    [importWarnings, setImportWarnings] = useState([]);
  const [tileId, setTileId] = useState(""),
    [tilesetId, setTilesetId] = useState(""),
    [tileRotate, setTileRotate] = useState(0),
    [tileFlipX, setTileFlipX] = useState(false),
    [tileFlipY, setTileFlipY] = useState(false);
  const [motion, setMotion] = useState({
    x: 0,
    y: 0,
    toX: 24,
    toY: 0,
    easing: "easeInOut",
    count: 20,
    seed: 1,
    speed: 2,
    spread: 180,
    gravity: 0.1,
    lifetime: 12,
    size: 1,
  });
  const storeRef = useRef(null),
    docRef = useRef(null),
    historyRef = useRef(null),
    historyCacheRef = useRef(null),
    luaRangeRef = useRef({type:0, colors:[], sliceIds:[]}),
    uiContextRef = useRef(null),
    revisionRef = useRef(0),
    nativeSessionRef = useRef(null),
    nativeReadyRef = useRef(false),
    documentRevisionsRef = useRef(new Map()),
    storedRevisionRef = useRef(undefined),
    savedRevisionsRef = useRef(new Map()),
    savedDocumentsRef = useRef(new Map()),
    activeRef = useRef({ frameId: "", layerId: "" }),
    operationRef = useRef(null),
    previewBaselineRef = useRef(null),
    checkpointDeliveryRef = useRef(null),
    temporaryDocumentsRef = useRef(new Map()),
    documentModeRef = useRef("library"),
    libraryStateRef = useRef({status:"unavailable", revision:null, error:null}),
    restoringRef = useRef(false),
    pathRef = useRef([]),
    canvasRef = useRef(null),
    overlayRef = useRef(null),
    isoOverlayRef = useRef(null),
    viewportRef = useRef(null),
    rgbaRef = useRef(null),
    fileRef = useRef(null),
    externalTilesetInputRef = useRef(null),
    externalTilesetRequestRef = useRef(null),
    saveQueueRef = useRef(Promise.resolve()),
    hostRef = useRef(null),
    automationRef = useRef(null),
    busyRef = useRef(false),
    loadGeneration = useRef(0);
  if (!historyCacheRef.current) historyCacheRef.current = createDocumentHistoryCache({historyOptions:{maxEntries:100}});
  uiContextRef.current = useMemo(() => doc ? editorUiContext(doc, {selection, range:{...luaRangeRef.current, frameIds:selectedFrames, layerIds:selectedLayers}, active:{frameId:activeFrame, layerId:activeLayer}, fgColor:color, bgColor}) : null, [doc, selection, selectedFrames, selectedLayers, activeFrame, activeLayer, color, bgColor]);
  const restoreUiContext = useCallback((context) => {
    const next = editorUiContext(docRef.current, context || {});
    uiContextRef.current = next;
    luaRangeRef.current = next.range;
    activeRef.current = next.active;
    setSelection(next.selection);
    setColor(next.fgColor);
    setBgColor(next.bgColor);
    setActiveFrame(next.active.frameId);
    setActiveLayer(next.active.layerId);
    setSelectedFrames(next.range.frameIds.length ? next.range.frameIds : [next.active.frameId]);
    setSelectedLayers(next.range.layerIds.length ? next.range.layerIds : [next.active.layerId]);
    setTimelinePage(Math.floor(docRef.current.frames.findIndex(frame => frame.id === next.active.frameId) / 64));
  }, []);
  const setBusy = useCallback((value) => {
    busyRef.current = typeof value === "function" ? value(busyRef.current) : value;
    setBusyState(busyRef.current);
  }, []);
  const analyticsRef = useRef(null);
  if (analyticsRef.current === null) {
    analyticsRef.current = createWorkbenchAnalytics({
      capture: captureAnalyticsEvent,
      consented: () => getAnalyticsConsentStatus() === "granted",
      getDocument: () => docRef.current,
      aggregateEnabled: isAnonymousTrafficEnabled,
      captureAggregateCreation: captureAnonymousCreation,
      captureAggregateExport: captureAnonymousExportOutcome,
      captureAggregateAutomationEdit: captureAnonymousAutomationEdit,
      captureAggregateAutomationOperation: captureAnonymousAutomationOperation,
    });
  }
  const pendingImportFormatRef = useRef("image");
  useEffect(() => {
    const sync = () => analyticsRef.current.consentChanged();
    window.addEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, sync);
  }, []);
  const access = useProAccess();
  const downloads = useDownload();
  const report = useCallback((error) => {
    setNotice(error instanceof Error ? error.message : String(error));
  }, []);
  useEffect(() => {
    let mounted = true;
    loadBrowserColorManager().then(manager => { if (mounted) setColorManager(manager); }).catch(error => { if (mounted) report(error); });
    return () => { mounted = false; };
  }, [report]);
  const reconcile = useCallback((next) => {
    const frameId = next.frames.some((f) => f.id === activeRef.current.frameId)
      ? activeRef.current.frameId
      : next.frames[0]?.id || "";
    const layerId = next.layers.some((l) => l.id === activeRef.current.layerId)
      ? activeRef.current.layerId
      : next.layers.find((l) => l.type !== "group")?.id ||
        next.layers[0]?.id ||
        "";
    activeRef.current = { frameId, layerId };
    setActiveFrame(frameId);
    setActiveLayer(layerId);
    setSelectedFrames((ids) => {
      const valid = ids.filter((id) => next.frames.some((f) => f.id === id));
      return valid.length ? valid : [frameId];
    });
    setSelectedLayers((ids) => {
      const valid = ids.filter((id) => next.layers.some((l) => l.id === id));
      return valid.length ? valid : [layerId];
    });
    setClipId((id) =>
      next.clips.some((c) => c.id === id) ? id : next.clips[0]?.id || "",
    );
    setTimelinePage((page) =>
      Math.min(page, Math.floor((next.frames.length - 1) / 64)),
    );
  }, []);
  const install = useCallback(
    (next, { resetHistory = false, storedRevision, allowLua = false, allowNative = false, allowRecovery = false } = {}) => {
      const finishingLua = allowLua && luaSavingRef.current && luaAbortRef.current;
      // External file-open delivery can still be cancelling its grants after
      // nativeFlushRecovery rejected it during Lua. Finish the durable Lua
      // installation; no native document can activate while Lua owns the editor.
      if (nativeSessionRef.current?.busy && !allowNative && !finishingLua) throw Error("Finish the current file operation first.");
      if (restoringRef.current && !allowRecovery) throw Error("Finish the current recovery before opening another project.");
      // A close prompt can arrive after a tracked operation starts saving. Finish
      // its installation; the close lock still blocks every new edit/operation.
      const finishing = finishingLua ||
        (allowNative && nativeSessionRef.current?.busy) || (allowRecovery && restoringRef.current);
      if (!finishing) automationRef.current?.desktop.assertEditable();
      if (luaAbortRef.current && !allowLua) throw Error("Wait for the Lua script to finish or cancel it.");
      docRef.current = next;
      activeRef.current = {
        frameId: next.frames.some((f) => f.id === activeRef.current.frameId)
          ? activeRef.current.frameId
          : next.frames[0]?.id,
        layerId: next.layers.some((l) => l.id === activeRef.current.layerId)
          ? activeRef.current.layerId
          : next.layers.find((l) => l.type !== "group")?.id,
      };
      revisionRef.current++;
      documentRevisionsRef.current.set(docRef.current.id, (documentRevisionsRef.current.get(docRef.current.id) || 0) + 1);
      if (resetHistory) {
        historyRef.current = historyCacheRef.current.acquire(next, {storedRevision}).history;
        next = historyRef.current.present;
        docRef.current = next;
        storedRevisionRef.current = storedRevision;
        savedRevisionsRef.current.set(next.id, storedRevision);
        if (storedRevision !== undefined)
          savedDocumentsRef.current.set(next.id, next);
      }
      setDoc(next);
      setHistoryVersion((v) => v + 1);
      setHistoryState({
        canUndo: historyRef.current?.canUndo || false,
        canRedo: historyRef.current?.canRedo || false,
      });
      setSelection(null);
      pathRef.current = [];
      setActiveFrame((current) =>
        next.frames.some((f) => f.id === current)
          ? current
          : next.frames[0]?.id || "",
      );
      setActiveLayer((current) =>
        next.layers.some((l) => l.id === current)
          ? current
          : next.layers.find((l) => l.type !== "group")?.id || "",
      );
      setClipId((current) =>
        next.clips?.some((c) => c.id === current)
          ? current
          : next.clips?.[0]?.id || "",
      );
    },
    [],
  );
  const commit = useCallback(
    (commands, label = "Edit") => {
      automationRef.current?.desktop.assertEditable();
      if (nativeSessionRef.current?.busy) throw Error("Finish the current file operation first.");
      if (luaAbortRef.current) throw Error("Wait for the Lua script to finish or cancel it.");
      if (restoringRef.current || operationRef.current)
        throw Error(
          "Finish the current edit or recovery before applying commands.",
        );
      const before = docRef.current;
      if (!before) throw Error("Open a project first.");
      let next = before;
      for (const command of Array.isArray(commands) ? commands : [commands])
        next = applyCommand(next, {
          frameId: activeRef.current.frameId,
          layerId: activeRef.current.layerId,
          ...command,
        });
      historyRef.current.commit(next, label);
      if (typeof libraryStateRef !== "undefined") libraryStateRef.current = {status:"dirty", revision:storedRevisionRef.current ?? null, error:libraryStateRef.current.error}; setSaveStatus("Unsaved changes");
      docRef.current = next;
      revisionRef.current++;
      documentRevisionsRef.current.set(docRef.current.id, (documentRevisionsRef.current.get(docRef.current.id) || 0) + 1);
      analyticsRef.current.committed(commands, historyRef.current.lastChange?.changed);
      reconcile(next);
      setDoc(next);
      setHistoryVersion((v) => v + 1);
      setHistoryState({
        canUndo: historyRef.current?.canUndo || false,
        canRedo: historyRef.current?.canRedo || false,
      });
      return next;
    },
    [reconcile],
  );
  const undo = useCallback(() => {
    if (luaAbortRef.current || nativeSessionRef.current?.busy) return;
    if (automationRef.current?.desktop.locked) return;
    if (restoringRef.current || operationRef.current) return;
    const h = historyRef.current;
    if (h?.canUndo) {
      h.undo();
      docRef.current = h.present;
      revisionRef.current++;
      documentRevisionsRef.current.set(docRef.current.id, (documentRevisionsRef.current.get(docRef.current.id) || 0) + 1);
      reconcile(h.present);
      setDoc(h.present);
      if (typeof libraryStateRef !== "undefined") libraryStateRef.current = {status:"dirty", revision:storedRevisionRef.current ?? null, error:libraryStateRef.current.error}; setSaveStatus("Unsaved changes");
      const context = h.lastContext;
      if (context !== undefined) restoreUiContext(context);
      else setSelection(null);
      setHistoryVersion((v) => v + 1);
      setHistoryState({
        canUndo: historyRef.current?.canUndo || false,
        canRedo: historyRef.current?.canRedo || false,
      });
    }
  }, [reconcile, restoreUiContext]);
  const redo = useCallback(() => {
    if (luaAbortRef.current || nativeSessionRef.current?.busy) return;
    if (automationRef.current?.desktop.locked) return;
    if (restoringRef.current || operationRef.current) return;
    const h = historyRef.current;
    if (h?.canRedo) {
      h.redo();
      docRef.current = h.present;
      revisionRef.current++;
      documentRevisionsRef.current.set(docRef.current.id, (documentRevisionsRef.current.get(docRef.current.id) || 0) + 1);
      reconcile(h.present);
      setDoc(h.present);
      if (typeof libraryStateRef !== "undefined") libraryStateRef.current = {status:"dirty", revision:storedRevisionRef.current ?? null, error:libraryStateRef.current.error}; setSaveStatus("Unsaved changes");
      const context = h.lastContext;
      if (context !== undefined) restoreUiContext(context);
      else setSelection(null);
      setHistoryVersion((v) => v + 1);
      setHistoryState({
        canUndo: historyRef.current?.canUndo || false,
        canRedo: historyRef.current?.canRedo || false,
      });
    }
  }, [reconcile, restoreUiContext]);
  const save = useCallback(async () => {
    if (luaAbortRef.current) return null;
    const captured = docRef.current,
      store = storeRef.current;
    if (!captured || !store) return null;
    if (documentModeRef.current !== "library") return {saved:false, skipped:true, mode:documentModeRef.current, reason:"The active document is file-backed or temporary; use its file save or a verified checkpoint."};
    setSaveStatus("Saving…");
    libraryStateRef.current = {status:"saving", revision:storedRevisionRef.current ?? null, error:null};
    const task = async () => {
      const expected = savedRevisionsRef.current.get(captured.id);
      const result = await store.saveDocument(captured, {
        expectedRevision: expected,
        label: "Editor save",
      });
      savedRevisionsRef.current.set(captured.id, result.revision);
      savedDocumentsRef.current.set(captured.id, captured);
      if (docRef.current?.id === captured.id) {
        storedRevisionRef.current = result.revision;
        libraryStateRef.current = {status:"saved", revision:result.revision, error:null};
        if (docRef.current === captured) setSaveStatus("Saved on this device");
      }
      setDocuments(await store.listDocuments());
      return result;
    };
    const run = saveQueueRef.current.catch(() => {}).then(task);
    saveQueueRef.current = run;
    try {
      const result = await run;
      analyticsRef.current.saveResult();
      return result;
    } catch (error) {
      analyticsRef.current.saveResult(error);
      setSaveStatus("Save needs attention");
      libraryStateRef.current = {status:"failed", revision:storedRevisionRef.current ?? null, error:{code:error?.code, message:error?.message}};
      report(error);
      throw error;
    }
  }, [report]);
  const saveBeforeSwitch = useCallback(async () => {
    const current = docRef.current;
    if (!current) return {saved:true};
    if (documentModeRef.current === "library") return save();
    if (documentModeRef.current !== "file") return {saved:false, skipped:true, mode:documentModeRef.current, reason:"The active temporary document needs a verified checkpoint before switching."};
    if (!nativeSessionRef.current) return {saved:false, reason:"The file-backed document is unavailable. Reopen its bound file before switching."};
    if (temporaryDocumentsRef.current.size >= 8 && !temporaryDocumentsRef.current.has(current.id)) return {saved:false, reason:"At most eight retained documents are supported; restore or checkpoint one before opening another."};
    const captured = {document:current, revision:revisionRef.current, storedRevision:storedRevisionRef.current, mode:"file", checkpoint:checkpointDeliveryRef.current ?? null};
    await nativeSessionRef.current.saveCurrent();
    temporaryDocumentsRef.current.set(current.id, captured);
    return {saved:true, document:current, revision:captured.revision, mode:"file"};
  }, [save]);
  const activate = useCallback(
    async (next, storedRevision, {allowLua = false, allowNative = false, allowRecovery = false, mode = "library"} = {}) => {
      setPlaying(false);
      if (docRef.current && docRef.current.id !== next.id) historyCacheRef.current.park({history:historyRef.current, document:savedDocumentsRef.current.get(docRef.current.id), storedRevision:savedRevisionsRef.current.get(docRef.current.id)});
      install(next, { resetHistory: true, storedRevision, allowLua, allowNative, allowRecovery });
      if (typeof documentModeRef !== "undefined") documentModeRef.current = mode;
      if (typeof checkpointDeliveryRef !== "undefined") checkpointDeliveryRef.current = null;
      if (typeof libraryStateRef !== "undefined") libraryStateRef.current = {status:mode === "library" ? storedRevision === undefined ? "dirty" : "saved" : "not_saved", revision:mode === "library" ? storedRevision ?? null : null, error:null};
      if (mode === "temporary") setSaveStatus("Temporary document · checkpoint before closing");
      else if (mode === "file") setSaveStatus("File-backed document · use Save to keep changes");
      else setSaveStatus(storedRevision === undefined ? "Unsaved changes" : "Saved on this device");
      luaRangeRef.current = {type:0, colors:[], sliceIds:[]};
      const layerId =
        next.layers.find((l) => l.type !== "group")?.id ||
        next.layers[0]?.id ||
        "";
      activeRef.current = { frameId: next.frames[0].id, layerId };
      setActiveFrame(next.frames[0].id);
      setActiveLayer(layerId);
      setSelectedFrames([next.frames[0].id]);
      setSelectedLayers([layerId]);
      setTimelinePage(0);
      const viewport = viewportRef.current;
      setZoom(
        clamp(
          Math.floor(
            Math.min(
              Math.max(
                64,
                (viewport?.clientWidth || window.innerWidth - 350) - 64,
              ) / next.width,
              Math.max(
                64,
                (viewport?.clientHeight || window.innerHeight - 400) - 64,
              ) / next.height,
            ),
          ),
          1,
          16,
        ),
      );
      await storeRef.current?.setSetting("activeDocument", next.id);
    },
    [install],
  );
  const newDocument = useCallback(
    async (options = {}) => {
      const requestedMode = options.mode === "temporary" ? "temporary" : "library";
      automationRef.current?.desktop.assertEditable();
      if (nativeSessionRef.current?.busy) throw Error("Finish the current file operation first.");
      if (luaAbortRef.current) throw Error("Wait for the Lua script to finish or cancel it.");
      if (restoringRef.current || operationRef.current)
        throw Error(
          "Finish the current edit or recovery before opening another document.",
        );
      try {
        setBusy(true);
        if (requestedMode === "library") {
          const saved = await saveBeforeSwitch();
          if (!saved || saved.saved === false) throw Error("Save a checkpoint or bound file before opening another document.");
        } else if (docRef.current) {
          if (temporaryDocumentsRef.current.size >= 8 && !temporaryDocumentsRef.current.has(docRef.current.id)) throw Error("At most eight retained documents are supported; restore or checkpoint one before opening another.");
          temporaryDocumentsRef.current.set(docRef.current.id, {document:docRef.current, revision:revisionRef.current, storedRevision:storedRevisionRef.current, mode:documentModeRef.current, checkpoint:checkpointDeliveryRef.current ?? null});
        }
        const next = createDocument({ ...options, mode:undefined, id: crypto.randomUUID() });
        await activate(next, undefined, {mode:requestedMode});
        analyticsRef.current.project("new", "completed");
        setModal(null);
        return next;
      } catch (error) {
        analyticsRef.current.project("new", "failed");
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [saveBeforeSwitch, activate, setBusy],
  );
  const newWaterScene = useCallback(async (options = {}) => {
    automationRef.current?.desktop.assertEditable();
    if (busyRef.current || luaAbortRef.current || nativeSessionRef.current?.busy || operationRef.current || restoringRef.current) throw Error("Finish the current operation before generating a scene.");
    setBusy(true);
    try {
      const next = createDocument({ id: crypto.randomUUID(), name: options.name || "Water study", width: options.width || 64, height: options.height || 48 });
      // scene.water is intentionally applied to a fresh document. This keeps
      // the current artwork in its own saved tab and lets the generator own
      // the replacement semantics for the new blank document.
      const generated = applyCommand(next, { type: "scene.water", ...options });
      const saved = await saveBeforeSwitch();
      if (docRef.current && (!saved || saved.saved === false)) throw Error("Save a checkpoint or bound file before generating a water scene.");
      await activate(generated);
      analyticsRef.current.project("new", "completed");
      analyticsRef.current.committed({ type: "scene.water" }, true);
      setModal(null);
      setNotice("Water scene generated in a new project tab.");
      return generated;
    } finally {
      setBusy(false);
    }
  }, [activate, saveBeforeSwitch, setBusy]);
  useEffect(() => {
    let mounted = true;
    const generation = ++loadGeneration.current;
    void (async () => {
      const store = await openStore();
      if (!mounted) {
        store.close();
        return;
      }
      storeRef.current = store;
      setAsepriteRegistry(createAsepriteExtensionRegistry(store));
      const savedExtensions = await store.getSetting("extensions", []);
      setExtensions(
        savedExtensions.flatMap((value) => {
          try {
            return [validateExtension(value)];
          } catch {
            return [];
          }
        }),
      );
      setExportPresets(await store.getSetting("exportPresets", []));
      const prefs = await store.getSetting("workspace", null);
      if (prefs) {
        setSettings(prefs);
        setPinnedPanels(prefs.pinnedPanels || []);
        setClosedDocuments(prefs.closedDocuments || []);
        setIsometricGrid(!!prefs.isometricGrid);
        setIsometricSnap(!!prefs.isometricSnap);
        setIsometricTileWidth(clamp(Math.round((prefs.isometricTileWidth || 16) / 4) * 4, 4, 128));
      }
      const migrations = await store.importLegacy({
        convert: (raw) => {
          const parsed = parseProject(JSON.stringify(raw));
          return migrateLegacy(parsed);
        },
      });
      if (migrations.some((r) => r.status === "failed"))
        setNotice(
          "Some older browser backups could not be opened. Their originals are retained; use a portable project backup to recover them.",
        );
      else if (migrations.some((r) => r.status === "imported"))
        setNotice(
          "Older projects were added to your library. Original browser backups are retained.",
        );
      const list = await store.listDocuments();
      setDocuments(list);
      const preferredLegacy = migrations.find((r) => r.documentId)?.documentId;
      const last = await store.getSetting(
        "activeDocument",
        preferredLegacy || list[0]?.id,
      );
      const loaded =
        (last ? await store.loadDocument(last) : null) ||
        (list[0] ? await store.loadDocument(list[0].id) : null);
      if (mounted && generation === loadGeneration.current) {
        await activate(
          loaded?.document ||
            createDocument({ name: "Untitled", width: 64, height: 64 }),
          loaded?.revision,
        );
        setSaveStatus(loaded ? "Saved on this device" : "Ready");
        libraryStateRef.current = loaded ? {status:"saved", revision:loaded.revision, error:null} : {status:"available", revision:null, error:null};
        analyticsRef.current.loaded(loaded
          ? migrations.some((result) => result.status === "imported") ? "legacy_migration" : "library"
          : "new");
      }
      void store.requestPersistence?.();
    })().catch(async (error) => {
      if (!mounted) return;
      storeRef.current = null;
      setNotice(
        error.message +
          " Editing is still available. Save portable project files to keep your work.",
      );
      await activate(
        createDocument({ name: "Untitled", width: 64, height: 64 }),
      );
      setSaveStatus("Portable backups only");
      libraryStateRef.current = {status:"unavailable", revision:null, error:{message:error.message}};
      analyticsRef.current.loaded("storage_unavailable");
      analyticsRef.current.saveResult(error);
    });
    return () => {
      mounted = false;
    };
  }, [activate, report]);
  useEffect(() => {
    activeRef.current = { frameId: activeFrame, layerId: activeLayer };
  }, [activeFrame, activeLayer]);
  useEffect(() => {
    if (!doc || !storeRef.current || operationRef.current) return;
    const timer = setTimeout(() => void save().catch(() => {}), 750);
    return () => clearTimeout(timer);
  }, [doc, save]);
  useEffect(() => {
    const flush = () => {
      if (
        docRef.current &&
        savedDocumentsRef.current.get(docRef.current.id) !== docRef.current
      )
        void save().catch(() => {});
    };
    const before = (event) => {
      if (hasUncheckpointedWork(docRef.current, revisionRef.current, documentModeRef.current, checkpointDeliveryRef.current, temporaryDocumentsRef.current, savedDocumentsRef.current)) {
        flush();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", before);
    };
  }, [save]);
  useEffect(() => {
    if (storeRef.current)
      void storeRef.current
        .setSetting("workspace", { ...settings, pinnedPanels, closedDocuments, isometricGrid, isometricSnap, isometricTileWidth })
        .catch(report);
  }, [settings, pinnedPanels, closedDocuments, isometricGrid, isometricSnap, isometricTileWidth, report]);
  const layer = doc?.layers.find((l) => l.id === activeLayer),
    frame = doc?.frames.find((f) => f.id === activeFrame),
    selectedClip = doc?.clips?.find((c) => c.id === clipId),
    maskBounds = doc ? bounds(selection, doc.width) : null;
  const externalTilesets = useMemo(() => doc?.tilesets.some(tileset => tileset.flags & 1) ? listExternalTilesets(doc) : [], [doc]);
  const workingBrush = useMemo(() => {
    if (!customBrush || !doc) return customBrush;
    try { return {...customBrush, colors:transferPixelColors(customBrush.colors, customBrush.colorProfile || "sRGB", documentProfile(doc), colorManager)}; }
    catch { return null; }
  }, [customBrush, doc, colorManager]);
  const activePalette = useMemo(() => doc ? getFramePalette(doc, activeFrame) : [], [doc, activeFrame]);
  const displayedColors = useMemo(() => {
    const colors = [...new Set([...activePalette, color, bgColor, endColor])];
    try {
      const converted = colorManager && doc ? colorManager.transformColors(colors, documentProfile(doc), "sRGB") : colors;
      return new Map(colors.map((value, index) => [value, converted[index]]));
    } catch { return new Map(colors.map(value => [value, value])); }
  }, [activePalette, color, bgColor, endColor, colorManager, doc]);
  const displayColor = value => displayedColors.get(value) || value;
  const workingColor = (value) => colorManager && doc ? colorManager.workingColor(doc, value) : value;
  const paletteTarget = () => ({ scope: paletteScope, ...(paletteScope === "range" ? {frameIds: selectedFrames.length ? selectedFrames : [activeFrame]} : {}) });
  let profileName = "sRGB";
  try { profileName = colorManager && doc ? colorManager.profileInfo(documentProfile(doc)).name : doc && !isSRGB(documentProfile(doc)) ? "Embedded profile · loading" : "sRGB"; } catch { profileName = "Unreadable profile"; }
  const visibleFrames = useMemo(
    () => doc?.frames.slice(timelinePage * 64, (timelinePage + 1) * 64) || [],
    [doc, timelinePage],
  );
  useEffect(() => {
    if (!playing || !doc) return;
    let timer, cursor, cancelled = false;
    const fail = error => { if (!cancelled) { report(error); setPlaying(false); } };
    const show = state => {
      if (cancelled) return;
      if (state.frameId) setActiveFrame(state.frameId);
      if (state.stopped) { setPlaying(false); return; }
      timer = setTimeout(() => {
        try { show(cursor.next()); } catch (error) { fail(error); }
      }, doc.frames[state.frame]?.durationMs || 125);
    };
    timer = setTimeout(() => {
      try {
        cursor = createDocumentPlayback(doc, {clip:selectedClip, initialFrameId:activeRef.current.frameId, loop:selectedClip?.loop !== false});
        show(cursor.snapshot());
      } catch (error) { fail(error); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); cursor?.stop(); };
  }, [playing, doc, selectedClip, report]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc || !activeFrame) return;
    try {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, doc.width, doc.height);
      const index = doc.frames.findIndex((f) => f.id === activeFrame);
      if (!playing) {
        for (const direction of [-1, 1])
          for (
            let n = 1;
            n <= (direction < 0 ? onionBefore : onionAfter);
            n++
          ) {
            const other = doc.frames[index + direction * n];
            if (!other) continue;
            const pixels = renderFrame(doc, other.id);
            for (let i = 0; i < pixels.length; i += 4) {
              pixels[i] = direction < 0 ? 255 : 80;
              pixels[i + 1] = direction < 0 ? 90 : 170;
              pixels[i + 2] = direction < 0 ? 90 : 255;
              pixels[i + 3] = Math.round((pixels[i + 3] * onionOpacity) / n);
            }
            ctx.drawImage(rgbaImage(pixels, doc.width, doc.height), 0, 0);
          }
      }
      const pixels = renderFrame(doc, activeFrame);
      rgbaRef.current = pixels;
      if (!colorManager && !isSRGB(documentProfile(doc))) return;
      ctx.drawImage(rgbaImage(colorManager ? colorManager.transformRGBA(pixels, documentProfile(doc)) : pixels, doc.width, doc.height), 0, 0);
    } catch (error) {
      queueMicrotask(() => report(error));
    }
  }, [
    doc,
    activeFrame,
    playing,
    onionBefore,
    onionAfter,
    onionOpacity,
    report,
    colorManager,
  ]);
  useEffect(() => {
    const overlay = overlayRef.current?.getContext("2d");
    if (!overlay || !doc) return;
    overlay.clearRect(0, 0, doc.width, doc.height);
    if (selection && !playing) {
      overlay.fillStyle = "rgba(255,235,120,.25)";
      for (let i = 0; i < selection.length; i++)
        if (selection[i])
          overlay.fillRect(i % doc.width, Math.floor(i / doc.width), 1, 1);
    }
  }, [selection, playing, doc?.width, doc?.height, doc]);
  useEffect(() => {
    const canvas = isoOverlayRef.current;
    if (!canvas || !doc) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, doc.width, doc.height);
    if (!isometricGrid) return;
    const origin = { x: Math.floor(doc.width / 2), y: Math.floor(doc.height / 4) };
    const span = Math.ceil((doc.width + doc.height) / isometricTileWidth) + 2;
    ctx.save();
    ctx.strokeStyle = "rgba(70, 64, 150, .27)";
    ctx.lineWidth = 0.5;
    for (let i = -span; i <= span; i++) {
      const a = isoProject(i, -span, isometricTileWidth, origin);
      const b = isoProject(i, span, isometricTileWidth, origin);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const c = isoProject(-span, i, isometricTileWidth, origin);
      const d = isoProject(span, i, isometricTileWidth, origin);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
    ctx.restore();
  }, [isometricGrid, isometricTileWidth, doc]);
  const targetLayers = () =>
    selectedLayers.includes(activeLayer) ? selectedLayers : [activeLayer];
  const targetCels = () =>
    targetLayers().flatMap((layerId) =>
      targetFrames().map((frameId) => ({ layerId, frameId })),
    );
  function selectLayer(id, event) {
    if (luaAbortRef.current || nativeSessionRef.current?.busy || automationRef.current?.desktop.locked) return;
    luaRangeRef.current = {...luaRangeRef.current, type:4};
    activeRef.current.layerId = id;
    setActiveLayer(id);
    if (event?.metaKey || event?.ctrlKey)
      setSelectedLayers((current) => {
        const ids = current.length ? current : [activeLayer];
        return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      });
    else setSelectedLayers([id]);
    setSelection(null);
  }
  const targetFrames = () =>
    selectedFrames.length ? selectedFrames : [activeFrame];
  function run(command, label) {
    try {
      return commit(command, label);
    } catch (error) {
      report(error);
      return null;
    }
  }
  function selectFrame(id, event) {
    if (luaAbortRef.current || nativeSessionRef.current?.busy || automationRef.current?.desktop.locked) return;
    luaRangeRef.current = {...luaRangeRef.current, type:2};
    activeRef.current.frameId = id;
    setPlaying(false);
    if (event?.shiftKey && doc) {
      const a = doc.frames.findIndex((f) => f.id === activeFrame),
        b = doc.frames.findIndex((f) => f.id === id);
      setSelectedFrames(
        doc.frames.slice(Math.min(a, b), Math.max(a, b) + 1).map((f) => f.id),
      );
    } else if (event?.metaKey || event?.ctrlKey)
      setSelectedFrames((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      );
    else setSelectedFrames([id]);
    setActiveFrame(id);
    setSelection(null);
  }
  function point(event) {
    const r = canvasRef.current.getBoundingClientRect();
    const raw = {
      x: clamp(
        Math.floor(((event.clientX - r.left) * doc.width) / r.width),
        0,
        doc.width - 1,
      ),
      y: clamp(
        Math.floor(((event.clientY - r.top) * doc.height) / r.height),
        0,
        doc.height - 1,
      ),
      pressure: pressure ? event.pressure || 0.5 : 0.5,
    };
    const snapTools = new Set(["pencil", "eraser", "line", "curve", "rect", "ellipse", "polygon", "gradient", "text"]);
    if (isometricSnap && isometricGrid && snapTools.has(tool)) {
      const snapped = snapIso(raw.x, raw.y, isometricTileWidth, { x: Math.floor(doc.width / 2), y: Math.floor(doc.height / 4) });
      raw.x = clamp(Math.round(snapped.x), 0, doc.width - 1);
      raw.y = clamp(Math.round(snapped.y), 0, doc.height - 1);
    }
    return raw;
  }
  function commandFor(kind, points) {
    const a = points[0],
      b = points.at(-1),
      common = {
        frameId: activeFrame,
        layerId: activeLayer,
        color,
        selection: selection || undefined,
      };
    if (kind === "pencil" || kind === "eraser")
      return {
        ...common,
        type: "draw.stroke",
        points,
        size: brush,
        brush: brushShape,
        mask: customBrush ? workingBrush || (() => { throw Error("Color management is still loading. Try again in a moment."); })() : undefined,
        wrap,
        symmetry,
        pixelPerfect,
        erase: kind === "eraser",
        ink,
        shadeStep,
        pressure,
      };
    if (kind === "line")
      return {
        ...common,
        type: "draw.line",
        from: a,
        to: b,
        size: brush,
        wrap,
      };
    if (kind === "rect" || kind === "ellipse")
      return {
        ...common,
        type: "draw." + kind,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x) + 1,
        height: Math.abs(b.y - a.y) + 1,
        filled,
      };
    if (kind === "gradient")
      return {
        ...common,
        type: "draw.gradient",
        from: a,
        to: b,
        endColor,
        dither,
      };
    return null;
  }
  function paintTile(p) {
    const ts = doc.tilesets?.find((t) => t.id === tilesetId);
    if (!ts || layer?.type !== "tilemap") {
      setNotice("Choose a tilemap layer and a tileset first.");
      return;
    }
    const map = layer.tilemaps?.[activeFrame],
      cel = frame.cels[activeLayer];
    run(
      {
        type: "tilemap.paint",
        tilesetId,
        points: [
          {
            x: Math.floor((p.x - (map?.x ?? cel?.x ?? 0)) / ts.tileWidth),
            y: Math.floor((p.y - (map?.y ?? cel?.y ?? 0)) / ts.tileHeight),
            tileId: tileId || null,
            flipX: tileFlipX,
            flipY: tileFlipY,
            rotate: tileRotate,
          },
        ],
      },
      "Paint tile",
    );
  }
  function pointerDown(event) {
    if (luaAbortRef.current || nativeSessionRef.current?.busy) return;
    if (!doc || playing || event.button !== 0 || automationRef.current?.desktop.locked || nativeSessionRef.current?.busy || operationRef.current?.tool === "automation") return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    setCursor(p);
    if (tool === "hand") {
      operationRef.current = {
        tool,
        startClient: { x: event.clientX, y: event.clientY },
        scroll: {
          x: viewportRef.current.scrollLeft,
          y: viewportRef.current.scrollTop,
        },
      };
      return;
    }
    if (tool === "picker") {
      const i = (p.y * doc.width + p.x) * 4;
      setColor(hex(rgbaRef.current.slice(i, i + 4)));
      return;
    }
    if (tool === "fill") {
      run(
        { type: "draw.fill", ...p, color, selection: selection || undefined },
        "Fill",
      );
      return;
    }
    if (tool === "wand") {
      try {
        setSelection(
          buildSelection(
            doc,
            {
              shape: "wand",
              ...p,
              frameId: activeFrame,
              layerId: activeLayer,
              tolerance: effectAmount,
            },
            selection,
            selectionMode,
          ),
        );
      } catch (error) {
        report(error);
      }
      return;
    }
    if (tool === "text") {
      run(
        {
          type: "draw.text",
          ...p,
          text,
          color,
          scale: textScale,
          selection: selection || undefined,
        },
        "Insert text",
      );
      return;
    }
    if (tool === "tilePixels") {
      try {
        if (layer?.type !== "tilemap")
          throw Error("Choose a tilemap layer first.");
        const ts = doc.tilesets.find(
          (t) =>
            t.id ===
            (layer.tilemaps?.[activeFrame]?.tilesetId ||
              layer.tilesetId ||
              tilesetId),
        );
        if (!ts) throw Error("Choose a tileset first.");
        const prepared = run(
          { type: "tilemap.paint", tilesetId: ts.id, points: [] },
          "Prepare tile editing",
        );
        if (!prepared) return;
        const map = prepared.layers.find((l) => l.id === activeLayer).tilemaps[
            activeFrame
          ],
          x = Math.floor((p.x - (map.x || 0)) / ts.tileWidth),
          y = Math.floor((p.y - (map.y || 0)) / ts.tileHeight),
          cell = map.cells[y * map.columns + x];
        if (!cell) throw Error("Paint a tile here before editing its pixels.");
        const tile = getTile(prepared, ts.id, cell.tileId);
        setTileDraft({
          ...tile,
          pixels: tile.pixels.map((pixel) =>
            pixel === null ? null : hex(pixelRGBA(prepared, pixel)),
          ),
          x,
          y,
          frameId: activeFrame,
          layerId: activeLayer,
        });
        setModal("tilePixels");
      } catch (error) {
        report(error);
      }
      return;
    }
    if (tool === "tile") {
      paintTile(p);
      return;
    }
    if (tool === "polygon" || tool === "polygonSelect" || tool === "curve") {
      pathRef.current.push(p);
      setNotice(
        `${pathRef.current.length} points · ${tool !== "curve" ? "Enter to close polygon" : "Choose four points"}`,
      );
      if (tool === "curve" && pathRef.current.length === 4) {
        run(
          { type: "draw.curve", points: pathRef.current, color, size: brush },
          "Draw curve",
        );
        pathRef.current = [];
      }
      return;
    }
    operationRef.current = {
      tool,
      points: [p],
      base: docRef.current,
      baseSelection: selection,
    };
    if (tool === "select" || tool === "ellipseSelect") {
      setSelection(
        buildSelection(
          docRef.current,
          {
            shape: tool === "select" ? "rect" : "ellipse",
            x: p.x,
            y: p.y,
            width: 1,
            height: 1,
          },
          selectionMode === "replace" ? null : selection,
          selectionMode,
        ),
      );
    }
    if (tool === "pencil" || tool === "eraser") {
      try {
        const next = applyCommand(docRef.current, commandFor(tool, [p]));
        setDoc(next);
      } catch (error) {
        operationRef.current = null;
        report(error);
      }
    }
  }
  function pointerMove(event) {
    if (!doc) return;
    const p = point(event);
    setCursor(p);
    const op = operationRef.current;
    if (!op) return;
    if (op.tool === "automation") return;
    if (op.tool === "hand") {
      viewportRef.current.scrollLeft =
        op.scroll.x - (event.clientX - op.startClient.x);
      viewportRef.current.scrollTop =
        op.scroll.y - (event.clientY - op.startClient.y);
      return;
    }
    if (op.points.at(-1)?.x === p.x && op.points.at(-1)?.y === p.y) return;
    if (
      stabilize &&
      op.points.length &&
      Math.hypot(p.x - op.points.at(-1).x, p.y - op.points.at(-1).y) < stabilize
    )
      return;
    op.points.push(p);
    if (["select", "ellipseSelect", "lasso"].includes(op.tool)) {
      if (op.tool === "lasso" && op.points.length < 3) return;
      const a = op.points[0];
      try {
        setSelection(
          buildSelection(
            op.base,
            {
              shape:
                op.tool === "select"
                  ? "rect"
                  : op.tool === "ellipseSelect"
                    ? "ellipse"
                    : "lasso",
              x: Math.min(a.x, p.x),
              y: Math.min(a.y, p.y),
              width: Math.abs(p.x - a.x) + 1,
              height: Math.abs(p.y - a.y) + 1,
              points: op.points,
            },
            selectionMode === "replace" ? null : op.baseSelection,
            selectionMode,
          ),
        );
      } catch (error) {
        report(error);
      }
      return;
    }
    try {
      const command = commandFor(op.tool, op.points);
      if (command) setDoc(applyCommand(op.base, command));
    } catch (error) {
      report(error);
    }
  }
  function pointerUp(event) {
    const op = operationRef.current;
    if (!op) return;
    if (op.tool === "automation") return;
    operationRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (
      op.tool === "hand" ||
      ["select", "ellipseSelect", "lasso"].includes(op.tool)
    )
      return;
    try {
      const command = commandFor(op.tool, op.points);
      if (command) {
        const next = applyCommand(op.base, command);
        historyRef.current.commit(next, op.tool);
        if (typeof libraryStateRef !== "undefined") libraryStateRef.current = {status:"dirty", revision:storedRevisionRef.current ?? null, error:libraryStateRef.current.error}; setSaveStatus("Unsaved changes");
        docRef.current = next;
        revisionRef.current++;
        documentRevisionsRef.current.set(docRef.current.id, (documentRevisionsRef.current.get(docRef.current.id) || 0) + 1);
        analyticsRef.current.committed(command, historyRef.current.lastChange?.changed);
        setDoc(next);
        setHistoryVersion((v) => v + 1);
        setHistoryState({
          canUndo: historyRef.current?.canUndo || false,
          canRedo: historyRef.current?.canRedo || false,
        });
      }
    } catch (error) {
      setDoc(op.base);
      report(error);
    }
  }
  function finishPolygon() {
    if (tool === "polygonSelect") {
      if (pathRef.current.length >= 3) {
        setSelection(
          buildSelection(
            doc,
            { shape: "lasso", points: pathRef.current },
            selection,
            selectionMode,
          ),
        );
        pathRef.current = [];
      }
      return;
    }
    if (pathRef.current.length >= 3) {
      run(
        { type: "draw.polygon", points: pathRef.current, color, filled },
        "Draw polygon",
      );
      pathRef.current = [];
      setNotice("Polygon drawn");
    }
  }
  function stampIsometricShape() {
    if (run({ type: "draw.isometric", frameId: activeFrame, layerId: activeLayer, selection: selection || undefined, ...isoShapeOptions }, "Insert isometric shape")) setModal(null);
  }
  function selectAll() {
    if (luaAbortRef.current || nativeSessionRef.current?.busy || automationRef.current?.desktop.locked) return;
    setSelection(Array(doc.width * doc.height).fill(1));
  }
  async function copy({system = true, cut = false, throwOnError = false} = {}) {
    let ownsBusy = false, writeToken;
    const bridge = system ? window.pixelwallNativeClipboard : null;
    const before = docRef.current, revision = revisionRef.current, context = uiContextRef.current;
    try {
      automationRef.current?.desktop.assertEditable();
      if (busyRef.current || luaAbortRef.current || nativeSessionRef.current?.busy || operationRef.current || restoringRef.current) throw Error("Finish the current operation before copying.");
      if (!maskBounds || !context?.selection) throw Error("Select an area first.");
      const cel = getCel(before, context.active.frameId, context.active.layerId);
      if (!cel) throw Error("The active cel has no pixels to copy.");
      if (bridge) {
        setBusy(true);ownsBusy = true;
        const reserved = await bridge.beginWrite();
        if (reserved?.status !== "reserved" || !reserved.token) throw Error(reserved?.reason || "Use Copy or Cut again to copy this image.");
        writeToken = reserved.token;
      }
      const rgba = renderFrame({...before,
        layers:before.layers.map(layer => ({...layer, visible:layer.id === context.active.layerId || layer.type === "group", locked:false, opacity:1, blendMode:"normal"})),
        frames:before.frames.map(frame => ({...frame,cels:Object.fromEntries(Object.entries(frame.cels).map(([id,cel]) => [id,{...cel,opacity:1}]))})),
      }, context.active.frameId);
      const pixels = [], cropped = new Uint8Array(maskBounds.width * maskBounds.height * 4);
      for (let y = 0; y < maskBounds.height; y++) for (let x = 0; x < maskBounds.width; x++) {
        const index = (maskBounds.y + y) * before.width + maskBounds.x + x, target = y * maskBounds.width + x;
        const value = rgba.subarray(index * 4, index * 4 + 4);
        pixels.push(context.selection[index] ? hex(value) : null);
        if (context.selection[index]) cropped.set(value,target * 4);
      }
      const copied = {...maskBounds,pixels,colorProfile:structuredClone(documentProfile(before))};
      setClipboard(copied);
      if (!system) {setNotice("Selection copied inside PixelWall.");return copied;}
      if (!bridge && (!navigator.clipboard?.write || !window.ClipboardItem)) {
        if (cut) throw Error("The system image clipboard is unavailable. Your artwork has been kept; use Paste copied pixels for the internal copy.");
        setNotice("Copied inside PixelWall. Use Paste copied pixels.");return copied;
      }
      setBusy(true);ownsBusy = true;
      const encoded = (async () => {
        const manager = colorManager || await loadBrowserColorManager();
        return encodeClipboardImage({width:copied.width,height:copied.height,rgba:manager.transformRGBA(cropped, copied.colorProfile, "sRGB")});
      })();
      if (bridge) {
        const result = await bridge.writeImage({...await encoded, token:writeToken});
        if (result?.status !== "written") throw Error(result?.reason || "The system image clipboard could not be written.");
      } else {
        // Passing a promised Blob starts the permission request in the user's click.
        await navigator.clipboard.write([new ClipboardItem({"image/png":encoded.then(payload => new Blob([payload.bytes],{type:"image/png"}))})]);
      }
      if (cut) {
        if (docRef.current !== before || revisionRef.current !== revision || !historyValuesEqual(context, uiContextRef.current)) throw Error("The selection was copied, but the project changed before Cut could remove it. Your artwork has been kept.");
        commit({type:"selection.clear", selection:Array.from(context.selection), frameId:context.active.frameId, layerId:context.active.layerId}, "Cut selection");
      }
      setNotice(cut ? "Selection cut to the system clipboard. Undo restores the pixels." : "Selection copied to the system clipboard.");
      return copied;
    } catch (error) {if (throwOnError) throw error;report(error);return null;}
    finally { if (writeToken) await bridge.cancelWrite({token:writeToken}).catch(() => {}); if (ownsBusy) setBusy(false); }
  }
  async function paste({localOnly = false, throwOnError = false} = {}) {
    const before = docRef.current, revision = revisionRef.current, context = uiContextRef.current;
    let ownsBusy = false;
    try {
      automationRef.current?.desktop.assertEditable();
      if (busyRef.current || luaAbortRef.current || nativeSessionRef.current?.busy || operationRef.current || restoringRef.current) throw Error("Finish the current operation before pasting.");
      setBusy(true);ownsBusy = true;
      let copied = clipboard;
      if (!localOnly) {
        let payload;
        if (window.pixelwallNativeClipboard) {
          payload = await window.pixelwallNativeClipboard.readImage();
          if (payload?.status !== "image") throw Error(payload?.reason || "The system clipboard contains no image.");
        } else {
          if (!navigator.clipboard?.read) throw Error("The system image clipboard is unavailable. Use Paste copied pixels for an internal copy.");
          const items = await navigator.clipboard.read(), item = items.find(item => item.types.includes("image/png"));
          if (!item) throw Error("The system clipboard contains no PNG image.");
          const blob = await item.getType("image/png");
          if (blob.size > 32 * 1024 * 1024) throw Error("The clipboard image exceeds 32 MB.");
          payload = {format:"png",bytes:new Uint8Array(await blob.arrayBuffer())};
        }
        const image = decodeClipboardImage(payload);
        copied = {width:image.width,height:image.height,x:0,y:0,pixels:pixelsFromRgba(image.rgba),colorProfile:image.colorProfile || "sRGB"};
        if (image.warnings?.length) setImportWarnings(image.warnings);
      }
      if (!copied) throw Error("Copy pixels inside PixelWall first.");
      const manager = colorManager || await loadBrowserColorManager();
      const pixels = transferPixelColors(copied.pixels,copied.colorProfile || "sRGB",documentProfile(before),manager);
      if (docRef.current !== before || revisionRef.current !== revision || !historyValuesEqual(context,uiContextRef.current)) throw Error("The project or selection changed while reading the clipboard. Paste again.");
      const x = localOnly ? copied.x + 1 : bounds(context.selection,before.width)?.x || 0;
      const y = localOnly ? copied.y + 1 : bounds(context.selection,before.width)?.y || 0;
      const next = commit({type:"image.stamp",width:copied.width,height:copied.height,pixels,x,y,transparent:"skip",frameId:context.active.frameId,layerId:context.active.layerId},"Paste image");
      setSelection(buildSelection(next,{shape:"rect",x,y,width:copied.width,height:copied.height}));
      setNotice(localOnly ? "Copied pixels pasted." : "System clipboard image pasted. Untagged images are treated as sRGB.");
      canvasRef.current?.focus({preventScroll:true});
      return next;
    } catch (error) {if (throwOnError) throw error;report(error);return null;}
    finally {if (ownsBusy) setBusy(false);}
  }
  function captureBrush() {
    if (!clipboard) {
      void copy({system:false});
      setNotice(
        "Selection copied. Choose Use copied pixels as brush to capture it.",
      );
      return;
    }
    setCustomBrush({
      width: clipboard.width,
      height: clipboard.height,
      pixels: clipboard.pixels.map((p) => (p && p.slice(-2) !== "00" ? 1 : 0)),
      colors: clipboard.pixels,
      colorProfile:structuredClone(clipboard.colorProfile || "sRGB"),
    });
    setTool("pencil");
    setNotice("Custom brush ready");
  }
  function transform(operation, extra = {}) {
    if (!selection) {
      setNotice("Select pixels first.");
      return false;
    }
    const result = run(
      targetCels()
        .filter((target, index, list) => {
          const imageId = doc.frames.find((f) => f.id === target.frameId)?.cels[
            target.layerId
          ]?.imageId;
          return (
            imageId &&
            list.findIndex(
              (t) =>
                doc.frames.find((f) => f.id === t.frameId)?.cels[t.layerId]
                  ?.imageId === imageId,
            ) === index
          );
        })
        .map((target) => ({
          type: "selection.transform",
          ...target,
          selection,
          operation,
          method: operation === "rotate" ? rotationMethod : "nearest",
          ...extra,
        })),
      "Transform selection",
    );
    if (!result) return false;
    if (operation === "move") {
      const moved = Array(doc.width * doc.height).fill(0);
      selection.forEach((v, i) => {
        if (v) {
          const x = (i % doc.width) + (extra.dx || 0),
            y = Math.floor(i / doc.width) + (extra.dy || 0);
          if (x >= 0 && y >= 0 && x < doc.width && y < doc.height)
            moved[y * doc.width + x] = 1;
        }
      });
      setSelection(moved);
    } else setSelection(null);
    return true;
  }
  function onKey(event) {
    if (modal || restoringRef.current || luaAbortRef.current || nativeSessionRef.current?.busy || automationRef.current?.desktop.locked) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (modifier && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (modifier && key === "s") {
      event.preventDefault();
      if (nativeSessionRef.current) void automationRef.current.desktop.action(event.shiftKey ? "saveAs" : "save").catch(report);
      else void save().catch(() => {});
      return;
    }
    if (modifier && key === "a") {
      event.preventDefault();
      selectAll();
      return;
    }
    if (modifier && key === "c") {
      event.preventDefault();
      copy();
      return;
    }
    if (modifier && key === "x") {
      event.preventDefault();
      void copy({cut:true});
      return;
    }
    if (modifier && key === "v") {
      event.preventDefault();
      paste();
      return;
    }
    if (modifier && key === "k") {
      event.preventDefault();
      setModal("commands");
      return;
    }
    if (event.key === "Escape") {
      setSelection(null);
      pathRef.current = [];
      setPlaying(false);
      return;
    }
    if (
      event.key === "Enter" &&
      (tool === "polygon" || tool === "polygonSelect")
    ) {
      finishPolygon();
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      setPlaying((p) => !p);
      return;
    }
    if (selection && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const n = event.shiftKey ? 5 : 1;
      transform("move", {
        dx: event.key === "ArrowRight" ? n : event.key === "ArrowLeft" ? -n : 0,
        dy: event.key === "ArrowDown" ? n : event.key === "ArrowUp" ? -n : 0,
      });
      return;
    }
    if (selection && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      run(
        {
          type: "selection.clear",
          selection,
        },
        "Clear selection",
      );
      return;
    }
    const found = TOOLS.find(
      ([id, , , shortcut]) => (settings.shortcuts[id] || shortcut) === key,
    );
    if (found) {
      event.preventDefault();
      setTool(found[0]);
    }
  }
  async function openDocument(id) {
    try {
      if (nativeSessionRef.current?.busy) throw Error("Finish the current file operation first.");
      if (luaAbortRef.current) throw Error("Wait for the Lua script to finish or cancel it.");
      automationRef.current?.desktop.assertEditable();
      setBusy(true);
      if (id === docRef.current?.id) return true;
      if (temporaryDocumentsRef.current.has(id)) {
        await hostRef.current.restoreTemporary({documentId:id});
        setClosedDocuments(ids => ids.filter(value => value !== id));
        return true;
      }
      const loaded = await storeRef.current.loadDocument(id);
      if (!loaded) throw Error("Project could not be found.");
      if (documentModeRef.current === "library") {
        const result = await saveBeforeSwitch();
        if (!result || result.saved === false) throw Error("Save the current project or open another file temporarily before switching.");
      } else if (docRef.current) {
        if (temporaryDocumentsRef.current.size >= 8 && !temporaryDocumentsRef.current.has(docRef.current.id)) throw Error("At most eight retained documents are supported; checkpoint retained work before opening another.");
        temporaryDocumentsRef.current.set(docRef.current.id, {document:docRef.current, revision:revisionRef.current, storedRevision:storedRevisionRef.current, mode:documentModeRef.current, checkpoint:checkpointDeliveryRef.current ?? null});
      }
      await activate(loaded.document, loaded.revision);
      setClosedDocuments(ids => ids.filter(value => value !== id));
      analyticsRef.current.project("open", "completed");
      return true;
    } catch (error) {
      analyticsRef.current.project("open", "failed");
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function closeDocumentTab(id) {
    if (busy || luaAbortRef.current || nativeSessionRef.current?.busy) return;
    if (id === docRef.current?.id) {
      const others = documents.filter(d => d.id !== id && !closedDocuments.includes(d.id));
      const next = others[0] || documents.find(d => d.id !== id);
      if (!next) {
        setNotice("This is your only project. Create another project before closing this tab.");
        return;
      }
      if (!await openDocument(next.id)) return;
    }
    setClosedDocuments(ids => [...new Set([...ids, id])]);
    setNotice(temporaryDocumentsRef.current.has(id)
      ? "Tab closed. Your work is retained for this session in Storage. Save a checkpoint before leaving."
      : "Tab closed. Reopen it from All projects; your artwork is still saved on this device.");
  }
  function dockPanels(side) {
    panelDrag.current = null;
    setSettings(current => ({...current, sidebar:side}));
  }
  async function decodeImage(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".tga"))
      return readTga(new Uint8Array(await file.arrayBuffer()));
    if (file.name.toLowerCase().endsWith(".bmp"))
      return readBmp(new Uint8Array(await file.arrayBuffer()));
    if (file.name.toLowerCase().endsWith(".png")) {
      const image = readPng(bytes);
      if (image.colorProfile) {
        const manager = colorManager || await loadBrowserColorManager();
        return {...image, rgba:manager.transformRGBA(image.rgba, image.colorProfile), colorProfile:undefined};
      }
      return image;
    }
    const bitmap = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      width: c.width,
      height: c.height,
      rgba: ctx.getImageData(0, 0, c.width, c.height).data,
    };
  }
  function pixelsFromRgba(rgba) {
    return Array.from({ length: rgba.length / 4 }, (_, i) =>
      rgba[i * 4 + 3] ? hex(rgba.slice(i * 4, i * 4 + 4)) : null,
    );
  }
  async function importFiles(files, kind = importKind) {
    if (!files.length) return;
    if (nativeSessionRef.current?.busy) { report(Error("Finish the current file operation first.")); return; }
    if (luaAbortRef.current) { report(Error("Wait for the Lua script to finish or cancel it.")); return; }
    if (automationRef.current?.desktop.locked) {
      report(Error("Finish the close dialog before importing artwork."));
      return;
    }
    setBusy(true);
    const file = files[0],
      ext = file.name.toLowerCase().split(".").pop(),
      importFormat = analyticsFormat(ext);
    try {
      let next,
        warnings = [];
      if (kind === "profile") {
        const manager = colorManager || await loadBrowserColorManager();
        const profile = manager.readProfile(new Uint8Array(await file.arrayBuffer()));
        setImportedProfile(profile);
        setProfileTarget("imported");
        setModal("profile");
        return;
      }
      if (kind === "lua") {
        if (file.size > 256 * 1024) throw Error("Lua scripts must be 256 KiB or smaller.");
        setLuaSource(await file.text());
        setScriptLanguage("lua");
        setPanel("automation");
        return;
      }
      if (kind === "extension") {
        const extension = validateExtension(JSON.parse(await file.text()));
        const updated = [
          ...extensions.filter((e) => e.id !== extension.id),
          extension,
        ];
        await storeRef.current.setSetting("extensions", updated);
        setExtensions(updated);
        analyticsRef.current.imported(kind, importFormat, files.length);
        setNotice(
          extension.name + " installed. Choose Run in Scripts to apply it.",
        );
        return;
      }
      if (kind === "palette") {
        const imported = run(
          { type: "palette.update", ...paletteTarget(), palette: parsePalette(await file.text()) },
          "Import palette",
        );
        analyticsRef.current.imported(kind, importFormat, files.length, 0, !imported);
        return;
      }
      if (kind === "sequence") {
        const ordered = [...files].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
        const images = await Promise.all(ordered.map(decodeImage));
        warnings = images.flatMap((i) => i.warnings || []);
        next = createDocument({
          name: stem(file.name),
          width: Math.max(...images.map((i) => i.width)),
          height: Math.max(...images.map((i) => i.height)),
        });
        for (let i = 0; i < images.length; i++) {
          if (i)
            next = applyCommand(next, {
              type: "frame.add",
              clipId: next.clips[0]?.id,
            });
          next = applyCommand(next, {
            type: "cel.set",
            frameId: next.frames.at(-1).id,
            layerId: next.layers[0].id,
            width: images[i].width,
            height: images[i].height,
            pixels: pixelsFromRgba(images[i].rgba),
          });
        }
      } else if (kind === "reference") {
        const before = docRef.current, revision = revisionRef.current;
        const image = await decodeImage(file);
        const manager = colorManager || await loadBrowserColorManager();
        const workingPixels = manager.transformRGBA(image.rgba, "sRGB", documentProfile(before));
        if (docRef.current !== before || revisionRef.current !== revision) throw Error("The project changed while reading the reference. Import it again.");
        warnings.push(...(image.warnings || []));
        const id = "reference-" + Date.now();
        const imported = run(
          [
            {
              type: "layer.add",
              layer: { id, name: file.name, type: "reference", opacity: 0.4 },
            },
            {
              type: "cel.set",
              layerId: id,
              width: image.width,
              height: image.height,
              pixels: pixelsFromRgba(workingPixels),
              x: 0,
              y: 0,
            },
            { type: "layer.update", layerId: id, patch: { locked: true } },
          ],
          "Import reference",
        );
        analyticsRef.current.imported(kind, importFormat, files.length, warnings.length, !imported);
        setActiveLayer(id);
        setNotice("Reference imported. Unlock it to move or transform.");
        if (warnings.length) {
          setImportWarnings(warnings);
          setModal("warnings");
        }
        return;
      } else if (kind === "sheet") {
        const image = await decodeImage(file);
        warnings.push(...(image.warnings || []));
        pendingImportFormatRef.current = importFormat;
        setPendingImage({ ...image, name: stem(file.name) });
        setImportWarnings(warnings);
        setModal("sheet");
        return;
      } else if (ext === "ase" || ext === "aseprite") {
        const result = readAseprite(new Uint8Array(await file.arrayBuffer()));
        next = result.document;
        warnings = result.warnings || [];
      } else if (ext === "gif") {
        const result = importGif(new Uint8Array(await file.arrayBuffer()));
        next = result.document;
        warnings = result.warnings || [];
      } else if (["pixelwall", "json"].includes(ext)) {
        const raw = decodeProjectContainer(new Uint8Array(await file.arrayBuffer()));
        if (raw.version === 4 && raw.format === "pixelwall-document")
          next = normalizeDocument(raw);
        else {
          const parsed = parseProject(JSON.stringify(raw));
          next = migrateLegacy(parsed);
        }
      } else {
        const image = await decodeImage(file);
        warnings.push(...(image.warnings || []));
        next = createDocument({
          name: stem(file.name),
          width: image.width,
          height: image.height,
        });
        next = applyCommand(next, {
          type: "cel.set",
          frameId: next.frames[0].id,
          layerId: next.layers[0].id,
          width: image.width,
          height: image.height,
          pixels: pixelsFromRgba(image.rgba),
        });
      }
      if (kind === "temporary") {
        if (docRef.current) { if (temporaryDocumentsRef.current.size >= 8 && !temporaryDocumentsRef.current.has(docRef.current.id)) throw Error("At most eight retained documents are supported; restore or checkpoint one before opening another."); temporaryDocumentsRef.current.set(docRef.current.id, {document:docRef.current, revision:revisionRef.current, storedRevision:storedRevisionRef.current, mode:documentModeRef.current, checkpoint:checkpointDeliveryRef.current ?? null}); }
        await activate({ ...next, id: crypto.randomUUID() }, undefined, {mode:"temporary"});
      } else {
        const saved = await saveBeforeSwitch();
        if (!saved || saved.saved === false) throw Error("Save a checkpoint or bound file before opening another project.");
        await activate({ ...next, id: crypto.randomUUID() });
      }
      analyticsRef.current.imported(kind, importFormat, files.length, warnings.length);
      setImportWarnings(warnings);
      setNotice(
        warnings.length
          ? `Imported with ${warnings.length} compatibility notes.`
          : "Project imported",
      );
      if (warnings.length) setModal("warnings");
    } catch (error) {
      analyticsRef.current.imported(kind, importFormat, files.length, 0, true);
      report(error);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function chooseImport(kind) {
    setImportKind(kind);
    fileRef.current.multiple = kind === "sequence";
    fileRef.current.click();
  }
  function exportFrameIds(options, source = docRef.current) {
    if (!["gif", "sheet", "zip"].includes(options.format)) return {ids:[],loop:true};
    const clip = source.clips?.find(
      (c) => c.id === (options.clipId || clipId),
    );
    if (options.clipId && !clip) throw Error("The export clip no longer exists.");
    const ids = exportFrameTraversal(source, options.format === "gif"
      ? {clip,playSubtags:true,clipScope:"contained"}
      : {clip,playSubtags:false,legacyDirection:false}).map(index => source.frames[index].id);
    return { ids, loop: clip?.loop !== false };
  }
  function buildExportAtlasPlan(source, frameIds, scale, layerIds, options) {
    const sourcePixels = Math.max(1, Math.trunc(source.width * scale)) * Math.max(1, Math.trunc(source.height * scale)) * frameIds.length;
    if (!Number.isSafeInteger(sourcePixels) || sourcePixels > 16 * 1024 * 1024) throw Error("This atlas exceeds the export memory budget. Reduce scale or select a shorter clip.");
    const visible = new Set(layerIds), byId = new Map(source.layers.map(layer => [layer.id, layer]));
    for (let pass = 0; pass < source.layers.length; pass++) for (const layer of source.layers) if (visible.has(layer.parentId)) visible.add(layer.id);
    for (const id of [...visible]) { let layer = byId.get(id); while (layer?.parentId) { visible.add(layer.parentId); layer = byId.get(layer.parentId); } }
    const scoped = { ...source, layers: source.layers.map(layer => ({ ...layer, visible: visible.has(layer.id) && (options.includeReferenceLayers || layer.type !== "reference") })) };
    const entries = frameIds.map((id, index) => ({ id, name: `${stem(source.name)}-${String(index + 1).padStart(3, "0")}`, ...renderScaledExportFrame(scoped, id, scale, { colorManager, intent: renderingIntent }), durationMs: source.frames.find(frame => frame.id === id)?.durationMs ?? 100 }));
    const layout = ["rows", "columns"].includes(options.layout) ? "grid" : options.layout || "packed";
    const columns = options.layout === "columns" && options.rows ? Math.ceil(entries.length / options.rows) : options.columns;
    const atlas = packAtlas(entries, { trim: options.trim !== false, padding: Number(options.padding ?? 1), border: Number(options.border ?? options.padding ?? 1), extrude: Number(options.extrude ?? 1), powerOfTwo: !!options.powerOfTwo, layout, ...(columns ? { columns } : {}), ...(options.width ? { width: Number(options.width) } : {}), ...(options.height ? { height: Number(options.height) } : {}), maxSize: Number(options.maxSize ?? 16384), maxPixels: 16 * 1024 * 1024, planOnly: true, scale: 1, clips: source.clips, slices: scaleExportSlices(source.slices, scale, scale) });
    if (atlas.width * atlas.height * 4 > 64 * 1024 * 1024) throw Error("The generated atlas exceeds the export memory budget. Reduce padding, scale, or frame count.");
    return { width: atlas.width, height: atlas.height, frames: atlas.frames, layout: atlas.meta.layout, padding: atlas.meta.padding, border: atlas.meta.border, extrude: atlas.meta.extrude, trim: options.trim !== false, powerOfTwo: !!options.powerOfTwo };
  }
  function createExportPlan(options = {}, source = docRef.current) {
    if (!source) throw Error("Open a project first.");
    const format = options.format || "png", native = ["project", "aseprite"].includes(format), scale = native ? 1 : validateExportScale(options.scale ?? 1);
    if (!["png","bmp","tga","project","aseprite","gif","sheet","zip"].includes(format)) throw Error("Unsupported export format.");
    const clip = source.clips?.find(c => c.id === (options.clipId || clipId));
    if (options.clipId && !clip) throw Error("The export clip no longer exists.");
    const traversal = exportFrameIds(options, source), fid = options.frameId || activeRef.current.frameId;
    const frameIds = ["project", "aseprite"].includes(format) ? source.frames.map(frame => frame.id) : format === "gif" || format === "sheet" || format === "zip" ? traversal.ids : [fid];
    if (!frameIds.every(id => source.frames.some(frame => frame.id === id))) throw Error("The export frame no longer exists.");
    if (options.expectedFrameCount !== undefined && options.expectedFrameCount !== frameIds.length) throw Error("The export frame count changed. Reinspect the document and plan again.");
    const selected = options.layers === "active" ? [activeRef.current.layerId] : options.layers === "selected" ? targetLayers() : options.layerIds;
    if (selected?.some(id => !source.layers.some(layer => layer.id === id))) throw Error("An export layer no longer exists.");
    const chosen = selected?.length ? new Set(selected) : null;
    if (chosen) for (let pass=0;pass<source.layers.length;pass++) for (const layer of source.layers) if(chosen.has(layer.parentId))chosen.add(layer.id);
    const byId = new Map(source.layers.map(layer=>[layer.id,layer]));
    const visible = layer => { for(let item=layer;item;item=byId.get(item.parentId))if(!item.visible)return false; return true; };
    const layerIds = native ? source.layers.map(layer=>layer.id) : source.layers.filter(layer=>layer.type !== "group" && (chosen ? chosen.has(layer.id) : visible(layer)) && (options.includeReferenceLayers || layer.type !== "reference")).map(layer=>layer.id);
    const requiredEntitlement = PAID_FORMATS.has(format) ? "pro" : "free", canExport = requiredEntitlement === "free" || access.pro === true;
    const filename = stem(source.name) + "." + (format === "project" ? "pixelwall" : format === "sheet" ? "png" : format);
    const width = Math.max(1, Math.trunc(source.width * scale)), height = Math.max(1, Math.trunc(source.height * scale));
    const atlas = format === "sheet" || format === "zip" ? (options.skipAtlasPlan ? null : buildExportAtlasPlan(source, frameIds, scale, layerIds, options)) : null;
    return {documentId:source.id, revision:revisionRef.current, format, scale, frameId:fid, frameIds, frameCount:frameIds.length, durations:frameIds.map(id => source.frames.find(frame => frame.id === id)?.durationMs ?? 0), loop:traversal.loop, sourceWidth:width, sourceHeight:height, outputWidth:atlas?.width ?? width, outputHeight:atlas?.height ?? height, width:atlas?.width ?? width, height:atlas?.height ?? height, atlas, layerIds, includeReferenceLayers:native || options.includeReferenceLayers === true, requiredEntitlement, entitlement:access.pro === true ? "pro" : "free", canExport, freeAlternative:requiredEntitlement === "pro" ? "Export PNG frames individually." : null, filenames:format === "sheet" ? [filename,stem(source.name)+".json"] : [filename], delivery:{status:"not_requested",conflicts:"checked-by-native-delivery",browserCompletionObservable:false}, memoryBudgetBytes:format === "gif" ? width * height * frameIds.length * 4 : format === "sheet" || format === "zip" ? (atlas?.width ?? width) * (atlas?.height ?? height) * 4 : width * height * 4, files:format === "sheet" ? 2 : 1};
  }
  async function exportArtwork(options = {}, source = "ui") {
    const attempt = analyticsRef.current.exportStarted(options.format || "png", source);
    try {
      const result = await generateArtwork(options);
      analyticsRef.current.exportFinished(attempt);
      return result;
    } catch (error) {
      analyticsRef.current.exportFinished(attempt, error);
      throw error;
    }
  }
  async function generateArtwork(options = {}) {
    const source = docRef.current;
    if (!source) throw Error("Open a project first.");
    const sourceRevision = revisionRef.current;
    let current = source;
    const chosen =
      options.layers === "active"
        ? [activeRef.current.layerId]
        : options.layers === "selected"
          ? targetLayers()
          : options.layerIds;
    if (chosen?.length && !["project", "aseprite"].includes(options.format)) {
      if (chosen.some((id) => !source.layers.some((l) => l.id === id)))
        throw Error("An export layer no longer exists.");
      const visible = new Set(chosen);
      for (let pass = 0; pass < source.layers.length; pass++)
        for (const layer of source.layers)
          if (visible.has(layer.parentId)) visible.add(layer.id);
      const ancestors = new Set(visible);
      for (let pass = 0; pass < source.layers.length; pass++)
        for (const layer of source.layers)
          if (ancestors.has(layer.id) && layer.parentId)
            ancestors.add(layer.parentId);
      current = {
        ...source,
        layers: source.layers.map((l) => ({
          ...l,
          visible: ancestors.has(l.id),
        })),
      };
    }
    if (
      !["project", "aseprite"].includes(options.format) &&
      !options.includeReferenceLayers
    )
      current = {
        ...current,
        layers: current.layers.map((l) =>
          l.type === "reference" ? { ...l, visible: false } : l,
        ),
      };
    const format = options.format || "png",
      scale = ["project", "aseprite"].includes(format) ? 1 : validateExportScale(options.scale ?? 1);
    const plan = createExportPlan({ ...options, skipAtlasPlan: true }, source);
    const fid = plan.frameId, ids = plan.frameIds, loop = plan.loop;
    const width = Math.max(1, Math.trunc(current.width * scale)), height = Math.max(1, Math.trunc(current.height * scale));
    if (PAID_FORMATS.has(format) && !(await access.requestAccess())) {
      const error = Error("Pro access is required for this export.");
      error.name = "ProExportRequired";
      throw error;
    }
    if (docRef.current !== source || revisionRef.current !== sourceRevision) throw Error("The project changed while export access was being checked. Plan the export again.");
    const rendering = {colorManager:!["project", "aseprite"].includes(format) && !isSRGB(documentProfile(current)) ? colorManager || await loadBrowserColorManager() : colorManager, intent:renderingIntent};
    let bytes,
      companion,
      mime = "application/octet-stream",
      suffix = format;
    if (format === "project") {
      bytes = encodeProjectContainer(current);
      suffix = "pixelwall";
      mime = "application/octet-stream";
    } else if (format === "aseprite") {
      bytes = writeAseprite(current);
    } else if (format === "bmp" || format === "tga") {
      const image = renderScaledExportFrame(current, fid, scale, rendering);
      bytes = (format === "bmp" ? writeBmp : writeTga)(image.width, image.height, image.rgba);
    } else if (format === "png") {
      const image = renderScaledExportFrame(current, fid, scale, rendering);
      bytes = writePng(image.width, image.height, image.rgba);
      mime = "image/png";
    } else if (format === "gif") {
      if (
        width * height * ids.length >
        64 * 1024 * 1024
      )
        throw Error(
          "This GIF exceeds the export memory budget. Reduce scale or select a shorter clip.",
        );
      const entries = [];
      for (let n = 0; n < ids.length; n++) {
        const f = current.frames.find((f) => f.id === ids[n]);
        entries.push({
          ...renderScaledExportFrame(current, f.id, scale, rendering),
          durationMs: f.durationMs,
        });
        if (n % 4 === 0) await deferred();
      }
      bytes = encodeGif(entries, { loop: loop ? 0 : -1 });
      mime = "image/gif";
    } else if (format === "sheet" || format === "zip") {
      if (
        width * height * ids.length >
        64 * 1024 * 1024
      )
        throw Error(
          "This export exceeds the memory budget. Reduce scale or select a shorter clip.",
        );
      const entries = ids.map((id, index) => ({
        id,
        name: `${stem(current.name)}-${String(index + 1).padStart(3, "0")}`,
        ...renderScaledExportFrame(current, id, scale, rendering),
        durationMs: current.frames.find((f) => f.id === id).durationMs,
      }));
      const atlas = packAtlas(entries, {
        padding: Number(options.padding ?? 1),
        border: Number(options.border ?? options.padding ?? 1),
        extrude: Number(options.extrude ?? 1),
        trim: options.trim !== false,
        powerOfTwo: !!options.powerOfTwo,
        layout: ["rows", "columns"].includes(options.layout) ? "grid" : options.layout || "packed",
        ...(options.columns || (options.layout === "columns" && options.rows) ? { columns: options.layout === "columns" && options.rows ? Math.ceil(entries.length / options.rows) : Number(options.columns) } : {}),
        ...(options.width ? { width: Number(options.width) } : {}),
        ...(options.height ? { height: Number(options.height) } : {}),
        maxSize: Number(options.maxSize ?? 16384),
        maxPixels: 16 * 1024 * 1024,
        imageName:
          format === "sheet" ? stem(current.name) + ".png" : "sprites.png",
        scale: 1,
        clips: current.clips,
        slices: scaleExportSlices(current.slices, width / current.width, height / current.height),
      });
      atlas.meta.scale = String(scale);
      atlas.meta.sourceSlices = current.slices;
      const png = writePng(atlas.width, atlas.height, atlas.rgba);
      if (format === "sheet") {
        companion = {
          blob: new Blob(
            [
              JSON.stringify(
                { frames: atlas.frames, meta: atlas.meta },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
          filename: stem(current.name) + ".json",
        };
        bytes = png;
        suffix = "png";
        mime = "image/png";
      } else {
        bytes = makeGamePackage(current, { ...rendering, entries, atlas, projectDocument:source });
        mime = "application/zip";
      }
    } else throw Error("Unsupported export format.");
    if (docRef.current !== source || revisionRef.current !== sourceRevision) throw Error("The project changed while the export was being prepared. No artifact was published.");
    const filename = `${stem(current.name)}.${suffix}`;
    const exportResult = await downloads.publishFiles([
      { blob: new Blob([bytes], { type: mime }), filename },
      ...(companion ? [companion] : []),
    ], { request: options.download !== false });
    setNotice(`${filename} exported · ${bytes.length.toLocaleString()} bytes`);
    return { filename, bytes: bytes.length, mime, exportResult };
  }
  async function doExport(options) {
    setBusy(true);
    try {
      const result = await exportArtwork(options);
      setModal(null);
      return result;
    } catch (error) {
      report(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }
  async function applyAutomation(commands, label = "Script", {onProgress, signal} = {}) {
    automationRef.current?.desktop.assertEditable();
    if (nativeSessionRef.current?.busy || luaAbortRef.current || restoringRef.current || operationRef.current)
      throw Error("Finish the current operation before applying commands.");
    const before = docRef.current;
    const capturedRevision = revisionRef.current;
    if (!before) throw Error("Open a project first.");
    const list = structuredClone(Array.isArray(commands) ? commands : [commands]);
    const capturedFrameId = activeRef.current.frameId;
    const capturedLayerId = activeRef.current.layerId;
    const callerSignal = signal;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    callerSignal?.addEventListener("abort", cancel, {once:true});
    if (callerSignal?.aborted) cancel();
    signal = controller.signal;
    const lock = {tool:"automation", base:before, cancel};
    operationRef.current = lock;
    let next = before;
    let processed = 0;
    const phaseStarted = performance.now(), phaseTimings = {};
    const announcePhase = phase => {
      phaseTimings[phase] = { startedAtMs: Math.round(performance.now() - phaseStarted) };
      onProgress?.({status:"running", phase, commandsProcessed:processed, commandsTotal:list.length, revision:capturedRevision, phaseTimings:structuredClone(phaseTimings)});
    };
    const finishPhase = phase => { if (phaseTimings[phase]) phaseTimings[phase].durationMs = Math.max(0, Math.round(performance.now() - phaseStarted - phaseTimings[phase].startedAtMs)); };
    try {
      announcePhase("validation");
      await deferred();
      finishPhase("validation");
      announcePhase("staging");
      let yieldedAt = performance.now();
      for (let index = 0; index < list.length; index++) {
        throwIfCancelled(signal);
        if (docRef.current !== before || revisionRef.current !== capturedRevision || operationRef.current !== lock)
          throw Error("The project changed while the edit was running. No partial edits were committed.");
        next = applyCommand(next, {frameId:capturedFrameId, layerId:capturedLayerId, ...list[index]});
        processed = index + 1;
        onProgress?.({status:"running", commandsProcessed:index + 1, commandsTotal:list.length, revision:capturedRevision});
        if ((index + 1) % 32 === 0 || performance.now() - yieldedAt >= 16) {
          await deferred();
          yieldedAt = performance.now();
        }
      }
      if (docRef.current !== before || revisionRef.current !== capturedRevision || operationRef.current !== lock)
        throw Error("The project changed while the edit was running. No partial edits were committed.");
      throwIfCancelled(signal);
      finishPhase("staging");
      announcePhase("committing");
      historyRef.current.commit(next, label);
      if (typeof libraryStateRef !== "undefined") libraryStateRef.current = {status:"dirty", revision:storedRevisionRef.current ?? null, error:libraryStateRef.current.error}; setSaveStatus("Unsaved changes");
      docRef.current = next;
      revisionRef.current++;
      documentRevisionsRef.current.set(docRef.current.id, (documentRevisionsRef.current.get(docRef.current.id) || 0) + 1);
      analyticsRef.current.committed(list, historyRef.current.lastChange?.changed);
      reconcile(next);
      setDoc(next);
      setHistoryVersion((v) => v + 1);
      setHistoryState({canUndo:historyRef.current?.canUndo || false, canRedo:historyRef.current?.canRedo || false});
      finishPhase("committing");
      announcePhase("completed");
      finishPhase("completed");
      onProgress?.({status:"committed", phase:"completed", commandsProcessed:list.length, commandsTotal:list.length, revision:revisionRef.current, phaseTimings:structuredClone(phaseTimings)});
      return next;
    } catch (error) {
      onProgress?.({status:"failed", phase:Object.keys(phaseTimings).at(-1), commandsProcessed:processed, commandsTotal:list.length, revision:revisionRef.current, phaseTimings:structuredClone(phaseTimings), error:error instanceof Error ? error.message : String(error)});
      setNotice(`Command edit failed after ${processed}/${list.length} commands · ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      callerSignal?.removeEventListener("abort", cancel);
      if (operationRef.current === lock) operationRef.current = null;
    }
  }
  useEffect(() => {
    hostRef.current = {
      desktopState: () => ({
        loaded: !!docRef.current && !!historyRef.current,
        id: docRef.current?.id,
        revision: revisionRef.current,
        canSave: !!storeRef.current || documentModeRef.current === "file" || (checkpointDeliveryRef.current?.documentId === docRef.current?.id && checkpointDeliveryRef.current?.revision === revisionRef.current),
        busy: busyRef.current || !!luaAbortRef.current || !!nativeSessionRef.current?.busy || !!operationRef.current || restoringRef.current,
      }),
      saveForClose: async () => {
        // Native saves return per-document revisions; checkpoint receipts use
        // the editor's global revision. Keep those two identities separate.
        const nativeDocuments = nativeSessionRef.current ? await nativeSessionRef.current.saveAll() : [];
        const fileSaved = document => nativeDocuments.some(entry => entry.id === document?.id && entry.revision === (documentRevisionsRef.current.get(document.id) ?? 0));
        const retained = [...temporaryDocumentsRef.current.values()];
        const durableCheckpoint = entry => entry?.checkpoint?.status === "verified" && entry.checkpoint.documentId === entry.document.id && entry.checkpoint.revision === entry.revision;
        const librarySaved = entry => entry.mode === "library" && historyValuesEqual(entry.document, savedDocumentsRef.current.get(entry.document.id));
        if (retained.some(entry => !librarySaved(entry) && !durableCheckpoint(entry) && !fileSaved(entry.document))) {
          return {saved:false, reason:"Retained documents have unsaved changes; save them or create verified checkpoints before closing."};
        }
        let result;
        try {
          result = fileSaved(docRef.current)
            ? {saved:true, document:docRef.current, revision:revisionRef.current, mode:"file"}
            : documentModeRef.current === "library" ? await save()
            : {saved:false, reason:"The active document needs a file save or a verified checkpoint before closing."};
        }
        catch (error) {
          if (error?.code !== "BUDGET_EXCEEDED" && !/storage budget/i.test(error?.message || "")) throw error;
          result = {saved:false, reason:"The local library is full; file-backed documents can still be saved to their bound files."};
        }
        const currentCheckpoint = checkpointDeliveryRef.current?.documentId === docRef.current?.id && checkpointDeliveryRef.current?.revision === revisionRef.current && checkpointDeliveryRef.current.status === "verified";
        if ((!result || result.saved === false) && currentCheckpoint) result = {saved:true, document:docRef.current, revision:revisionRef.current, checkpoint:checkpointDeliveryRef.current, mode:documentModeRef.current};
        if (!result && !nativeSessionRef.current) return null;
        return {...result, nativeDocuments};
      },
      nativeRead: async (id = docRef.current?.id) => {
        const retained = temporaryDocumentsRef.current.get(id);
        const loaded = id === docRef.current?.id
          ? {document:docRef.current, storedRevision:storedRevisionRef.current}
          : retained ? {document:retained.document, storedRevision:retained.storedRevision}
          : await storeRef.current?.loadDocument(id);
        if (!loaded) return null;
        const mode = id === docRef.current?.id ? documentModeRef.current : retained?.mode ?? "library";
        return {...loaded, mode, storedRevision:loaded.storedRevision ?? loaded.revision, revision:documentRevisionsRef.current.get(id) || 0};
      },
      nativeEncode: (document, format) => format === "aseprite"
        ? writeAseprite(document) : encodeProjectContainer(normalizeDocument(document)),
      nativeDecode: (file) => {
        if (file.format === "aseprite") {
          const result = readAseprite(new Uint8Array(file.bytes));
          return {...result, document:{...result.document, name:stem(file.name)}};
        }
        const raw = decodeProjectContainer(file.bytes);
        return {document:raw.version === 4 && raw.format === "pixelwall-document" ? normalizeDocument(raw) : migrateLegacy(parseProject(JSON.stringify(raw))), warnings:[]};
      },
      nativePersistImported: async (document) => {
        const next = {...document, id:crypto.randomUUID()};
        const result = await storeRef.current.saveDocument(next, {expectedRevision:0, label:"Open native file"});
        savedRevisionsRef.current.set(next.id, result.revision);
        savedDocumentsRef.current.set(next.id, next);
        documentRevisionsRef.current.set(next.id, 0);
        setDocuments(await storeRef.current.listDocuments());
        return {document:next, storedRevision:result.revision, revision:0};
      },
      nativeActivate: async (captured) => {
        const mode = captured.mode ?? "library";
        await activate(captured.document, mode === "library" ? captured.storedRevision : undefined, {allowNative:true, mode});
        setSaveStatus(mode === "file" ? "File-backed document · use Save to keep changes" : "Saved on this device");
      },
      activateTemporary: async ({document}) => {
        if (docRef.current) { if (temporaryDocumentsRef.current.size >= 8 && !temporaryDocumentsRef.current.has(docRef.current.id)) throw Error("At most eight retained documents are supported; restore or checkpoint one before opening another."); temporaryDocumentsRef.current.set(docRef.current.id, { document:docRef.current, revision:revisionRef.current, storedRevision:storedRevisionRef.current, mode:documentModeRef.current, checkpoint:checkpointDeliveryRef.current ?? downloads.getLastResult?.() ?? null }); }
        const next = {...document, id:crypto.randomUUID()};
        await activate(next, undefined, {allowNative:true, mode:"temporary"});
        setSaveStatus("Temporary document · checkpoint before closing");
      },
      activateFileBacked: async ({document}) => {
        const previousDocumentId = docRef.current?.id;
        if (docRef.current) { if (temporaryDocumentsRef.current.size >= 8 && !temporaryDocumentsRef.current.has(docRef.current.id)) throw Error("At most eight retained documents are supported; restore or checkpoint one before opening another."); temporaryDocumentsRef.current.set(docRef.current.id, { document:docRef.current, revision:revisionRef.current, storedRevision:storedRevisionRef.current, mode:documentModeRef.current, checkpoint:checkpointDeliveryRef.current ?? downloads.getLastResult?.() ?? null }); }
        const next = {...document, id:crypto.randomUUID()};
        await activate(next, 0, {allowNative:true, mode:"file"});
        setSaveStatus("File-backed document · saved to its bound file");
        return {document:next, revision:0, previousDocumentId};
      },
      rollbackFileBacked: async ({captured} = {}) => {
        const previous = temporaryDocumentsRef.current.get(captured?.previousDocumentId);
        if (!previous) return;
        await activate(previous.document, previous.mode === "library" ? previous.storedRevision : undefined, {allowNative:true, mode:previous.mode});
        checkpointDeliveryRef.current = previous.checkpoint ?? null;
        temporaryDocumentsRef.current.delete(previous.document.id);
      },
      nativeFlushRecovery: async () => {
        automationRef.current?.desktop.assertEditable();
        if (luaAbortRef.current || operationRef.current || restoringRef.current) throw Error("Finish the current edit or script before opening a file.");
        const saved = await save();
        if (!saved || saved.saved === false) throw Error("Device storage is unavailable. Save a verified portable copy before opening another file.");
      },
      nativeImported: (file, warnings) => {
        analyticsRef.current.imported("document", file.format, 1, warnings.length);
        setImportWarnings(warnings);
        if (warnings.length) setModal("warnings");
        setNotice(file.changed ? "Opened the updated file. Your previous version remains in the library." : `Opened ${file.name}`);
      },
      nativeSaved: (result, captured) => {
        if (captured.revision !== (documentRevisionsRef.current.get(captured.document.id) ?? 0)) return;
        if (docRef.current === captured.document) {
          documentModeRef.current = "file";
          setSaveStatus(`Saved to ${result.name}`);
        }
        const retained = temporaryDocumentsRef.current.get(captured.document.id);
        if (retained?.document === captured.document) retained.mode = "file";
        setNotice(`Saved ${result.name}`);
      },
      nativeRestoreNative: async ({document: restored, revision, source}) => {
        // A bound file may be newer than its library snapshot after a full-
        // library save. Restore from disk without rewriting that older backup.
        const current = docRef.current?.id === restored.id;
        const retained = temporaryDocumentsRef.current.get(restored.id);
        const existing = current ? docRef.current : retained?.document;
        const mode = current ? documentModeRef.current : retained?.mode;
        if (existing && (mode !== "library" || !historyValuesEqual(existing, savedDocumentsRef.current.get(restored.id)))) {
          throw Error("This project has changes in the editor. Save a separate copy before restoring its bound file.");
        }
        if (current) {
          await activate(restored, undefined, {allowNative:true, mode:"file"});
          temporaryDocumentsRef.current.delete(restored.id);
          setSaveStatus(`Restored from ${source.name}`);
        } else {
          temporaryDocumentsRef.current.set(restored.id, {document:restored, revision:revisionRef.current, storedRevision:undefined, mode:"file", checkpoint:null});
        }
        documentRevisionsRef.current.set(restored.id, revision);
        setDocuments(entries => [...entries.filter(entry => entry.id !== restored.id), {id:restored.id, name:restored.name}]);
      },
      desktopAction: async (action) => {
        if (busyRef.current || luaAbortRef.current || nativeSessionRef.current?.busy || operationRef.current || restoringRef.current) throw Error("Finish the current operation first.");
        if (action === "copy" || action === "cut") return copy({cut:action === "cut",throwOnError:true});
        if (action === "paste") return paste({throwOnError:true});
        if (action === "new") setModal("new");
        else if (action === "open") {
          if (nativeSessionRef.current) await nativeSessionRef.current.open();
          else chooseImport("document");
        } else if (action === "export") setModal("export");
        else if (action === "save" || action === "saveAs") {
          if (nativeSessionRef.current) {
            await nativeSessionRef.current.saveCurrent({saveAs:action === "saveAs"});
          } else { await exportArtwork({format:"project"}); await save(); }
        }
        return { handled: true };
      },
      revision: () => revisionRef.current,
      inspect: () => describeDocument(docRef.current),
      commands: () => COMMANDS,
      validate: async ({commands, timeoutMs} = {}) => {
        const current = docRef.current;
        if (!current) throw Error("Open a project first.");
        return preflightCommands(current, commands, {...activeRef.current, timeoutMs});
      },
      projects: async () => {
        const entries = await storeRef.current?.listDocuments() ?? [];
        return {activeDocumentId:docRef.current?.id, projects:entries};
      },
      storageStatus: async ({documentId, revision} = {}) => {
        const current = docRef.current;
        if (!current) return {status:"unavailable", reason:"No active document."};
        if (documentId !== undefined && documentId !== current.id) throw Error("The document changed. Inspect it again before reading storage status.");
        if (revision !== undefined && revision !== revisionRef.current) throw Error("The document revision changed. Inspect it again before reading storage status.");
        if (!storeRef.current) return {status:"unavailable", reason:"The local library is unavailable."};
        return {documentId:current.id, revision:revisionRef.current, ...(await storeRef.current.stats()), saveEstimate:await storeRef.current.estimateSave(current)};
      },
      storageStats: async () => storeRef.current?.stats() ?? {status:"unavailable", reason:"The local library is unavailable."},
      setStorageBudget: async ({bytes} = {}) => { if (!storeRef.current) throw Error("The local library is unavailable."); const result = await storeRef.current.setBudget(bytes); setStorageStats(result); return result; },
      persistence: async () => {
        const libraryState = libraryStateRef.current;
        const editStatus = operationRef.current ? "staging" : "committed";
        const dirty = !historyValuesEqual(docRef.current, savedDocumentsRef.current.get(docRef.current?.id));
        const checkpoint = checkpointDeliveryRef.current?.documentId === docRef.current?.id && checkpointDeliveryRef.current?.revision === revisionRef.current ? checkpointDeliveryRef.current : null;
        return {documentId:docRef.current?.id, revision:revisionRef.current, mode:documentModeRef.current, edit:{status:editStatus, revision:revisionRef.current, dirty}, library:storeRef.current ? {status:documentModeRef.current === "library" ? libraryState.status : "not_saved", revision:libraryState.revision, error:libraryState.error, ...(await storeRef.current.stats())} : {status:"unavailable", message:saveStatus}, checkpoint};
      },
      estimateSave: async ({documentId, revision} = {}) => {
        const current = docRef.current;
        if (!current) throw Error("Open a project first.");
        if (documentId !== undefined && documentId !== current.id) throw Error("The document changed. Inspect it again before estimating storage.");
        if (revision !== undefined && revision !== revisionRef.current) throw Error("The document revision changed. Inspect it again before estimating storage.");
        if (!storeRef.current) return {status:"unavailable", reason:"The local library is unavailable."};
        return {documentId:current.id, revision:revisionRef.current, ...(await storeRef.current.estimateSave(current))};
      },
      checkpoint: async ({expectedDocumentId, expectedRevision, download = false} = {}) => {
        const captured = docRef.current, sourceRevision = revisionRef.current;
        if (!captured) throw Error("Open a project first.");
        if (expectedDocumentId !== undefined && expectedDocumentId !== captured.id) throw Error("The checkpoint document does not match the active document.");
        if (expectedRevision !== undefined && expectedRevision !== sourceRevision) throw Error("The checkpoint revision does not match the active document.");
        const result = await exportArtwork({format:"project", download}, "checkpoint");
        if (docRef.current !== captured || revisionRef.current !== sourceRevision) throw Error("The project changed while the checkpoint was being prepared.");
        const generated = result.exportResult?.generated?.files?.[0], persistence = result.exportResult?.persistence;
        const checkpoint = {status:"generated", documentId:captured.id, revision:sourceRevision, filename:result.filename, bytes:result.bytes, mime:result.mime, artifactId:generated?.artifactId, sha256:generated?.sha256, expiresAt:generated?.expiresAt, download:result.exportResult?.download ?? {status:"not_requested"}, verification:{status:"not_requested", reason:"Verify the delivered file with desktop checkpoint or CLI verify."}, persistence:persistence || {status:"failed", error:{code:"NOT_PERSISTED", message:"The backup was generated but not retained in the artifact library."}}, library:storeRef.current ? await storeRef.current.stats() : {status:"unavailable"}};
        checkpointDeliveryRef.current = checkpoint;
        return checkpoint;
      },
      checkpointDelivered: async delivery => {
        const current = docRef.current;
        if (!current || delivery?.documentId !== current.id || delivery?.revision !== revisionRef.current) {
          throw Error("The delivered checkpoint is stale or belongs to another document.");
        }
        if (!delivery?.sha256 || !Number.isSafeInteger(delivery.bytes) || delivery.bytes < 1) throw Error("Checkpoint delivery metadata is incomplete.");
        checkpointDeliveryRef.current = {...delivery, status:"verified"};
        setSaveStatus("Verified checkpoint saved to the approved folder");
        return {recorded:true, documentId:current.id, revision:revisionRef.current, library:storeRef.current ? await storeRef.current.stats() : {status:"unavailable"}, delivery:{...delivery}};
      },
      animationReview: async ({expectedDocumentId, expectedRevision, clipId, frameIds, anchoredLayers, anchoredRegions, exclusions, expectedFrameCount, compareCount} = {}) => {
        const current = docRef.current;
        if (!current) throw Error("Open a project first.");
        if (expectedDocumentId !== undefined && expectedDocumentId !== current.id) throw Error("The document changed. Inspect it again before reviewing animation.");
        if (expectedRevision !== undefined && expectedRevision !== revisionRef.current) throw Error("The document revision changed. Inspect it again before reviewing animation.");
        const review = diagnoseAnimation(current, {clipId, frameIds, anchoredLayers, anchoredRegions, exclusions, expectedFrameCount, renderFrame:(document, frameId) => renderFrame(document, frameId)});
        const ids = review.frameIds;
        const wrap = ids.length > 1 ? compareAnimationWrap(current, {frameIds:ids, compareCount:compareCount ?? 2, renderFrame:(document, frameId) => renderFrame(document, frameId)}) : {pairs:[], compareCount:0, identicalEndpoints:false};
        return {documentId:current.id, revision:revisionRef.current, ...review, wrap};
      },
      openTemporary: async ({bytes, name} = {}) => {
        if (!Array.isArray(bytes) || !bytes.length || bytes.length > 64 * 1024 * 1024 || bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw Error("Provide project bytes as an array of at most 64 MiB.");
        if (busyRef.current || luaAbortRef.current || nativeSessionRef.current?.busy || operationRef.current || restoringRef.current) throw Error("Finish the current operation before opening a temporary document.");
        const previous = docRef.current;
        if (previous) { if (temporaryDocumentsRef.current.size >= 8 && !temporaryDocumentsRef.current.has(previous.id)) throw Error("At most eight retained documents are supported; restore or checkpoint one before opening another."); temporaryDocumentsRef.current.set(previous.id, { document: previous, revision: revisionRef.current, storedRevision:storedRevisionRef.current, mode: documentModeRef.current, checkpoint: checkpointDeliveryRef.current ?? downloads.getLastResult?.() ?? null }); }
        const raw = decodeProjectContainer(new Uint8Array(bytes));
        const next = raw.format === "pixelwall-document" && raw.version === 4 ? normalizeDocument(raw) : migrateLegacy(parseProject(JSON.stringify(raw)));
        next.id = crypto.randomUUID();
        if (name !== undefined) { if (typeof name !== "string" || !name.trim() || name.length > 240) throw Error("Temporary project name must contain 1–240 characters."); next.name = name.trim(); }
        await activate(next, undefined, {mode:"temporary"});
        setSaveStatus("Temporary document · checkpoint before closing");
        return {documentId:next.id, revision:revisionRef.current, persistence:{mode:"temporary", library:"not_saved"}};
      },
      temporaryProjects: () => [...temporaryDocumentsRef.current.entries()].map(([key, entry]) => ({ documentId:key, name:entry.document.name, revision:entry.revision, mode:entry.mode ?? "temporary", checkpoint:entry.checkpoint })),
      restoreTemporary: async ({documentId} = {}) => {
        const entry = temporaryDocumentsRef.current.get(documentId);
        if (!entry) throw Error("Temporary document is no longer retained.");
        const current = docRef.current;
        if (current && current.id !== documentId) { if (temporaryDocumentsRef.current.size >= 8 && !temporaryDocumentsRef.current.has(current.id) && !temporaryDocumentsRef.current.has(documentId)) throw Error("At most eight retained documents are supported; restore or checkpoint one before opening another."); temporaryDocumentsRef.current.set(current.id, {document:current, revision:revisionRef.current, storedRevision:storedRevisionRef.current, mode:documentModeRef.current, checkpoint:checkpointDeliveryRef.current ?? downloads.getLastResult?.() ?? null}); }
        await activate(entry.document, entry.mode === "library" ? entry.storedRevision : entry.revision, {mode:entry.mode ?? "temporary"});
        checkpointDeliveryRef.current = entry.checkpoint?.status === "verified" ? entry.checkpoint : null;
        temporaryDocumentsRef.current.delete(documentId);
        const mode = entry.mode ?? "temporary";
        const librarySaved = mode === "library" && historyValuesEqual(savedDocumentsRef.current.get(documentId), entry.document);
        setSaveStatus(checkpointDeliveryRef.current ? "Verified checkpoint saved to the approved folder" : mode === "temporary" ? "Temporary document restored · checkpoint before closing" : mode === "file" ? "File-backed document restored · use Save to keep changes" : librarySaved ? "Saved on this device" : "Unsaved changes");
        return {documentId, revision:revisionRef.current, persistence:{mode, library:librarySaved ? "saved" : "not_saved", checkpoint:checkpointDeliveryRef.current}};
      },
      openTemporaryProject: async options => {
        const result = await hostRef.current.restoreTemporary(options);
        return result;
      },
      openProject: async ({documentId} = {}) => {
        if (typeof documentId !== "string" || !documentId || documentId.length > 200) throw Error("Choose a project ID from the project list.");
        if (busyRef.current || luaAbortRef.current || nativeSessionRef.current?.busy || operationRef.current || restoringRef.current) throw Error("Finish the current operation before opening a project.");
        const store = storeRef.current;
        if (!store) throw Error("The local library is unavailable.");
        if (documentId === docRef.current?.id) return;
        const before = docRef.current, revision = revisionRef.current;
        const saved = await store.loadDocument(documentId);
        if (!saved) throw Error("Project not found in the local library.");
        const currentSave = await saveBeforeSwitch();
        if (!currentSave || currentSave.saved === false) throw Error("Save a checkpoint or bound file before opening another project.");
        if (docRef.current !== before || revisionRef.current !== revision) throw Error("The current project changed. Retry opening the project after finishing the edit.");
        await activate(saved.document, saved.revision);
        setClosedDocuments(ids => ids.filter(value => value !== documentId));
      },
      importProject: async ({bytes, name} = {}) => {
        if (!Array.isArray(bytes) || !bytes.length || bytes.length > 16 * 1024 * 1024 || bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw Error("Provide project bytes as an array of at most 16 MiB.");
        if (busyRef.current || luaAbortRef.current || nativeSessionRef.current?.busy || operationRef.current || restoringRef.current) throw Error("Finish the current operation before importing a project.");
        const decoded = decodeProjectContainer(new Uint8Array(bytes));
        const next = decoded.format === "pixelwall-document" && decoded.version === 4 ? normalizeDocument(decoded) : migrateLegacy(parseProject(JSON.stringify(decoded)));
        next.id = crypto.randomUUID();
        if (name !== undefined) {
          if (typeof name !== "string" || !name.trim() || name.length > 240) throw Error("Project name must contain 1–240 characters.");
          next.name = name.trim();
        }
        const store = storeRef.current;
        const before = docRef.current, revision = revisionRef.current;
        const currentSave = await saveBeforeSwitch();
        if (!store || !currentSave || currentSave.saved === false) throw Error("Save a checkpoint or bound file before importing another project.");
        const stored = await store.saveDocument(next, {label:"Agent import"});
        if (docRef.current !== before || revisionRef.current !== revision) throw Error("The current project changed. The imported project was saved in the library; open it after finishing the edit.");
        await activate(next, stored.revision);
        setDocuments(await store.listDocuments());
      },
      artifacts: () => downloads.artifacts(),
      artifact: id => downloads.artifact(id),
      readArtifact: options => downloads.readArtifact(options),
      removeArtifact: id => downloads.removeArtifact(id),
      downloadArtifact: id => downloads.downloadArtifact(id),
      colorProfile: async ({operation = "inspect", icc, intent = 1} = {}) => {
        if (!["inspect", "assign", "convert"].includes(operation)) throw Error("Choose inspect, assign or convert.");
        const before = docRef.current, revision = revisionRef.current;
        const manager = colorManager || await loadBrowserColorManager();
        let changed = false;
        if (operation !== "inspect") {
          const profile = icc ? manager.readProfile(icc) : "sRGB";
          const next = operation === "assign" ? manager.assignProfile(before, profile) : manager.convertDocument(before, profile, {intent});
          changed = commitSnapshot(next, operation === "assign" ? "Assign color profile" : "Convert color profile", before, revision);
          analyticsRef.current.automationEdit("color_profile", changed);
        }
        return {revision:revisionRef.current, changed, ...manager.profileInfo(documentProfile(docRef.current)),profile:documentProfile(docRef.current)};
      },
      automationOperation: data => analyticsRef.current.automationOperation(data),
      runLua: (options) => runLua(options, {source: "automation"}),
      apply: async (commands, label, {onProgress, signal} = {}) => {
        const list = Array.isArray(commands) ? commands : [commands];
        const reportProgress = progress => {
          if (progress.status === "committed") setNotice(`Applied ${progress.commandsProcessed}/${progress.commandsTotal} commands · revision ${progress.revision}`);
          else if (progress.commandsProcessed === 0 || progress.commandsProcessed % 32 === 0) setNotice(`Applying ${progress.commandsProcessed}/${progress.commandsTotal} commands · revision ${progress.revision}`);
          onProgress?.(progress);
        };
        reportProgress({status:"running", commandsProcessed:0, commandsTotal:list.length, revision:revisionRef.current});
        await applyAutomation(list, label, {onProgress:reportProgress, signal});
        analyticsRef.current.automation("apply", list.length);
        analyticsRef.current.automationEdit("apply", historyRef.current.lastChange?.changed, list.length);
        return { changed: historyRef.current.lastChange?.changed === true, revision: revisionRef.current };
      },
      newDocument: async (options) => {
        const result = await newDocument(options);
        analyticsRef.current.automation("new_document");
        return result;
      },
      capturePreview: () => {
        previewBaselineRef.current = docRef.current;
        setPreviewBaseline(docRef.current);
        return {documentId:docRef.current.id,revision:revisionRef.current};
      },
      preview: async (options = {}) => {
        const current = docRef.current;
        if (!current) throw Error("Open a project first.");
        const manager = colorManager || await loadBrowserColorManager();
        const settings = {...options, frameId:options.frameId || activeRef.current.frameId,
          renderFrame:(document, frameId) => manager.displayFrame(document, frameId)};
        const png = image => { const {rgba, ...metadata} = image; return {...metadata, dataUrl:rgbaImage(rgba, image.width, image.height).toDataURL("image/png")}; };
        if (options.compare || options.kind === "comparison") {
          const baseline = previewBaselineRef.current;
          if (!baseline || baseline.id !== current.id) throw Error("Capture a comparison baseline for this project first.");
          const result = renderPreviewComparison(baseline, current, settings);
          return {...result, before:png(result.before), after:png(result.after), diff:undefined,
            dataUrl:rgbaImage(result.diff, result.width, result.height).toDataURL("image/png")};
        }
        const result = options.contactSheet || options.kind === "contact-sheet"
          ? renderPreviewContactSheet(current, {...settings, columns:options.columns ?? Math.min(8, options.frameIds?.length ?? current.frames.length)})
          : renderPreview(current, settings);
        return png(result);
      },
      save: async () => {
        const result = await save();
        if (result) analyticsRef.current.automation("save");
        return result;
      },
      export: async (options) => {
        const result = await exportArtwork(options, "automation");
        analyticsRef.current.automation("export");
        return result;
      },
      exportPlan: async ({format = "png", clipId: requestedClipId, frameId, layerIds, layers, includeReferenceLayers = false, scale = 1, expectedFrameCount} = {}) => {
        return createExportPlan({format, clipId:requestedClipId, frameId, layerIds, layers, includeReferenceLayers, scale, expectedFrameCount});
      },
      exportResult: () => downloads.getLastResult(),
      undo: () => {
        const before = revisionRef.current;
        const beforeDocument = docRef.current;
        undo();
        const changed = !historyValuesEqual(beforeDocument, docRef.current);
        if (revisionRef.current !== before) {
          analyticsRef.current.automation("undo");
          analyticsRef.current.automationEdit("undo", changed);
        }
        return { revision: revisionRef.current, changed };
      },
      redo: () => {
        const before = revisionRef.current;
        const beforeDocument = docRef.current;
        redo();
        const changed = !historyValuesEqual(beforeDocument, docRef.current);
        if (revisionRef.current !== before) {
          analyticsRef.current.automation("redo");
          analyticsRef.current.automationEdit("redo", changed);
        }
        return { revision: revisionRef.current, changed };
      },
    };
  });
  useEffect(() => {
    const delegate = new Proxy(
      {},
      {
        get:
          (_, key) =>
          (...args) => {
            if (!hostRef.current) throw Error("Editor is opening.");
            return hostRef.current[key](...args);
          },
      },
    );
    const api = createAutomation(delegate);
    automationRef.current = api;
    window.pixelwall = api;
    const cleanup = registerAutomation(
      document.modelContext || navigator.modelContext,
      api,
    );
    return () => {
      cleanup();
      if (automationRef.current === api) automationRef.current = null;
      if (window.pixelwall === api) delete window.pixelwall;
    };
  }, []);
  useEffect(() => {
    const bridge = window.pixelwallNativeFiles;
    if (!bridge) return;
    const names = ["read", "encode", "decode", "persistImported", "activate", "flushRecovery", "imported", "saved", "restoreNative"];
    const host = Object.fromEntries(names.map(name => [name, (...args) => hostRef.current["native" + name[0].toUpperCase() + name.slice(1)](...args)]));
    for (const name of ["activateTemporary", "activateFileBacked", "rollbackFileBacked"]) host[name] = (...args) => hostRef.current[name](...args);
    const session = createNativeDocumentSession(bridge, host);
    nativeSessionRef.current = session;
    const remove = bridge.onOpen(result => void session.acceptOpen(result).catch(report));
    return () => { remove(); if (nativeSessionRef.current === session) nativeSessionRef.current = null; };
  }, [report]);
  useEffect(() => {
    const bridge = window.pixelwallAgentConnection;
    if (!bridge) return;
    let mounted = true;
    void bridge.status().then(value => { if (mounted) setAgentConnection(value); }).catch(report);
    const remove = bridge.onChanged(value => { if (mounted) setAgentConnection(value); });
    return () => { mounted = false; remove(); };
  }, [report]);
  useEffect(() => {
    if (docRef.current && storeRef.current && nativeSessionRef.current && !nativeReadyRef.current) {
      nativeReadyRef.current = true;
      void (async () => {
        try {
          const result = await nativeSessionRef.current.recoverMissing();
          if (result?.errors?.length) report(Error(result.errors.map(error => `${error.name || "Native project"}: ${error.reason} ${error.action || ""}`).join("\n")));
        } catch (error) { report(error); }
        finally {
          try { await window.pixelwallNativeFiles.ready(); }
          catch (error) { nativeReadyRef.current = false; report(error); }
        }
      })();
    }
  }, [doc?.id, report]);
  async function runBatch() {
    try {
      const parsed = JSON.parse(commandText);
      const commands = captureCommands(Array.isArray(parsed) ? parsed : [parsed]).commands;
      const result = await applyAutomation(commands, "Command batch", {onProgress: progress => {
        if (progress.commandsProcessed % 32 === 0 || progress.status === "committed") setNotice(`Applying ${progress.commandsProcessed}/${progress.commandsTotal} commands · revision ${progress.revision}`);
      }});
      setCommandResult(JSON.stringify(describeDocument(result), null, 2));
      setNotice("Command batch applied as one undoable edit.");
      canvasRef.current?.focus({preventScroll:true});
    } catch (error) {
      setCommandResult(error.message);
      report(error);
    }
  }
  function commitSnapshot(next, label, before, revision, {allowLua = false, context} = {}) {
    const finishingLua = allowLua && luaSavingRef.current && luaAbortRef.current;
    if (!finishingLua) automationRef.current?.desktop.assertEditable();
    if (nativeSessionRef.current?.busy && !finishingLua) throw Error("Finish the current file operation first.");
    if (luaAbortRef.current && !allowLua) throw Error("Wait for the Lua script to finish or cancel it.");
    if (docRef.current !== before || revisionRef.current !== revision || operationRef.current || restoringRef.current)
      throw Error("The project changed while this operation was running. Run it again to apply it to the current artwork.");
    const changed = !historyValuesEqual(before, next);
    historyRef.current.commit(next, label, context);
    install(next, {allowLua});
    if (changed && typeof checkpointDeliveryRef !== "undefined") checkpointDeliveryRef.current = null;
    if (context) restoreUiContext(context.afterContext);
    if (typeof libraryStateRef !== "undefined") libraryStateRef.current = {status:"dirty", revision:storedRevisionRef.current ?? null, error:libraryStateRef.current.error}; setSaveStatus("Unsaved changes");
    return changed;
  }
  function guardScriptInteraction(event) {
    if (luaAbortRef.current && !event.target.closest?.("[data-pixelwall-lua-controls]")) {event.preventDefault();event.stopPropagation();}
  }
  function changeIndexedMapping(rgbmap, patch = {}) {
    setIndexedOptions(previous => {
      const dithering = rgbmap === "pixelwall"
        ? ({"aseprite-ordered":"ordered","aseprite-old":"ordered","aseprite-error-diffusion":"floyd-steinberg"}[previous.dithering] || previous.dithering)
        : ({ordered:"aseprite-ordered","floyd-steinberg":"aseprite-error-diffusion"}[previous.dithering] || previous.dithering);
      return {...previous,...patch,rgbmap,dithering,
        fitCriteria:rgbmap === "pixelwall" ? "default" : previous.fitCriteria,
        ditherStrength:["aseprite-ordered","aseprite-old"].includes(dithering) ? 1 : previous.ditherStrength};
    });
  }

  async function convertIndexed() {
    const before = docRef.current, revision = revisionRef.current;
    try {
      setBusy(true);
      await deferred();
      const next = applyCommand(before,{type:"document.colorMode",colorMode:"indexed",...indexedOptions});
      commitSnapshot(next,"Convert indexed colors",before,revision);
      setModal(null);
      setNotice("Indexed colors applied. Undo restores the original artwork.");
    } catch (error) {report(error);} finally {setBusy(false);}
  }
  async function changeProfile(mode) {
    const before = docRef.current, revision = revisionRef.current;
    try {
      automationRef.current?.desktop.assertEditable();
      setBusy(true);
      const manager = colorManager || await loadBrowserColorManager();
      const target = profileTarget === "imported" ? importedProfile : "sRGB";
      if (!target) throw Error("Choose an ICC profile first.");
      const next = mode === "assign" ? manager.assignProfile(before, target) : manager.convertDocument(before, target, {intent:renderingIntent});
      commitSnapshot(next, mode === "assign" ? "Assign color profile" : "Convert color profile", before, revision);
      setModal(null);
      setNotice(mode === "assign" ? "Profile assigned. Pixel values are unchanged." : "Colors converted to the selected profile.");
    } catch(error) { report(error); } finally { setBusy(false); }
  }
  function chooseExternalTileset(tilesetId) {
    try {
      automationRef.current?.desktop.assertEditable();
      if (luaAbortRef.current || nativeSessionRef.current?.busy || busyRef.current || operationRef.current) throw Error("Finish the current operation first.");
      externalTilesetRequestRef.current = {before:docRef.current, revision:revisionRef.current, tilesetId, context:uiContextRef.current};
      externalTilesetInputRef.current.value = "";
      externalTilesetInputRef.current.click();
    } catch (error) { report(error); }
  }
  async function loadExternalTileset(event) {
    const file = event.target.files?.[0], request = externalTilesetRequestRef.current;
    externalTilesetRequestRef.current = null;
    event.target.value = "";
    if (!file || !request) return;
    try {
      setBusy(true);
      if (file.size > 64 * 1024 * 1024) throw Error("Choose a sprite source file smaller than 64 MB.");
      const source = readAseprite(new Uint8Array(await file.arrayBuffer()));
      const manager = colorManager || await loadBrowserColorManager();
      const result = resolveExternalTileset(request.before, {tilesetId:request.tilesetId, sourceDocument:source.document, colorManager:manager, intent:renderingIntent});
      if (!historyValuesEqual(request.context, uiContextRef.current)) throw Error("The project selection changed while choosing the source. Choose it again.");
      commitSnapshot(result.document, "Embed external tileset", request.before, request.revision, {context:{beforeContext:request.context, afterContext:request.context}});
      setNotice(`Embedded tiles from ${file.name}. The project now contains this tileset.`);
      if (source.warnings.length) { setImportWarnings(source.warnings); setModal("warnings"); }
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function runPackageCommand(options) {
    const before = docRef.current, revision = revisionRef.current, context = uiContextRef.current;
    if (!storeRef.current) throw Error("Device storage is unavailable. Save a backup before running a package.");
    const captured = await capturePackageRun(storeRef.current, options);
    if (docRef.current !== before || revisionRef.current !== revision || !historyValuesEqual(context,uiContextRef.current)) throw Error("The project or selection changed while loading the package. Run it again.");
    setScriptLanguage("lua");
    return runLua({source:captured.source}, {packageRun:captured});
  }
  async function runLua({source = luaSource, params = {}, timeoutMs = luaTimeout} = {}, {packageRun, source: runSource = "ui"} = {}) {
    automationRef.current?.desktop.assertEditable();
    if (busyRef.current || nativeSessionRef.current?.busy || luaAbortRef.current || operationRef.current || restoringRef.current) throw Error("Finish the current operation before running Lua.");
    const before = docRef.current, revision = revisionRef.current;
    const beforeContext = editorUiContext(before, uiContextRef.current || {});
    const controller = new AbortController();
    setPlaying(false);
    luaAbortRef.current = controller;
    setBusy(true);
    try {
      const base = process.env.NEXT_PUBLIC_PIXELWALL_STANDALONE === "true" ? new URL('./runtimes/', location.href) : new URL('/runtimes/', location.origin);
      const showScriptUi = show => async (schema, context) => {
        if (packageRun) await assertPackageRunCurrent(storeRef.current,packageRun);
        const answer = await show(schema,context);
        if (packageRun) await assertPackageRunCurrent(storeRef.current,packageRun);
        return answer;
      };
      const result = await runLuaScript({source, document:before, activeFrameId:activeRef.current.frameId, activeLayerId:activeRef.current.layerId, selection:beforeContext.selection == null ? null : Array.from(beforeContext.selection), range:beforeContext.range, fgColor:pixelRGBA(before, beforeContext.fgColor), bgColor:pixelRGBA(before, beforeContext.bgColor), params, timeoutMs, signal:controller.signal}, {
        wasmUri:new URL('lua.wasm', base).href,
        isCurrent:() => docRef.current === before && revisionRef.current === revision && historyValuesEqual(beforeContext, uiContextRef.current),
        onDialog:showScriptUi(luaDialog.show),
        ...(packageRun ? {plugin:packageRun.plugin,onCommand:showScriptUi(luaCommands.show)} : {}),
      });
      const edited = result.documents.find(document => document.id === before.id);
      if (!edited || !result.document) throw Error("The script did not return an active project.");
      await saveQueueRef.current.catch(() => {});
      if (controller.signal.aborted) throw Error("Lua script cancelled. No edits were committed.");
      if (docRef.current !== before || revisionRef.current !== revision || !historyValuesEqual(beforeContext, uiContextRef.current)) throw Error("The project or selection changed while Lua was running. Run the script again.");
      const libraryMode = typeof documentModeRef === "undefined" || documentModeRef.current === "library";
      if (libraryMode && !storeRef.current) throw Error("Device storage is unavailable. Save a backup before running Lua.");
      const afterContext = editorUiContext(result.document, {selection:result.selection, range:result.range, active:result.active, fgColor:hex(result.fgColor), bgColor:hex(result.bgColor)});
      luaSavingRef.current = true;
      setLuaSaving(true);
      const saved = libraryMode
        ? await storeRef.current.saveDocuments(result.documents.map(document => ({document, settings:{expectedRevision:document.id === before.id ? savedRevisionsRef.current.get(document.id) : 0, label:"Lua script"}})), {settings:packageRun ? packageRunSettings(packageRun,result.plugin) : []})
        : result.documents.map(document => ({document, revision:0, savedAt:null, imagesWritten:0}));
      for (const entry of saved) { savedRevisionsRef.current.set(entry.document.id, entry.revision); savedDocumentsRef.current.set(entry.document.id, entry.document); }
      const originalAfterContext = result.document.id === before.id ? afterContext : editorUiContext(edited, beforeContext);
      const changed = commitSnapshot(edited, "Lua script", before, revision, {allowLua:true, context:{beforeContext, afterContext:originalAfterContext}});
      for (const entry of saved.filter(entry => entry.document.id !== before.id)) {
        historyCacheRef.current.invalidate(entry.document.id);
        const seed = result.created.find(document => document.id === entry.document.id);
        if (seed) {
          const history = createHistory(seed, {maxEntries:100, maxBytes:64 * 1024 * 1024});
          history.commit(entry.document, "Lua script", {beforeContext:editorUiContext(seed, {fgColor:beforeContext.fgColor, bgColor:beforeContext.bgColor}), afterContext:entry.document.id === result.document.id ? afterContext : editorUiContext(entry.document, {fgColor:afterContext.fgColor, bgColor:afterContext.bgColor})});
          historyCacheRef.current.park({history, document:entry.document, storedRevision:entry.revision});
        }
        if (!libraryMode) temporaryDocumentsRef.current.set(entry.document.id, {document:entry.document, revision:0, storedRevision:undefined, mode:"temporary", checkpoint:checkpointDeliveryRef.current ?? null});
      }
      storedRevisionRef.current = saved.find(entry => entry.document.id === before.id).revision;
      if (libraryMode) setDocuments(await storeRef.current.listDocuments());
      if (result.document.id !== before.id) {
        const loaded = saved.find(entry => entry.document.id === result.document.id);
        await activate(loaded.document, loaded.revision, {allowLua:true, mode:typeof documentModeRef === "undefined" ? "library" : documentModeRef.current});
      }
      const changedDocument = !historyValuesEqual(edited, before) || result.created.length > 0;
      analyticsRef.current.scripted(changed || changedDocument);
      if (runSource === "automation") {
        analyticsRef.current.automation("lua", result.stats?.commands);
        analyticsRef.current.automationEdit("lua", changed || changedDocument, result.stats?.commands);
      }
      restoreUiContext(afterContext);
      setCommandResult([...result.prints, `${result.stats.commands} editing commands applied.`].join("\n"));
      setNotice(packageRun ? "Package command applied and preferences saved. Undo restores artwork and selection." : "Lua script applied. Undo restores the previous artwork and selection.");
      canvasRef.current?.focus({preventScroll:true});
      return {revision:revisionRef.current,changed:changed || changedDocument,document:describeDocument(docRef.current),prints:result.prints,stats:result.stats};
    } finally { luaAbortRef.current = null; luaSavingRef.current = false; setLuaSaving(false); setBusy(false); }
  }
  async function showRecovery() {
    try {
      setBusy(true);
      setPlaying(false);
      await save();
      setRevisions(await storeRef.current.listRevisions(doc.id));
      setModal("recovery");
      analyticsRef.current.recovery("view", "completed");
    } catch (error) {
      analyticsRef.current.recovery("view", "failed", error);
      report(error);
    } finally {
      setBusy(false);
    }
  }
  if (!doc)
    return (
      <main className="wb-loading art-surface ph-no-capture">
        <strong>PIXELWALL</strong>
        <p role="status">{saveStatus}</p>
        {notice && <p role="alert">{notice}</p>}
      </main>
    );
  return (
    <div
      className={`workbench art-surface ph-no-capture sidebar-${settings.sidebar}`}
      onKeyDown={onKey}
      onKeyDownCapture={guardScriptInteraction}
      onPointerDownCapture={guardScriptInteraction}
      onClickCapture={guardScriptInteraction}
      onChangeCapture={guardScriptInteraction}
      role="application"
      aria-label="PixelWall editor"
    >
      <header className="wb-header">
        <a className="wb-brand" href="/" aria-label="PixelWall home">
          <span className="wb-mark">▦</span>PIXELWALL
        </a>
        <input
          className="wb-name"
          aria-label="Project name"
          value={doc.name}
          onChange={(e) =>
            run(
              { type: "document.update", patch: { name: e.target.value } },
              "Rename project",
            )
          }
        />
        <span className="wb-save-status" role="status">
          {saveStatus}
        </span>
        <div className="wb-header-actions">
          <IconButton
            icon={Plus}
            label="New project"
            onClick={() => setModal("new")}
          />
          <button className="wb-button-link" onClick={() => setModal("water")} title="Generate an animated procedural water scene in a new project">Water scene</button>
          <IconButton
            icon={FolderOpen}
            label="Open project or image"
            onClick={() => chooseImport("document")}
          />
          <IconButton
            icon={Save}
            label={nativeSessionRef.current ? "Save project" : "Save project backup"}
            onClick={() => nativeSessionRef.current ? void automationRef.current.desktop.action("save").catch(report) : void doExport({ format: "project" }).catch(() => {})}
          />
          <IconButton
            icon={Undo2}
            label="Undo"
            disabled={!historyState.canUndo}
            onClick={undo}
          />
          <IconButton
            icon={Redo2}
            label="Redo"
            disabled={!historyState.canRedo}
            onClick={redo}
          />
          <button
            className="wb-export-button"
            onClick={() => setModal("export")}
          >
            <Download size={16} />
            Export
          </button>
          <button className="wb-pro" onClick={access.show}>
            {access.pro ? "Pro active" : "Pro"}
          </button>
          <IconButton
            icon={Settings}
            label="Workspace settings"
            onClick={() => setModal("settings")}
          />
        </div>
      </header>
      {agentConnection?.enabled && <aside className="wb-agent-status" aria-label="Local agent connection">
        <span>{agentConnection.connected ? "Agent connected" : "Waiting for local agent"} · Exports: {agentConnection.exportRoot}</span>
        <button type="button" onClick={() => void window.pixelwallAgentConnection.disable().then(setAgentConnection).catch(report)}>Disconnect agent</button>
      </aside>}
      <nav className="wb-project-bar" aria-label="Projects">
        <IconButton icon={ChevronLeft} label="Scroll projects left" onClick={() => documentTabsRef.current?.scrollBy({left:-260, behavior:"smooth"})} />
        <div className="wb-doc-tabs" ref={documentTabsRef} onWheel={event => {
          if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
          event.currentTarget.scrollLeft += event.deltaY;
        }}>
          {[...documents.filter(d => !closedDocuments.includes(d.id) || d.id === doc.id), ...(!documents.some(d => d.id === doc.id) ? [doc] : [])].map(d => (
            <div className={`wb-doc-tab ${d.id === doc.id ? "active" : ""}`} key={d.id}>
              <button title={`Open ${d.name || "Untitled"}`} aria-current={d.id === doc.id ? "page" : undefined} disabled={busy} onClick={() => void openDocument(d.id)}>{d.name || "Untitled"}</button>
              <IconButton icon={X} label={`Close ${d.name || "Untitled"} tab (keep project)`} disabled={busy} onClick={() => void closeDocumentTab(d.id)} />
            </div>
          ))}
        </div>
        <IconButton icon={ChevronRight} label="Scroll projects right" onClick={() => documentTabsRef.current?.scrollBy({left:260, behavior:"smooth"})} />
        <IconButton icon={Plus} label="Create a new project" onClick={() => setModal("new")} />
        <select aria-label="All projects" title="Open any saved project, including closed tabs" value="" disabled={busy} onChange={event => void openDocument(event.target.value)}>
          <option value="" disabled>All projects ({documents.length})</option>
          {documents.map(d => <option key={d.id} value={d.id}>{d.name || "Untitled"}</option>)}
        </select>
      </nav>
      <nav className="wb-document-actions" aria-label="Document actions">
        <button title="Browse and restore earlier saved versions of this project" onClick={showRecovery}>Recovery</button>
        <button title="Open an editable file without adding it to the local library" onClick={() => chooseImport("temporary")}>Open temporary</button>
        <button title="Open an editable file as its bound durable source without using the local library" disabled={!nativeSessionRef.current || busy} onClick={() => void nativeSessionRef.current?.openFileBacked().catch(report)}>Open file-backed</button>
        <button
          onClick={() => run({ type: "layer.duplicate" }, "Duplicate layer")}
        >
          Duplicate layer
        </button>
        <button
          onClick={() => run({ type: "layer.mergeDown" }, "Merge layer down")}
        >
          Merge down
        </button>
        <button title="Import an image as a reference layer for tracing" onClick={() => chooseImport("reference")}>Reference</button>
        <button title="Import several images as animation frames" onClick={() => chooseImport("sequence")}>Image sequence</button>
        <button title="Split a sprite sheet into animation frames" onClick={() => chooseImport("sheet")}>Sprite sheet</button>
        <button onClick={() => setModal("commands")}>
          <Search size={13} />
          Commands
        </button>
        <button onClick={() => setModal("components")}>Scene components</button>
        <button onClick={() => {setPreviewResult(null);setModal("preview");}}>Review artwork</button>
        <button onClick={() => setModal("artifacts")}>Generated files</button>
        <button onClick={() => { void storeRef.current?.stats().then(setStorageStats).catch(report); setModal("storage"); }}>Storage</button>
      </nav>
      <section className="wb-options" aria-label="Tool options">
        <strong>{TOOLS.find((t) => t[0] === tool)?.[1]}</strong>
        <Field label="Size">
          <input
            aria-label="Brush size"
            type="number"
            min={1}
            max={128}
            value={brush}
            onChange={(e) => setBrush(clamp(+e.target.value, 1, 128))}
          />
        </Field>
        <Field label="Brush">
          <select
            value={brushShape}
            onChange={(e) => setBrushShape(e.target.value)}
          >
            <option value="square">Square</option>
            <option value="circle">Circle</option>
          </select>
        </Field>
        <Field label="Symmetry">
          <select
            value={symmetry}
            onChange={(e) => setSymmetry(e.target.value)}
          >
            {["none", "x", "y", "both"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <label>
          <input
            type="checkbox"
            checked={filled}
            onChange={(e) => setFilled(e.target.checked)}
          />
          Filled
        </label>
        <label>
          <input
            type="checkbox"
            checked={pixelPerfect}
            onChange={(e) => setPixelPerfect(e.target.checked)}
          />
          Pixel perfect
        </label>
        <Field label="Wrap">
          <select value={wrap} onChange={(e) => setWrap(e.target.value)}>
            {["none", "x", "y", "both"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Ink">
          <select value={ink} onChange={(e) => setInk(e.target.value)}>
            {["paint", "shading", "lighten", "darken"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        {ink === "shading" && <Field label="Ramp direction"><select value={shadeStep} onChange={e => setShadeStep(+e.target.value)}><option value={-1}>Previous palette color</option><option value={1}>Next palette color</option></select></Field>}
        <Field label="Zoom">
          <select value={zoom} onChange={(e) => setZoom(+e.target.value)}>
            {Array.from({ length: 32 }, (_, index) => index + 1).map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </Field>
        <button
          onClick={() =>
            setZoom(
              clamp(
                Math.floor(
                  Math.min(
                    (viewportRef.current?.clientWidth - 80) / doc.width,
                    (viewportRef.current?.clientHeight - 80) / doc.height,
                  ),
                ),
                1,
                32,
              ),
            )
          }
        >
          Fit
        </button>
        <label>
          <input
            type="checkbox"
            checked={grid}
            onChange={(e) => setGrid(e.target.checked)}
          />
          Grid
        </label>
        <label title="Show a 2:1 diamond guide over the canvas">
          <input type="checkbox" checked={isometricGrid} onChange={(e) => setIsometricGrid(e.target.checked)} />
          Isometric guide
        </label>
        <label title="Snap drawing points to the isometric guide">
          <input type="checkbox" checked={isometricSnap} disabled={!isometricGrid} onChange={(e) => setIsometricSnap(e.target.checked)} />
          Iso snap
        </label>
        <Field label="Iso tile width">
          <input type="number" min="4" max="128" step="4" value={isometricTileWidth} onChange={(e) => setIsometricTileWidth(clamp(Math.round((+e.target.value || 16) / 4) * 4, 4, 128))} />
        </Field>
        <button onClick={() => { setIsoShapeOptions(current => ({ ...current, x: Math.floor(doc.width / 2), y: Math.max(current.elevation + 1, Math.floor(doc.height / 4)), width: isometricTileWidth })); setModal("isometricShape"); }} title="Stamp an editable isometric tile, block, or ramp">Isometric shapes</button>
        <button
          onClick={() => {
            setResizeOptions({
              width: doc.width,
              height: doc.height,
              mode: "canvas",
              anchor: "center",
            });
            setModal("resize");
          }}
        >
          {doc.width} × {doc.height}
        </button>
      </section>
      <div className="wb-body">
        <aside className="wb-tools" aria-label="Drawing tools">
          {TOOLS.map(([id, label, Icon, key]) => (
            <button
              key={id}
              aria-label={label + " tool"}
              aria-pressed={tool === id}
              title={`${label}${key ? " (" + (settings.shortcuts[id] || key).toUpperCase() + ")" : ""}`}
              className={tool === id ? "active" : ""}
              onClick={() => {
                setTool(id);
                pathRef.current = [];
              }}
            >
              <Icon size={18} />
            </button>
          ))}
          <div
            className="wb-current-color"
            style={{ background: color }}
            title={color}
          />
        </aside>
        <section className="wb-canvas-section">
          <div
            className="wb-viewport"
            ref={viewportRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void importFiles([...e.dataTransfer.files], "document");
            }}
          >
            <div className="wb-canvas-center">
              <div
                className={`wb-canvas-wrap ${grid ? "show-grid" : ""}`}
                style={{
                  width: doc.width * zoom,
                  height: doc.height * zoom,
                  "--pixel": zoom + "px",
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={doc.width}
                  height={doc.height}
                  style={{ width: doc.width * zoom, height: doc.height * zoom }}
                  aria-label={`${doc.width} by ${doc.height} pixel editor`}
                  tabIndex={0}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={() => {
                    if (operationRef.current?.tool === "automation") return;
                    if (operationRef.current?.base)
                      setDoc(operationRef.current.base);
                    operationRef.current = null;
                  }}
                  onDoubleClick={() => tool === "polygon" && finishPolygon()}
                />
                <canvas
                  ref={overlayRef}
                  width={doc.width}
                  height={doc.height}
                  className="wb-selection-overlay"
                  style={{ width: doc.width * zoom, height: doc.height * zoom }}
                  aria-hidden="true"
                />
                <canvas
                  ref={isoOverlayRef}
                  width={doc.width}
                  height={doc.height}
                  className="wb-isometric-overlay"
                  style={{ width: doc.width * zoom, height: doc.height * zoom }}
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
          <div className="wb-selection-bar">
            <span>
              {cursor ? `${cursor.x}, ${cursor.y}` : "Pixel coordinates"} ·{" "}
              {maskBounds
                ? `${maskBounds.width} × ${maskBounds.height} selected`
                : doc.colorMode.toUpperCase()}
            </span>
            <button onClick={selectAll}>Select all</button>
            <select
              aria-label="Selection combination"
              value={selectionMode}
              onChange={(e) => setSelectionMode(e.target.value)}
            >
              <option value="replace">Replace</option>
              <option value="union">Add</option>
              <option value="subtract">Subtract</option>
              <option value="intersect">Intersect</option>
            </select>
            <button
              disabled={!selection}
              onClick={() => { if (!luaAbortRef.current && !nativeSessionRef.current?.busy && !automationRef.current?.desktop.locked) setSelection(selection.map((v) => (v ? 0 : 1))); }}
            >
              Invert
            </button>
            <button data-pixelwall-clipboard="copy" disabled={!selection || busy} onClick={() => void copy()}>Copy</button>
            <button data-pixelwall-clipboard="cut" disabled={!selection || busy} onClick={() => void copy({cut:true})}>Cut</button>
            <button data-pixelwall-clipboard="paste" disabled={busy} onClick={() => void paste()}>Paste image</button>
            {clipboard && <button disabled={busy} onClick={() => void paste({localOnly:true})}>Paste copied pixels</button>}
            <IconButton
              icon={FlipHorizontal}
              label="Flip selection horizontally"
              disabled={!selection}
              onClick={() => transform("flipX")}
            />
            <IconButton
              icon={FlipVertical}
              label="Flip selection vertically"
              disabled={!selection}
              onClick={() => transform("flipY")}
            />
            <button disabled={!selection} onClick={() => setModal("transform")}>
              Transform
            </button>
            <button onClick={() => { if (!luaAbortRef.current && !nativeSessionRef.current?.busy && !automationRef.current?.desktop.locked) setSelection(null); }}>Deselect</button>
          </div>
        </section>
        <aside
          ref={sidebarRef}
          key={settings.sidebar}
          className="wb-sidebar"
          style={
            settings.sidebar === "floating"
              ? {
                  left: settings.panelX ?? 80,
                  top: settings.panelY ?? 150,
                  width: settings.panelWidth || 268,
                }
              : undefined
          }
        >
          <div className="wb-panel-dock">
            <button
              title={settings.sidebar === "floating" ? "Drag to move panels. Use Dock left or Dock right to lock them in place." : "Detach panels so you can move them"}
              style={{touchAction:"none"}}
              onClick={() => { if (settings.sidebar !== "floating") setSettings(current => ({...current, sidebar:"floating"})); }}
              onPointerDown={event => {
                if (settings.sidebar !== "floating" || event.button !== 0) return;
                const rect = sidebarRef.current.getBoundingClientRect();
                event.currentTarget.setPointerCapture(event.pointerId);
                panelDrag.current = {x:event.clientX, y:event.clientY, left:rect.left, top:rect.top};
              }}
              onPointerMove={event => {
                const drag = panelDrag.current;
                if (!drag) return;
                const width = sidebarRef.current?.offsetWidth || 268;
                setSettings(current => ({...current,
                  panelX:clamp(drag.left + event.clientX - drag.x, 0, Math.max(0, window.innerWidth - width)),
                  panelY:clamp(drag.top + event.clientY - drag.y, 0, Math.max(0, window.innerHeight - 100))}));
              }}
              onPointerUp={() => { panelDrag.current = null; }}
              onPointerCancel={() => { panelDrag.current = null; }}
              onLostPointerCapture={() => { panelDrag.current = null; }}
            >{settings.sidebar === "floating" ? "Drag panels" : "Float panels"}</button>
            <button title="Lock panels to the left edge" aria-pressed={settings.sidebar === "left"} onClick={() => dockPanels("left")}>Dock left</button>
            <button title="Lock panels to the right edge" aria-pressed={settings.sidebar === "right"} onClick={() => dockPanels("right")}>Dock right</button>
          </div>
          <button className="wb-keep-panel" title="Keep this section visible when switching to another panel" aria-pressed={pinnedPanels.includes(panel)} onClick={() => setPinnedPanels(current => current.includes(panel) ? current.filter(p => p !== panel) : [...current, panel])}>
            {pinnedPanels.includes(panel) ? "Stop keeping section open" : "Keep section open"}
          </button>
          <nav aria-label="Editor panels">
            {[
              ["layers", "Layers", Layers],
              ["colors", "Colors", Palette],
              ["effects", "Effects", Sparkles],
              ["tiles", "Tiles", Grid2X2],
              ["automation", "Scripts", Code2],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                title={label + " panel"}
                aria-label={label + " panel"}
                aria-pressed={panel === id}
                className={panel === id ? "active" : ""}
                onClick={() => setPanel(id)}
              >
                <Icon size={17} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="wb-panel-content">
            {(panel === "layers" || pinnedPanels.includes("layers")) && (
              <>
                <div className="wb-panel-title">
                  <h2>Layers</h2>
                  <button
                    title="Add a new image layer"
                    aria-label="Add layer"
                    onClick={() => {
                      const next = run(
                        {
                          type: "layer.add",
                          layer: { name: "Layer " + (doc.layers.length + 1) },
                        },
                        "Add layer",
                      );
                      if (next) setActiveLayer(next.layers.at(-1).id);
                    }}
                  >
                    +
                  </button>
                  <button
                    title="Add a group to organize layers"
                    aria-label="Add layer group"
                    onClick={() =>
                      run(
                        {
                          type: "layer.add",
                          layer: { name: "Group", type: "group" },
                        },
                        "Add group",
                      )
                    }
                  >
                    Group
                  </button>
                </div>
                <div className="wb-layer-actions">
                  <button title="Delete the selected layer or group and its contents. Undo restores it." disabled={doc.layers.length === 1} onClick={() => run({type:"layer.remove", layerId:activeLayer}, "Delete layer")}><Trash2 size={14} /> Delete layer</button>
                </div>
                <div className="wb-layer-list" role="region" aria-label="Layers">
                  {[...doc.layers].reverse().map((l) => (
                    <div
                      key={l.id}
                      className={`wb-layer ${activeLayer === l.id || selectedLayers.includes(l.id) ? "active" : ""}`}
                      style={{ paddingLeft: l.parentId ? 18 : 4 }}
                    >
                      <IconButton
                        icon={l.visible ? Eye : EyeOff}
                        label={`${l.visible ? "Hide" : "Show"} ${l.name}`}
                        onClick={() =>
                          run({
                            type: "layer.update",
                            layerId: l.id,
                            patch: { visible: !l.visible },
                          })
                        }
                      />
                      <button
                        title={`${l.name} — click to select; Ctrl/⌘-click to select multiple layers`}
                        className="wb-layer-name"
                        onClick={(event) => selectLayer(l.id, event)}
                      >
                        {l.type === "group"
                          ? "▸ "
                          : l.type === "tilemap"
                            ? "▦ "
                            : l.type === "reference"
                              ? "◈ "
                              : ""}
                        {l.name}
                      </button>
                      <IconButton
                        icon={l.locked ? Lock : Unlock}
                        label={`${l.locked ? "Unlock" : "Lock"} ${l.name}`}
                        onClick={() =>
                          run({
                            type: "layer.update",
                            layerId: l.id,
                            patch: { locked: !l.locked },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                {layer && (
                  <>
                    <Field label="Layer name">
                      <input
                        value={layer.name}
                        onChange={(e) =>
                          run({
                            type: "layer.update",
                            patch: { name: e.target.value },
                          })
                        }
                      />
                    </Field>
                    <Field label="Opacity">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(layer.opacity * 100)}
                        onChange={(e) =>
                          run({
                            type: "layer.update",
                            patch: { opacity: +e.target.value / 100 },
                          })
                        }
                      />
                    </Field>
                    <Field label="Blend">
                      <select
                        value={layer.blendMode || "normal"}
                        onChange={(e) =>
                          run({
                            type: "layer.update",
                            patch: { blendMode: e.target.value },
                          })
                        }
                      >
                        {BLENDS.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Group">
                      <select
                        value={layer.parentId || ""}
                        onChange={(e) =>
                          run({
                            type: "layer.update",
                            patch: { parentId: e.target.value || null },
                          })
                        }
                      >
                        <option value="">None</option>
                        {doc.layers
                          .filter(
                            (l) => l.type === "group" && l.id !== layer.id,
                          )
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <div className="wb-button-row">
                      <IconButton
                        icon={ChevronUp}
                        label="Move layer up"
                        onClick={() =>
                          run({
                            type: "layer.reorder",
                            index: Math.min(
                              doc.layers.length - 1,
                              doc.layers.findIndex(
                                (l) => l.id === activeLayer,
                              ) + 1,
                            ),
                          })
                        }
                      />
                      <IconButton
                        icon={ChevronDown}
                        label="Move layer down"
                        onClick={() =>
                          run({
                            type: "layer.reorder",
                            index: Math.max(
                              0,
                              doc.layers.findIndex(
                                (l) => l.id === activeLayer,
                              ) - 1,
                            ),
                          })
                        }
                      />
                      <IconButton
                        icon={Trash2}
                        label="Delete layer (Undo restores it)"
                        disabled={doc.layers.length === 1}
                        onClick={() =>
                          run({ type: "layer.remove" }, "Delete layer")
                        }
                      />
                    </div>
                    <Field label="Cel X">
                      <input
                        type="number"
                        value={frame?.cels?.[activeLayer]?.x || 0}
                        onChange={(e) =>
                          run({
                            type: "cel.move",
                            x: +e.target.value,
                            y: frame?.cels?.[activeLayer]?.y || 0,
                          })
                        }
                      />
                    </Field>
                    <Field label="Cel Y">
                      <input
                        type="number"
                        value={frame?.cels?.[activeLayer]?.y || 0}
                        onChange={(e) =>
                          run({
                            type: "cel.move",
                            x: frame?.cels?.[activeLayer]?.x || 0,
                            y: +e.target.value,
                          })
                        }
                      />
                    </Field>
                  </>
                )}
                <button onClick={() => chooseImport("reference")}>
                  Import reference layer
                </button>
                <button onClick={() => run({type:"layer.flatten"}, "Rasterize layer")}>Rasterize layer or group</button>
                <button onClick={() => run({type:"document.flatten"}, "Flatten visible layers")}>Flatten visible layers</button>
                <button onClick={() => setModal("motion")}>
                  Animate layer…
                </button>
                <button
                  onClick={() => {
                    setSliceDraft(null);
                    setModal("slice");
                  }}
                >
                  Add named slice…
                </button>
                {doc.slices?.map((s) => (
                  <div className="wb-slice" key={s.id}>
                    <span>{s.name}</span>
                    {s.bounds && (
                      <button
                        aria-label={`Edit slice ${s.name}`}
                        onClick={() => {
                          setSliceDraft(s);
                          setModal("slice");
                        }}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      aria-label={`Delete slice ${s.name}`}
                      onClick={() =>
                        run({ type: "slice.remove", sliceId: s.id })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}
            {(panel === "colors" || pinnedPanels.includes("colors")) && (
              <>
                <h2>Color & brushes</h2>
                <div className="wb-color-input">
                  <input
                    aria-label="Color picker"
                    type="color"
                    value={displayColor(color).slice(0, 7)}
                    onChange={(e) =>
                      setColor(workingColor(e.target.value + color.slice(7, 9)))
                    }
                  />
                  <input
                    aria-label="Hex color"
                    value={color}
                    maxLength={9}
                    onChange={(e) => setColor(e.target.value)}
                    onBlur={() => {
                      if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color))
                        setColor("#ffb34bff");
                      else if (color.length === 7) setColor(color + "ff");
                    }}
                  />
                </div>
                <Field label="Background color">
                  <div className="wb-color-input">
                    <input aria-label="Background color picker" type="color" value={displayColor(bgColor).slice(0,7)} onChange={event => setBgColor(workingColor(event.target.value + bgColor.slice(7,9)))} />
                    <input aria-label="Background hex color" value={bgColor} maxLength={9} onChange={event => setBgColor(event.target.value)} onBlur={() => setBgColor(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(bgColor) ? bgColor.length === 7 ? bgColor + "ff" : bgColor : "#ffffffff")} />
                  </div>
                </Field>
                <button onClick={() => { setColor(bgColor); setBgColor(color); }}>Swap foreground and background</button>
                <Field label="Alpha">
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={parseInt(color.slice(7, 9) || "ff", 16) || 0}
                    onChange={(e) =>
                      setColor(
                        color.slice(0, 7) +
                          (+e.target.value).toString(16).padStart(2, "0"),
                      )
                    }
                  />
                </Field>
                <div className="wb-palette">
                  {activePalette.map((c, i) => (
                    <button
                      key={i}
                      style={{ background: displayColor(c) }}
                      aria-label={`Palette color ${i}: ${c}`}
                      title={c}
                      onClick={() => setColor(c.length === 7 ? c + "ff" : c)}
                    />
                  ))}
                </div>
                <div className="wb-button-row">
                  <button
                    onClick={() =>
                      run(
                        {
                          type: "palette.update",
                          ...paletteTarget(),
                          palette: [...activePalette, color],
                        },
                        "Add palette color",
                      )
                    }
                  >
                    Add color
                  </button>
                  <button
                    onClick={() => {
                      setPaletteText(activePalette.join("\n"));
                      setModal("palette");
                    }}
                  >
                    Edit palette
                  </button>
                  <button
                    onClick={() =>
                      downloads.downloadBlob(
                        new Blob([activePalette.join("\n")], {
                          type: "text/plain",
                        }),
                        stem(doc.name) + ".hex",
                      )
                    }
                  >
                    Save palette
                  </button>
                </div>
                <button onClick={() => chooseImport("palette")}>
                  Import palette
                </button>
                <Field label="Palette changes apply to"><select value={paletteScope} onChange={e => setPaletteScope(e.target.value)}><option value="all">All frames</option><option value="frame">Current frame</option><option value="range">Selected frames</option></select></Field>
                <button onClick={() => setModal("profile")}>Color profile: {profileName}</button>
                <Field label="Color mode">
                  <select
                    value={doc.colorMode}
                    onChange={event => event.target.value === "indexed" ? setModal("indexed") : run({type:"document.colorMode",colorMode:event.target.value},"Convert color mode")}
                  >
                    <option value="rgba">RGB + alpha</option>
                    <option value="indexed">Indexed</option>
                    <option value="grayscale">Grayscale</option>
                  </select>
                </Field>
                <button onClick={() => setModal("indexed")}>Indexed conversion options…</button>
                <Field label="Gradient end">
                  <input
                    type="color"
                    value={displayColor(endColor).slice(0, 7)}
                    onChange={(e) => setEndColor(workingColor(e.target.value + "ff"))}
                  />
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={dither}
                    onChange={(e) => setDither(e.target.checked)}
                  />
                  Dither gradient
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={pressure}
                    onChange={(e) => setPressure(e.target.checked)}
                  />
                  Pen pressure
                </label>
                <Field label="Stroke stabilization">
                  <input
                    type="range"
                    min={0}
                    max={8}
                    value={stabilize}
                    onChange={(e) => setStabilize(+e.target.value)}
                  />
                </Field>
                <button onClick={captureBrush}>
                  Use copied pixels as brush
                </button>
                {customBrush && (
                  <button onClick={() => setCustomBrush(null)}>
                    Reset custom brush
                  </button>
                )}
                <Field label="Text">
                  <textarea
                    rows={3}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </Field>
                <Field label="Text scale">
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={textScale}
                    onChange={(e) =>
                      setTextScale(clamp(+e.target.value, 1, 16))
                    }
                  />
                </Field>
              </>
            )}
            {(panel === "effects" || pinnedPanels.includes("effects")) && (
              <>
                <h2>Effects</h2>
                <Field label="Effect">
                  <select
                    value={effect}
                    onChange={(e) => setEffect(e.target.value)}
                  >
                    {[
                      "outline",
                      "replace",
                      "brightness",
                      "contrast",
                      "hue",
                      "saturation",
                      "convolution",
                      "despeckle",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount">
                  <input
                    type="number"
                    value={effectAmount}
                    onChange={(e) => setEffectAmount(+e.target.value)}
                  />
                </Field>
                {effect === "replace" && (
                  <Field label="Replace color">
                    <input
                      value={replaceColor}
                      onChange={(e) => setReplaceColor(e.target.value)}
                    />
                  </Field>
                )}
                {effect === "convolution" && (
                  <Field label="3 × 3 kernel">
                    <textarea
                      value={kernel}
                      onChange={(e) => setKernel(e.target.value)}
                    />
                  </Field>
                )}
                <p>
                  Applies to {targetLayers().length} selected layer(s) in{" "}
                  {targetFrames().length} selected frame
                  {targetFrames().length === 1 ? "" : "s"}
                  {selection ? ", within your selection" : ""}.
                </p>
                <button
                  className="wb-primary"
                  onClick={() =>
                    run(
                      targetLayers().map((layerId) => ({
                        type: "effect.apply",
                        layerId,
                        frameIds: targetFrames(),
                        effect,
                        amount: [
                          "brightness",
                          "contrast",
                          "saturation",
                        ].includes(effect)
                          ? clamp(
                              effectAmount / 100,
                              effect === "contrast" ? -0.99 : -1,
                              effect === "contrast" ? 0.99 : 1,
                            )
                          : effectAmount,
                        color,
                        fromColor: replaceColor,
                        toColor: color,
                        kernel: kernel.split(/[\s,]+/).map(Number),
                        selection: selection || undefined,
                      })),
                      "Apply effect",
                    )
                  }
                >
                  Apply effect
                </button>
                <h3>Animation</h3>
                <button onClick={() => setModal("motion")}>
                  Motion and particles
                </button>
                <Field label="Previous onion frames">
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={onionBefore}
                    onChange={(e) =>
                      setOnionBefore(clamp(+e.target.value, 0, 5))
                    }
                  />
                </Field>
                <Field label="Next onion frames">
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={onionAfter}
                    onChange={(e) =>
                      setOnionAfter(clamp(+e.target.value, 0, 5))
                    }
                  />
                </Field>
                <Field label="Onion opacity">
                  <input
                    type="range"
                    min={0}
                    max={0.8}
                    step={0.05}
                    value={onionOpacity}
                    onChange={(e) => setOnionOpacity(+e.target.value)}
                  />
                </Field>
              </>
            )}
            {(panel === "tiles" || pinnedPanels.includes("tiles")) && (
              <>
                <h2>Tilesets</h2>
                <input hidden ref={externalTilesetInputRef} type="file" accept=".aseprite,.ase" onChange={loadExternalTileset} />
                {externalTilesets.map(link => <div className="wb-slice" key={link.tilesetId}>
                  <span>{link.name || "External tileset"}<small>{link.sourceLabel || "Source file required"}</small></span>
                  <button disabled={busy} onClick={() => chooseExternalTileset(link.tilesetId)}>Choose source & embed</button>
                </div>)}
                <button
                  onClick={() => {
                    setTool("tilePixels");
                    setNotice("Click a tilemap cell to edit its tile pixels.");
                  }}
                >
                  Edit tile pixels…
                </button>
                <Field label="Tileset">
                  <select
                    value={tilesetId}
                    onChange={(e) => {
                      setTilesetId(e.target.value);
                      setTileId("");
                    }}
                  >
                    <option value="">Choose tileset</option>
                    {doc.tilesets?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button onClick={() => setModal("tileset")}>
                  Create tileset from frames…
                </button>
                <button
                  onClick={() => {
                    const next = run(
                      {
                        type: "layer.add",
                        layer: { name: "Tilemap", type: "tilemap" },
                      },
                      "Add tilemap layer",
                    );
                    if (next) {
                      setActiveLayer(next.layers.at(-1).id);
                      setTool("tile");
                    }
                  }}
                >
                  Add tilemap layer
                </button>
                <div className="wb-tile-list">
                  {doc.tilesets
                    ?.find((t) => t.id === tilesetId)
                    ?.tiles?.map((tile, index) => (
                      <button
                        key={tile.id}
                        className={tileId === tile.id ? "active" : ""}
                        onClick={() => {
                          setTileId(tile.id);
                          setTool("tile");
                        }}
                      >
                        Tile {index + 1}
                      </button>
                    ))}
                </div>
                <button
                  onClick={() => {
                    setTileId("");
                    setTool("tile");
                  }}
                >
                  Erase tile
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={tileFlipX}
                    onChange={(e) => setTileFlipX(e.target.checked)}
                  />
                  Flip horizontally
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={tileFlipY}
                    onChange={(e) => setTileFlipY(e.target.checked)}
                  />
                  Flip vertically
                </label>
                <Field label="Rotation">
                  <select
                    value={tileRotate}
                    onChange={(e) => setTileRotate(+e.target.value)}
                  >
                    {[0, 90, 180, 270].map((v) => (
                      <option key={v} value={v}>
                        {v}°
                      </option>
                    ))}
                  </select>
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={seamless}
                    onChange={(e) => setSeamless(e.target.checked)}
                  />
                  Seamless preview
                </label>
                {seamless && (
                  <div className="wb-repeat-preview">
                    <FrameThumb doc={doc} frameId={activeFrame} repeat={3} colorManager={colorManager} />
                  </div>
                )}
              </>
            )}
            {(panel === "automation" ||
              pinnedPanels.includes("automation")) && (
              <>
                <h2>Scripts & commands</h2>
                <AsepritePackagesPanel registry={asepriteRegistry} disabled={busy || !!nativeSessionRef.current?.busy || !!automationRef.current?.desktop.locked}
                  onOpenScript={source => {setLuaSource(source);setScriptLanguage("lua");}}
                  onRunScript={runPackageCommand}
                  onApplyPalette={palette => {commit({type:"palette.update", ...paletteTarget(), palette}, "Extension palette");setNotice("Extension palette applied. Undo restores the previous colors.");}}
                  onDownload={(blob,name) => downloads.downloadBlob(blob,name)} onNotice={setNotice} onError={report}/>
                <Field label="Script type"><select value={scriptLanguage} onChange={e => setScriptLanguage(e.target.value)}><option value="commands">PixelWall commands</option><option value="lua">Lua 5.4</option></select></Field>
                {scriptLanguage === "lua" ? <>
                  <p>Run Lua with Sprite, Image, Color, layers, frames, palettes and transactions. Each run is undoable. <a href="https://www.pixelwall.dev/guides/ai-agents" target="_blank" rel="noreferrer">Open the scripting and AI-agent guide.</a></p>
                  <div className="wb-button-row"><button onClick={() => chooseImport("lua")}>Open Lua script</button><button onClick={() => downloads.downloadBlob(new Blob([luaSource],{type:"text/plain"}),"pixelwall-script.lua")}>Save script</button></div>
                  <label className="wb-field"><span>Lua script</span><textarea className="wb-code" rows={16} value={luaSource} onChange={e => setLuaSource(e.target.value)} spellCheck={false}/></label>
                  <Field label="Time limit"><select value={luaTimeout} onChange={e => setLuaTimeout(+e.target.value)}><option value={3000}>3 seconds</option><option value={10000}>10 seconds</option></select></Field>
                  <button className="wb-primary" disabled={busy} onClick={() => void runLua().catch(error => {setCommandResult(error.message);report(error);})}>Run Lua script</button>
                  {busy && luaAbortRef.current && <button data-pixelwall-lua-controls disabled={luaSaving} onClick={() => { if (!luaSavingRef.current) luaAbortRef.current?.abort(); }}>{luaSaving ? "Saving script results…" : "Cancel script"}</button>}
                </> : <>
                <button onClick={() => chooseImport("extension")}>
                  Install command extension
                </button>
                {extensions.map((extension) => (
                  <div key={extension.id} className="wb-extension">
                    <strong>{extension.name}</strong>
                    <p>{extension.description}</p>
                    <button
                      onClick={() => run(extension.commands, extension.name)}
                    >
                      Run
                    </button>
                    <button
                      onClick={() =>
                        downloads.downloadBlob(
                          new Blob([JSON.stringify(extension, null, 2)], {
                            type: "application/json",
                          }),
                          extension.id + ".json",
                        )
                      }
                    >
                      Save
                    </button>
                    <button
                      onClick={async () => {
                        const next = extensions.filter(
                          (e) => e.id !== extension.id,
                        );
                        await storeRef.current.setSetting("extensions", next);
                        setExtensions(next);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={async () => {
                    try {
                      const value = JSON.parse(commandText),
                        extension = validateExtension({
                          format: "pixelwall-extension",
                          version: 1,
                          id: "macro-" + Date.now(),
                          name: "Saved commands " + (extensions.length + 1),
                          commands: Array.isArray(value) ? value : [value],
                        });
                      const next = [...extensions, extension];
                      await storeRef.current.setSetting("extensions", next);
                      setExtensions(next);
                    } catch (error) {
                      report(error);
                    }
                  }}
                >
                  Save batch as extension
                </button>
                <p>
                  Apply drawing and editing commands directly to this project.
                  Each batch is one undoable operation.
                </p>
                <label className="wb-field">
                  <span>Command batch (JSON)</span>
                  <textarea
                    className="wb-code"
                    rows={14}
                    value={commandText}
                    onChange={(e) => setCommandText(e.target.value)}
                    spellCheck={false}
                  />
                </label>
                <button onClick={() => { try {
                  const value = JSON.parse(commandText);
                  void automationRef.current.validate({commands:Array.isArray(value) ? value : [value]}).then(result => setCommandResult(JSON.stringify(result, null, 2))).catch(report);
                } catch (error) { report(error); } }}>Validate batch</button>
                <button className="wb-primary" onClick={runBatch}>
                  Run command batch
                </button>
                <button
                  onClick={() =>
                    setCommandResult(
                      JSON.stringify(window.pixelwall.inspect(), null, 2),
                    )
                  }
                >
                  Inspect document
                </button>
                <button
                  onClick={() =>
                    setCommandResult(JSON.stringify(COMMANDS, null, 2))
                  }
                >
                  Command reference
                </button>
                <a className="wb-button-link" href="https://www.pixelwall.dev/guides/ai-agents" target="_blank" rel="noreferrer">AI agent guide</a>
                </>}
                <pre
                  className="wb-code-result"
                  tabIndex={0}
                  role="log"
                  aria-label="Command output"
                >
                  {commandResult ||
                    "JavaScript API: window.pixelwall\nNo AI runs inside PixelWall."}
                </pre>
                <a href="/guides/scripting" target="_blank" rel="noreferrer">
                  Scripting & CLI guide
                </a>
              </>
            )}
          </div>
        </aside>
      </div>
      <section
        className="wb-timeline"
        aria-label="Animation timeline"
        style={{ height: settings.timelineHeight }}
      >
        <div className="wb-timeline-tools">
          <IconButton
            icon={playing ? Pause : Play}
            label={playing ? "Pause animation" : "Play animation"}
            onClick={() => setPlaying((p) => !p)}
          />
          <button
            onClick={() => {
              const next = run(
                {
                  type: "frame.add",
                  afterFrameId: activeFrame,
                  clipId: clipId || undefined,
                },
                "Add frame",
              );
              if (next) {
                const index = next.frames.findIndex(
                  (f) => f.id === activeFrame,
                );
                selectFrame(
                  next.frames[index + 1]?.id || next.frames.at(-1).id,
                );
              }
            }}
          >
            + Frame
          </button>
          <button
            onClick={() =>
              run(
                {
                  type: "frame.duplicate",
                  frameIds: targetFrames(),
                  clipId: clipId || undefined,
                },
                "Duplicate frames",
              )
            }
          >
            Duplicate
          </button>
          <button
            onClick={() =>
              run(
                {
                  type: "frame.duplicate",
                  frameIds: targetFrames(),
                  linked: true,
                  clipId: clipId || undefined,
                },
                "Duplicate linked frames",
              )
            }
          >
            Duplicate linked
          </button>
          <IconButton
            icon={Link2}
            label="Link selected cels"
            onClick={() =>
              run(
                {
                  type: "cel.link",
                  sourceFrameId: activeFrame,
                  frameIds: targetFrames(),
                },
                "Link cels",
              )
            }
          />
          <IconButton
            icon={Unlink}
            label="Unlink selected cels"
            onClick={() =>
              run(
                { type: "cel.unlink", frameIds: targetFrames() },
                "Unlink cels",
              )
            }
          />
          <IconButton
            icon={Trash2}
            label="Delete selected frames"
            disabled={targetFrames().length >= doc.frames.length}
            onClick={() => {
              const next = run(
                { type: "frame.remove", frameIds: targetFrames() },
                "Delete frames",
              );
              if (next) selectFrame(next.frames[0].id);
            }}
          />
          <Field label="Duration ms">
            <input
              type="number"
              min={16}
              max={60000}
              value={frame?.durationMs || 125}
              onChange={(e) =>
                run(
                  {
                    type: "frame.update",
                    frameIds: targetFrames(),
                    patch: { durationMs: clamp(+e.target.value, 16, 60000) },
                  },
                  "Frame timing",
                )
              }
            />
          </Field>
          <Field label="Clip">
            <select value={clipId} onChange={(e) => setClipId(e.target.value)}>
              <option value="">All frames</option>
              {doc.clips?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            onClick={() =>
              run(
                { type: "frame.reverse", frameIds: targetFrames() },
                "Reverse frames",
              )
            }
          >
            Reverse
          </button>
          <button
            onClick={() =>
              run(
                {
                  type: "frame.reorder",
                  frameIds: targetFrames(),
                  index: Math.max(
                    0,
                    doc.frames.findIndex((f) => targetFrames().includes(f.id)) -
                      1,
                  ),
                },
                "Move frames earlier",
              )
            }
          >
            ← Frames
          </button>
          <button
            onClick={() =>
              run(
                {
                  type: "frame.reorder",
                  frameIds: targetFrames(),
                  index: Math.min(
                    doc.frames.length - targetFrames().length,
                    doc.frames.findIndex((f) => targetFrames().includes(f.id)) +
                      1,
                  ),
                },
                "Move frames later",
              )
            }
          >
            Frames →
          </button>
          <button onClick={() => setModal("clip")}>Edit clips</button>
          <span>
            {doc.frames.length} frames · {doc.layers.length} layers
          </span>
          <button
            disabled={!timelinePage}
            onClick={() => setTimelinePage((p) => p - 1)}
          >
            ‹
          </button>
          <button
            disabled={(timelinePage + 1) * 64 >= doc.frames.length}
            onClick={() => setTimelinePage((p) => p + 1)}
          >
            ›
          </button>
        </div>
        <div className="wb-timeline-scroll">
          <div
            className="wb-timeline-grid"
            style={{
              gridTemplateColumns: `130px repeat(${visibleFrames.length},50px)`,
            }}
          >
            <div className="wb-timeline-corner">Layer / frame</div>
            {visibleFrames.map((f, i) => (
              <button
                key={"frame" + f.id}
                className={`wb-frame-heading ${selectedFrames.includes(f.id) ? "selected" : ""} ${activeFrame === f.id ? "active" : ""}`}
                aria-label={`Select frame ${timelinePage * 64 + i + 1}`}
                onClick={(e) => selectFrame(f.id, e)}
              >
                <span>{timelinePage * 64 + i + 1}</span>
                <FrameThumb doc={doc} frameId={f.id} colorManager={colorManager} />
                <small>{f.durationMs} ms</small>
              </button>
            ))}
            {[...doc.layers].reverse().flatMap((l) => [
              <button
                className={`wb-timeline-layer ${l.id === activeLayer ? "active" : ""}`}
                key={l.id}
                onClick={(event) => selectLayer(l.id, event)}
              >
                {l.name}
              </button>,
              ...visibleFrames.map((f) => (
                <button
                  key={l.id + f.id}
                  aria-label={`${l.name}, frame ${doc.frames.indexOf(f) + 1}`}
                  className={`wb-cel ${activeFrame === f.id && activeLayer === l.id ? "active" : ""}`}
                  onClick={(e) => {
                    selectLayer(l.id, e);
                    selectFrame(f.id, e);
                  }}
                >
                  {f.cels?.[l.id]
                    ? doc.frames.filter(
                        (fr) =>
                          fr.cels?.[l.id]?.imageId === f.cels[l.id].imageId,
                      ).length > 1
                      ? "◆"
                      : "●"
                    : l.tilemaps?.[f.id]
                      ? "▦"
                      : "·"}
                </button>
              )),
            ])}
          </div>
        </div>
      </section>
      <footer className="wb-status">
        {operationRef.current?.tool === "automation" && <button type="button" data-pixelwall-agent-controls onClick={() => {
          const operation = automationRef.current?.inspect().latestOperation;
          if (operation && ["queued", "running"].includes(operation.status)) automationRef.current.cancel(operation.id);
          operationRef.current?.cancel?.();
          setNotice("Cancellation requested; waiting for the current command to finish.");
        }}>Cancel edit</button>}
        <span role="status">
          {notice ||
            "Draw, animate, and export. All artwork stays on your device."}
        </span>
        <span>
          {doc.width} × {doc.height} · {doc.colorMode} · {zoom}× ·{" "}
          {typeof offlineStatus === "string"
            ? offlineStatus
            : offlineStatus.ready
              ? "Offline ready"
              : "Online workspace"}
        </span>
      </footer>
      <input
        ref={fileRef}
        className="wb-hidden"
        type="file"
        aria-label="Import artwork file"
        accept=".pixelwall,.json,.ase,.aseprite,.png,.gif,.jpg,.jpeg,.webp,.bmp,.tga,.hex,.gpl,.pal,.icc,.icm,.lua"
        onChange={(e) => void importFiles([...e.target.files])}
      />
      {luaDialog.view && <LuaDialogView key={luaDialog.view.requestId} view={luaDialog.view} document={doc} colorManager={colorManager} onCancelScript={() => luaAbortRef.current?.abort()} />}
      {luaCommands.view && <LuaCommandView key={luaCommands.view.requestId} view={luaCommands.view} />}
      {modal === "tilePixels" && tileDraft && (
        <Modal title="Edit tile pixels" onClose={() => setModal(null)}>
          <TilePixelEditor
            colorManager={colorManager}
            colorProfile={documentProfile(doc)}
            tile={tileDraft}
            color={color}
            onCancel={() => setModal(null)}
            onApply={(pixels, mode) => {
              if (
                run(
                  {
                    type: "tilemap.edit",
                    frameId: tileDraft.frameId,
                    layerId: tileDraft.layerId,
                    x: tileDraft.x,
                    y: tileDraft.y,
                    pixels,
                    mode,
                  },
                  "Edit tile pixels",
                )
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === "new" && (
        <Modal title="New project" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void newDocument(newOptions).catch(report);
            }}
          >
            <Field label="Project name">
              <input
                value={newOptions.name}
                onChange={(e) =>
                  setNewOptions({ ...newOptions, name: e.target.value })
                }
              />
            </Field>
            <div className="wb-two-fields">
              {["width", "height"].map((k) => (
                <Field key={k} label={k}>
                  <input
                    type="number"
                    min={1}
                    max={LIMITS.edge}
                    required
                    value={newOptions[k]}
                    onChange={(e) =>
                      setNewOptions({ ...newOptions, [k]: +e.target.value })
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="Color mode">
              <select
                value={newOptions.colorMode}
                onChange={(e) =>
                  setNewOptions({ ...newOptions, colorMode: e.target.value })
                }
              >
                <option value="rgba">RGB + alpha</option>
                <option value="indexed">Indexed</option>
                <option value="grayscale">Grayscale</option>
              </select>
            </Field>
            <Field label="Storage mode"><select value={newOptions.mode} onChange={e => setNewOptions({...newOptions, mode:e.target.value})}><option value="library">Save in local library</option><option value="temporary">Temporary document (checkpoint required)</option></select></Field>
            <button className="wb-primary" type="submit">
              Create project
            </button>
          </form>
        </Modal>
      )}
      {modal === "components" && <Modal title="Scene components" onClose={() => setModal(null)} wide>
        <SceneComponentsPanel document={doc} disabled={busy || !!operationRef.current} onStamp={command => {
          if (run(command, "Stamp scene component")) setNotice("Component added as editable layers. Undo restores the previous scene.");
        }} onReplace={command => {
          if (run(command, "Regenerate scene component")) setNotice("Component regeneration committed. Protected manual layers were preserved.");
        }} />
      </Modal>}
      {modal === "preview" && <Modal title="Review artwork" onClose={() => setModal(null)} wide>
        <button type="button" onClick={() => { automationRef.current.capturePreview(); setPreviewResult(null); }}>Capture comparison baseline</button>
        <PreviewPanel key={doc.id} document={doc} beforeDocument={previewBaseline?.id === doc.id ? previewBaseline : null}
          result={previewResult} onRender={options => void automationRef.current.preview(options).then(setPreviewResult).catch(report)} />
        {previewResult && <div className="wb-preview-images">
          {previewResult.kind === "comparison" ? <>{["before", "after"].map(name => <figure key={name}><figcaption>{name === "before" ? "Before" : "After"}</figcaption><img src={previewResult[name].dataUrl} alt={`${name} artwork preview`} /></figure>)}<figure><figcaption>Changed pixels</figcaption><img src={previewResult.dataUrl} alt="Changed pixels in red" /></figure></>
            : <figure><img src={previewResult.dataUrl} alt={previewResult.kind === "contact-sheet" ? "Animation contact sheet" : "Artwork preview"} /></figure>}
        </div>}
        <AnimationReviewPanel key={`animation-${doc.id}`} document={doc} baseline={previewBaseline?.id === doc.id ? previewBaseline : null} disabled={busy || !!operationRef.current} onBake={options => run({type:"animation.environment", ...options}, "Bake periodic motion")} />
      </Modal>}
      {modal === "artifacts" && <Modal title="Generated files" onClose={() => setModal(null)} wide>
        <p>Generated copies stay on this device for up to 24 hours, subject to the 128 MiB / 64-file limit. Download a copy to keep it.</p>
        <ArtifactLibrary listArtifacts={downloads.artifacts} onDownload={downloads.downloadArtifact} onRemove={downloads.removeArtifact} onReleaseUrl={downloads.releaseArtifactUrl} refreshKey={downloads.lastResult?.id} />
      </Modal>}
      {modal === "storage" && <Modal title="Local storage" onClose={() => setModal(null)}>
        <p>Library saves, recovery history, and temporary export artifacts are separate. PixelWall never deletes saved projects automatically.</p>
        <p>Closing a project tab hides it. Its saved artwork and recovery history stay in the library and continue to use storage.</p>
        {storageStats && storageStats.status !== "unavailable" ? <dl className="wb-storage-stats">
          <div><dt>Library used</dt><dd>{storageStats.usedBytes.toLocaleString()} / {storageStats.budgetBytes.toLocaleString()} bytes</dd></div>
          <div><dt>Artwork and heads</dt><dd>{storageStats.artworkBytes.toLocaleString()} bytes</dd></div>
          <div><dt>Recovery history</dt><dd>{storageStats.recoveryBytes.toLocaleString()} bytes</dd></div>
          <div><dt>Projects / revisions</dt><dd>{storageStats.documentCount} / {storageStats.revisionCount}</dd></div>
          <div><dt>Available</dt><dd>{storageStats.availableBytes.toLocaleString()} bytes</dd></div>
        </dl> : <p role="status">Local library statistics are unavailable.</p>}
        <p>When the library is full, use desktop Save or Save As to keep artwork in a file, export a verified .pixelwall checkpoint, or increase the library budget. Existing library projects remain intact.</p>
        {storageStats && storageStats.status !== "unavailable" && <form onSubmit={event => { event.preventDefault(); void hostRef.current?.setStorageBudget?.({bytes:Math.trunc(Number(storageBudgetInput) * 1024 * 1024)}).catch(report); }}><label>Library budget (MiB) <input type="number" min="16" max="1024" step="1" value={storageBudgetInput || Math.round(storageStats.budgetBytes / (1024 * 1024))} onChange={event => setStorageBudgetInput(event.target.value)} /></label><button type="submit">Apply budget</button></form>}
        <button type="button" onClick={() => setTemporaryProjects(hostRef.current?.temporaryProjects?.() ?? [])}>Refresh retained documents</button>
        {temporaryProjects.length > 0 && <ul aria-label="Retained documents">{temporaryProjects.map(entry => <li key={entry.documentId}>{entry.name || entry.documentId} · {entry.mode} <button type="button" onClick={() => void hostRef.current?.openTemporaryProject?.({documentId:entry.documentId}).then(() => setTemporaryProjects(hostRef.current.temporaryProjects())).catch(report)}>Restore</button></li>)}</ul>}
      </Modal>}
      {modal === "water" && (
        <Modal title="Generate water scene" wide onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); void newWaterScene(waterOptions).catch(report); }}>
            <p className="wb-dialog-hint">Creates a new project tab and leaves your current artwork untouched.</p>
            <WaterPreview options={waterOptions} onValidityChange={setWaterPreviewValid} />
            <Field label="Project name"><input value={waterOptions.name} onChange={(e) => setWaterOptions({...waterOptions, name:e.target.value})} /></Field>
            <div className="wb-two-fields">
              <Field label="Width"><input type="number" min="8" max="256" value={waterOptions.width} onChange={(e) => setWaterOptions({...waterOptions, width:clamp(Math.trunc(+e.target.value || 8),8,256)})} /></Field>
              <Field label="Height"><input type="number" min="8" max="256" value={waterOptions.height} onChange={(e) => setWaterOptions({...waterOptions, height:clamp(Math.trunc(+e.target.value || 8),8,256)})} /></Field>
            </div>
            <div className="wb-two-fields">
              <Field label="Scene"><select value={waterOptions.scene} onChange={(e) => setWaterOptions({...waterOptions, scene:e.target.value})}>{["pond","river","stream","waterfall","shoreline"].map(v=><option key={v}>{v}</option>)}</select></Field>
              <Field label="View"><select value={waterOptions.view} onChange={(e) => setWaterOptions({...waterOptions, view:e.target.value})}><option value="top-down">Top down</option><option value="isometric">Isometric</option></select></Field>
            </div>
            <div className="wb-two-fields">
              <Field label="Season"><select value={waterOptions.season} onChange={(e) => setWaterOptions({...waterOptions, season:e.target.value})}>{["spring","summer","autumn","winter"].map(v=><option key={v}>{v}</option>)}</select></Field>
              <Field label="Water color"><input type="color" value={(waterOptions.palette.water || {spring:"#368fab",summer:"#338eaa",autumn:"#448b9b",winter:"#6ba6ba"}[waterOptions.season]).slice(0,7)} onChange={(e) => setWaterOptions({...waterOptions, palette:{...waterOptions.palette, water:`${e.target.value}ff`}})} /></Field>
            </div>
            <div className="wb-two-fields">
              <Field label="Frames"><input type="number" min="1" max="32" value={waterOptions.frames} onChange={(e) => setWaterOptions({...waterOptions, frames:clamp(Math.trunc(+e.target.value || 1),1,32)})} /></Field>
              <Field label="Frame duration (ms)"><input type="number" min="1" max="65535" value={waterOptions.durationMs} onChange={(e) => setWaterOptions({...waterOptions, durationMs:clamp(Math.trunc(+e.target.value || 1),1,65535)})} /></Field>
            </div>
            <Field label="Shoreline seed"><input type="number" min="0" max="4294967295" step="1" value={waterOptions.seed} onChange={(e) => setWaterOptions({...waterOptions, seed:clamp(Math.trunc(+e.target.value || 0),0,4294967295)})} /></Field>
            <Field label="Water seed"><input type="number" min="0" max="4294967295" step="1" value={waterOptions.waterSeed} onChange={(e) => setWaterOptions({...waterOptions, waterSeed:+e.target.value})} /></Field>
            <div className="wb-two-fields">
              <Field label="Ripple density"><input type="number" min="0" max="1" step=".05" value={waterOptions.rippleDensity} onChange={(e) => setWaterOptions({...waterOptions, rippleDensity:clamp(+e.target.value || 0, 0, 1)})} /></Field>
              <Field label="Phase offset"><input type="number" min="-65535" max="65535" step="1" value={waterOptions.phaseOffset} onChange={(e) => setWaterOptions({...waterOptions, phaseOffset:Math.trunc(+e.target.value || 0)})} /></Field>
            </div>
            <button type="button" onClick={() => setWaterOptions({...waterOptions, palette:{}})}>Reset seasonal colors</button>
            <p className="wb-dialog-hint">3× repeat checks seams; these scenes loop in time but are not guaranteed to tile spatially. Water seed and ripple density keep the shoreline fixed.</p>
            <Field label="Detail level"><select value={waterOptions.details} onChange={(e) => setWaterOptions({...waterOptions, details:+e.target.value})}>{[0,1,2,3,4].map(v=><option key={v} value={v}>{v} · {v === 0 ? "minimal" : v === 4 ? "rich" : ""}</option>)}</select></Field>
            <button className="wb-primary" type="submit" disabled={!waterPreviewValid}>Generate water scene</button>
          </form>
        </Modal>
      )}
      {modal === "isometricShape" && (
        <Modal title="Isometric shapes" wide onClose={() => setModal(null)}>
          <p className="wb-dialog-hint">Stamp a reusable 2:1 tile, elevated block, or ramp into the active frame and layer. Ground X and Y place its back corner; elevation raises the top.</p>
          <IsoShapePreview options={isoShapeOptions} />
          <div className="wb-two-fields">
            <Field label="Shape"><select value={isoShapeOptions.shape} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, shape:e.target.value, elevation:e.target.value !== "tile" && isoShapeOptions.elevation === 0 ? isoShapeOptions.width / 2 : isoShapeOptions.elevation})}><option value="tile">Tile</option><option value="block">Block</option><option value="ramp">Ramp</option></select></Field>
            <Field label="Width (multiple of 4)"><input type="number" min="4" max="512" step="4" value={isoShapeOptions.width} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, width:+e.target.value})} /></Field>
          </div>
          <div className="wb-two-fields">
            <Field label="Ground X"><input type="number" value={isoShapeOptions.x} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, x:+e.target.value})} /></Field>
            <Field label="Ground Y"><input type="number" value={isoShapeOptions.y} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, y:+e.target.value})} /></Field>
          </div>
          <Field label="Elevation"><input type="number" min="0" max="512" disabled={isoShapeOptions.shape === "tile"} value={isoShapeOptions.elevation} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, elevation:+e.target.value})} /></Field>
          {isoShapeOptions.shape === "ramp" && <Field label="Ramp direction"><select value={isoShapeOptions.direction} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, direction:e.target.value})}><option value="right">Right</option><option value="left">Left</option></select></Field>}
          <div className="wb-two-fields">
            <Field label="Top color"><input type="color" value={isoShapeOptions.color.slice(0,7)} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, color:`${e.target.value}ff`})} /></Field>
            <Field label="Left color"><input type="color" value={isoShapeOptions.leftColor.slice(0,7)} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, leftColor:`${e.target.value}ff`})} /></Field>
          </div>
          <Field label="Right color"><input type="color" value={isoShapeOptions.rightColor.slice(0,7)} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, rightColor:`${e.target.value}ff`})} /></Field>
          <label><input type="checkbox" checked={isoShapeOptions.filled} onChange={(e) => setIsoShapeOptions({...isoShapeOptions, filled:e.target.checked})} /> Filled</label>
          <button className="wb-primary" onClick={stampIsometricShape}>Stamp shape</button>
        </Modal>
      )}
      {modal === "resize" && (
        <Modal title="Resize artwork" onClose={() => setModal(null)}>
          <div className="wb-two-fields">
            {["width", "height"].map((k) => (
              <Field key={k} label={k}>
                <input
                  type="number"
                  min={1}
                  max={LIMITS.edge}
                  value={resizeOptions[k]}
                  onChange={(e) =>
                    setResizeOptions({ ...resizeOptions, [k]: +e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          <Field label="Operation">
            <select
              value={resizeOptions.mode}
              onChange={(e) =>
                setResizeOptions({ ...resizeOptions, mode: e.target.value })
              }
            >
              <option value="canvas">Change canvas bounds</option>
              <option value="scale">Scale artwork (nearest neighbor)</option>
            </select>
          </Field>
          <Field label="Anchor">
            <select
              value={resizeOptions.anchor}
              onChange={(e) =>
                setResizeOptions({ ...resizeOptions, anchor: e.target.value })
              }
            >
              <option value="center">Center</option>
              <option value="top-left">Top left</option>
            </select>
          </Field>
          <button
            className="wb-primary"
            onClick={() => {
              if (
                run(
                  { type: "document.resize", ...resizeOptions },
                  "Resize artwork",
                )
              ) {
                setSelection(null);
                setModal(null);
              }
            }}
          >
            Resize
          </button>
        </Modal>
      )}
      {modal === "transform" && (
        <Modal title="Transform selection" onClose={() => setModal(null)}>
          {Object.entries({dx:"Move horizontally",dy:"Move vertically",scaleX:"Width multiplier",scaleY:"Height multiplier",angle:"Rotation angle"}).map(([k,label]) => (
            <Field key={k} label={label}>
              <input
                type="number"
                step={k.startsWith("scale") ? 0.1 : 1}
                value={transformOptions[k]}
                onChange={(e) =>
                  setTransformOptions({
                    ...transformOptions,
                    [k]: +e.target.value,
                  })
                }
              />
            </Field>
          ))}
          <Field label="Rotation method"><select value={rotationMethod} onChange={event => setRotationMethod(event.target.value)}><option value="rotsprite">RotSprite · preserve pixel edges</option><option value="fast">Fast · nearest pixel</option></select></Field>
          <div className="wb-button-row">
            <button
              onClick={() => {
                if (transform("move", {
                  dx: transformOptions.dx,
                  dy: transformOptions.dy,
                })) setModal(null);
              }}
            >
              Move
            </button>
            <button
              onClick={() => {
                if (transform("scale", {
                  scaleX: transformOptions.scaleX,
                  scaleY: transformOptions.scaleY,
                })) setModal(null);
              }}
            >
              Scale
            </button>
            <button
              onClick={() => {
                if (transform("rotate", { angle: transformOptions.angle })) setModal(null);
              }}
            >
              Rotate
            </button>
          </div>
        </Modal>
      )}
      {modal === "palette" && (
        <Modal title="Edit palette" onClose={() => setModal(null)}>
          <p>
            One hex color per line. Order determines indices in indexed mode.
          </p>
          <textarea
            aria-label="Palette colors"
            rows={12}
            value={paletteText}
            onChange={(e) => setPaletteText(e.target.value)}
          />
          <div className="wb-button-row">
            <button
              onClick={() => {
                if (
                  run(
                    {
                      type: "palette.update",
                      ...paletteTarget(),
                      palette: paletteText.split(/[\s,]+/).filter(Boolean),
                    },
                    "Edit palette",
                  )
                )
                  setModal(null);
              }}
            >
              Update palette
            </button>
            <button
              onClick={() => {
                if (
                  run(
                    {
                      type: "palette.remap",
                      ...paletteTarget(),
                      palette: paletteText.split(/[\s,]+/).filter(Boolean),
                    },
                    "Remap palette",
                  )
                )
                  setModal(null);
              }}
            >
              Remap nearest colors
            </button>
          </div>
        </Modal>
      )}
      {modal === "indexed" && (
        <Modal title="Indexed color conversion" onClose={() => !busy && setModal(null)}>
          <p>Convert every frame and embedded tile. Undo restores the original colors.</p>
          <Field label="Palette"><select value={indexedOptions.paletteMode} onChange={event => setIndexedOptions({...indexedOptions,paletteMode:event.target.value})}><option value="existing">Use each frame’s current palette</option><option value="generate">Generate one palette for all frames</option></select></Field>
          {indexedOptions.paletteMode === "generate" && <>
            <Field label="Maximum colors, including transparency"><input type="number" min={2} max={256} value={indexedOptions.maxColors} onChange={event => setIndexedOptions({...indexedOptions,maxColors:Number(event.target.value)})}/></Field>
            <label><input type="checkbox" checked={indexedOptions.withAlpha} onChange={event => setIndexedOptions({...indexedOptions,withAlpha:event.target.checked})}/>Include partial transparency in the palette</label>
            <Field label="Palette method"><select value={indexedOptions.quantization} onChange={event => event.target.value === "median-cut" ? setIndexedOptions({...indexedOptions,quantization:event.target.value}) : changeIndexedMapping(event.target.value,{quantization:event.target.value})}><option value="median-cut">Median cut</option><option value="octree">Octree</option><option value="rgb5a3">RGB5A3</option></select></Field>
            <p>{indexedOptions.quantization === "median-cut" ? "Builds the palette from stored artwork, including hidden layers and unused tiles." : "Builds the palette from visible, composited frames. Hidden layers and unused tiles are then mapped into it."}</p>
          </>}
          <Field label="Color matching"><select value={indexedOptions.rgbmap} onChange={event => changeIndexedMapping(event.target.value)}><option value="pixelwall">PixelWall RGBA</option><option value="octree">Octree</option><option value="rgb5a3">RGB5A3</option></select></Field>
          {indexedOptions.rgbmap !== "pixelwall" && <Field label="Color distance"><select value={indexedOptions.fitCriteria} onChange={event => setIndexedOptions({...indexedOptions,fitCriteria:event.target.value})}><option value="default">Default weighted RGB</option><option value="rgb">RGB</option><option value="linearizedRGB">Linear RGB</option><option value="ciexyz">CIE XYZ</option><option value="cielab">CIE Lab</option></select></Field>}
          <Field label="Dithering"><select value={indexedOptions.dithering} onChange={event => setIndexedOptions({...indexedOptions,dithering:event.target.value,...(["aseprite-ordered","aseprite-old"].includes(event.target.value)?{ditherStrength:1}:{})})}><option value="none">None · nearest color</option>{indexedOptions.rgbmap === "pixelwall" ? <><option value="ordered">Ordered · Bayer</option><option value="floyd-steinberg">Floyd–Steinberg</option></> : <><option value="aseprite-ordered">Ordered · Bayer</option><option value="aseprite-old">Ordered · legacy</option><option value="aseprite-error-diffusion">Error diffusion</option></>}</select></Field>
          {["ordered","aseprite-ordered","aseprite-old"].includes(indexedOptions.dithering) && <Field label="Bayer pattern"><select value={indexedOptions.ditherMatrix} onChange={event => setIndexedOptions({...indexedOptions,ditherMatrix:event.target.value})}><option value="bayer2x2">2 × 2</option><option value="bayer4x4">4 × 4</option><option value="bayer8x8">8 × 8</option></select></Field>}
          {!["none","aseprite-ordered","aseprite-old"].includes(indexedOptions.dithering) && <Field label={`Dither strength · ${Math.round(indexedOptions.ditherStrength * 100)}%`}><input type="range" min={0} max={1} step={0.05} value={indexedOptions.ditherStrength} onChange={event => setIndexedOptions({...indexedOptions,ditherStrength:Number(event.target.value)})}/></Field>}
          <p>Choose the palette and pattern that suit your artwork.</p>
          <button className="wb-primary" disabled={busy} onClick={() => void convertIndexed()}>Convert to indexed</button>
        </Modal>
      )}
      {modal === "profile" && (
        <Modal title="Color profile" onClose={() => setModal(null)}>
          <p>Current profile: {profileName}. The canvas displays colors in sRGB.</p>
          <Field label="Target profile"><select value={profileTarget} onChange={e => setProfileTarget(e.target.value)}><option value="sRGB">sRGB</option>{importedProfile && <option value="imported">{colorManager?.profileInfo(importedProfile).name || "Imported ICC profile"}</option>}</select></Field>
          <button onClick={() => chooseImport("profile")}>Choose ICC profile…</button>
          <Field label="Rendering intent"><select value={renderingIntent} onChange={e => setRenderingIntent(+e.target.value)}><option value={1}>Relative colorimetric</option><option value={0}>Perceptual</option><option value={2}>Saturation</option><option value={3}>Absolute colorimetric</option></select></Field>
          <p>Assign changes how the existing pixel values are interpreted. Convert changes the values to preserve their appearance in the target profile.</p>
          <p>Editable project and sprite files retain the profile. Image exports convert to sRGB.</p>
          <div className="wb-button-row"><button disabled={busy || !colorManager} onClick={() => void changeProfile("assign")}>Assign profile</button><button className="wb-primary" disabled={busy || !colorManager} onClick={() => void changeProfile("convert")}>Convert colors</button></div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal title="Export artwork" onClose={() => setModal(null)}>
          <Field label="Format">
            <select
              value={exportOptions.format}
              onChange={(e) =>
                setExportOptions({ ...exportOptions, format: e.target.value })
              }
            >
              <option value="png">Current frame PNG · Free</option>
              <option value="project">Editable PixelWall project · Free</option>
              <option value="aseprite">Editable sprite project · Free</option>
              <option value="bmp">Current frame BMP · Free</option>
              <option value="tga">Current frame TGA · Free</option>
              <option value="gif">Animated GIF · Pro</option>
              <option value="sheet">Sprite atlas PNG · Pro</option>
              <option value="zip">Game package ZIP · Pro</option>
            </select>
          </Field>
          {!["project", "aseprite"].includes(exportOptions.format) && (
            <>
              <Field label="Scale">
                <input type="number" min="0.01" max="64" step="any"
                  value={exportOptions.scale}
                  onChange={(e) =>
                    setExportOptions({
                      ...exportOptions,
                      scale: e.target.value,
                    })
                  }
                />
                <small>{Math.max(1, Math.trunc(doc.width * Number(exportOptions.scale)))} × {Math.max(1, Math.trunc(doc.height * Number(exportOptions.scale)))} pixels</small>
              </Field>
              <Field label="Clip">
                <select
                  value={exportOptions.clipId}
                  onChange={(e) =>
                    setExportOptions({
                      ...exportOptions,
                      clipId: e.target.value,
                    })
                  }
                >
                  <option value="">Active clip / all frames</option>
                  {doc.clips?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Layers">
                <select
                  value={exportOptions.layers || "visible"}
                  onChange={(e) =>
                    setExportOptions({
                      ...exportOptions,
                      layers: e.target.value,
                    })
                  }
                >
                  <option value="visible">Visible layers</option>
                  <option value="active">Active layer</option>
                  <option value="selected">Selected layers</option>
                </select>
              </Field>
              <label>
                <input
                  type="checkbox"
                  checked={!!exportOptions.includeReferenceLayers}
                  onChange={(e) =>
                    setExportOptions({
                      ...exportOptions,
                      includeReferenceLayers: e.target.checked,
                    })
                  }
                />
                Include reference layers
              </label>
            </>
          )}
          {["sheet", "zip"].includes(exportOptions.format) && (
            <>
              <Field label="Layout">
                <select
                  value={exportOptions.layout}
                  onChange={(e) =>
                    setExportOptions({
                      ...exportOptions,
                      layout: e.target.value,
                    })
                  }
                >
                  {["packed", "horizontal", "vertical", "grid"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              {["padding", "extrude"].map((k) => (
                <Field key={k} label={k}>
                  <input
                    type="number"
                    min={0}
                    max={32}
                    value={exportOptions[k]}
                    onChange={(e) =>
                      setExportOptions({
                        ...exportOptions,
                        [k]: +e.target.value,
                      })
                    }
                  />
                </Field>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={exportOptions.trim}
                  onChange={(e) =>
                    setExportOptions({
                      ...exportOptions,
                      trim: e.target.checked,
                    })
                  }
                />
                Trim transparent edges
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={exportOptions.powerOfTwo}
                  onChange={(e) =>
                    setExportOptions({
                      ...exportOptions,
                      powerOfTwo: e.target.checked,
                    })
                  }
                />
                Power-of-two dimensions
              </label>
            </>
          )}
          <button
            className="wb-primary"
            disabled={busy}
            onClick={() => void doExport(exportOptions).catch(() => {})}
          >
            {busy ? "Exporting…" : "Export"}
          </button>
          <Field label="Preset name">
            <input
              value={presetName}
              maxLength={80}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </Field>
          <button
            onClick={async () => {
              if (!(await access.requestAccess())) return;
              const name = presetName.trim();
              if (!name) {
                setNotice("Name your preset first.");
                return;
              }
              const next = [
                ...exportPresets.filter((p) => p.name !== name),
                { name, options: exportOptions },
              ];
              await storeRef.current.setSetting("exportPresets", next);
              setExportPresets(next);
              setNotice("Export preset saved.");
            }}
          >
            Save export preset · Pro
          </button>
          {exportPresets.map((preset) => (
            <div className="wb-preset" key={preset.name}>
              <button
                onClick={() => {
                  setExportOptions(preset.options);
                  setPresetName(preset.name);
                }}
              >
                {preset.name}
              </button>
              <button
                aria-label={"Remove preset " + preset.name}
                onClick={async () => {
                  const next = exportPresets.filter(
                    (p) => p.name !== preset.name,
                  );
                  await storeRef.current.setSetting("exportPresets", next);
                  setExportPresets(next);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </Modal>
      )}
      {modal === "clip" && (
        <Modal title="Animation clips" onClose={() => setModal(null)}>
          {doc.clips?.map((c) => (
            <div className="wb-clip-editor" key={c.id}>
              <Field label="Name">
                <input
                  value={c.name}
                  onChange={(e) =>
                    run({
                      type: "clip.update",
                      clipId: c.id,
                      patch: { name: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Direction">
                <select
                  value={c.direction}
                  onChange={(e) =>
                    run({
                      type: "clip.update",
                      clipId: c.id,
                      patch: { direction: e.target.value },
                    })
                  }
                >
                  {["forward", "reverse", "pingpong", "pingpong_reverse"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Repeats · 0 means continuous">
                <input
                  type="number" min={0} max={65535} step={1}
                  value={c.repeat ?? (c.loop === false ? 1 : 0)}
                  onChange={(e) =>
                    run({
                      type: "clip.update",
                      clipId: c.id,
                      patch: { repeat: Number(e.target.value), loop: Number(e.target.value) === 0 },
                    })
                  }
                />
              </Field>
              {c.direction.startsWith("pingpong") && <small>Each direction counts as one repeat.</small>}
              <button
                onClick={() =>
                  run({
                    type: "clip.update",
                    clipId: c.id,
                    patch: { frameIds: targetFrames() },
                  })
                }
              >
                Use selected frames
              </button>
              <button
                onClick={() => run({ type: "clip.remove", clipId: c.id })}
              >
                Delete clip
              </button>
            </div>
          ))}
          <button
            className="wb-primary"
            onClick={() =>
              run(
                {
                  type: "clip.add",
                  clip: {
                    name: "Clip " + (doc.clips.length + 1),
                    frameIds: targetFrames(),
                    direction: "forward",
                    loop: true,
                  },
                },
                "Add clip",
              )
            }
          >
            Create clip from selected frames
          </button>
        </Modal>
      )}
      {modal === "motion" && (
        <Modal
          title="Animate selected frames"
          onClose={() => setModal(null)}
          wide
        >
          <p>
            These operations bake editable results into the{" "}
            {targetFrames().length} selected frames on the active layer.
          </p>
          <div className="wb-two-fields">
            {["x", "y", "toX", "toY"].map((k) => (
              <Field key={k} label={k}>
                <input
                  type="number"
                  value={motion[k]}
                  onChange={(e) =>
                    setMotion({ ...motion, [k]: +e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          <Field label="Easing">
            <select
              value={motion.easing}
              onChange={(e) => setMotion({ ...motion, easing: e.target.value })}
            >
              {["linear", "easeIn", "easeOut", "easeInOut", "bounce"].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
          </Field>
          <button
            onClick={() =>
              run(
                {
                  type: "animation.tween",
                  frameIds: targetFrames(),
                  from: { x: motion.x, y: motion.y, opacity: 1 },
                  to: { x: motion.toX, y: motion.toY, opacity: 1 },
                  easing: motion.easing,
                  bake: true,
                },
                "Bake motion",
              )
            }
          >
            Bake position animation
          </button>
          <h3>Particles</h3>
          <div className="wb-two-fields">
            {[
              "count",
              "seed",
              "speed",
              "spread",
              "gravity",
              "lifetime",
              "size",
            ].map((k) => (
              <Field key={k} label={k}>
                <input
                  type="number"
                  step={k === "gravity" ? 0.1 : 1}
                  value={motion[k]}
                  onChange={(e) =>
                    setMotion({ ...motion, [k]: +e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          <button
            onClick={() =>
              run(
                {
                  type: "animation.particles",
                  frameIds: targetFrames(),
                  ...motion,
                  color,
                },
                "Bake particles",
              )
            }
          >
            Bake particles
          </button>
        </Modal>
      )}
      {modal === "tileset" && (
        <Modal title="Create tileset" onClose={() => setModal(null)}>
          <p>
            Each selected frame becomes one reusable tile. Tiles use the current
            canvas size.
          </p>
          <button
            className="wb-primary"
            onClick={() => {
              const id = "tileset-" + Date.now();
              const tiles = targetFrames().map((frameId) => {
                const pixels = pixelsFromRgba(renderFrame(doc, frameId));
                return { id: "tile-" + frameId, pixels };
              });
              if (
                run(
                  {
                    type: "tileset.add",
                    tileset: {
                      id,
                      name: "Tileset " + (doc.tilesets.length + 1),
                      tileWidth: doc.width,
                      tileHeight: doc.height,
                      tiles,
                    },
                  },
                  "Create tileset",
                )
              ) {
                setTilesetId(id);
                setModal(null);
              }
            }}
          >
            Create from selected frames
          </button>
        </Modal>
      )}
      {modal === "slice" && (
        <Modal
          title={sliceDraft ? "Edit slice" : "Add slice"}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const patch = {
                name: String(data.get("name")),
                bounds: Object.fromEntries(
                  ["x", "y", "width", "height"].map((k) => [
                    k,
                    +data.get("bounds-" + k),
                  ]),
                ),
                pivot: { x: +data.get("x"), y: +data.get("y") },
                ninePatch: data.get("nine-patch")
                  ? Object.fromEntries(
                      ["x", "y", "width", "height"].map((k) => [
                        k,
                        +data.get("center-" + k),
                      ]),
                    )
                  : null,
              };
              if (
                patch.ninePatch &&
                (patch.ninePatch.x + patch.ninePatch.width >
                  patch.bounds.width ||
                  patch.ninePatch.y + patch.ninePatch.height >
                    patch.bounds.height)
              ) {
                report(
                  Error("The nine-patch center must fit inside the slice."),
                );
                return;
              }
              if (
                run(
                  sliceDraft
                    ? { type: "slice.update", sliceId: sliceDraft.id, patch }
                    : { type: "slice.add", slice: patch },
                  "Save slice",
                )
              )
                setModal(null);
            }}
          >
            <Field label="Name">
              <input
                name="name"
                defaultValue={
                  sliceDraft?.name || "Slice " + (doc.slices.length + 1)
                }
                required
              />
            </Field>
            <div className="wb-fields-row">
              {["x", "y", "width", "height"].map((k) => (
                <Field key={k} label={`Slice ${k}`}>
                  <input
                    name={`bounds-${k}`}
                    type="number"
                    min={k === "width" || k === "height" ? 1 : 0}
                    defaultValue={
                      (sliceDraft?.bounds ||
                        maskBounds || {
                          x: 0,
                          y: 0,
                          width: doc.width,
                          height: doc.height,
                        })[k]
                    }
                    required
                  />
                </Field>
              ))}
            </div>
            <Field label="Pivot X">
              <input
                name="x"
                type="number"
                defaultValue={
                  sliceDraft?.pivot?.x ??
                  Math.floor((maskBounds?.width || doc.width) / 2)
                }
              />
            </Field>
            <Field label="Pivot Y">
              <input
                name="y"
                type="number"
                defaultValue={
                  sliceDraft?.pivot?.y ?? maskBounds?.height ?? doc.height
                }
              />
            </Field>
            <label>
              <input
                type="checkbox"
                name="nine-patch"
                defaultChecked={!!sliceDraft?.ninePatch}
              />{" "}
              Nine-patch center
            </label>
            <div className="wb-fields-row">
              {["x", "y", "width", "height"].map((k) => (
                <Field key={k} label={`Center ${k}`}>
                  <input
                    name={`center-${k}`}
                    type="number"
                    min={k === "width" || k === "height" ? 1 : 0}
                    defaultValue={
                      sliceDraft?.ninePatch?.[k] ??
                      (k === "width" || k === "height" ? 1 : 0)
                    }
                    required
                  />
                </Field>
              ))}
            </div>
            <p>Pivot and nine-patch coordinates are relative to this slice.</p>
            <button className="wb-primary">Save slice</button>
          </form>
        </Modal>
      )}
      {modal === "sheet" && pendingImage && (
        <Modal title="Import sprite sheet" onClose={() => setModal(null)}>
          {[
            "frameWidth",
            "frameHeight",
            "padding",
            "spacing",
            "columns",
            "count",
          ].map((k) => (
            <Field
              key={k}
              label={
                {
                  frameWidth: "Frame width",
                  frameHeight: "Frame height",
                  padding: "Outer padding",
                  spacing: "Spacing",
                  columns: "Columns (0 = all)",
                  count: "Frame count (blank = all)",
                }[k]
              }
            >
              <input
                type="number"
                min={k.startsWith("frame") || k === "count" ? 1 : 0}
                value={sheetOptions[k] ?? ""}
                onChange={(e) =>
                  setSheetOptions({
                    ...sheetOptions,
                    [k]:
                      k === "count" && !e.target.value
                        ? undefined
                        : +e.target.value,
                  })
                }
              />
            </Field>
          ))}
          <Field label="Import order">
            <select
              value={sheetOptions.order}
              onChange={(e) =>
                setSheetOptions({ ...sheetOptions, order: e.target.value })
              }
            >
              <option value="row">Across each row</option>
              <option value="column">Down each column</option>
            </select>
          </Field>
          <SheetImportPreview image={pendingImage} options={sheetOptions} />
          <button
            className="wb-primary"
            onClick={async () => {
              try {
                const next = importSheet(pendingImage, {
                  ...sheetOptions,
                  name: pendingImage.name,
                });
                await save();
                await activate(next);
                analyticsRef.current.imported("sheet", pendingImportFormatRef.current, 1, importWarnings.length);
                setModal(null);
                setPendingImage(null);
              } catch (error) {
                analyticsRef.current.imported("sheet", pendingImportFormatRef.current, 1, 0, true);
                report(error);
              }
            }}
          >
            Import frames
          </button>
        </Modal>
      )}
      {modal === "warnings" && (
        <Modal
          title="Import compatibility notes"
          onClose={() => setModal(null)}
        >
          <ul>
            {importWarnings.map((w, i) => (
              <li key={i}>{typeof w === "string" ? w : JSON.stringify(w)}</li>
            ))}
          </ul>
        </Modal>
      )}
      {modal === "recovery" && (
        <Modal title="Project recovery" onClose={() => setModal(null)}>
          <p>
            Restoring a revision preserves your current project in recovery
            history.
          </p>
          {revisions.length ? (
            revisions.map((r) => (
              <div className="wb-recovery-row" key={r.id || r.revision}>
                <span>
                  {new Date(
                    r.savedAt || r.createdAt || r.timestamp,
                  ).toLocaleString()}
                  <small>{r.label || "Saved revision"}</small>
                </span>
                <button
                  onClick={async () => {
                    if (restoringRef.current || automationRef.current?.desktop.locked || nativeSessionRef.current?.busy) return;
                    restoringRef.current = true;
                    const before = docRef.current, revision = revisionRef.current;
                    try {
                      setBusy(true);
                      await save();
                      const restore = saveQueueRef.current.then(async () => {
                        if (docRef.current !== before || revisionRef.current !== revision) throw Error("The project changed while preparing recovery. Choose the revision again.");
                        const restored = await storeRef.current.restoreRevision(
                          doc.id,
                          r.id || r.revision,
                        );
                        if (docRef.current !== before || revisionRef.current !== revision) throw Error("The project changed while restoring. Open the restored version from the library.");
                        historyCacheRef.current.invalidate(restored.document.id);
                        await activate(restored.document, restored.revision, {allowRecovery:true});
                      });
                      saveQueueRef.current = restore;
                      await restore;
                      analyticsRef.current.recovery("restore", "completed");
                      setModal(null);
                    } catch (error) {
                      analyticsRef.current.recovery("restore", "failed", error);
                      report(error);
                    } finally {
                      restoringRef.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  Restore
                </button>
              </div>
            ))
          ) : (
            <p>No earlier revisions yet.</p>
          )}
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="Workspace settings" onClose={() => setModal(null)}>
          <Field label="Sidebar position">
            <select
              value={settings.sidebar}
              onChange={(e) =>
                setSettings({ ...settings, sidebar: e.target.value })
              }
            >
              <option value="right">Right</option>
              <option value="left">Left</option>
              <option value="floating">Floating</option>
            </select>
          </Field>
          <Field label="Timeline height">
            <input
              type="range"
              min={130}
              max={400}
              value={settings.timelineHeight}
              onChange={(e) =>
                setSettings({ ...settings, timelineHeight: +e.target.value })
              }
            />
          </Field>
          <h3>Keyboard shortcuts</h3>
          <div className="wb-shortcuts">
            {TOOLS.filter((t) => t[3]).map(([id, label, , key]) => (
              <Field key={id} label={label}>
                <input
                  maxLength={1}
                  value={settings.shortcuts[id] || key}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      shortcuts: {
                        ...settings.shortcuts,
                        [id]: e.target.value.toLowerCase(),
                      },
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <p>
            ⌘/Ctrl Z: undo · ⌘/Ctrl S: save · ⌘/Ctrl K: command search · Space:
            play/pause.
          </p>
          <a href="/editor/classic">Open the classic editor</a>
        </Modal>
      )}
      {modal === "commands" && (
        <Modal
          title="Command search"
          onClose={() => {
            setModal(null);
            setSearch("");
          }}
        >
          <input
            aria-label="Search commands"

            placeholder="Search tools and commands…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="wb-command-list">
            {TOOLS.filter((t) =>
              t[1].toLowerCase().includes(search.toLowerCase()),
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  setTool(id);
                  setModal(null);
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
            {[
              ["New project", () => setModal("new")],
              ["Export artwork", () => setModal("export")],
              [
                "Resize canvas",
                () => {
                  setResizeOptions({
                    width: doc.width,
                    height: doc.height,
                    mode: "canvas",
                    anchor: "center",
                  });
                  setModal("resize");
                },
              ],
              [
                "Undo",
                () => {
                  undo();
                  setModal(null);
                },
              ],
              [
                "Redo",
                () => {
                  redo();
                  setModal(null);
                },
              ],
              [
                "Scripts and API",
                () => {
                  setPanel("automation");
                  setModal(null);
                },
              ],
              ["Recovery", () => void showRecovery()],
            ]
              .filter(([name]) =>
                name.toLowerCase().includes(search.toLowerCase()),
              )
              .map(([name, action]) => (
                <button key={name} onClick={action}>
                  {name}
                </button>
              ))}
          </div>
        </Modal>
      )}
      <ProDialog
        access={access}
        beforeCheckout={async () => {
          await save();
          downloads.downloadBlob(
            new Blob([JSON.stringify(docRef.current)], {
              type: "application/json",
            }),
            stem(doc.name) + ".pixelwall",
          );
        }}
      />
      <DownloadReady
        file={downloads.readyFile}
        onDismiss={downloads.dismissDownload}
      />
      <span className="wb-hidden" aria-hidden="true">
        {historyVersion}
      </span>
    </div>
  );
}
