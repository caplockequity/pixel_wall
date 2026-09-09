"use client";
/* eslint react/prop-types: "off" -- Tiles are validated by the shared document engine. */
import { useEffect, useRef, useState } from "react";
import {
  createDocument,
  applyCommand,
  renderFrame,
  getCel,
} from "./editor-core.mjs";
import { isSRGB } from "./color-management.mjs";

export default function TilePixelEditor({ tile, color, colorProfile, colorManager, onApply, onCancel }) {
  const [draft, setDraft] = useState(() =>
    applyCommand(
      createDocument({
        name: "Tile pixels",
        width: tile.width,
        height: tile.height,
      }),
      {
        type: "cel.set",
        width: tile.width,
        height: tile.height,
        pixels: tile.pixels,
      },
    ),
  );
  const [mode, setMode] = useState("auto"),
    [erase, setErase] = useState(false);
  const canvas = useRef(null),
    stroke = useRef(null),
    draftRef = useRef(draft);
  const scale = Math.max(
    1,
    Math.min(16, Math.floor(320 / Math.max(tile.width, tile.height))),
  );
  useEffect(() => {
    if (!colorManager && !isSRGB(colorProfile)) return;
    const pixels = renderFrame(draft, draft.frames[0].id);
    canvas.current
      .getContext("2d")
      .putImageData(
        new ImageData(
          colorManager ? colorManager.transformRGBA(pixels, colorProfile) : pixels,
          draft.width,
          draft.height,
        ),
        0,
        0,
      );
  }, [draft, colorManager, colorProfile]);
  function point(event) {
    const rect = canvas.current.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          tile.width - 1,
          Math.floor(((event.clientX - rect.left) * tile.width) / rect.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          tile.height - 1,
          Math.floor(((event.clientY - rect.top) * tile.height) / rect.height),
        ),
      ),
    };
  }
  function paint(points) {
    const next = applyCommand(draftRef.current, {
      type: "draw.stroke",
      points,
      size: 1,
      color,
      erase,
    });
    draftRef.current = next;
    setDraft(next);
  }
  return (
    <>
      <p>
        Paint the original tile pixels. The cell keeps its rotation and flips.
      </p>
      <div className="wb-button-row">
        <button onClick={() => setErase(false)} aria-pressed={!erase}>
          Pencil
        </button>
        <button onClick={() => setErase(true)} aria-pressed={erase}>
          Eraser
        </button>
      </div>
      <canvas
        ref={canvas}
        width={tile.width}
        height={tile.height}
        aria-label="Tile pixel canvas"
        role="img"
        style={{
          width: tile.width * scale,
          height: tile.height * scale,
          imageRendering: "pixelated",
          touchAction: "none",
          display: "block",
          margin: "16px auto",
          background:
            "repeating-conic-gradient(#fff 0% 25%,#ddd 0% 50%) 0/12px 12px",
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const p = point(event);
          stroke.current = p;
          paint([p]);
        }}
        onPointerMove={(event) => {
          if (!stroke.current) return;
          const p = point(event);
          paint([stroke.current, p]);
          stroke.current = p;
        }}
        onPointerUp={() => {
          stroke.current = null;
        }}
        onPointerCancel={() => {
          stroke.current = null;
        }}
      />
      <label className="wb-field">
        <span>Tile edit mode</span>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="auto">Auto · reuse or add a tile</option>
          <option value="manual">Manual · update every use</option>
          <option value="stack">Stack · always add a tile</option>
        </select>
      </label>
      <div className="wb-button-row">
        <button
          className="wb-primary"
          onClick={() =>
            onApply(
              getCel(draft, draft.frames[0].id, draft.layers[0].id).image
                .pixels,
              mode,
            )
          }
        >
          Apply tile pixels
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}
