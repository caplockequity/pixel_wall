/** Bounded sheet cell geometry. Original implementation from recorded CLI output. */
import { exportRegionDocument } from './export-transform.mjs';
const PIXEL_LIMIT = 64 * 1024 * 1024;
const CELL_LIMIT = 32768;
const fail = message => { throw Error(message); };

export function parseExportGrid(value) {
  if (value == null) return null;
  const parts = typeof value === 'string' ? value.split(',').map(Number) : Array.isArray(value) ? value : [value.x, value.y, value.width ?? value.w, value.height ?? value.h];
  if (parts.length !== 4 || !parts.every(Number.isSafeInteger) || Math.abs(parts[0]) > 2147483647 || Math.abs(parts[1]) > 2147483647 || parts[2] < 1 || parts[3] < 1 || parts[2] > 65535 || parts[3] > 65535 || parts[2] * parts[3] > PIXEL_LIMIT) fail('Grid requires x,y,width,height with integer origins and positive cell dimensions within the export limits.');
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/** Repeat the grid to the first cell containing canvas origin. Leading cells may
 * extend outside the canvas; incomplete right/bottom cells are omitted. Grid
 * dimensions are measured on the scaled sprite and do not scale themselves. */
export function exportGridCells(width, height, value) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || width * height > PIXEL_LIMIT) fail('Grid canvas exceeds the export pixel limit.');
  const grid = parseExportGrid(value) ?? { x: 0, y: 0, width: 16, height: 16 };
  const origin = (position, size) => { const remainder = position % size; return remainder > 0 ? remainder - size : remainder || 0; };
  const x = origin(grid.x, grid.width), y = origin(grid.y, grid.height);
  const columns = Math.floor((width - x) / grid.width), rows = Math.floor((height - y) / grid.height), count = columns * rows;
  if (count > CELL_LIMIT || count * grid.width * grid.height > PIXEL_LIMIT) fail('Grid export exceeds the total pixel or cell limit; use larger cells or export smaller batches.');
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    return { index, column, row, columns, rows, definition: { ...grid }, bounds: { x: x + column * grid.width, y: y + row * grid.height, width: grid.width, height: grid.height } };
  });
}

/** Render the complete grid extent, including off-canvas cel pixels in leading
 * cells. Translate just the selected frame so inherited palettes remain intact.
 * This temporary view shares pixel arrays and never mutates source geometry. */
export function exportGridCanvas(document, frameId, cells) {
  if (!cells.length) return null;
  const first = cells[0], { x, y, width: cellWidth, height: cellHeight } = first.bounds;
  const width = first.columns * cellWidth, height = first.rows * cellHeight;
  if (!Number.isSafeInteger(width * height) || width * height > PIXEL_LIMIT) fail('Grid render exceeds the export pixel limit.');
  return { x, y, document: exportRegionDocument(document, frameId, { x, y, width, height }) };
}
