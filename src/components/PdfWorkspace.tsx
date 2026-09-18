import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Eraser, Image as ImageIcon, Redo2, ScanText, Trash2, Undo2, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Page } from "react-pdf";
import { OPS, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import type {
  Annotation,
  AnnotationRect,
  AutoHighlight,
  ImageCapture,
  InkPoint,
  InkStroke,
  PaperComment,
  ReaderMode,
  SelectionAction,
  TextSelection,
  PageTranslation,
  PdfVisualRegion,
  TranslationSegment,
} from "../types";
import { readBrandedStorage } from "../lib/brand-storage";
import { escapeAndHighlight } from "../lib/pdf";
import { IconButton } from "./IconButton";
import explanationIcon from "../assets/reader-icons/main-icon-feature-explanation.svg";
import highlightToolbarIcon from "../assets/reader-icons/main-icon-feature-highlight-toolbar.svg";
import translationIcon from "../assets/reader-icons/main-icon-feature-translation.svg";
import commentIcon from "../assets/reader-icons/main-icon-feature-comment.svg";
import aiChatIcon from "../assets/reader-icons/main-icon-feature-ai-chat.svg";

const COLOR_LABELS = {
  yellow: "黄色",
  green: "绿色",
  blue: "蓝色",
  rose: "红色",
} as const;

const INK_COLORS = ["#111111", "#ffcf24", "#20a7d8", "#31b95f", "#ee655f", "#b45bd2"];
const INK_WIDTHS = [2, 5, 9];
const INK_PREFERENCES_KEY = "whalepaper.ink-preferences.v1";
const SELECTION_MENU_WIDTH = 280;
const SELECTION_MENU_HEIGHT = 248;
const SELECTION_CONTEXT_LENGTH = 320;

type HighlightColor = keyof typeof COLOR_LABELS;

type PdfWorkspaceProps = {
  documentId: string;
  pdf: PDFDocumentProxy;
  pageCount: number;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  targetPage: number;
  searchQuery: string;
  annotations: Annotation[];
  comments: PaperComment[];
  autoHighlights: AutoHighlight[];
  showAutoHighlightLabels: boolean;
  ink: InkStroke[];
  mode: ReaderMode;
  onModeChange: (mode: ReaderMode) => void;
  onInkChange: (ink: InkStroke[]) => void;
  onAutoHighlightRectsChange: (id: string, rects: AnnotationRect[]) => void;
  onCitationSelect: (referenceNumber: number) => void;
  onImageCapture: (capture: ImageCapture) => void;
  onCurrentPageChange: (page: number) => void;
  onSelectionAction: (action: SelectionAction, selection: TextSelection) => void;
  onCreateAnnotation: (selection: TextSelection, type: "highlight" | "note", color: HighlightColor) => void;
  onDeleteAnnotation: (id: string) => void;
  translations: PageTranslation[];
  activeTranslationSegmentId: string | null;
  onTranslationSegmentActivate: (segment: TranslationSegment, clicked: boolean) => void;
  onTranslationRectsChange: (segmentId: string, rects: AnnotationRect[]) => void;
  onVisualRegionsChange: (pageNumber: number, regions: PdfVisualRegion[], ready: boolean) => void;
};

type ReaderPageProps = {
  documentId: string;
  pdf: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  rotation: 0 | 90 | 180 | 270;
  defaultRatio: number;
  scrollRoot: HTMLDivElement | null;
  query: string;
  annotations: Annotation[];
  comments: PaperComment[];
  autoHighlights: AutoHighlight[];
  showAutoHighlightLabels: boolean;
  ink: InkStroke[];
  mode: ReaderMode;
  inkColor: string;
  inkWidth: number;
  citationDestinationNumbers: Record<string, number>;
  registerPage: (pageNumber: number, element: HTMLDivElement | null) => void;
  onSelection: (selection: TextSelection | null) => void;
  onAddInk: (stroke: InkStroke) => void;
  onEraseInk: (strokeId: string) => void;
  onAutoHighlightRectsChange: (id: string, rects: AnnotationRect[]) => void;
  onCitationSelect: (referenceNumber: number) => void;
  onImageCapture: (capture: ImageCapture) => void;
  onVisualAction: (action: SelectionAction | "highlight", capture: ImageCapture, selection: TextSelection) => void;
  onAnnotationAction: (action: SelectionAction, annotation: Annotation, clientX: number, clientY: number) => void;
  onUrlAction: (url: string, clientX: number, clientY: number) => void;
  onDeleteAnnotation: (id: string) => void;
  onModeChange: (mode: ReaderMode) => void;
  translationSegments: TranslationSegment[];
  activeTranslationSegmentId: string | null;
  onTranslationSegmentActivate: (segment: TranslationSegment, clicked: boolean) => void;
  onTranslationRectsChange: (segmentId: string, rects: AnnotationRect[]) => void;
  onVisualRegionsChange: (pageNumber: number, regions: PdfVisualRegion[], ready: boolean) => void;
};

type DragRect = { start: InkPoint; current: InkPoint };
type Matrix = [number, number, number, number, number, number];
type VisualRegion = AnnotationRect & {
  id: string;
  kind: "image" | "table" | "formula";
  confidence?: number;
  sourceText?: string;
};

type LayoutDetectionBox = {
  box_cls?: number;
  box_conf?: number;
  box_xywhn?: [number, number, number, number];
};

const LAYOUT_MODEL_CACHE_PREFIX = "whalepaper.doclayout-onnx.v1";
const LAYOUT_MODEL_CLASS = { figure: 3, table: 5, formula: 8 } as const;
const TABLE_CAPTION_RE = /^(?:table|tab\.|tbl\.|表)\s*[\d一二三四五六七八九十]+[a-z]?(?:\s|[:.\-]|$)/i;
const TABLE_NUMBER_RE = /^\s*[-+]?\d+(?:\.\d+)?%?\s*$/;

function layoutModelRegions(boxes: LayoutDetectionBox[], pageNumber: number): VisualRegion[] {
  return boxes.flatMap((box, index) => {
    const coordinates = box.box_xywhn;
    const kind = box.box_cls === LAYOUT_MODEL_CLASS.table
      ? "table"
      : box.box_cls === LAYOUT_MODEL_CLASS.formula
        ? "formula"
        : box.box_cls === LAYOUT_MODEL_CLASS.figure
          ? "image"
          : null;
    if (!coordinates || !kind || coordinates.length !== 4 || !coordinates.every(Number.isFinite)) return [];
    const [centerX, centerY, width, height] = coordinates;
    const left = Math.max(0, centerX - width / 2);
    const top = Math.max(0, centerY - height / 2);
    const right = Math.min(1, centerX + width / 2);
    const bottom = Math.min(1, centerY + height / 2);
    if (right <= left || bottom <= top) return [];
    return [{
      id: `doclayout-${pageNumber}-${index}`,
      kind,
      left,
      top,
      width: right - left,
      height: bottom - top,
      confidence: Number.isFinite(box.box_conf) ? box.box_conf : undefined,
    }];
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("无法生成页面图像")),
    "image/png",
  ));
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取页面图像"));
    reader.onerror = () => reject(reader.error || new Error("无法读取页面图像"));
    reader.readAsDataURL(blob);
  });
}

async function detectLayoutModel(
  canvas: HTMLCanvasElement,
  documentId: string,
  pageNumber: number,
  rotation: ReaderPageProps["rotation"],
): Promise<VisualRegion[]> {
  // Layout inference is an on-device desktop feature. Browser previews do
  // not upload rendered paper pages to a remote compatibility endpoint.
  if (!isTauri()) return [];

  const cacheKey = `${LAYOUT_MODEL_CACHE_PREFIX}:${documentId}:${pageNumber}:${rotation}`;
  try {
    const cached = JSON.parse(readBrandedStorage(cacheKey) || "null") as LayoutDetectionBox[] | null;
    if (Array.isArray(cached)) return layoutModelRegions(cached, pageNumber);
  } catch {
    // Detection can continue without a cache entry.
  }

  const blob = await canvasBlob(canvas);
  const boxes = await invoke<LayoutDetectionBox[]>("detect_pdf_layout", {
    request: {
      dataUrl: await blobDataUrl(blob),
      documentId,
      pageIndex: pageNumber - 1,
    },
  });
  if (!Array.isArray(boxes)) throw new Error("版面检测返回格式错误");
  try {
    localStorage.setItem(cacheKey, JSON.stringify(boxes));
  } catch {
    // Live detection remains usable when storage is unavailable.
  }
  return layoutModelRegions(boxes, pageNumber);
}

function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function matrixPoint(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function numericBox(value: unknown): [number, number, number, number] | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<number, unknown>;
  const numbers = [box[0], box[1], box[2], box[3]].map(Number);
  return numbers.every(Number.isFinite) ? numbers as [number, number, number, number] : null;
}

function regionContains(container: AnnotationRect, item: AnnotationRect): boolean {
  const overlapWidth = Math.max(0, Math.min(container.left + container.width, item.left + item.width) - Math.max(container.left, item.left));
  const overlapHeight = Math.max(0, Math.min(container.top + container.height, item.top + item.height) - Math.max(container.top, item.top));
  return overlapWidth * overlapHeight >= item.width * item.height * 0.88;
}

