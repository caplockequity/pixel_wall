"use client";
/* eslint react/prop-types: "off" -- Decoded pixels and cut options are validated below. */
import { useEffect, useMemo, useRef } from "react";

/** Read-only geometry matching importSheet's aliases, validation and cut order. */
export function getSheetPreviewLayout(image, options = {}) {
  const width = image?.width;
  const height = image?.height;
  const result = { width, height, valid: false, error: "" };
  const dimensionsValid = (w, h) =>
    Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w * h <= 64 * 1024 * 1024;
  if (!dimensionsValid(width, height) || image.rgba?.length !== width * height * 4) {
    return { ...result, error: "The sheet image is unavailable." };
  }
  const frameWidth = Number(options.frameWidth || options.cellWidth);
  const frameHeight = Number(options.frameHeight || options.cellHeight);
  if (!dimensionsValid(frameWidth, frameHeight)) {
    return { ...result, error: "Enter a positive whole-number frame width and height." };
  }
  const margin = Number(options.margin ?? options.padding ?? 0);
  const spacing = Number(options.spacing || 0);
  if (![margin, spacing].every((value) => Number.isInteger(value) && value >= 0)) {
    return { ...result, error: "Outer padding and spacing must be nonnegative whole numbers." };
  }
  const availableColumns = Math.floor((width - margin * 2 + spacing) / (frameWidth + spacing));
  const columns = options.columns || availableColumns;
  const rows = Math.floor((height - margin * 2 + spacing) / (frameHeight + spacing));
  if (!Number.isInteger(columns) || columns <= 0 || columns > availableColumns || rows <= 0) {
    return { ...result, error: "These cuts do not fit. Reduce the frame size, padding, or columns." };
  }
  const count = options.count ?? columns * rows;
  if (!Number.isInteger(count) || count <= 0 || count > columns * rows) {
    return { ...result, error: `Frame count must be between 1 and ${(columns * rows).toLocaleString()}.` };
  }
  return {
    width, height, valid: true, error: "", frameWidth, frameHeight, margin, spacing,
    availableColumns, columns, rows, count, capacity: columns * rows,
    order: options.order === "column" ? "column" : "row",
    unusedRight: width - margin * 2 - (columns * frameWidth + (columns - 1) * spacing),
    unusedBottom: height - margin * 2 - (rows * frameHeight + (rows - 1) * spacing),
  };
}

export function getSheetPreviewCut(layout, index) {
  if (!layout.valid || !Number.isInteger(index) || index < 0 || index >= layout.count) return null;
  const column = layout.order === "column" ? Math.floor(index / layout.rows) : index % layout.columns;
  const row = layout.order === "column" ? index % layout.rows : Math.floor(index / layout.columns);
  return {
    x: layout.margin + column * (layout.frameWidth + layout.spacing),
    y: layout.margin + row * (layout.frameHeight + layout.spacing),
    width: layout.frameWidth,
    height: layout.frameHeight,
    index,
  };
}

function selectedPixel(layout, x, y) {
  if (!layout.valid || x < layout.margin || y < layout.margin) return false;
  const column = Math.floor((x - layout.margin) / (layout.frameWidth + layout.spacing));
  const row = Math.floor((y - layout.margin) / (layout.frameHeight + layout.spacing));
  if (column >= layout.columns || row >= layout.rows) return false;
  const localX = x - layout.margin - column * (layout.frameWidth + layout.spacing);
  const localY = y - layout.margin - row * (layout.frameHeight + layout.spacing);
  if (localX >= layout.frameWidth || localY >= layout.frameHeight) return false;
  const index = layout.order === "column" ? column * layout.rows + row : row * layout.columns + column;
  return index < layout.count;
}

