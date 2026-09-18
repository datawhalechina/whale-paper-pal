import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OutlineEntry, PdfTextBlock, SearchHit } from "../types";
import { extractPdfParagraphs } from "./pdf-paragraphs";

type PdfOutlineItem = {
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineItem[];
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
};

type PageLine = {
  text: string;
  y: number;
  height: number;
  right: number;
  fontName: string;
};

type DetectedHeading = {
  title: string;
  pageNumber: number;
  level: number;
};

const OUTLINE_SCAN_PAGE_LIMIT = 30;
const UNNUMBERED_HEADING_PATTERN = /^(?:abstract|summary|introduction|background|related work|methods?|methodology|materials and methods|experiments?|experimental setup|evaluation|results?|discussion|conclusions?|limitations?|future work|acknowledg(?:e)?ments?|references|bibliography)$/i;

function normalizeOutlineTitle(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

/**
 * A few TeX/PDF font encodings expose one visual word as several text items
 * with a fake space between the first glyph and the rest of the word, e.g.
 * `V OICE M EM` or `P eople`. Keep ordinary prose such as `A model` intact by
 * only applying this repair when the same malformed pattern occurs repeatedly
 * in a line/page.
 */
function repairPdfTextSpacing(value: string): string {
  let text = normalizeOutlineTitle(value);
  const malformedRuns = text.match(/\b[A-Z]\s+(?=[A-Za-z]{2,})/g) || [];
  const repeatedMalformedRuns = malformedRuns.length >= 3;
  const hasBrokenUppercaseWord = /\b[A-Z]\s+[A-Z]{2,}\b/.test(text) && malformedRuns.length >= 1;
  if (repeatedMalformedRuns || hasBrokenUppercaseWord) {
    text = text
      .replace(/\b([A-Z])\s+(?=[a-z]{2,})/g, "$1")
      .replace(/\b([A-Z])\s+(?=[A-Z]{2,}\b)/g, "$1");
  }
  // Keep semantic hyphens (for example `post-training`) while removing only
  // the artificial space introduced when a PDF line ends at that hyphen.
  return text.replace(/([A-Za-z])[-‐‑–—]\s+([a-z])/g, "$1-$2");
}

type TextFragment = { str: string; x: number; y: number; width: number; height: number };

/**
 * PDF.js may return one text item per glyph (especially for bold/display
 * fonts). Joining every item with a space turns `VoiceMem` into `V oice M em`.
 * Use the measured horizontal gap to distinguish glyph fragments from words.
 */
function joinTextFragments(fragments: TextFragment[]): string {
  let result = "";
  let previous: TextFragment | undefined;
  for (const fragment of fragments) {
    const text = fragment.str.trim();
    if (!text) continue;
    if (!previous || !result) {
      result += text;
    } else {
      // `buildPdfTextBlocks` uses page-relative coordinates (0..1), while
      // the text index uses PDF points. Keep the tolerance proportional to
      // the glyph height so the same joiner works in both coordinate spaces.
      const relative = Math.max(fragment.height, previous.height) < 1;
      const lineTolerance = relative ? 0.003 : 1.5;
      const gapFloor = relative ? 0.0012 : 0.7;
      const sameLine = Math.abs(fragment.y - previous.y) <= Math.max(lineTolerance, Math.min(fragment.height, previous.height) * 0.35);
      const gap = fragment.x - (previous.x + previous.width);
      const threshold = Math.max(gapFloor, Math.min(fragment.height, previous.height) * 0.16);
      const punctuation = /^[,.;:!?%)\]}，。！？；：]/u.test(text) || /[([{（「《]$/u.test(previous.str.trim());
      const forceSeparator = /^\d$/.test(previous.str.trim()) && /^[A-Za-z]/.test(text);
      const dashSeparator = /^[—–]/u.test(text) || /[—–]$/u.test(previous.str.trim());
      const separator = !sameLine || dashSeparator || (gap > threshold && !punctuation) || forceSeparator ? " " : "";
      result += separator + text;
    }
    previous = fragment;
  }
  return repairPdfTextSpacing(result);
}

function pageLines(items: PdfTextItem[]): PageLine[] {
  const lines: PageLine[] = [];
  items.forEach((item) => {
    const text = normalizeOutlineTitle(item.str);
    if (!text || item.transform.length < 6) return;
    const x = item.transform[4];
    const y = item.transform[5];
    const height = Math.max(Math.abs(item.height), Math.hypot(item.transform[2] || 0, item.transform[3] || 0), 1);
    const width = Math.max(Math.abs(item.width), Math.abs(item.transform[0] || item.transform[3] || item.height) * Math.max(text.length * 0.48, 1));
    const previous = lines.at(-1);
    const horizontalGap = previous ? x - previous.right : Number.POSITIVE_INFINITY;
    const sameLine = previous
      && Math.abs(previous.y - y) <= Math.max(1.5, Math.min(previous.height, height) * 0.3)
      && horizontalGap >= -2
      && horizontalGap <= Math.max(24, height * 3);
    if (sameLine) {
      const threshold = Math.max(0.7, Math.min(previous.height, height) * 0.16);
      const punctuation = /^[,.;:!?%)\]}，。！？；：]/u.test(text) || /[([{（「《]$/u.test(previous.text);
      previous.text = repairPdfTextSpacing(`${previous.text}${horizontalGap > threshold && !punctuation ? " " : ""}${text}`);
      previous.height = Math.max(previous.height, height);
      previous.right = Math.max(previous.right, x + width);
      return;
    }
    lines.push({ text, y, height, right: x + width, fontName: item.fontName });
  });
  return lines;
}

function estimateBodyTextHeight(lines: PageLine[]): number {
  const buckets = new Map<number, number>();
  lines.forEach((line) => {
    if (line.text.length < 40 || line.height < 5 || line.height > 24) return;
    const bucket = Math.round(line.height * 4) / 4;
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  });
  return [...buckets].sort((left, right) => right[1] - left[1])[0]?.[0] || 9;
}

function identifyHeadingFonts(lines: PageLine[], bodyHeight: number): Set<string> {
  const fonts = new Set<string>();
  lines.forEach((line) => {
    const title = normalizeOutlineTitle(line.text);
    const numbered = /^(\d{1,2})(?:\.\d{1,2})*\.?\s+[\p{L}]/u.test(title);
    const lettered = /^[A-Z](?:\.\d{1,2})*\.?\s+[\p{L}]/u.test(title);
    if (UNNUMBERED_HEADING_PATTERN.test(title) || ((numbered || lettered) && line.height >= bodyHeight * 1.05)) {
      fonts.add(line.fontName);
    }
  });
  return fonts;
}

function headingLevel(title: string, line: PageLine, bodyHeight: number, headingFonts: Set<string>): number | undefined {
  if (line.height < bodyHeight * 0.94) return undefined;
  if (headingFonts.size && !headingFonts.has(line.fontName)) return undefined;
  const numbered = title.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+([\p{L}].*)$/u);
  if (numbered) {
    const parts = numbered[1].split(".");
    if (Number(parts[0]) >= 1 && Number(parts[0]) <= 30 && !numbered[2].endsWith("-")) return parts.length - 1;
  }
  const lettered = title.match(/^([A-Z](?:\.\d{1,2}){0,3})\.?\s+([\p{L}].*)$/u);
  if (lettered && !lettered[2].endsWith("-") && !/[.!?]$/.test(title)) return lettered[1].split(".").length - 1;
  const appendix = /^(?:appendix|appendices)(?:\s+[A-Z0-9]+)?(?:\s*[:.-]\s*|\s+).+/i.test(title);
  if (appendix && !/[.!?]$/.test(title)) return 0;
  return UNNUMBERED_HEADING_PATTERN.test(title) ? 0 : undefined;
}

