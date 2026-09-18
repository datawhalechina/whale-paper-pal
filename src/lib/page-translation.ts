import type { AnnotationRect, PdfTextBlock, PdfVisualRegion, TranslationSegment } from "../types";
import { protectTranslationTokens } from "./translation-utils";

type TranslationKind = NonNullable<TranslationSegment["kind"]>;

const CAPTION_PATTERN = /^(?:fig(?:ure)?\.?|图|table|tab\.?|tbl\.?|表)\s*[\d一二三四五六七八九十]+[a-z]?(?:\s|[:.\-]|$)/i;

export type PageTranslationRequest = {
  sourceText: string;
  kind: TranslationKind;
  sourceBlockIds: string[];
  rects: AnnotationRect[];
};

export type PageTranslationBatch = {
  id: string;
  items: Array<{ id: string; sourceText: string; kind: TranslationKind; sourceBlockIds: string[]; rects: AnnotationRect[] }>;
};

function classifyBlock(block: PdfTextBlock): TranslationKind {
  const value = block.text.trim();
  if (/^(?:footnotes?\b|脚注|注释)/i.test(value)) return "footnote";
  // A body paragraph can extend to the bottom margin. Its position alone
  // cannot make it a footnote and interrupt the surrounding prose request.
  if (value.length < 400 && block.rects.length && block.rects.every((rect) => rect.top > 0.79)
    && /^(?:[†‡*∗]|\d{1,3}[.)]?\s)/u.test(value)) return "footnote";
  if (/^(?:fig(?:ure)?\.?|图)\s*\d+/i.test(value)) return "figure-caption";
  if (/^(?:table|表)\s*\.?\s*\d+/i.test(value) || /\t/.test(value) || /^\s*\|.+\|\s*$/m.test(value)) return "table";
  const formulaSymbols = (value.match(/[=+−×÷∑∏∫√≤≥≈∈∇α-ω]/g) || []).length;
  const words = value.match(/[A-Za-z]{2,}/g) || [];
  if (formulaSymbols >= 2 && value.length < 360 && words.length < 8) return "formula";
  return "text";
}

function rectCoveredByVisual(rect: AnnotationRect, regions: PdfVisualRegion[]): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return regions.some((region) => {
    if (region.kind === "formula") return false;
    const width = Math.max(0, Math.min(rect.left + rect.width, region.left + region.width) - Math.max(rect.left, region.left));
    const height = Math.max(0, Math.min(rect.top + rect.height, region.top + region.height) - Math.max(rect.top, region.top));
    return width * height >= rect.width * rect.height * 0.5;
  });
}

function joinSourceLines(lines: string[]): string {
  return lines.reduce((text, line) => {
    if (!text) return line;
    if (/[-‐]$/.test(text) && /^[A-Za-z]/.test(line)) {
      const compound = /\b(?:post|pre|self|non|cross|on|off|multi|semi|low|high|token|policy|weight|rank|step|fine|in)-$/i.test(text)
        || /^[A-Z]/.test(line);
      if (/^or\b/i.test(line)) return `${text} ${line}`;
      return `${compound ? text : text.slice(0, -1)}${line}`;
    }
    return `${text} ${line}`;
  }, "");
}

function withoutVisualText(block: PdfTextBlock, regions: PdfVisualRegion[]): PdfTextBlock | null {
  if (!regions.length) return block;
  if (block.lines?.length) {
    const lines = block.lines.filter((line) => CAPTION_PATTERN.test(line.text.trim()) || !rectCoveredByVisual(line.rect, regions));
    if (!lines.length) return null;
    if (lines.length === block.lines.length) return block;
    return { ...block, text: joinSourceLines(lines.map((line) => line.text)), rects: lines.map((line) => line.rect), lines };
  }
  if (CAPTION_PATTERN.test(block.text.trim())) return block;
  const covered = block.rects.filter((rect) => rectCoveredByVisual(rect, regions)).length;
  return covered >= Math.max(1, Math.ceil(block.rects.length / 2)) ? null : block;
}

