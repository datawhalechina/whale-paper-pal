import { useCallback, useEffect, useRef, useState } from "react";
import { readBrandedStorage } from "../lib/brand-storage";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

type ResizeEdge = "left" | "right";

type UseResizablePanelOptions = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  edge: ResizeEdge;
  label: string;
  getMaxWidth: (panel: HTMLElement) => number;
};

type ResizerProps = {
  role: "separator";
  tabIndex: number;
  title: string;
  "aria-label": string;
  "aria-orientation": "vertical";
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  className: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

type ResizablePanel = {
  panelRef: RefObject<HTMLElement | null>;
  panelStyle: CSSProperties;
  resizerProps: ResizerProps;
};

function loadWidth(storageKey: string, fallback: number): number {
  try {
    const stored = Number(readBrandedStorage(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

function saveWidth(storageKey: string, width: number): void {
  try {
    localStorage.setItem(storageKey, String(width));
  } catch {
    // Width persistence is optional when storage is unavailable.
  }
}

export function useResizablePanel({ storageKey, defaultWidth, minWidth, edge, label, getMaxWidth }: UseResizablePanelOptions): ResizablePanel {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; lastX: number; width: number } | null>(null);
  const bodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null);
  const [width, setWidth] = useState(() => loadWidth(storageKey, defaultWidth));
  const [maxWidth, setMaxWidth] = useState(Math.max(minWidth, defaultWidth));
  const [resizing, setResizing] = useState(false);

  const measureMaxWidth = useCallback(() => {
    const panel = panelRef.current;
    return Math.max(minWidth, Math.floor(panel ? getMaxWidth(panel) : window.innerWidth));
  }, [getMaxWidth, minWidth]);

  const clampWidth = useCallback((nextWidth: number, nextMaxWidth = measureMaxWidth()) => (
    Math.round(Math.min(Math.max(nextWidth, minWidth), nextMaxWidth))
  ), [measureMaxWidth, minWidth]);

  const restoreBody = useCallback(() => {
    if (!bodyStyleRef.current) return;
    document.body.style.cursor = bodyStyleRef.current.cursor;
    document.body.style.userSelect = bodyStyleRef.current.userSelect;
    bodyStyleRef.current = null;
  }, []);

  const finishResize = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const nextMaxWidth = measureMaxWidth();
    const nextWidth = clampWidth(drag.width, nextMaxWidth);
    dragRef.current = null;
    setMaxWidth(nextMaxWidth);
    setWidth(nextWidth);
    setResizing(false);
    saveWidth(storageKey, nextWidth);
    restoreBody();
  }, [clampWidth, measureMaxWidth, restoreBody, storageKey]);

  const updatePointerPosition = useCallback((clientX: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const direction = edge === "left" ? -1 : 1;
    const nextMaxWidth = measureMaxWidth();
    const nextWidth = clampWidth(drag.width + (clientX - drag.lastX) * direction, nextMaxWidth);
    dragRef.current = { ...drag, lastX: clientX, width: nextWidth };
    setMaxWidth(nextMaxWidth);
    setWidth(nextWidth);
  }, [clampWidth, edge, measureMaxWidth]);

  useEffect(() => {
    const syncToViewport = () => {
      const nextMaxWidth = measureMaxWidth();
      setMaxWidth(nextMaxWidth);
      setWidth((current) => clampWidth(current, nextMaxWidth));
    };
    syncToViewport();
    window.addEventListener("resize", syncToViewport);
    return () => window.removeEventListener("resize", syncToViewport);
  }, [clampWidth, measureMaxWidth]);

  useEffect(() => () => restoreBody(), [restoreBody]);

  useEffect(() => {
    if (!resizing) return;
    const onPointerMove = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      updatePointerPosition(event.clientX);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) finishResize();
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerEnd);
    document.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", finishResize);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerEnd);
      document.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", finishResize);
    };
  }, [finishResize, resizing, updatePointerPosition]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (dragRef.current) finishResize();
    const nextMaxWidth = measureMaxWidth();
    const currentWidth = clampWidth(width, nextMaxWidth);
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, width: currentWidth };
    bodyStyleRef.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setMaxWidth(nextMaxWidth);
    setResizing(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 16;
    const separatorMovement = event.key === "ArrowLeft" ? -step : step;
    const widthDelta = separatorMovement * (edge === "left" ? -1 : 1);
    const nextMaxWidth = measureMaxWidth();
    const nextWidth = clampWidth(width + widthDelta, nextMaxWidth);
    setMaxWidth(nextMaxWidth);
    setWidth(nextWidth);
    saveWidth(storageKey, nextWidth);
  };

  return {
    panelRef,
    panelStyle: { width, flexBasis: width },
    resizerProps: {
      role: "separator",
      tabIndex: 0,
      title: "拖动调整宽度",
      "aria-label": label,
      "aria-orientation": "vertical",
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": width,
      className: `panel-resizer is-${edge}${resizing ? " is-resizing" : ""}`,
      onPointerDown,
      onKeyDown,
    },
  };
}
