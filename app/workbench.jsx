"use client";
/* eslint react/prop-types: "off" -- Editor documents are validated at the engine boundary. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocument,
  normalizeDocument,
  migrateLegacy,
  applyCommand,
  renderFrame,
  getCel,
  getTile,
  pixelRGBA,
  describeDocument,
  buildSelection,
  COMMANDS,
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
import { parseProject } from "./project-format.mjs";
import { openStore } from "./storage.mjs";
import { createHistory } from "./history.mjs";
import { createAutomation, registerAutomation } from "./editor-automation.mjs";
import { validateExtension, parsePalette } from "./editor-extensions.mjs";
import { useProAccess, ProDialog } from "./pro-access";
import { useDownload, DownloadReady } from "./use-download";
import { strToU8 } from "fflate";
import { encodeGif } from "./formats.mjs";
import TilePixelEditor from "./tile-pixel-editor";
import { registerOffline } from "./offline-client.mjs";
import { sameFrameRender } from "./frame-render-equality.mjs";
import SheetImportPreview from "./sheet-import-preview.jsx";
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
function resizeRgba(rgba, w, h, scale) {
  if (scale === 1) return rgba;
  const out = new Uint8Array(w * h * scale * scale * 4);
  for (let y = 0; y < h * scale; y++)
    for (let x = 0; x < w * scale; x++) {
      const i = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4;
      out.set(rgba.subarray(i, i + 4), (y * w * scale + x) * 4);
    }
  return out;
}
function Field({ label, children, ...props }) {
  return (
    <label className="wb-field" {...props}>
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
        <button aria-label={`Close ${title}`} onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
function FrameThumb({ doc, frameId, repeat = 1 }) {
  const ref = useRef(null);
  const lastInputs = useRef(null);
  useEffect(() => {
    const previous = lastInputs.current;
    lastInputs.current = { doc, frameId, repeat };
    if (
      previous?.frameId === frameId &&
      previous?.repeat === repeat &&
      sameFrameRender(previous.doc, doc, frameId)
    )
      return;
    try {
      const ctx = ref.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 40 * repeat, 40 * repeat);
        ctx.imageSmoothingEnabled = false;
        const s = Math.min(40 / doc.width, 40 / doc.height);
        const image = rgbaImage(
          renderFrame(doc, frameId),
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
  }, [doc, frameId, repeat]);
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
  const [extensions, setExtensions] = useState([]);
  const [exportPresets, setExportPresets] = useState([]),
    [presetName, setPresetName] = useState("My export");
  const [tileDraft, setTileDraft] = useState(null);
  const [sliceDraft, setSliceDraft] = useState(null);
  const [pinnedPanels, setPinnedPanels] = useState([]);
  const panelDrag = useRef(null);
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
  const [tool, setTool] = useState("pencil"),
    [color, setColor] = useState("#ffb34bff"),
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
    [busy, setBusy] = useState(false);
  const [newOptions, setNewOptions] = useState({
      name: "Untitled",
      width: 64,
      height: 64,
      colorMode: "rgba",
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
    revisionRef = useRef(0),
    storedRevisionRef = useRef(undefined),
    savedRevisionsRef = useRef(new Map()),
    savedDocumentsRef = useRef(new Map()),
    activeRef = useRef({ frameId: "", layerId: "" }),
    operationRef = useRef(null),
    restoringRef = useRef(false),
    pathRef = useRef([]),
    canvasRef = useRef(null),
    overlayRef = useRef(null),
    viewportRef = useRef(null),
    rgbaRef = useRef(null),
    fileRef = useRef(null),
    saveQueueRef = useRef(Promise.resolve()),
    hostRef = useRef(null),
    loadGeneration = useRef(0);
  const access = useProAccess();
  const downloads = useDownload();
  const report = useCallback((error) => {
    setNotice(error instanceof Error ? error.message : String(error));
    setBusy(false);
  }, []);
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
    (next, { resetHistory = false, storedRevision } = {}) => {
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
      if (resetHistory) {
        historyRef.current = createHistory(next, {
          maxEntries: 100,
          maxBytes: 64 * 1024 * 1024,
        });
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
      setSaveStatus("Unsaved changes");
      docRef.current = next;
      revisionRef.current++;
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
    if (restoringRef.current || operationRef.current) return;
    const h = historyRef.current;
    if (h?.canUndo) {
      h.undo();
      docRef.current = h.present;
      revisionRef.current++;
      reconcile(h.present);
      setDoc(h.present);
      setSaveStatus("Unsaved changes");
      setSelection(null);
      setHistoryVersion((v) => v + 1);
      setHistoryState({
        canUndo: historyRef.current?.canUndo || false,
        canRedo: historyRef.current?.canRedo || false,
      });
    }
  }, [reconcile]);
  const redo = useCallback(() => {
    if (restoringRef.current || operationRef.current) return;
    const h = historyRef.current;
    if (h?.canRedo) {
      h.redo();
      docRef.current = h.present;
      revisionRef.current++;
      reconcile(h.present);
      setDoc(h.present);
      setSaveStatus("Unsaved changes");
      setSelection(null);
      setHistoryVersion((v) => v + 1);
      setHistoryState({
        canUndo: historyRef.current?.canUndo || false,
        canRedo: historyRef.current?.canRedo || false,
      });
    }
  }, [reconcile]);
  const save = useCallback(async () => {
    const captured = docRef.current,
      store = storeRef.current;
    if (!captured || !store) return null;
    setSaveStatus("Saving…");
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
        if (docRef.current === captured) setSaveStatus("Saved on this device");
      }
      setDocuments(await store.listDocuments());
      return result;
    };
    const run = saveQueueRef.current.catch(() => {}).then(task);
    saveQueueRef.current = run;
    try {
      return await run;
    } catch (error) {
      setSaveStatus("Save needs attention");
      report(error);
      throw error;
    }
  }, [report]);
  const activate = useCallback(
    async (next, storedRevision) => {
      setPlaying(false);
      install(next, { resetHistory: true, storedRevision });
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
      if (restoringRef.current || operationRef.current)
        throw Error(
          "Finish the current edit or recovery before opening another document.",
        );
      await save();
      const next = createDocument({ ...options, id: crypto.randomUUID() });
      await activate(next);
      setModal(null);
      return next;
    },
    [save, activate],
  );
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
      }
      const migrations = await store.importLegacy({
        convert: (raw) => {
          const parsed = parseProject(JSON.stringify(raw));
          return migrateLegacy(parsed.project || parsed);
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
      const last = await store.getSetting("activeDocument", list[0]?.id);
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
      if (
        docRef.current &&
        savedDocumentsRef.current.get(docRef.current.id) !== docRef.current
      ) {
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
        .setSetting("workspace", { ...settings, pinnedPanels })
        .catch(report);
  }, [settings, pinnedPanels, report]);
  const layer = doc?.layers.find((l) => l.id === activeLayer),
    frame = doc?.frames.find((f) => f.id === activeFrame),
    selectedClip = doc?.clips?.find((c) => c.id === clipId),
    maskBounds = doc ? bounds(selection, doc.width) : null;
  const visibleFrames = useMemo(
    () => doc?.frames.slice(timelinePage * 64, (timelinePage + 1) * 64) || [],
    [doc, timelinePage],
  );
  useEffect(() => {
    if (!playing || !doc) return;
    let ids = selectedClip?.frameIds?.length
      ? [...selectedClip.frameIds]
      : doc.frames.map((f) => f.id);
    if (["reverse", "pingpong_reverse"].includes(selectedClip?.direction))
      ids.reverse();
    if (selectedClip?.direction?.startsWith("pingpong"))
      ids = [...ids, ...ids.slice(1, -1).reverse()];
    let index = Math.max(0, ids.indexOf(activeRef.current.frameId)),
      timer;
    const schedule = () => {
      const frame = doc.frames.find((f) => f.id === ids[index]);
      timer = setTimeout(() => {
        if (index + 1 >= ids.length && selectedClip?.loop === false) {
          setPlaying(false);
          return;
        }
        index = (index + 1) % ids.length;
        setActiveFrame(ids[index]);
        schedule();
      }, frame?.durationMs || 125);
    };
    timer = setTimeout(() => {
      setActiveFrame(ids[index]);
      schedule();
    }, 0);
    return () => clearTimeout(timer);
  }, [playing, doc, selectedClip]);
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
      ctx.drawImage(rgbaImage(pixels, doc.width, doc.height), 0, 0);
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
  const targetLayers = () =>
    selectedLayers.includes(activeLayer) ? selectedLayers : [activeLayer];
  const targetCels = () =>
    targetLayers().flatMap((layerId) =>
      targetFrames().map((frameId) => ({ layerId, frameId })),
    );
  function selectLayer(id, event) {
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
    return {
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
        mask: customBrush || undefined,
        wrap,
        symmetry,
        pixelPerfect,
        erase: kind === "eraser",
        ink,
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
    if (!doc || playing || event.button !== 0) return;
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
        setSaveStatus("Unsaved changes");
        docRef.current = next;
        revisionRef.current++;
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
  function selectAll() {
    setSelection(Array(doc.width * doc.height).fill(1));
  }
  function copy() {
    if (!maskBounds) {
      setNotice("Select an area first.");
      return;
    }
    const cel = getCel(doc, activeFrame, activeLayer);
    if (!cel) return;
    const rgba = renderFrame(
      {
        ...doc,
        layers: doc.layers.map((l) => ({
          ...l,
          visible: l.id === activeLayer || l.type === "group",
          locked: false,
          opacity: 1,
          blendMode: "normal",
        })),
        frames: doc.frames.map((f) => ({
          ...f,
          cels: Object.fromEntries(
            Object.entries(f.cels).map(([id, cel]) => [
              id,
              { ...cel, opacity: 1 },
            ]),
          ),
        })),
      },
      activeFrame,
    );
    const pixels = [];
    for (let y = 0; y < maskBounds.height; y++)
      for (let x = 0; x < maskBounds.width; x++) {
        const i = (maskBounds.y + y) * doc.width + maskBounds.x + x;
        pixels.push(selection[i] ? hex(rgba.slice(i * 4, i * 4 + 4)) : null);
      }
    setClipboard({ ...maskBounds, pixels });
    setNotice("Selection copied");
  }
  function paste() {
    if (!clipboard) return;
    const next = run(
      {
        type: "image.stamp",
        width: clipboard.width,
        height: clipboard.height,
        pixels: clipboard.pixels,
        x: clipboard.x + 1,
        y: clipboard.y + 1,
        transparent: "skip",
      },
      "Paste selection",
    );
    if (next)
      setSelection(
        buildSelection(next, {
          shape: "rect",
          x: clipboard.x + 1,
          y: clipboard.y + 1,
          width: clipboard.width,
          height: clipboard.height,
        }),
      );
  }
  function captureBrush() {
    if (!clipboard) {
      copy();
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
    });
    setTool("pencil");
    setNotice("Custom brush ready");
  }
  function transform(operation, extra = {}) {
    if (!selection) {
      setNotice("Select pixels first.");
      return;
    }
    run(
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
          method: operation === "rotate" ? "pixel-safe" : "nearest",
          ...extra,
        })),
      "Transform selection",
    );
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
  }
  function onKey(event) {
    if (modal || restoringRef.current) return;
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
      void save().catch(() => {});
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
      await save();
      const loaded = await storeRef.current.loadDocument(id);
      if (!loaded) throw Error("Project could not be found.");
      await activate(loaded.document, loaded.revision);
    } catch (error) {
      report(error);
    }
  }
  async function decodeImage(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".tga"))
      return readTga(new Uint8Array(await file.arrayBuffer()));
    if (file.name.toLowerCase().endsWith(".bmp"))
      return readBmp(new Uint8Array(await file.arrayBuffer()));
    if (file.name.toLowerCase().endsWith(".png")) return readPng(bytes);
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
    setBusy(true);
    try {
      const file = files[0],
        ext = file.name.toLowerCase().split(".").pop();
      let next,
        warnings = [];
      if (kind === "extension") {
        const extension = validateExtension(JSON.parse(await file.text()));
        const updated = [
          ...extensions.filter((e) => e.id !== extension.id),
          extension,
        ];
        await storeRef.current.setSetting("extensions", updated);
        setExtensions(updated);
        setNotice(
          extension.name + " installed. Choose Run in Scripts to apply it.",
        );
        return;
      }
      if (kind === "palette") {
        run(
          { type: "palette.update", palette: parsePalette(await file.text()) },
          "Import palette",
        );
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
        const image = await decodeImage(file);
        warnings.push(...(image.warnings || []));
        const id = "reference-" + Date.now();
        run(
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
              pixels: pixelsFromRgba(image.rgba),
              x: 0,
              y: 0,
            },
            { type: "layer.update", layerId: id, patch: { locked: true } },
          ],
          "Import reference",
        );
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
        const raw = JSON.parse(await file.text());
        if (raw.version === 4 && raw.format === "pixelwall-document")
          next = normalizeDocument(raw);
        else {
          const parsed = parseProject(JSON.stringify(raw));
          next = migrateLegacy(parsed.project || parsed);
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
      await save();
      await activate({ ...next, id: crypto.randomUUID() });
      setImportWarnings(warnings);
      setNotice(
        warnings.length
          ? `Imported with ${warnings.length} compatibility notes.`
          : "Project imported",
      );
      if (warnings.length) setModal("warnings");
    } catch (error) {
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
  function exportFrameIds(options) {
    const clip = docRef.current.clips?.find(
      (c) => c.id === (options.clipId || clipId),
    );
    let ids = clip?.frameIds?.length
      ? [...clip.frameIds]
      : docRef.current.frames.map((f) => f.id);
    if (clip?.direction === "reverse" || clip?.direction === "pingpong_reverse")
      ids.reverse();
    if (clip?.direction?.startsWith("pingpong"))
      ids = [...ids, ...ids.slice(1, -1).reverse()];
    return { ids, loop: clip?.loop !== false };
  }
  async function exportArtwork(options = {}) {
    const source = docRef.current;
    if (!source) throw Error("Open a project first.");
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
      scale = clamp(Math.floor(Number(options.scale) || 1), 1, 8);
    if (PAID_FORMATS.has(format) && !(await access.requestAccess()))
      throw Error("Pro access is required for this export.");
    let bytes,
      companion,
      mime = "application/octet-stream",
      suffix = format;
    const fid = options.frameId || activeRef.current.frameId;
    if (format === "project") {
      bytes = strToU8(JSON.stringify(current));
      suffix = "pixelwall";
      mime = "application/json";
    } else if (format === "aseprite") {
      bytes = writeAseprite(current);
    } else if (format === "bmp" || format === "tga") {
      bytes = (format === "bmp" ? writeBmp : writeTga)(
        current.width * scale,
        current.height * scale,
        resizeRgba(
          renderFrame(current, fid),
          current.width,
          current.height,
          scale,
        ),
      );
    } else if (format === "png") {
      bytes = writePng(
        current.width * scale,
        current.height * scale,
        resizeRgba(
          renderFrame(current, fid),
          current.width,
          current.height,
          scale,
        ),
      );
      mime = "image/png";
    } else if (format === "gif") {
      const { ids, loop } = exportFrameIds(options);
      if (
        current.width * current.height * scale * scale * ids.length >
        64 * 1024 * 1024
      )
        throw Error(
          "This GIF exceeds the export memory budget. Reduce scale or select a shorter clip.",
        );
      const entries = [];
      for (let n = 0; n < ids.length; n++) {
        const f = current.frames.find((f) => f.id === ids[n]);
        entries.push({
          width: current.width * scale,
          height: current.height * scale,
          rgba: resizeRgba(
            renderFrame(current, f.id),
            current.width,
            current.height,
            scale,
          ),
          durationMs: f.durationMs,
        });
        if (n % 4 === 0) await deferred();
      }
      bytes = encodeGif(entries, { loop: loop ? 0 : -1 });
      mime = "image/gif";
    } else if (format === "sheet" || format === "zip") {
      const { ids } = exportFrameIds(options);
      if (
        current.width * current.height * scale * scale * ids.length >
        64 * 1024 * 1024
      )
        throw Error(
          "This export exceeds the memory budget. Reduce scale or select a shorter clip.",
        );
      const entries = ids.map((id, index) => ({
        id,
        name: `${stem(current.name)}-${String(index + 1).padStart(3, "0")}`,
        width: current.width * scale,
        height: current.height * scale,
        rgba: resizeRgba(
          renderFrame(current, id),
          current.width,
          current.height,
          scale,
        ),
        durationMs: current.frames.find((f) => f.id === id).durationMs,
      }));
      const atlas = packAtlas(entries, {
        padding: Number(options.padding ?? 1),
        extrude: Number(options.extrude ?? 1),
        trim: options.trim !== false,
        powerOfTwo: !!options.powerOfTwo,
        layout: options.layout || "packed",
        imageName:
          format === "sheet" ? stem(current.name) + ".png" : "sprites.png",
        scale,
        clips: current.clips,
        slices: current.slices,
      });
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
        bytes = makeGamePackage(current, { entries, atlas });
        mime = "application/zip";
      }
    } else throw Error("Unsupported export format.");
    const filename = `${stem(current.name)}.${suffix}`;
    downloads.downloadFiles([
      { blob: new Blob([bytes], { type: mime }), filename },
      ...(companion ? [companion] : []),
    ]);
    setNotice(`${filename} exported · ${bytes.length.toLocaleString()} bytes`);
    return { filename, bytes: bytes.length, mime };
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
  useEffect(() => {
    hostRef.current = {
      revision: () => revisionRef.current,
      inspect: () => describeDocument(docRef.current),
      commands: () => COMMANDS,
      apply: async (commands, label) => {
        commit(commands, label);
        await deferred();
      },
      newDocument,
      preview: async ({ frameId, scale = 1 } = {}) => {
        const current = docRef.current,
          s = clamp(scale, 1, 8);
        const rgba = resizeRgba(
          renderFrame(current, frameId || activeRef.current.frameId),
          current.width,
          current.height,
          s,
        );
        const c = rgbaImage(rgba, current.width * s, current.height * s);
        return {
          width: c.width,
          height: c.height,
          dataUrl: c.toDataURL("image/png"),
        };
      },
      save,
      export: exportArtwork,
      undo,
      redo,
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
    window.pixelwall = api;
    const cleanup = registerAutomation(
      document.modelContext || navigator.modelContext,
      api,
    );
    return () => {
      cleanup();
      if (window.pixelwall === api) delete window.pixelwall;
    };
  }, []);
  async function runBatch() {
    try {
      const parsed = JSON.parse(commandText);
      const result = await window.pixelwall.apply({
        commands: Array.isArray(parsed) ? parsed : [parsed],
        label: "Command batch",
      });
      setCommandResult(JSON.stringify(result, null, 2));
      setNotice("Command batch applied as one undoable edit.");
    } catch (error) {
      setCommandResult(error.message);
      report(error);
    }
  }
  async function showRecovery() {
    try {
      setBusy(true);
      setPlaying(false);
      await save();
      setRevisions(await storeRef.current.listRevisions(doc.id));
      setModal("recovery");
    } catch (error) {
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
          <IconButton
            icon={FolderOpen}
            label="Open project or image"
            onClick={() => chooseImport("document")}
          />
          <IconButton
            icon={Save}
            label="Save project backup"
            onClick={() => void doExport({ format: "project" }).catch(() => {})}
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
      <nav className="wb-doc-tabs" aria-label="Open documents">
        {documents.map((d) => (
          <button
            key={d.id}
            className={d.id === doc.id ? "active" : ""}
            onClick={() => void openDocument(d.id)}
          >
            {d.name || "Untitled"}
          </button>
        ))}
        {!documents.some((d) => d.id === doc.id) && (
          <button className="active">{doc.name}</button>
        )}
        <button onClick={() => setModal("new")} aria-label="Add document">
          +
        </button>
        <button onClick={showRecovery}>Recovery</button>
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
        <button onClick={() => chooseImport("reference")}>Reference</button>
        <button onClick={() => chooseImport("sequence")}>Image sequence</button>
        <button onClick={() => chooseImport("sheet")}>Sprite sheet</button>
        <button onClick={() => setModal("commands")}>
          <Search size={13} />
          Commands
        </button>
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
            {["paint", "lighten", "darken"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
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
              onClick={() => setSelection(selection.map((v) => (v ? 0 : 1)))}
            >
              Invert
            </button>
            <button disabled={!selection} onClick={copy}>
              Copy
            </button>
            <button disabled={!clipboard} onClick={paste}>
              Paste
            </button>
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
            <button onClick={() => setSelection(null)}>Deselect</button>
          </div>
        </section>
        <aside
          className="wb-sidebar"
          style={
            settings.sidebar === "floating"
              ? {
                  left: settings.panelX || 80,
                  top: settings.panelY || 150,
                  width: settings.panelWidth || 268,
                }
              : undefined
          }
        >
          <div className="wb-panel-dock">
            <button
              aria-label="Move floating panels"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                panelDrag.current = {
                  x: event.clientX,
                  y: event.clientY,
                  left: settings.panelX || 80,
                  top: settings.panelY || 150,
                };
                setSettings((current) => ({ ...current, sidebar: "floating" }));
              }}
              onPointerMove={(event) => {
                const drag = panelDrag.current;
                if (drag)
                  setSettings((current) => ({
                    ...current,
                    panelX: Math.max(0, drag.left + event.clientX - drag.x),
                    panelY: Math.max(0, drag.top + event.clientY - drag.y),
                  }));
              }}
              onPointerUp={() => {
                panelDrag.current = null;
              }}
            >
              Move panels
            </button>
            <button
              onClick={() =>
                setPinnedPanels((current) =>
                  current.includes(panel)
                    ? current.filter((p) => p !== panel)
                    : [...current, panel],
                )
              }
            >
              {pinnedPanels.includes(panel) ? "Unpin panel" : "Pin panel"}
            </button>
          </div>
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
                <div className="wb-layer-list">
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
                        label="Delete layer"
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
                    value={color.slice(0, 7)}
                    onChange={(e) =>
                      setColor(e.target.value + color.slice(7, 9))
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
                  {doc.palette.map((c, i) => (
                    <button
                      key={i}
                      style={{ background: c }}
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
                          palette: [...doc.palette, color],
                        },
                        "Add palette color",
                      )
                    }
                  >
                    Add color
                  </button>
                  <button
                    onClick={() => {
                      setPaletteText(doc.palette.join("\n"));
                      setModal("palette");
                    }}
                  >
                    Edit palette
                  </button>
                  <button
                    onClick={() =>
                      downloads.downloadBlob(
                        new Blob([doc.palette.join("\n")], {
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
                <Field label="Color mode">
                  <select
                    value={doc.colorMode}
                    onChange={(e) =>
                      run(
                        {
                          type: "document.colorMode",
                          colorMode: e.target.value,
                        },
                        "Convert color mode",
                      )
                    }
                  >
                    <option value="rgba">RGB + alpha</option>
                    <option value="indexed">Indexed</option>
                    <option value="grayscale">Grayscale</option>
                  </select>
                </Field>
                <Field label="Gradient end">
                  <input
                    type="color"
                    value={endColor.slice(0, 7)}
                    onChange={(e) => setEndColor(e.target.value + "ff")}
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
                    <FrameThumb doc={doc} frameId={activeFrame} repeat={3} />
                  </div>
                )}
              </>
            )}
            {(panel === "automation" ||
              pinnedPanels.includes("automation")) && (
              <>
                <h2>Scripts & commands</h2>
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
                <FrameThumb doc={doc} frameId={f.id} />
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
        accept=".pixelwall,.json,.ase,.aseprite,.png,.gif,.jpg,.jpeg,.webp,.bmp,.tga,.hex,.gpl,.pal"
        onChange={(e) => void importFiles([...e.target.files])}
      />
      {modal === "tilePixels" && tileDraft && (
        <Modal title="Edit tile pixels" onClose={() => setModal(null)}>
          <TilePixelEditor
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
                    max={2048}
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
            <button className="wb-primary" type="submit">
              Create project
            </button>
          </form>
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
                  max={2048}
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
          {Object.keys(transformOptions).map((k) => (
            <Field key={k} label={k}>
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
          <div className="wb-button-row">
            <button
              onClick={() => {
                transform("move", {
                  dx: transformOptions.dx,
                  dy: transformOptions.dy,
                });
                setModal(null);
              }}
            >
              Move
            </button>
            <button
              onClick={() => {
                transform("scale", {
                  scaleX: transformOptions.scaleX,
                  scaleY: transformOptions.scaleY,
                });
                setModal(null);
              }}
            >
              Scale
            </button>
            <button
              onClick={() => {
                transform("rotate", { angle: transformOptions.angle });
                setModal(null);
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
              <option value="aseprite">Editable Aseprite project · Free</option>
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
                <select
                  value={exportOptions.scale}
                  onChange={(e) =>
                    setExportOptions({
                      ...exportOptions,
                      scale: +e.target.value,
                    })
                  }
                >
                  {[1, 2, 4, 8].map((v) => (
                    <option key={v} value={v}>
                      {v}× · {doc.width * v} × {doc.height * v}
                    </option>
                  ))}
                </select>
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
              <label>
                <input
                  type="checkbox"
                  checked={c.loop}
                  onChange={(e) =>
                    run({
                      type: "clip.update",
                      clipId: c.id,
                      patch: { loop: e.target.checked },
                    })
                  }
                />
                Loop
              </label>
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
                setModal(null);
                setPendingImage(null);
              } catch (error) {
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
                    if (restoringRef.current) return;
                    restoringRef.current = true;
                    try {
                      setBusy(true);
                      await save();
                      const restore = saveQueueRef.current.then(async () => {
                        const restored = await storeRef.current.restoreRevision(
                          doc.id,
                          r.id || r.revision,
                        );
                        await activate(restored.document, restored.revision);
                      });
                      saveQueueRef.current = restore;
                      await restore;
                      setModal(null);
                    } catch (error) {
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