function buildDetectedOutline(headings: DetectedHeading[]): OutlineEntry[] {
  const roots: OutlineEntry[] = [];
  const stack: Array<{ level: number; entry: OutlineEntry }> = [];
  headings.forEach((heading) => {
    const entry: OutlineEntry = { title: heading.title, pageNumber: heading.pageNumber, items: [] };
    while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop();
    if (stack.length) stack.at(-1)!.entry.items.push(entry);
    else roots.push(entry);
    stack.push({ level: heading.level, entry });
  });
  return roots.length === 1 && roots[0].items.length ? roots[0].items : roots;
}

async function detectOutline(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const linesByPage: Array<{ pageNumber: number; lines: PageLine[] }> = [];
  const allLines: PageLine[] = [];
  const headings: DetectedHeading[] = [];
  const seen = new Set<string>();
  const pageLimit = Math.min(pdf.numPages, OUTLINE_SCAN_PAGE_LIMIT);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.filter((item): item is typeof item & PdfTextItem => "str" in item && "transform" in item);
    const lines = pageLines(items);
    linesByPage.push({ pageNumber, lines });
    allLines.push(...lines);
  }
  const bodyHeight = estimateBodyTextHeight(allLines);
  const headingFonts = identifyHeadingFonts(allLines, bodyHeight);
  for (const { pageNumber, lines } of linesByPage) {
    for (const line of lines) {
      const title = normalizeOutlineTitle(line.text);
      if (title.length < 2 || title.length > 180) continue;
      const level = headingLevel(title, line, bodyHeight, headingFonts);
      if (level === undefined) continue;
      const identity = title.toLocaleLowerCase();
      if (seen.has(identity)) continue;
      seen.add(identity);
      headings.push({ title, pageNumber, level });
    }
  }
  return buildDetectedOutline(headings);
}