async function extractVisualRegions(page: PDFPageProxy, rotation: ReaderPageProps["rotation"]): Promise<VisualRegion[]> {
  const operatorList = await page.getOperatorList();
  const viewport = page.getViewport({ scale: 1, rotation });
  const stack: Matrix[] = [];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const candidates: VisualRegion[] = [];

  const addCandidate = (box: [number, number, number, number], kind: VisualRegion["kind"], index: number) => {
    const pagePoints = [
      matrixPoint(matrix, box[0], box[1]),
      matrixPoint(matrix, box[2], box[1]),
      matrixPoint(matrix, box[0], box[3]),
      matrixPoint(matrix, box[2], box[3]),
    ];
    const displayPoints = pagePoints.map(([x, y]) => viewport.convertToViewportPoint(x, y));
    const left = Math.max(0, Math.min(...displayPoints.map(([x]) => x)) / viewport.width);
    const top = Math.max(0, Math.min(...displayPoints.map(([, y]) => y)) / viewport.height);
    const right = Math.min(1, Math.max(...displayPoints.map(([x]) => x)) / viewport.width);
    const bottom = Math.min(1, Math.max(...displayPoints.map(([, y]) => y)) / viewport.height);
    const width = right - left;
    const height = bottom - top;
    const area = width * height;
    if (width < 0.08 || height < 0.05 || area < 0.006 || area > 0.72) return;
    candidates.push({ id: `${kind}-${index}`, kind, left, top, width, height });
  };

  operatorList.fnArray.forEach((operation, index) => {
    const args = operatorList.argsArray[index] as unknown[] | null;
    if (operation === OPS.save) {
      stack.push([...matrix] as Matrix);
    } else if (operation === OPS.restore) {
      matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (operation === OPS.transform && args && args.length >= 6) {
      const next = args.slice(0, 6).map(Number) as Matrix;
      if (next.every(Number.isFinite)) matrix = multiplyMatrix(matrix, next);
    } else if (operation === OPS.paintFormXObjectBegin) {
      const box = numericBox(args?.[1]);
      if (box) addCandidate(box, "image", index);
    } else if (operation === OPS.paintImageXObject || operation === OPS.paintInlineImageXObject) {
      addCandidate([0, 0, 1, 1], "image", index);
    }
  });

  return candidates
    .sort((left, right) => right.width * right.height - left.width * left.height)
    .filter((candidate, index, ordered) => !ordered.slice(0, index).some((larger) => regionContains(larger, candidate)));
}

function classifyVisualRegions(pageElement: HTMLElement, regions: VisualRegion[]): VisualRegion[] {
  const pageBounds = pageElement.getBoundingClientRect();
  const spans = Array.from(pageElement.querySelectorAll<HTMLElement>(".textLayer span"));
  return regions.map((region) => {
    const left = pageBounds.left + region.left * pageBounds.width;
    const top = pageBounds.top + region.top * pageBounds.height;
    const right = left + region.width * pageBounds.width;
    const bottom = top + region.height * pageBounds.height;
    const nearby = spans.flatMap((span) => {
      const bounds = span.getBoundingClientRect();
      const horizontalOverlap = Math.max(0, Math.min(right, bounds.right) - Math.max(left, bounds.left));
      const inside = horizontalOverlap > 0 && bounds.bottom >= top && bounds.top <= bottom;
      const caption = horizontalOverlap > 0 && bounds.top >= bottom && bounds.top <= bottom + 48;
      return inside || caption ? [span.textContent || ""] : [];
    }).join(" ").replace(/\s+/g, " ").trim();
    // A metric word in nearby prose is not enough to call a visual box a table.
    // Require an explicit caption close to the box; this prevents a figure or
    // image box in a two-column paper from inheriting text from the next column.
    const captionNearRegion = spans.some((span) => {
      const text = (span.textContent || "").trim();
      if (!TABLE_CAPTION_RE.test(text)) return false;
      const bounds = span.getBoundingClientRect();
      const horizontalOverlap = Math.max(0, Math.min(right, bounds.right) - Math.max(left, bounds.left));
      const verticalDistance = bounds.top >= bottom ? bounds.top - bottom : top - bounds.bottom;
      return horizontalOverlap > 0 && verticalDistance <= 72;
    });
    const table = region.kind === "table" && (captionNearRegion || (region.confidence || 0) >= 0.82);
    const formulaSymbols = (nearby.match(/[=+−×÷∑∏∫√≤≥≈∈∇α-ω]/g) || []).length;
    const formula = !table && (region.kind === "formula" || (formulaSymbols >= 2 && nearby.length < 900));
    return { ...region, kind: table ? "table" : formula ? "formula" : "image", sourceText: nearby || undefined };
  });
}

function detectTextTableRegions(pageElement: HTMLElement): VisualRegion[] {
  const pageBounds = pageElement.getBoundingClientRect();
  const spans = Array.from(pageElement.querySelectorAll<HTMLElement>(".textLayer span"));
  const captions = spans.filter((span) => TABLE_CAPTION_RE.test((span.textContent || "").trim()));
  const inPage = (span: HTMLElement) => {
    const bounds = span.getBoundingClientRect();
    return bounds.left >= pageBounds.left && bounds.right <= pageBounds.right;
  };
  type TextRow = {
    spans: HTMLElement[];
    bounds: { left: number; top: number; right: number; bottom: number; height: number };
    text: string;
    numericCount: number;
    structured: boolean;
  };
  const textRows = (items: HTMLElement[]): TextRow[] => {
    const rows = new Map<number, HTMLElement[]>();
    items.forEach((span) => {
      const key = Math.round(span.getBoundingClientRect().top / 3) * 3;
      rows.set(key, [...(rows.get(key) || []), span]);
    });
    return Array.from(rows.values()).map((row) => {
      const rects = row.map((span) => span.getBoundingClientRect());
      const text = row.map((span) => span.textContent || "").join(" ").replace(/\s+/g, " ").trim();
      const numericCount = (text.match(/(?<![\p{L}\d])[-+]?\d+(?:\.\d+)?%?(?![\p{L}\d])/gu) || []).length;
      const top = Math.min(...rects.map((rect) => rect.top));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return {
        spans: row,
        bounds: {
          left: Math.min(...rects.map((rect) => rect.left)),
          top,
          right: Math.max(...rects.map((rect) => rect.right)),
          bottom,
          height: bottom - top,
        },
        text,
        numericCount,
        // Body text often consists of many spans too. Numeric cells and a
        // compact row are stronger table evidence than span count alone.
        structured: numericCount >= 2 && row.length >= 3 && text.length < 180,
      };
    }).sort((left, right) => left.bounds.top - right.bounds.top);
  };
  const tableBlocks = (rows: TextRow[]): TextRow[][] => {
    const blocks: TextRow[][] = [];
    for (const row of rows.filter((item) => item.structured)) {
      const block = blocks.at(-1);
      const previous = block?.at(-1);
      if (!block || !previous) {
        blocks.push([row]);
        continue;
      }
      const numericRows = block.filter((item) => item.numericCount >= 2).length;
      const gap = row.bounds.top - previous.bounds.bottom;
      const maximumGap = Math.max(14, Math.min(24, Math.max(previous.bounds.height, row.bounds.height) * 1.8));
      // Once a numeric table body is established, a non-numeric row is normally a note or the next section title.
      if (gap > maximumGap || (numericRows >= 2 && row.numericCount === 0)) blocks.push([row]);
      else block.push(row);
    }
    return blocks;
  };
  return captions.flatMap((caption, captionIndex): VisualRegion[] => {
    const captionBounds = caption.getBoundingClientRect();
    const pageMiddle = pageBounds.left + pageBounds.width / 2;
    const captionMiddle = (captionBounds.left + captionBounds.right) / 2;
    const columnLeft = captionMiddle < pageMiddle ? pageBounds.left : pageMiddle;
    const columnRight = captionMiddle < pageMiddle ? pageMiddle : pageBounds.right;
    const sameColumn = (span: HTMLElement) => {
      const bounds = span.getBoundingClientRect();
      const middle = (bounds.left + bounds.right) / 2;
      return middle >= columnLeft - 8 && middle <= columnRight + 8;
    };
    const nearby = spans.filter((span) => {
      const bounds = span.getBoundingClientRect();
      return span !== caption
        && inPage(span)
        && sameColumn(span)
        && bounds.top >= captionBounds.top - 180
        && bounds.bottom <= captionBounds.bottom + 180;
    });
    const blocks = tableBlocks(textRows(nearby)).filter((block) => {
      const numericRows = block.filter((row) => row.numericCount >= 2).length;
      const numericCount = block.reduce((sum, row) => sum + row.numericCount, 0);
      if (block.length < 3 || numericRows < 3 || numericCount < 6) return false;
      const rowsWithNumbers = block.filter((row) => row.numericCount >= 2);
      const referenceColumns = rowsWithNumbers[0].spans
        .filter((span) => TABLE_NUMBER_RE.test(span.textContent || ""))
        .map((span) => {
          const bounds = span.getBoundingClientRect();
          return (bounds.left + bounds.right) / 2;
        });
      if (referenceColumns.length < 2) return false;
      return rowsWithNumbers.slice(1).every((row) => {
        const columns = row.spans
          .filter((span) => TABLE_NUMBER_RE.test(span.textContent || ""))
          .map((span) => {
            const bounds = span.getBoundingClientRect();
            return (bounds.left + bounds.right) / 2;
          });
        return columns.length >= 2 && referenceColumns.every((x) => columns.some((candidate) => Math.abs(candidate - x) <= 28));
      });
    });
    const selectedBlock = blocks.sort((left, right) => {
      const score = (block: TextRow[]) => {
        const numericRows = block.filter((row) => row.numericCount >= 2).length;
        const numericCount = block.reduce((sum, row) => sum + row.numericCount, 0);
        const first = block[0].bounds;
        const last = block.at(-1)!.bounds;
        const distance = last.bottom < captionBounds.top
          ? captionBounds.top - last.bottom
          : Math.max(0, first.top - captionBounds.bottom);
        return numericRows * 12 + numericCount * 2 + Math.min(10, block.length) - distance / 16;
      };
      return score(right) - score(left);
    })[0];
    if (!selectedBlock) return [];
    const selectedDistance = selectedBlock[0].bounds.top > captionBounds.bottom
      ? selectedBlock[0].bounds.top - captionBounds.bottom
      : captionBounds.top - selectedBlock.at(-1)!.bounds.bottom;
    if (selectedDistance > 96) return [];
    const candidates = Array.from(new Set([caption, ...selectedBlock.flatMap((row) => row.spans)]));
    const text = candidates.map((span) => span.textContent || "").join(" ").replace(/\s+/g, " ").trim();
    const numericCount = (text.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
    if (candidates.length < 4 || numericCount < 4) return [];
    const rects = candidates.map((span) => span.getBoundingClientRect());
    const left = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - pageBounds.left);
    const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - pageBounds.top);
    const right = Math.min(pageBounds.width, Math.max(...rects.map((rect) => rect.right)) - pageBounds.left);
    const bottom = Math.min(pageBounds.height, Math.max(...rects.map((rect) => rect.bottom)) - pageBounds.top);
    return [{
      id: `text-table-${captionIndex}`,
      kind: "table",
      left: left / pageBounds.width,
      top: top / pageBounds.height,
      width: (right - left) / pageBounds.width,
      height: (bottom - top) / pageBounds.height,
      sourceText: text,
    }];
  }).filter((region, index, regions) => !regions.slice(0, index).some((existing) => regionContains(existing, region)));
}