/** Preserve the paragraph boundaries inferred from the PDF layout. */
export function buildPageTranslationRequests(
  blocks: PdfTextBlock[],
  fallbackText: string,
  _maxChars = 8000,
  visualRegions: PdfVisualRegion[] = [],
): PageTranslationRequest[] {
  // A layout block is already one natural paragraph (or one structural unit).
  // Do not merge neighbors here: a page is not one translation unit.
  return blocks.length
    ? [...blocks].sort((a, b) => a.order - b.order)
      .map((block) => withoutVisualText(block, visualRegions))
      .filter((block): block is PdfTextBlock => Boolean(block))
      .map((block) => ({
      sourceText: block.text.trim(),
      kind: block.kind || classifyBlock(block),
      sourceBlockIds: [block.id],
      rects: [...block.rects],
    })).filter((unit) => unit.sourceText)
    : fallbackText.split(/\n\s*\n/).map((text): PageTranslationRequest => ({
      sourceText: text.trim(), kind: "text", sourceBlockIds: [], rects: [],
    })).filter((unit) => unit.sourceText);
}

/** Each complete response belongs to its complete input, without marker parsing. */
export async function translatePageRequests(
  requests: PageTranslationRequest[],
  translate: (source: string) => Promise<string>,
): Promise<{ content: string; segments: TranslationSegment[] }> {
  const segments: TranslationSegment[] = [];
  let sourceOffset = 0;
  let targetOffset = 0;
  for (const request of requests) {
    const protectedText = protectTranslationTokens(request.sourceText);
    const targetText = protectedText.restore(await translate(protectedText.text)).trim();
    if (!targetText) throw new Error("翻译返回了空内容，请重试。");
    segments.push({
      id: crypto.randomUUID(),
      kind: request.kind,
      sourceBlockId: request.sourceBlockIds[0],
      sourceBlockIds: request.sourceBlockIds.length ? [...request.sourceBlockIds] : undefined,
      sourceText: request.sourceText,
      sourceRange: { start: sourceOffset, end: sourceOffset + request.sourceText.length },
      targetText,
      targetRange: { start: targetOffset, end: targetOffset + targetText.length },
      rects: [...request.rects],
    });
    sourceOffset += request.sourceText.length + 2;
    targetOffset += targetText.length + 2;
  }
  return { content: segments.map((segment) => segment.targetText).join("\n\n"), segments };
}

/** Group adjacent blocks for transport while keeping each paragraph as an
 * independent returned segment. This avoids one network round trip per line
 * of a page and gives the model enough local context for terminology. */
export function batchPageTranslationRequests(requests: PageTranslationRequest[], maxChars = 6500): PageTranslationBatch[] {
  const batches: PageTranslationBatch[] = [];
  let current: PageTranslationBatch | undefined;
  let size = 0;
  for (const request of requests) {
    const item = { id: request.sourceBlockIds[0] || crypto.randomUUID(), sourceText: request.sourceText, kind: request.kind, sourceBlockIds: [...request.sourceBlockIds], rects: [...request.rects] };
    const nextSize = item.sourceText.length + 80;
    if (!current || (size > 0 && size + nextSize > maxChars)) {
      current = { id: crypto.randomUUID(), items: [] };
      batches.push(current);
      size = 0;
    }
    current.items.push(item);
    size += nextSize;
  }
  return batches;
}

export async function translatePageBatches(
  requests: PageTranslationRequest[],
  translate: (batch: PageTranslationBatch, protectedItems: Array<{ id: string; sourceText: string }>) => Promise<Record<string, string>>,
): Promise<{ content: string; segments: TranslationSegment[] }> {
  const segments: TranslationSegment[] = [];
  let sourceOffset = 0;
  let targetOffset = 0;
  for (const batch of batchPageTranslationRequests(requests)) {
    const protectedTokens = batch.items.map((item) => {
      const protectedText = protectTranslationTokens(item.sourceText);
      return { item, protectedText };
    });
    const translated = await translate(batch, protectedTokens.map(({ item, protectedText }) => ({ id: item.id, sourceText: protectedText.text })));
    for (const { item, protectedText } of protectedTokens) {
      const targetText = protectedText.restore(String(translated[item.id] || "")).trim();
      if (!targetText) throw new Error(`翻译返回了空内容（${item.id}）。`);
      segments.push({ id: crypto.randomUUID(), kind: item.kind, sourceBlockId: item.sourceBlockIds[0], sourceBlockIds: item.sourceBlockIds.length ? [...item.sourceBlockIds] : undefined, sourceText: item.sourceText, sourceRange: { start: sourceOffset, end: sourceOffset + item.sourceText.length }, targetText, targetRange: { start: targetOffset, end: targetOffset + targetText.length }, rects: [...item.rects] });
      sourceOffset += item.sourceText.length + 2;
      targetOffset += targetText.length + 2;
    }
  }
  return { content: segments.map((segment) => segment.targetText).join("\n\n"), segments };
}