/** Pixels are sampled into a small preview; the source array is never changed. */
function drawPreview(canvas, image, layout) {
  if (!canvas || !image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width < 1 || image.height < 1 || image.rgba?.length !== image.width * image.height * 4) return;
  const fit = Math.min(8, 520 / image.width, 280 / image.height);
  const width = Math.max(1, Math.round(image.width * fit));
  const height = Math.max(1, Math.round(image.height * fit));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const preview = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / width));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * width + x) * 4;
      const alpha = image.rgba[source + 3] / 255;
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 48 : 35;
      const selected = selectedPixel(layout, sourceX, sourceY);
      for (let channel = 0; channel < 3; channel++) {
        const color = image.rgba[source + channel] * alpha + checker * (1 - alpha);
        preview.data[target + channel] = selected ? color : color * 0.3 + 12;
      }
      preview.data[target + 3] = 255;
    }
  }
  context.putImageData(preview, 0, 0);
  if (!layout.valid) return;
  const sx = width / image.width;
  const sy = height / image.height;
  const readableCells = layout.frameWidth * sx >= 4 && layout.frameHeight * sy >= 4;
  const drawAll = readableCells && layout.count <= 5000;
  const labels = drawAll && layout.count <= 200 && layout.frameWidth * sx >= 26 && layout.frameHeight * sy >= 20;
  const indices = drawAll ? Array.from({ length: layout.count }, (_, index) => index) : [0];
  context.font = "bold 10px ui-monospace, SFMono-Regular, monospace";
  context.textBaseline = "top";
  for (const index of indices) {
    const cut = getSheetPreviewCut(layout, index);
    const x = cut.x * sx;
    const y = cut.y * sy;
    const w = cut.width * sx;
    const h = cut.height * sy;
    context.strokeStyle = index === 0 ? "#8df0ce" : "rgba(255,179,75,0.9)";
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    if (labels) {
      const label = String(index + 1);
      const labelWidth = context.measureText(label).width + 6;
      context.fillStyle = "rgba(12,15,24,0.88)";
      context.fillRect(x + 1, y + 1, labelWidth, 14);
      context.fillStyle = index === 0 ? "#8df0ce" : "#ffe0ad";
      context.fillText(label, x + 4, y + 3);
    }
  }
}

/** Place below the cut-option controls. No callbacks or import side effects. */
export default function SheetImportPreview({ image, options }) {
  const canvasRef = useRef(null);
  const layout = useMemo(() => getSheetPreviewLayout(image, options), [image, options]);
  useEffect(() => {
    drawPreview(canvasRef.current, image, layout);
  }, [image, layout]);
  const first = getSheetPreviewCut(layout, 0);
  const last = getSheetPreviewCut(layout, layout.count - 1);
  const countLabel = layout.valid
    ? `${layout.count.toLocaleString()} ${layout.count === 1 ? "frame" : "frames"} · ${layout.columns} columns × ${layout.rows} rows`
    : "Adjust the cuts to preview frames";
  return (
    <section
      aria-label="Sprite sheet cut preview"
      style={{ margin: "12px 0", padding: 12, border: "1px solid #383947", borderRadius: 12, background: "#171923" }}
    >
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", marginBottom: 10, fontSize: 12 }}>
        <strong style={{ color: "#f4eee4" }}>{countLabel}</strong>
        {layout.valid && <span style={{ color: "#b8bccb" }}>{layout.frameWidth} × {layout.frameHeight} px each</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "center", overflow: "hidden", borderRadius: 6, background: "#0d1018" }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={layout.valid
            ? `${countLabel}. First frame starts at ${first.x}, ${first.y}; last frame starts at ${last.x}, ${last.y}. Import order is ${layout.order === "column" ? "down each column" : "across each row"}. Dimmed areas are excluded.`
            : layout.error}
          style={{ display: "block", maxWidth: "100%", height: "auto", imageRendering: "pixelated" }}
        />
      </div>
      <div aria-live="polite" style={{ marginTop: 9, fontSize: 12, lineHeight: 1.5, color: layout.valid ? "#b8bccb" : "#ffb8a5" }}>
        {layout.valid ? (
          <>
            <span style={{ color: "#8df0ce" }}>Green: first frame.</span>{" "}
            Amber outlines mark cuts; dimmed areas stay out.
            <div>
              {layout.order === "column" ? "Down each column" : "Across each row"} · {layout.margin} px outer padding · {layout.spacing} px spacing
              {layout.count < layout.capacity && ` · first ${layout.count} of ${layout.capacity} cells`}
            </div>
            {(layout.unusedRight > 0 || layout.unusedBottom > 0) && (
              <div>{layout.unusedRight} px unused on the right; {layout.unusedBottom} px unused at the bottom, inside outer padding.</div>
            )}
            {layout.count > 5000 && <div>Grid outlines are reduced for this dense sheet; the highlighted cuts remain accurate.</div>}
          </>
        ) : layout.error}
      </div>
    </section>
  );
}