function displayPointToCanonical(point: InkPoint, rotation: ReaderPageProps["rotation"]): InkPoint {
  if (rotation === 90) return { x: point.y, y: 1 - point.x };
  if (rotation === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (rotation === 270) return { x: 1 - point.y, y: point.x };
  return point;
}

function canonicalPointToDisplay(point: InkPoint, rotation: ReaderPageProps["rotation"]): InkPoint {
  if (rotation === 90) return { x: 1 - point.y, y: point.x };
  if (rotation === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (rotation === 270) return { x: point.y, y: 1 - point.x };
  return point;
}

function transformRect(rect: AnnotationRect, transform: (point: InkPoint) => InkPoint): AnnotationRect {
  const points = [
    transform({ x: rect.left, y: rect.top }),
    transform({ x: rect.left + rect.width, y: rect.top }),
    transform({ x: rect.left, y: rect.top + rect.height }),
    transform({ x: rect.left + rect.width, y: rect.top + rect.height }),
  ];
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return { left, top, width: right - left, height: bottom - top };
}

function pointFromEvent(event: { clientX: number; clientY: number }, element: HTMLElement): InkPoint {
  const bounds = element.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

function distanceToSegment(point: InkPoint, start: InkPoint, end: InkPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

function strokeDistance(point: InkPoint, stroke: InkStroke): number {
  if (stroke.points.length < 2) return Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < stroke.points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, stroke.points[index - 1], stroke.points[index]));
  }
  return distance;
}

function captureCanvasRegion(pageElement: HTMLElement, pageNumber: number, drag: DragRect): ImageCapture | null {
  const canvas = pageElement.querySelector("canvas");
  if (!canvas) return null;
  const left = Math.min(drag.start.x, drag.current.x);
  const top = Math.min(drag.start.y, drag.current.y);
  const width = Math.abs(drag.current.x - drag.start.x);
  const height = Math.abs(drag.current.y - drag.start.y);
  if (width < 0.025 || height < 0.025) return null;

  const sourceX = Math.round(left * canvas.width);
  const sourceY = Math.round(top * canvas.height);
  const sourceWidth = Math.max(1, Math.round(width * canvas.width));
  const sourceHeight = Math.max(1, Math.round(height * canvas.height));
  const output = document.createElement("canvas");
  output.width = sourceWidth;
  output.height = sourceHeight;
  const context = output.getContext("2d");
  if (!context) return null;
  context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  return {
    id: crypto.randomUUID(),
    pageNumber,
    dataUrl: output.toDataURL("image/png"),
    width: sourceWidth,
    height: sourceHeight,
  };
}

async function copyImageCapture(capture: ImageCapture): Promise<void> {
  const blob = await (await fetch(capture.dataUrl)).blob();
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("当前环境不支持复制图片");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function canonicalCharacter(character: string): string {
  return Array.from(character.normalize("NFKC"))
    .map((value) => /[\p{L}\p{N}]/u.test(value) ? value.toLocaleLowerCase() : " ")
    .join("");
}

function canonicalText(value: string): string {
  return Array.from(value).map(canonicalCharacter).join("").replace(/\s+/g, " ").trim();
}

function normalizeWithMap(nodes: Text[]): { text: string; map: Array<{ node: Text; offset: number }> } {
  let text = "";
  const map: Array<{ node: Text; offset: number }> = [];
  nodes.forEach((node, nodeIndex) => {
    const value = node.textContent || "";
    if (nodeIndex > 0 && text && !text.endsWith(" ")) {
      text += " ";
      map.push({ node, offset: 0 });
    }
    for (let offset = 0; offset < value.length; offset += 1) {
      Array.from(canonicalCharacter(value[offset])).forEach((character) => {
        if (character === " " && text.endsWith(" ")) return;
        text += character;
        map.push({ node, offset });
      });
    }
  });
  return { text, map };
}

function resolveQuoteRects(pageElement: HTMLElement, quote: string): AnnotationRect[] {
  const textLayer = pageElement.querySelector(".textLayer");
  if (!textLayer) return [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  if (!nodes.length) return [];
  const normalized = normalizeWithMap(nodes);
  const needle = canonicalText(quote);
  let index = normalized.text.indexOf(needle);
  let matchedLength = needle.length;
  if (index < 0 && needle.length > 80) {
    const shorter = needle.slice(0, 80).trim();
    index = normalized.text.indexOf(shorter);
    matchedLength = shorter.length;
  }
  let matchMap = normalized.map;
  if (index < 0) {
    const compactText: string[] = [];
    const compactMap: Array<{ node: Text; offset: number }> = [];
    Array.from(normalized.text).forEach((character, characterIndex) => {
      if (!/[\p{L}\p{N}]/u.test(character) || !normalized.map[characterIndex]) return;
      compactText.push(character);
      compactMap.push(normalized.map[characterIndex]);
    });
    const compactNeedle = Array.from(needle).filter((character) => /[\p{L}\p{N}]/u.test(character)).join("");
    if (compactNeedle.length >= 16) {
      index = compactText.join("").indexOf(compactNeedle);
      matchedLength = compactNeedle.length;
      matchMap = compactMap;
    }
  }
  if (index < 0 || !matchMap[index] || !matchMap[index + matchedLength - 1]) return [];

  const start = matchMap[index];
  const end = matchMap[index + matchedLength - 1];
  const range = document.createRange();
  range.setStart(start.node, Math.min(start.offset, start.node.length));
  range.setEnd(end.node, Math.min(end.offset + 1, end.node.length));
  const pageBounds = pageElement.getBoundingClientRect();
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 1 && rect.height > 1)
    .map((rect) => ({
      left: Math.max(0, (rect.left - pageBounds.left) / pageBounds.width),
      top: Math.max(0, (rect.top - pageBounds.top) / pageBounds.height),
      width: Math.min(1, rect.width / pageBounds.width),
      height: Math.min(1, rect.height / pageBounds.height),
    }));
  range.detach();
  return rects;
}

function assignCitationNumbers(pageElement: HTMLElement, elementNumbers: Record<string, number>): void {
  const spans = Array.from(pageElement.querySelectorAll(".textLayer span"));
  pageElement.querySelectorAll<HTMLElement>('.annotationLayer a[href="#"]').forEach((link) => {
    const resolvedNumber = elementNumbers[link.dataset.elementId || ""];
    if (resolvedNumber) {
      link.dataset.referenceNumber = String(resolvedNumber);
      return;
    }
    const linkBounds = link.getBoundingClientRect();
    const center = { x: linkBounds.left + linkBounds.width / 2, y: linkBounds.top + linkBounds.height / 2 };
    const candidates: Array<{ value: number; distance: number }> = [];
    spans.forEach((span) => {
      const bounds = span.getBoundingClientRect();
      if (bounds.left >= linkBounds.right || bounds.right <= linkBounds.left || bounds.top >= linkBounds.bottom || bounds.bottom <= linkBounds.top) return;
      const node = Array.from(span.childNodes).find((child): child is Text => child.nodeType === Node.TEXT_NODE);
      const text = node?.textContent || "";
      for (const match of text.matchAll(/\d{1,3}/g)) {
        if (!node || match.index === undefined) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        range.detach();
        candidates.push({
          value: Number.parseInt(match[0], 10),
          distance: Math.hypot(rect.left + rect.width / 2 - center.x, rect.top + rect.height / 2 - center.y),
        });
      }
    });
    const match = candidates.sort((left, right) => left.distance - right.distance)[0];
    if (match) link.dataset.referenceNumber = String(match.value);
  });
}

function ReaderPage(props: ReaderPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const modelRegionsApplied = useRef(false);
  const modelDetectionKey = useRef("");
  const operatorRegionsReady = useRef(false);
  const modelRegionsReady = useRef(false);
  const visualRegionsReadyTimer = useRef<number | null>(null);
  const erasedDuringGesture = useRef(new Set<string>());
  const citationElementNumbers = useRef<Record<string, number>>({});
  const [shouldRender, setShouldRender] = useState(props.pageNumber <= 3);
  const [ratio, setRatio] = useState(props.defaultRatio);
  const [draftStroke, setDraftStroke] = useState<InkStroke | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const [resolvedAutoRects, setResolvedAutoRects] = useState<Record<string, AnnotationRect[]>>({});
  const [resolvedCommentRects, setResolvedCommentRects] = useState<Record<string, AnnotationRect[]>>({});
  const [resolvedTranslationRects, setResolvedTranslationRects] = useState<Record<string, AnnotationRect[]>>({});
  const [visualRegions, setVisualRegions] = useState<VisualRegion[]>([]);
  const [visualRegionsReady, setVisualRegionsReady] = useState(false);
  const [activeVisual, setActiveVisual] = useState<{ id: string; layered: boolean } | null>(null);
  const [copiedVisualId, setCopiedVisualId] = useState<string | null>(null);
  const [visualContextMenu, setVisualContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [annotationContextMenu, setAnnotationContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [urlContextMenu, setUrlContextMenu] = useState<{ url: string; x: number; y: number } | null>(null);

  const rectRecordsEqual = (left: Record<string, AnnotationRect[]>, right: Record<string, AnnotationRect[]>) => {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => {
      const a = left[key] || [];
      const b = right[key] || [];
      return a.length === b.length && a.every((rect, index) => {
        const other = b[index];
        return other
          && rect.left === other.left
          && rect.top === other.top
          && rect.width === other.width
          && rect.height === other.height;
      });
    });
  };

  const renderHighlightedText = useCallback(
    ({ str }: { str: string }) => escapeAndHighlight(str, props.query),
    [props.query],
  );

  useEffect(() => {
    if (!shouldRender) setRatio(props.defaultRatio);
  }, [props.defaultRatio, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    modelRegionsApplied.current = false;
    operatorRegionsReady.current = false;
    modelRegionsReady.current = false;
    if (visualRegionsReadyTimer.current !== null) window.clearTimeout(visualRegionsReadyTimer.current);
    setVisualRegionsReady(false);
    let cancelled = false;
    void props.pdf.getPage(props.pageNumber)
      .then((page) => extractVisualRegions(page, props.rotation))
      .then((regions) => { if (!cancelled && !modelRegionsApplied.current) setVisualRegions(regions); })
      .catch(() => { if (!cancelled && !modelRegionsApplied.current) setVisualRegions([]); })
      .finally(() => {
        if (cancelled) return;
        operatorRegionsReady.current = true;
        if (modelRegionsReady.current) {
          visualRegionsReadyTimer.current = window.setTimeout(() => setVisualRegionsReady(true), 400);
        }
      });
    return () => {
      cancelled = true;
      if (visualRegionsReadyTimer.current !== null) window.clearTimeout(visualRegionsReadyTimer.current);
    };
  }, [props.pageNumber, props.pdf, props.rotation, shouldRender]);

  useEffect(() => {
    props.onVisualRegionsChange(
      props.pageNumber,
      visualRegions.map((region) => {
        const canonical = transformRect(region, (point) => displayPointToCanonical(point, props.rotation));
        return { ...canonical, kind: region.kind };
      }),
      visualRegionsReady,
    );
  }, [props.onVisualRegionsChange, props.pageNumber, props.rotation, visualRegions, visualRegionsReady]);

  useEffect(() => {
    setActiveVisual(null);
    setCopiedVisualId(null);
    setVisualContextMenu(null);
    setAnnotationContextMenu(null);
    setUrlContextMenu(null);
  }, [props.documentId, props.mode, props.rotation]);

  useEffect(() => {
    if (!visualContextMenu && !annotationContextMenu && !urlContextMenu) return;
    const closeMenu = () => { setVisualContextMenu(null); setAnnotationContextMenu(null); setUrlContextMenu(null); };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [annotationContextMenu, urlContextMenu, visualContextMenu]);

  useEffect(() => {
    const pageElement = pageRef.current;
    if (!pageElement || props.mode !== "select") return;
    const onLinkContextMenu = (event: Event) => {
      const mouseEvent = event as MouseEvent;
      const link = (mouseEvent.target as Element | null)?.closest<HTMLAnchorElement>(".annotationLayer a[href]");
      const url = link?.href || "";
      if (!url || url.endsWith("#") || link?.dataset.referenceNumber) return;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      setUrlContextMenu({ url, x: mouseEvent.clientX, y: mouseEvent.clientY });
    };
    pageElement.addEventListener("contextmenu", onLinkContextMenu, true);
    return () => pageElement.removeEventListener("contextmenu", onLinkContextMenu, true);
  }, [props.mode, shouldRender]);

  useEffect(() => {
    const element = pageRef.current;
    props.registerPage(props.pageNumber, element);
    return () => props.registerPage(props.pageNumber, null);
  }, [props.pageNumber, props.registerPage]);

  useEffect(() => {
    const element = pageRef.current;
    if (!element || shouldRender) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setShouldRender(true),
      { root: props.scrollRoot, rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.scrollRoot, shouldRender]);

  useEffect(() => {
    const pageElement = pageRef.current;
    if (!pageElement) return;
    let frame = 0;
    let retry = 0;
    let observedTextLayer: Element | null = null;
    const resolve = () => {
      assignCitationNumbers(pageElement, citationElementNumbers.current);
      setVisualRegions((current) => {
        const classified = classifyVisualRegions(pageElement, current);
        const tables = detectTextTableRegions(pageElement);
        const additions = tables.filter((table) => !classified.some((region) => (
          region.id === table.id
          || (region.kind === "table" && (regionContains(region, table) || regionContains(table, region)))
        )));
        // Text-table detection runs again whenever the PDF text layer mutates.
        // Remove repeated IDs and overlapping table candidates instead of
        // retaining two interactive overlays for the same table.
        const nextRegions = [...classified, ...additions].filter((region, index, all) => (
          all.findIndex((candidate) => candidate.id === region.id) === index
          && !all.slice(0, index).some((candidate) => (
            candidate.kind === "table" && region.kind === "table"
            && (regionContains(candidate, region) || regionContains(region, candidate))
          ))
        ));
        // The resolver runs from a text-layer observer. Avoid rerendering when
        // classification is unchanged, otherwise overlay updates can keep the
        // observer busy indefinitely.
        if (current.length === nextRegions.length && current.every((region, index) => (
          region.id === nextRegions[index]?.id
          && region.kind === nextRegions[index]?.kind
          && region.left === nextRegions[index]?.left
          && region.top === nextRegions[index]?.top
          && region.width === nextRegions[index]?.width
          && region.height === nextRegions[index]?.height
        ))) return current;
        return nextRegions;
      });
      const next: Record<string, AnnotationRect[]> = {};
      props.autoHighlights.forEach((item) => {
        if (item.rects?.length) {
          next[item.id] = item.rects.map((rect) => transformRect(rect, (point) => canonicalPointToDisplay(point, props.rotation)));
          return;
        }
        const displayRects = resolveQuoteRects(pageElement, item.quote);
        next[item.id] = displayRects;
        if (displayRects.length) {
          props.onAutoHighlightRectsChange(
            item.id,
            displayRects.map((rect) => transformRect(rect, (point) => displayPointToCanonical(point, props.rotation))),
          );
        }
      });
      setResolvedAutoRects((current) => rectRecordsEqual(current, next) ? current : next);
      const nextComments: Record<string, AnnotationRect[]> = {};
      props.comments.forEach((comment) => {
        nextComments[comment.id] = comment.rects?.length
          ? comment.rects.map((rect) => transformRect(rect, (point) => canonicalPointToDisplay(point, props.rotation)))
          : resolveQuoteRects(pageElement, comment.quote);
      });
      setResolvedCommentRects((current) => rectRecordsEqual(current, nextComments) ? current : nextComments);
      const nextTranslations: Record<string, AnnotationRect[]> = {};
      props.translationSegments.forEach((segment) => {
        const displayRects = segment.rects?.length
          ? segment.rects.map((rect) => transformRect(rect, (point) => canonicalPointToDisplay(point, props.rotation)))
          : resolveQuoteRects(pageElement, segment.sourceText);
        nextTranslations[segment.id] = displayRects;
        if (!segment.rects?.length && displayRects.length) {
          props.onTranslationRectsChange(
            segment.id,
            displayRects.map((rect) => transformRect(rect, (point) => displayPointToCanonical(point, props.rotation))),
          );
        }
      });
      setResolvedTranslationRects((current) => rectRecordsEqual(current, nextTranslations) ? current : nextTranslations);
    };
    const scheduleResolve = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(resolve);
    };
    const textObserver = new MutationObserver(scheduleResolve);
    const connectTextLayer = () => {
      const nextTextLayer = pageElement.querySelector(".textLayer");
      if (nextTextLayer === observedTextLayer) return;
      textObserver.disconnect();
      observedTextLayer = nextTextLayer;
      if (nextTextLayer) {
        textObserver.observe(nextTextLayer, { childList: true, subtree: true });
        scheduleResolve();
      }
    };
    const layerObserver = new MutationObserver(connectTextLayer);
    // Only watch direct children while react-pdf mounts the text layer. The
    // previous subtree observer also saw our annotation/translation overlays,
    // causing a render -> mutation -> render loop.
    layerObserver.observe(pageElement, { childList: true });
    connectTextLayer();
    if (observedTextLayer) layerObserver.disconnect();
    retry = window.setTimeout(scheduleResolve, 350);
    return () => {
      layerObserver.disconnect();
      textObserver.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
    };
  }, [props.autoHighlights, props.comments, props.onTranslationRectsChange, props.rotation, props.translationSegments, shouldRender]);

  useEffect(() => {
    if (!Object.keys(props.citationDestinationNumbers).length) return;
    let cancelled = false;
    void props.pdf.getPage(props.pageNumber).then((page) => page.getAnnotations()).then((annotations) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      annotations.forEach((annotation) => {
        const destination = typeof annotation.dest === "string" ? annotation.dest : "";
        const number = props.citationDestinationNumbers[destination];
        if (annotation.id && number) next[annotation.id] = number;
      });
      citationElementNumbers.current = next;
      const pageElement = pageRef.current;
      if (pageElement) assignCitationNumbers(pageElement, next);
    }).catch(() => {
      citationElementNumbers.current = {};
    });
    return () => { cancelled = true; };
  }, [props.citationDestinationNumbers, props.pageNumber, props.pdf]);

  useEffect(() => {
    const clearSelecting = () => pageRef.current?.querySelector(".textLayer")?.classList.remove("selecting");
    document.addEventListener("pointerup", clearSelecting);
    document.addEventListener("pointercancel", clearSelecting);
    window.addEventListener("blur", clearSelecting);
    return () => {
      document.removeEventListener("pointerup", clearSelecting);
      document.removeEventListener("pointercancel", clearSelecting);
      window.removeEventListener("blur", clearSelecting);
    };
  }, []);

  const handlePageLoad = (page: PDFPageProxy) => {
    const viewport = page.getViewport({ scale: 1, rotation: props.rotation });
    setRatio(viewport.height / viewport.width);
  };

  const handlePageRendered = () => {
    const pageElement = pageRef.current;
    const canvas = pageElement?.querySelector<HTMLCanvasElement>(".react-pdf__Page__canvas");
    if (!canvas) return;
    const detectionKey = `${props.documentId}:${props.pageNumber}:${props.rotation}`;
    if (modelDetectionKey.current === detectionKey) return;
    modelDetectionKey.current = detectionKey;
    void detectLayoutModel(canvas, props.documentId, props.pageNumber, props.rotation).then((regions) => {
      if (regions.length && pageRef.current) {
        modelRegionsApplied.current = true;
        setVisualRegions(classifyVisualRegions(pageRef.current, regions));
      }
    }).catch(() => {
      // Local PDF drawing and text heuristics remain available if ONNX inference fails.
    }).finally(() => {
      modelRegionsReady.current = true;
      if (operatorRegionsReady.current) {
        visualRegionsReadyTimer.current = window.setTimeout(() => setVisualRegionsReady(true), 400);
      }
    });
  };

  const handleSelection = () => {
    if (props.mode !== "select") return;
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      const pageElement = pageRef.current;
      pageElement?.querySelector(".textLayer")?.classList.remove("selecting");
      if (!selection || selection.isCollapsed || !pageElement) return props.onSelection(null);
      const quote = selection.toString().trim();
      if (!quote) return props.onSelection(null);

      const range = selection.getRangeAt(0);
      const textLayer = pageElement.querySelector(".textLayer");
      let contextBefore = "";
      let contextAfter = "";
      if (textLayer?.contains(range.startContainer) && textLayer.contains(range.endContainer)) {
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(textLayer);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        contextBefore = beforeRange.toString().trim().slice(-SELECTION_CONTEXT_LENGTH);
        beforeRange.detach();
        const afterRange = document.createRange();
        afterRange.selectNodeContents(textLayer);
        afterRange.setStart(range.endContainer, range.endOffset);
        contextAfter = afterRange.toString().trim().slice(0, SELECTION_CONTEXT_LENGTH);
        afterRange.detach();
      }
      const pageBounds = pageElement.getBoundingClientRect();
      const clientRects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 1 && rect.height > 1 && rect.bottom >= pageBounds.top && rect.top <= pageBounds.bottom,
      );
      if (!clientRects.length) return props.onSelection(null);

      const rects = clientRects.map((rect) => transformRect({
        left: Math.max(0, (rect.left - pageBounds.left) / pageBounds.width),
        top: Math.max(0, (rect.top - pageBounds.top) / pageBounds.height),
        width: Math.min(1, rect.width / pageBounds.width),
        height: Math.min(1, rect.height / pageBounds.height),
      }, (point) => displayPointToCanonical(point, props.rotation)));
      const last = clientRects[clientRects.length - 1];
      const workspaceBounds = props.scrollRoot?.getBoundingClientRect();
      const boundaryLeft = workspaceBounds?.left ?? 0;
      const boundaryRight = workspaceBounds?.right ?? window.innerWidth;
      const boundaryTop = workspaceBounds?.top ?? 0;
      const boundaryBottom = workspaceBounds?.bottom ?? window.innerHeight;
      const preferredX = last.right + 10;
      const clientX = preferredX + SELECTION_MENU_WIDTH <= boundaryRight - 12
        ? preferredX
        : Math.max(boundaryLeft + 12, last.left - SELECTION_MENU_WIDTH - 10);
      const preferredY = last.bottom + 8;
      const clientY = preferredY + SELECTION_MENU_HEIGHT <= boundaryBottom - 12
        ? preferredY
        : Math.max(boundaryTop + 12, last.top - SELECTION_MENU_HEIGHT - 8);
      props.onSelection({
        pageNumber: props.pageNumber,
        quote,
        contextBefore,
        contextAfter,
        rects,
        clientX,
        clientY,
      });
    });
  };

  const handlePageClick = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest("a") : null;
    if (!target || target.getAttribute("href") !== "#") return;
    const storedReferenceNumber = Number.parseInt((target as HTMLElement).dataset.referenceNumber || "", 10);
    if (Number.isFinite(storedReferenceNumber)) {
      event.preventDefault();
      event.stopPropagation();
      props.onCitationSelect(storedReferenceNumber);
      return;
    }
    const targetBounds = target.getBoundingClientRect();
    const targetCenter = { x: targetBounds.left + targetBounds.width / 2, y: targetBounds.top + targetBounds.height / 2 };
    const candidates: Array<{ value: number; distance: number }> = [];
    pageRef.current?.querySelectorAll(".textLayer span").forEach((span) => {
      const bounds = span.getBoundingClientRect();
      if (bounds.left >= targetBounds.right || bounds.right <= targetBounds.left || bounds.top >= targetBounds.bottom || bounds.bottom <= targetBounds.top) return;
      const node = Array.from(span.childNodes).find((child): child is Text => child.nodeType === Node.TEXT_NODE);
      const text = node?.textContent || "";
      for (const match of text.matchAll(/\d{1,3}/g)) {
        if (!node || match.index === undefined) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        range.detach();
        candidates.push({
          value: Number.parseInt(match[0], 10),
          distance: Math.hypot(rect.left + rect.width / 2 - targetCenter.x, rect.top + rect.height / 2 - targetCenter.y),
        });
      }
    });
    const referenceNumber = candidates.sort((left, right) => left.distance - right.distance)[0]?.value;
    if (!Number.isFinite(referenceNumber)) return;
    event.preventDefault();
    event.stopPropagation();
    props.onCitationSelect(referenceNumber);
  };

  const translationAtPoint = (event: React.MouseEvent<HTMLElement>): TranslationSegment | undefined => {
    if (props.mode !== "select" || !(event.target instanceof Element) || !event.target.closest(".textLayer")) return undefined;
    const bounds = pageRef.current?.getBoundingClientRect();
    if (!bounds) return undefined;
    const point = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
    return props.translationSegments.find((segment) => (resolvedTranslationRects[segment.id] || []).some((rect) => (
      point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height
    )));
  };

  const handleTranslationHover = (event: React.MouseEvent<HTMLElement>) => {
    const segment = translationAtPoint(event);
    if (segment) props.onTranslationSegmentActivate(segment, false);
  };

  const handleTranslationClick = (event: React.MouseEvent<HTMLElement>) => {
    const segment = translationAtPoint(event);
    if (segment) props.onTranslationSegmentActivate(segment, true);
  };

  useEffect(() => {
    const pageElement = pageRef.current;
    if (!pageElement) return;
    const onClick = (event: MouseEvent) => handlePageClick(event);
    pageElement.addEventListener("click", onClick, true);
    return () => pageElement.removeEventListener("click", onClick, true);
  });

  const eraseAt = (point: InkPoint) => {
    const canonicalPoint = displayPointToCanonical(point, props.rotation);
    const candidates = props.ink
      .filter((stroke) => !erasedDuringGesture.current.has(stroke.id))
      .map((stroke) => ({ stroke, distance: strokeDistance(canonicalPoint, stroke) }))
      .filter(({ stroke, distance }) => distance <= Math.max(0.008, (stroke.width + 7) / props.width))
      .sort((left, right) => left.distance - right.distance);
    const target = candidates[0]?.stroke;
    if (target) {
      erasedDuringGesture.current.add(target.id);
      props.onEraseInk(target.id);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pageRef.current) return;
    if (props.mode === "select") {
      const point = pointFromEvent(event, pageRef.current);
      const textTarget = event.target instanceof Element
        ? event.target.closest(".textLayer span, .textLayer br")
        : null;
      // Layout-model regions are visual metadata. They must never sit on top
      // of selectable PDF text. Activate a region only when the pointer is in
      // its non-text part; dragging from a text span stays a native selection.
      if (!textTarget) {
        const hitRegion = visualRegions.find((region) => (
          point.x >= region.left && point.x <= region.left + region.width
          && point.y >= region.top && point.y <= region.top + region.height
        ));
        if (hitRegion) {
          setActiveVisual({ id: hitRegion.id, layered: false });
          setVisualContextMenu(null);
          return;
        }
      }
      const activeRegion = visualRegions.find((region) => region.id === activeVisual?.id);
      const insideActive = activeRegion
        && point.x >= activeRegion.left && point.x <= activeRegion.left + activeRegion.width
        && point.y >= activeRegion.top && point.y <= activeRegion.top + activeRegion.height;
      if (!insideActive) setActiveVisual(null);
      setVisualContextMenu(null);
      if (event.button === 0) pageRef.current.querySelector(".textLayer")?.classList.add("selecting");
      return;
    }
    if (!["draw", "erase", "image"].includes(props.mode)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event, pageRef.current);
    erasedDuringGesture.current.clear();
    if (props.mode === "draw") {
      setDraftStroke({
        id: crypto.randomUUID(),
        documentId: props.documentId,
        pageNumber: props.pageNumber,
        color: props.inkColor,
        width: props.inkWidth,
        points: [displayPointToCanonical(point, props.rotation)],
        createdAt: new Date().toISOString(),
      });
    } else if (props.mode === "erase") {
      eraseAt(point);
    } else {
      setDragRect({ start: point, current: point });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pageRef.current || event.buttons !== 1) return;
    const point = pointFromEvent(event, pageRef.current);
    if (props.mode === "draw" && draftStroke) {
      const canonicalPoint = displayPointToCanonical(point, props.rotation);
      const previous = draftStroke.points[draftStroke.points.length - 1];
      if (Math.hypot(canonicalPoint.x - previous.x, canonicalPoint.y - previous.y) > 0.0015) {
        setDraftStroke({ ...draftStroke, points: [...draftStroke.points, canonicalPoint] });
      }
    } else if (props.mode === "erase") {
      eraseAt(point);
    } else if (props.mode === "image" && dragRect) {
      setDragRect({ ...dragRect, current: point });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (draftStroke) {
      const stroke = draftStroke.points.length === 1
        ? { ...draftStroke, points: [...draftStroke.points, { x: draftStroke.points[0].x + 0.0001, y: draftStroke.points[0].y + 0.0001 }] }
        : draftStroke;
      props.onAddInk(stroke);
      setDraftStroke(null);
    }
    if (dragRect && pageRef.current) {
      const capture = captureCanvasRegion(pageRef.current, props.pageNumber, dragRect);
      setDragRect(null);
      if (capture) {
        props.onImageCapture(capture);
        props.onModeChange("select");
      }
    }
    erasedDuringGesture.current.clear();
  };

  const visibleStrokes = draftStroke ? [...props.ink, draftStroke] : props.ink;
  const selectionBounds = dragRect ? {
    left: `${Math.min(dragRect.start.x, dragRect.current.x) * 100}%`,
    top: `${Math.min(dragRect.start.y, dragRect.current.y) * 100}%`,
    width: `${Math.abs(dragRect.current.x - dragRect.start.x) * 100}%`,
    height: `${Math.abs(dragRect.current.y - dragRect.start.y) * 100}%`,
  } : null;

  const copyVisualRegion = useCallback(async (region: VisualRegion) => {
    const pageElement = pageRef.current;
    if (!pageElement) return;
    const capture = captureCanvasRegion(pageElement, props.pageNumber, {
      start: { x: region.left, y: region.top },
      current: { x: region.left + region.width, y: region.top + region.height },
    });
    if (!capture) return;
    try {
      if (region.kind !== "image" && region.sourceText) await navigator.clipboard.writeText(region.sourceText);
      else await copyImageCapture(capture);
      setCopiedVisualId(region.id);
      window.setTimeout(() => setCopiedVisualId((current) => current === region.id ? null : current), 1400);
    } catch {
      setCopiedVisualId(null);
    }
  }, [props.pageNumber]);

  const runVisualAction = useCallback((action: SelectionAction | "highlight", region: VisualRegion) => {
    const pageElement = pageRef.current;
    if (!pageElement) return;
    const capture = captureCanvasRegion(pageElement, props.pageNumber, {
      start: { x: region.left, y: region.top },
      current: { x: region.left + region.width, y: region.top + region.height },
    });
    if (!capture) return;
    capture.sourceType = region.kind;
    capture.sourceText = region.sourceText;
    const canonicalRect = transformRect(region, (point) => displayPointToCanonical(point, props.rotation));
    const sourceLabel = { image: "图片", table: "表格", formula: "公式" }[region.kind];
    props.onVisualAction(action, capture, {
      pageNumber: props.pageNumber,
      quote: region.sourceText || `第 ${props.pageNumber} 页${sourceLabel}`,
      contextBefore: "",
      contextAfter: "",
      rects: [canonicalRect],
      clientX: visualContextMenu?.x ?? 0,
      clientY: visualContextMenu?.y ?? 0,
    });
    setVisualContextMenu(null);
  }, [props, visualContextMenu]);

  useEffect(() => {
    if (!activeVisual || activeVisual.layered || props.mode !== "select") return;
    const onCopy = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "c") return;
      const region = visualRegions.find((item) => item.id === activeVisual.id);
      if (!region) return;
      event.preventDefault();
      void copyVisualRegion(region);
    };
    window.addEventListener("keydown", onCopy);
    return () => window.removeEventListener("keydown", onCopy);
  }, [activeVisual, copyVisualRegion, props.mode, visualRegions]);

  return (
    <div
      ref={pageRef}
      className={`pdf-page mode-${props.mode}`}
      data-page-number={props.pageNumber}
      style={{ width: props.width, minHeight: props.width * ratio }}
      onMouseUp={handleSelection}
      onMouseMove={handleTranslationHover}
      onClick={handleTranslationClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(event) => {
        if (props.mode !== "select" || !pageRef.current || visualContextMenu) return;
        const bounds = pageRef.current.getBoundingClientRect();
        const displayPoint = {
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
        };
        const canonicalPoint = displayPointToCanonical(displayPoint, props.rotation);
        const visualRegion = visualRegions.find((region) => (
          displayPoint.x >= region.left && displayPoint.x <= region.left + region.width
          && displayPoint.y >= region.top && displayPoint.y <= region.top + region.height
        ));
        const textTarget = event.target instanceof Element
          ? event.target.closest(".textLayer span, .textLayer br")
          : null;
        if (visualRegion && !textTarget) {
          event.preventDefault();
          event.stopPropagation();
          window.getSelection()?.removeAllRanges();
          props.onSelection(null);
          setActiveVisual({ id: visualRegion.id, layered: false });
          setVisualContextMenu({ id: visualRegion.id, x: event.clientX, y: event.clientY });
          return;
        }
        const annotation = [...props.annotations].reverse().find((item) => item.type === "highlight" && item.rects.some((rect) => (
          canonicalPoint.x >= rect.left && canonicalPoint.x <= rect.left + rect.width
          && canonicalPoint.y >= rect.top && canonicalPoint.y <= rect.top + rect.height
        )));
        if (!annotation) return;
        event.preventDefault();
        event.stopPropagation();
        window.getSelection()?.removeAllRanges();
        props.onSelection(null);
        setAnnotationContextMenu({ id: annotation.id, x: event.clientX, y: event.clientY });
      }}
    >
      {shouldRender ? (
        <Page
          pdf={props.pdf}
          pageNumber={props.pageNumber}
          width={props.width}
          rotate={props.rotation}
          onLoadSuccess={handlePageLoad}
          onRenderSuccess={handlePageRendered}
          loading={<div className="page-loading">正在渲染第 {props.pageNumber} 页</div>}
          customTextRenderer={renderHighlightedText}
          renderAnnotationLayer
          renderTextLayer
          devicePixelRatio={Math.min(window.devicePixelRatio || 1, 2)}
        />
      ) : (
        <div className="page-placeholder">{props.pageNumber}</div>
      )}
      <div className="annotation-layer" aria-hidden="true">
        {props.annotations.flatMap((annotation) => annotation.rects.map((sourceRect, index) => {
          const rect = transformRect(sourceRect, (point) => canonicalPointToDisplay(point, props.rotation));
          return (
          <span
            className={`annotation-mark color-${annotation.color}`}
            key={`${annotation.id}-${index}`}
            style={{ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
          />
          );
        }))}
        {props.autoHighlights.flatMap((item) => (resolvedAutoRects[item.id] || []).map((rect, index) => (
          <span
            className={`annotation-mark auto-highlight-mark category-${item.category}`}
            key={`${item.id}-${index}`}
            style={{ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
          >
            {index === 0 && props.showAutoHighlightLabels && <span className="auto-highlight-label">{{ novelty: "独创性", methods: "方法", results: "结果" }[item.category]}</span>}
          </span>
        )))}
        {props.comments.filter((comment) => !comment.resolved).flatMap((comment) => (resolvedCommentRects[comment.id] || []).map((rect, index) => (
          <span className="comment-anchor-mark" key={`${comment.id}-${index}`} style={{ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />
        )))}
      </div>
      <svg className={`ink-layer ${["draw", "erase"].includes(props.mode) ? "is-interactive" : ""}`} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {visibleStrokes.map((stroke) => (
          <polyline
            key={stroke.id}
            points={stroke.points.map((point) => canonicalPointToDisplay(point, props.rotation)).map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {props.mode === "select" && visualRegions.map((region) => {
        const isActive = activeVisual?.id === region.id;
        const isLayered = isActive && activeVisual.layered;
        return (
          <div
            key={region.id}
            className={`pdf-visual-region ${isActive ? "is-active" : ""} ${isLayered ? "is-layered" : ""}`}
            style={{ left: `${region.left * 100}%`, top: `${region.top * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
            role="img"
            aria-label={`第 ${props.pageNumber} 页${{ image: "图片", table: "表格", formula: "公式" }[region.kind]}区域`}
            onPointerDown={(event) => {
              if (isLayered) return;
              event.preventDefault();
              event.stopPropagation();
              window.getSelection()?.removeAllRanges();
              props.onSelection(null);
              setActiveVisual({ id: region.id, layered: false });
            }}
            onContextMenu={(event) => {
              if (isLayered || !pageRef.current) return;
              event.preventDefault();
              event.stopPropagation();
              window.getSelection()?.removeAllRanges();
              props.onSelection(null);
              setActiveVisual({ id: region.id, layered: false });
              setVisualContextMenu({ id: region.id, x: event.clientX, y: event.clientY });
            }}
          >
            {isActive && (
              <div className="pdf-visual-actions" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}>
                <button type="button" title={region.kind === "image" ? "复制图片" : `复制${region.kind === "table" ? "表格" : "公式"}文本`} aria-label="复制内容" onClick={() => void copyVisualRegion(region)}>
                  {copiedVisualId === region.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  title={isLayered ? "按图片查看" : "切换为可选文字"}
                  aria-label={isLayered ? "按图片查看" : "切换为可选文字"}
                  onClick={() => {
                    window.getSelection()?.removeAllRanges();
                    setActiveVisual({ id: region.id, layered: !isLayered });
                  }}
                >
                  {isLayered ? <ImageIcon size={14} /> : <ScanText size={14} />}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {visualContextMenu && (() => {
        const region = visualRegions.find((item) => item.id === visualContextMenu.id);
        if (!region) return null;
        const canonicalRegion = transformRect(region, (point) => displayPointToCanonical(point, props.rotation));
        const visualHighlight = props.annotations.find((annotation) => annotation.type === "highlight" && annotation.rects.some(
          (rect) => regionContains(rect, canonicalRegion) || regionContains(canonicalRegion, rect),
        ));
        return (
          <div
            className="selection-toolbar pdf-image-selection-toolbar"
            style={{ left: visualContextMenu.x, top: visualContextMenu.y }}
            role="menu"
            aria-label={`所选${{ image: "图片", table: "表格", formula: "公式" }[region.kind]}操作`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runVisualAction("explain", region)}>
              <img src={explanationIcon} alt="" />
              <span>解释</span><kbd>E</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className="selection-menu-row"
              onClick={() => {
                if (visualHighlight) {
                  props.onDeleteAnnotation(visualHighlight.id);
                  setVisualContextMenu(null);
                } else {
                  runVisualAction("highlight", region);
                }
              }}
            >
              <img src={highlightToolbarIcon} alt="" />
              <span>{visualHighlight ? "取消高亮" : "高亮"}</span><kbd>H</kbd>
            </button>
            <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runVisualAction("translate", region)}>
              <img src={translationIcon} alt="" />
              <span>翻译</span><kbd>T</kbd>
            </button>
            <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runVisualAction("comment", region)}>
              <img src={commentIcon} alt="" />
              <span>评论</span><kbd>C</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className="selection-menu-row"
              onClick={() => runVisualAction("ask-ai", region)}
            >
              <img src={aiChatIcon} alt="" />
              <span>向AI提问</span><kbd>Enter</kbd>
            </button>
          </div>
        );
      })()}
      {annotationContextMenu && (() => {
        const annotation = props.annotations.find((item) => item.id === annotationContextMenu.id);
        if (!annotation) return null;
        const runAction = (action: SelectionAction) => {
          props.onAnnotationAction(action, annotation, annotationContextMenu.x, annotationContextMenu.y);
          setAnnotationContextMenu(null);
        };
        return (
          <div className="selection-toolbar" role="menu" aria-label="已高亮文字操作" style={{ left: annotationContextMenu.x, top: annotationContextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runAction("explain")}><img src={explanationIcon} alt="" /><span>解释</span><kbd>E</kbd></button>
            <button type="button" role="menuitem" className="selection-menu-row" onClick={() => { props.onDeleteAnnotation(annotation.id); setAnnotationContextMenu(null); }}><img src={highlightToolbarIcon} alt="" /><span>取消高亮</span><kbd>H</kbd></button>
            <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runAction("translate")}><img src={translationIcon} alt="" /><span>翻译</span><kbd>T</kbd></button>
            <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runAction("comment")}><img src={commentIcon} alt="" /><span>评论</span><kbd>C</kbd></button>
            <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runAction("ask-ai")}><img src={aiChatIcon} alt="" /><span>向AI提问</span><kbd>Enter</kbd></button>
          </div>
        );
      })()}
      {urlContextMenu && <div className="selection-toolbar" role="menu" aria-label="链接操作" style={{ left: urlContextMenu.x, top: urlContextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" className="selection-menu-row" onClick={() => { props.onUrlAction(urlContextMenu.url, urlContextMenu.x, urlContextMenu.y); setUrlContextMenu(null); }}><img src={explanationIcon} alt="" /><span>解释链接</span><kbd>E</kbd></button>
        <button type="button" role="menuitem" className="selection-menu-row" onClick={() => void navigator.clipboard.writeText(urlContextMenu.url)}><Copy size={14} /><span>复制链接</span><kbd>⌘C</kbd></button>
      </div>}
      {selectionBounds && <div className="image-selection-box" style={selectionBounds} />}
      <span className="page-number-badge">{props.pageNumber}</span>
    </div>
  );
}

function loadInkPreferences(): { color: string; width: number } {
  try {
    const value = JSON.parse(readBrandedStorage(INK_PREFERENCES_KEY) || "{}") as { color?: string; width?: number };
    return {
      color: value.color && INK_COLORS.includes(value.color) ? value.color : INK_COLORS[0],
      width: value.width && INK_WIDTHS.includes(value.width) ? value.width : INK_WIDTHS[1],
    };
  } catch {
    return { color: INK_COLORS[0], width: INK_WIDTHS[1] };
  }
}

export function PdfWorkspace(props: PdfWorkspaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageElements = useRef(new Map<number, HTMLDivElement>());
  const undoStack = useRef<InkStroke[][]>([]);
  const redoStack = useRef<InkStroke[][]>([]);
  const panState = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [baseWidth, setBaseWidth] = useState(760);
  const [defaultRatio, setDefaultRatio] = useState(1.414);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [color, setColor] = useState<HighlightColor>("yellow");
  const [inkPreferences, setInkPreferences] = useState(loadInkPreferences);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [citationDestinationNumbers, setCitationDestinationNumbers] = useState<Record<string, number>>({});
  const pageWidth = Math.round(baseWidth * props.zoom);

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, Annotation[]>();
    props.annotations.forEach((annotation) => grouped.set(annotation.pageNumber, [...(grouped.get(annotation.pageNumber) || []), annotation]));
    return grouped;
  }, [props.annotations]);

  const autoHighlightsByPage = useMemo(() => {
    const grouped = new Map<number, AutoHighlight[]>();
    props.autoHighlights.forEach((item) => grouped.set(item.pageNumber, [...(grouped.get(item.pageNumber) || []), item]));
    return grouped;
  }, [props.autoHighlights]);

  const inkByPage = useMemo(() => {
    const grouped = new Map<number, InkStroke[]>();
    props.ink.forEach((stroke) => grouped.set(stroke.pageNumber, [...(grouped.get(stroke.pageNumber) || []), stroke]));
    return grouped;
  }, [props.ink]);

  const translationsByPage = useMemo(() => {
    const grouped = new Map<number, TranslationSegment[]>();
    props.translations.forEach((translation) => {
      if (!translation.segments?.length) return;
      grouped.set(translation.pageNumber, translation.segments);
    });
    return grouped;
  }, [props.translations]);

  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    setHistoryRevision((revision) => revision + 1);
  }, [props.documentId]);

  useEffect(() => {
    let cancelled = false;
    setCitationDestinationNumbers({});
    void props.pdf.getDestinations().then(async (destinations) => {
      const locations = await Promise.all(Object.entries(destinations).flatMap(([name, destination]) => {
        if (!/^(?:cite|bib(?:liography)?)[.:]/i.test(name) || !destination?.length) return [];
        return [Promise.resolve().then(async () => {
          const pageIndex = typeof destination[0] === "number" ? destination[0] : await props.pdf.getPageIndex(destination[0]);
          return { name, pageIndex, top: Number(destination[3]) || 0 };
        }).catch(() => null)];
      }));
      if (cancelled) return;
      const ordered = locations
        .filter((item): item is { name: string; pageIndex: number; top: number } => Boolean(item))
        .sort((left, right) => left.pageIndex - right.pageIndex || right.top - left.top);
      setCitationDestinationNumbers(Object.fromEntries(ordered.map((item, index) => [item.name, index + 1])));
    }).catch(() => {
      if (!cancelled) setCitationDestinationNumbers({});
    });
    return () => { cancelled = true; };
  }, [props.documentId, props.pdf]);

  useEffect(() => {
    let cancelled = false;
    void props.pdf.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1, rotation: props.rotation });
      if (!cancelled) setDefaultRatio(viewport.height / viewport.width);
    });
    return () => { cancelled = true; };
  }, [props.pdf, props.rotation]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const updateWidth = () => setBaseWidth(Math.min(920, Math.max(420, root.clientWidth - 72)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => ratios.set(Number((entry.target as HTMLElement).dataset.pageNumber), entry.intersectionRatio));
      let bestPage = 1;
      let bestRatio = 0;
      ratios.forEach((ratio, page) => {
        if (ratio > bestRatio) { bestRatio = ratio; bestPage = page; }
      });
      if (bestRatio > 0) props.onCurrentPageChange(bestPage);
    }, { root, threshold: [0, 0.1, 0.25, 0.5, 0.75] });
    pageElements.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [props.pageCount, props.onCurrentPageChange]);

  useEffect(() => {
    pageElements.current.get(props.targetPage)?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [props.targetPage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z" || !["draw", "erase"].includes(props.mode)) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const registerPage = useMemo(() => (pageNumber: number, element: HTMLDivElement | null) => {
    if (element) pageElements.current.set(pageNumber, element);
    else pageElements.current.delete(pageNumber);
  }, []);

  const updateSelection = (next: TextSelection | null) => {
    setSelection(next);
  };

  const createAnnotation = (type: "highlight" | "note") => {
    if (!selection) return;
    props.onCreateAnnotation(selection, type, color);
    window.getSelection()?.removeAllRanges();
    updateSelection(null);
  };

  const runSelectionAction = useCallback((action: SelectionAction) => {
    if (!selection) return;
    props.onSelectionAction(action, selection);
    window.getSelection()?.removeAllRanges();
    updateSelection(null);
  }, [props, selection]);

  useEffect(() => {
    if (!selection) return;
    const onSelectionShortcut = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const action = event.key === "Enter"
        ? "ask-ai"
        : ({ e: "explain", t: "translate", c: "comment" } as const)[event.key.toLocaleLowerCase() as "e" | "t" | "c"];
      if (event.key.toLocaleLowerCase() === "h") {
        event.preventDefault();
        createAnnotation("highlight");
      } else if (action) {
        event.preventDefault();
        runSelectionAction(action);
      } else if (event.key === "Escape") {
        window.getSelection()?.removeAllRanges();
        updateSelection(null);
      }
    };
    window.addEventListener("keydown", onSelectionShortcut);
    return () => window.removeEventListener("keydown", onSelectionShortcut);
  }, [runSelectionAction, selection]);

  const commitInk = (next: InkStroke[]) => {
    undoStack.current = [...undoStack.current.slice(-29), props.ink];
    redoStack.current = [];
    props.onInkChange(next);
    setHistoryRevision((revision) => revision + 1);
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(props.ink);
    props.onInkChange(previous);
    setHistoryRevision((revision) => revision + 1);
  };

  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(props.ink);
    props.onInkChange(next);
    setHistoryRevision((revision) => revision + 1);
  };

  const saveInkPreferences = (next: { color: string; width: number }) => {
    setInkPreferences(next);
    localStorage.setItem(INK_PREFERENCES_KEY, JSON.stringify(next));
  };

  const onPanPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const root = scrollRef.current;
    if (props.mode !== "pan" || !root) return;
    event.preventDefault();
    root.setPointerCapture(event.pointerId);
    panState.current = { x: event.clientX, y: event.clientY, left: root.scrollLeft, top: root.scrollTop };
  };

  const onPanPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const root = scrollRef.current;
    if (!root || !panState.current || props.mode !== "pan") return;
    root.scrollLeft = panState.current.left - (event.clientX - panState.current.x);
    root.scrollTop = panState.current.top - (event.clientY - panState.current.y);
  };

  const stopPan = (event: React.PointerEvent<HTMLElement>) => {
    const root = scrollRef.current;
    if (root?.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    panState.current = null;
  };

  return (
    <section
      className={`pdf-workspace mode-${props.mode}`}
      ref={scrollRef}
      onWheel={() => selection && updateSelection(null)}
      onPointerDown={onPanPointerDown}
      onPointerMove={onPanPointerMove}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
    >
      <div className="pages-stack" style={{ minWidth: pageWidth + 72 }}>
        {Array.from({ length: props.pageCount }, (_, index) => index + 1).map((pageNumber) => (
          <ReaderPage
            key={pageNumber}
            documentId={props.documentId}
            pdf={props.pdf}
            pageNumber={pageNumber}
            width={pageWidth}
            rotation={props.rotation}
            defaultRatio={defaultRatio}
            scrollRoot={scrollRef.current}
            query={props.searchQuery}
            annotations={annotationsByPage.get(pageNumber) || []}
            comments={props.comments.filter((comment) => comment.pageNumber === pageNumber)}
            autoHighlights={autoHighlightsByPage.get(pageNumber) || []}
            showAutoHighlightLabels={props.showAutoHighlightLabels}
            ink={inkByPage.get(pageNumber) || []}
            mode={props.mode}
            inkColor={inkPreferences.color}
            inkWidth={inkPreferences.width}
            citationDestinationNumbers={citationDestinationNumbers}
            registerPage={registerPage}
            onSelection={updateSelection}
            onAddInk={(stroke) => commitInk([...props.ink, stroke])}
            onEraseInk={(strokeId) => commitInk(props.ink.filter((stroke) => stroke.id !== strokeId))}
            onAutoHighlightRectsChange={props.onAutoHighlightRectsChange}
            onCitationSelect={props.onCitationSelect}
            onImageCapture={props.onImageCapture}
            onVisualAction={(action, capture, visualSelection) => {
              if (action === "highlight") {
                props.onCreateAnnotation(visualSelection, "highlight", color);
                return;
              }
              props.onImageCapture({ ...capture, intent: action });
              if (action === "comment" || action === "ask-ai") props.onSelectionAction(action, visualSelection);
            }}
            onAnnotationAction={(action, annotation, clientX, clientY) => props.onSelectionAction(action, {
              pageNumber: annotation.pageNumber,
              quote: annotation.quote,
              contextBefore: "",
              contextAfter: "",
              rects: annotation.rects,
              clientX,
              clientY,
            })}
            onUrlAction={(url, clientX, clientY) => props.onSelectionAction("explain", {
              pageNumber,
              quote: url,
              contextBefore: "",
              contextAfter: "",
              rects: [],
              clientX,
              clientY,
              sourceType: "url",
            })}
            onDeleteAnnotation={props.onDeleteAnnotation}
            onModeChange={props.onModeChange}
            translationSegments={translationsByPage.get(pageNumber) || []}
            activeTranslationSegmentId={props.activeTranslationSegmentId}
            onTranslationSegmentActivate={props.onTranslationSegmentActivate}
            onTranslationRectsChange={props.onTranslationRectsChange}
            onVisualRegionsChange={props.onVisualRegionsChange}
          />
        ))}
      </div>

      {selection && (
        <div
          className="selection-toolbar"
          role="menu"
          aria-label="所选文字操作"
          style={{ left: selection.clientX, top: selection.clientY }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runSelectionAction("explain")}>
            <img src={explanationIcon} alt="" />
            <span>解释</span><kbd>E</kbd>
          </button>
          <div className="selection-highlight-row">
            <button type="button" role="menuitem" className="selection-highlight-trigger" onClick={() => createAnnotation("highlight")}>
              <img src={highlightToolbarIcon} alt="" />
              <span>高亮</span><i className={`selection-color-indicator color-${color}`} />
            </button>
            <div className="selection-inline-palette" aria-label="高亮颜色">
              {(Object.keys(COLOR_LABELS) as HighlightColor[]).filter((item) => item !== color).map((item) => (
                <button type="button" key={item} className={`color-swatch color-${item}`} aria-label={`${COLOR_LABELS[item]}高亮`} title={`${COLOR_LABELS[item]}高亮`} onClick={() => setColor(item)} />
              ))}
            </div>
            <kbd>H</kbd>
          </div>
          <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runSelectionAction("translate")}>
            <img src={translationIcon} alt="" />
            <span>翻译</span><kbd>T</kbd>
          </button>
          <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runSelectionAction("comment")}>
            <img src={commentIcon} alt="" />
            <span>评论</span><kbd>C</kbd>
          </button>
          <button type="button" role="menuitem" className="selection-menu-row" onClick={() => runSelectionAction("ask-ai")}>
            <img src={aiChatIcon} alt="" />
            <span>向AI提问</span><kbd>Enter</kbd>
          </button>
        </div>
      )}

      {["draw", "erase"].includes(props.mode) && (
        <div className="ink-toolbar" data-history-revision={historyRevision}>
          <div className="ink-colors" aria-label="画笔颜色">
            {INK_COLORS.map((inkColor) => (
              <button
                type="button"
                key={inkColor}
                className={inkPreferences.color === inkColor && props.mode === "draw" ? "is-selected" : ""}
                style={{ backgroundColor: inkColor }}
                aria-label={`画笔颜色 ${inkColor}`}
                title={`画笔颜色 ${inkColor}`}
                onClick={() => { saveInkPreferences({ ...inkPreferences, color: inkColor }); props.onModeChange("draw"); }}
              />
            ))}
          </div>
          <span className="ink-divider" />
          <div className="ink-widths" aria-label="画笔粗细">
            {INK_WIDTHS.map((width) => (
              <button type="button" key={width} className={inkPreferences.width === width ? "is-selected" : ""} aria-label={`笔宽 ${width}`} title={`笔宽 ${width}`} onClick={() => saveInkPreferences({ ...inkPreferences, width })}>
                <span style={{ width: Math.max(3, width), height: Math.max(3, width) }} />
              </button>
            ))}
          </div>
          <span className="ink-divider" />
          <IconButton label="橡皮擦" active={props.mode === "erase"} onClick={() => props.onModeChange(props.mode === "erase" ? "draw" : "erase")}><Eraser size={16} /></IconButton>
          <IconButton label="撤销" disabled={!undoStack.current.length} onClick={undo}><Undo2 size={16} /></IconButton>
          <IconButton label="重做" disabled={!redoStack.current.length} onClick={redo}><Redo2 size={16} /></IconButton>
          <IconButton label="清空所有笔迹" disabled={!props.ink.length} onClick={() => {
            if (window.confirm("确定清空这篇论文的所有手写笔迹吗？")) commitInk([]);
          }}><Trash2 size={16} /></IconButton>
          <span className="ink-divider" />
          <IconButton label="关闭画笔" onClick={() => props.onModeChange("select")}><X size={16} /></IconButton>
        </div>
      )}

      {props.mode === "image" && <div className="mode-hint">在 PDF 页面上拖拽选择图片或公式区域</div>}
    </section>
  );
}
