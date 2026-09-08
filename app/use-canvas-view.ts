"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

export const CELL_SIZES = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64];

type Point = { x: number; y: number };

export function useCanvasView(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  activePointer: RefObject<number | null>,
  size: number,
  cellSize: number,
  setCellSize: (value: number) => void,
  handActive: boolean,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ pixel: Point; view: Point } | null>(null);
  const pan = useRef<{ pointerId: number; start: Point; scroll: Point } | null>(null);
  const [panning, setPanning] = useState(false);

  const centerView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const point = anchor.current;
    anchor.current = null;
    if (!viewport || !canvas) return;
    if (!point) {
      centerView();
      return;
    }
    // Measure after layout: centering margins and scrollbars change as the canvas grows.
    const bounds = canvas.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    viewport.scrollLeft += bounds.left + point.pixel.x * cellSize - view.left - point.view.x;
    viewport.scrollTop += bounds.top + point.pixel.y * cellSize - view.top - point.view.y;
  }, [canvasRef, cellSize, size, centerView]);

  const changeCellSize = useCallback((direction: -1 | 1, pointer?: Point) => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas || activePointer.current !== null || pan.current) return;
    const next = direction > 0
      ? CELL_SIZES.find((value) => value > cellSize) ?? cellSize
      : CELL_SIZES.findLast((value) => value < cellSize) ?? cellSize;
    if (next === cellSize) return;
    const bounds = canvas.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    const target = pointer ?? { x: view.left + viewport.clientWidth / 2, y: view.top + viewport.clientHeight / 2 };
    anchor.current = {
      pixel: {
        x: Math.max(0, Math.min(size, (target.x - bounds.left) / cellSize)),
        y: Math.max(0, Math.min(size, (target.y - bounds.top) / cellSize)),
      },
      view: { x: target.x - view.left, y: target.y - view.top },
    };
    setCellSize(next);
  }, [activePointer, canvasRef, cellSize, setCellSize, size]);

  function fitCellSize(targetSize = size) {
    const viewport = viewportRef.current;
    if (!viewport) return CELL_SIZES[0];
    // Allow for the frame's border, padding and the workspace gutter on both sides.
    const space = Math.min(viewport.clientWidth, viewport.clientHeight) - 80;
    return CELL_SIZES.findLast((value) => value * targetSize <= space) ?? CELL_SIZES[0];
  }

  function fitView() {
    if (activePointer.current !== null || pan.current) return;
    anchor.current = null;
    const next = fitCellSize();
    if (next === cellSize) centerView();
    else setCellSize(next);
  }

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let distance = 0;
    let lastWheelTime = 0;
    function zoomWithWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const now = performance.now();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport!.clientHeight : 1);
      if (now - lastWheelTime > 180 || Math.sign(delta) !== Math.sign(distance)) distance = 0;
      lastWheelTime = now;
      distance += delta;
      if (Math.abs(distance) < 35) return;
      changeCellSize(distance < 0 ? 1 : -1, { x: event.clientX, y: event.clientY });
      distance = 0;
    }
    // Native non-passive listener keeps a pinch / modified scroll inside the editor.
    viewport.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", zoomWithWheel);
  }, [changeCellSize]);

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if ((!handActive || event.button !== 0) && event.button !== 1) return;
    if (!event.isPrimary || pan.current || activePointer.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const viewport = event.currentTarget;
    pan.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      scroll: { x: viewport.scrollLeft, y: viewport.scrollTop },
    };
    viewport.setPointerCapture(event.pointerId);
    canvasRef.current?.focus({ preventScroll: true });
    setPanning(true);
  }

  function continuePan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pan.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.scrollLeft = drag.scroll.x + drag.start.x - event.clientX;
    event.currentTarget.scrollTop = drag.scroll.y + drag.start.y - event.clientY;
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (pan.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    pan.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return {
    viewportRef, changeCellSize, fitCellSize, fitView, panning,
    panHandlers: {
      onPointerDownCapture: beginPan,
      onPointerMoveCapture: continuePan,
      onPointerUpCapture: endPan,
      onPointerCancelCapture: endPan,
      onLostPointerCapture: endPan,
    },
  };
}