export async function resolveOutline(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const source = (await pdf.getOutline()) as PdfOutlineItem[] | null;
  if (!source?.length) return detectOutline(pdf);

  const resolveItem = async (item: PdfOutlineItem): Promise<OutlineEntry> => {
    let pageNumber: number | undefined;
    try {
      const destination = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      if (destination?.[0]) {
        const pageIndex = await pdf.getPageIndex(destination[0]);
        pageNumber = pageIndex + 1;
      }
    } catch {
      pageNumber = undefined;
    }
    return {
      title: item.title,
      pageNumber,
      items: await Promise.all((item.items || []).map(resolveItem)),
    };
  };

  return Promise.all(source.map(resolveItem));
}

export async function buildPdfTextBlocks(
  pdf: PDFDocumentProxy,
  onProgress?: (completed: number) => void,
  onPageError?: (pageNumber: number, error: unknown) => void,
): Promise<PdfTextBlock[][]> {
  const pages: PdfTextBlock[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is typeof item & PdfTextItem => "str" in item && "transform" in item);
      pages.push(extractPdfParagraphs(items, viewport.width, viewport.height, pageNumber));
    } catch (error) {
      pages.push([]);
      onPageError?.(pageNumber, error);
    }
    onProgress?.(pageNumber);
  }
  return pages;
}

export function searchTextIndex(index: string[], query: string): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return index.flatMap((text, pageIndex) => {
    const haystack = text.toLocaleLowerCase();
    let cursor = 0;
    let count = 0;
    let first = -1;
    while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
      if (first === -1) first = cursor;
      count += 1;
      cursor += Math.max(needle.length, 1);
    }
    if (!count) return [];
    const start = Math.max(0, first - 56);
    const end = Math.min(text.length, first + needle.length + 80);
    return [{ pageNumber: pageIndex + 1, count, excerpt: text.slice(start, end) }];
  });
}

export function escapeAndHighlight(text: string, query: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  const term = query.trim();
  if (!term) return escaped;
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
}
