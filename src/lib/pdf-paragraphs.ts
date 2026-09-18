import type { PdfTextBlock } from "../types";

export type ParagraphTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
};

type Fragment = { text: string; x: number; y: number; width: number; size: number; font: string };
type Line = {
  text: string; left: number; right: number; top: number; bottom: number;
  baseline: number; size: number; font: string;
};
type Paragraph = { lines: Line[]; kind?: PdfTextBlock["kind"] };

function quantile(values: number[], fraction: number, fallback: number): number {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function similarSize(a: Line, b: Line): boolean {
  return Math.abs(a.size - b.size) <= Math.max(a.size, b.size) * 0.09;
}

const HEADING = /^(?:abstract|summary|introduction|background|related work|methods?|methodology|experiments?|results?|discussion|conclusions?|limitations?|acknowledg(?:e)?ments?|references|bibliography)$/i;
function isHeading(line: Line): boolean {
  return HEADING.test(line.text) || (line.text.length < 100 && /^(?:\d{1,2}(?:\.\d{1,2})*|[A-Z])\.?\s+[A-Z][\p{L}\s,:()–-]+$/u.test(line.text));
}

function noteStart(line: Line, pageHeight: number): boolean {
  return line.top > pageHeight * 0.78
    && /^(?:[†‡*∗]|\d{1,3}[.)]?\s|B\s*Corresponding\b)/u.test(line.text);
}

/** Reconstruct physical lines BEFORE inferring columns. A font change or an
 * inline symbol on the right half of a single-column page is not a new column.
 * All distances here are PDF points; rectangles are normalized only at output.
 */
function reconstructLines(items: ParagraphTextItem[], pageHeight: number): Line[] {
  const fragments: Fragment[] = items.filter((item) => item.str.trim() && item.transform.length >= 6
    && Math.abs(Math.atan2(item.transform[1], item.transform[0])) < 0.15)
    .map((item) => {
      const size = Math.max(Math.abs(item.height), Math.hypot(item.transform[2], item.transform[3]), 1);
      return {
        text: item.str, x: item.transform[4], y: pageHeight - item.transform[5], size, font: item.fontName,
        width: Math.abs(item.width) > 0.01 ? Math.abs(item.width) : size * Math.max(item.str.trim().length * 0.48, 1),
      };
    });
  const rows: Array<{ baseline: number; size: number; fragments: Fragment[] }> = [];
  // Main glyphs establish baselines, then superscripts and subscripts attach
  // to them. Content-stream order is not guaranteed to be visual order.
  for (const fragment of fragments.sort((a, b) => b.size - a.size || a.y - b.y || a.x - b.x)) {
    const row = rows.filter((candidate) => {
      const tolerance = fragment.size < candidate.size * 0.85 ? candidate.size * 0.65 : Math.max(1.2, candidate.size * 0.22);
      return Math.abs(candidate.baseline - fragment.y) <= tolerance;
    }).sort((a, b) => Math.abs(a.baseline - fragment.y) - Math.abs(b.baseline - fragment.y))[0];
    if (row) row.fragments.push(fragment);
    else rows.push({ baseline: fragment.y, size: fragment.size, fragments: [fragment] });
  }
  const lines: Line[] = [];
  for (const row of rows) {
    const parts: Fragment[][] = [];
    let right = -Infinity;
    for (const fragment of row.fragments.sort((a, b) => a.x - b.x || a.y - b.y)) {
      // A genuine gutter separates columns even when both share a baseline.
      if (!parts.length || fragment.x - right > Math.max(12, row.size * 1.7)) parts.push([]);
      parts.at(-1)!.push(fragment);
      right = Math.max(right, fragment.x + fragment.width);
    }
    for (const part of parts) {
      const weights = new Map<string, { size: number; font: string; weight: number; baseline: number }>();
      for (const fragment of part) {
        const key = `${fragment.font}:${fragment.size.toFixed(1)}`;
        const entry = weights.get(key) || { size: fragment.size, font: fragment.font, weight: 0, baseline: fragment.y };
        entry.weight += fragment.text.trim().length;
        weights.set(key, entry);
      }
      const main = [...weights.values()].sort((a, b) => b.weight - a.weight)[0];
      let text = "";
      for (let i = 0; i < part.length; i++) {
        const fragment = part[i];
        const previous = part[i - 1];
        const gap = previous ? fragment.x - (previous.x + previous.width) : 0;
        const space = previous && (/\s$/.test(previous.text) || /^\s/.test(fragment.text)
          || gap > Math.max(0.7, Math.min(previous.size, fragment.size) * 0.16));
        text += `${space ? " " : ""}${fragment.text.trim()}`;
      }
      text = text.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
      const top = Math.min(...part.map((fragment) => fragment.y - fragment.size));
      const bottom = Math.max(...part.map((fragment) => fragment.y));
      // Page numbers and rotated arXiv marks are not paragraphs.
      if (/^\d{1,4}$/.test(text) && (top > pageHeight * 0.91 || bottom < pageHeight * 0.06)) continue;
      lines.push({ text, left: part[0].x, right: Math.max(...part.map((fragment) => fragment.x + fragment.width)),
        top, bottom, baseline: main.baseline, size: main.size, font: main.font });
    }
  }
  const ordered = lines.sort((a, b) => a.top - b.top || a.left - b.left);
  // TeX footnote symbols are often emitted on a separate superscript
  // baseline. Attach a symbol-only row to the adjacent footnote text before
  // paragraph detection, otherwise the text looks like ordinary body prose.
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const marker = ordered[index];
    const next = ordered[index + 1];
    if (!/^[†‡*∗]$/u.test(marker.text)
      || next.left < marker.left - marker.size * 0.3
      || next.left - marker.right > marker.size * 1.2
      || next.top - marker.bottom > marker.size * 0.8) continue;
    next.text = `${marker.text}${next.text}`;
    next.left = marker.left;
    next.top = Math.min(marker.top, next.top);
    next.baseline = Math.min(marker.baseline, next.baseline);
    ordered.splice(index, 1);
    index -= 1;
  }
  return ordered;
}

function columnGutter(lines: Line[], pageWidth: number): number | undefined {
  const long = lines.filter((line) => line.text.length >= 35 && line.right - line.left > pageWidth * 0.2);
  const candidates = long.filter((line) => line.left > pageWidth * 0.43 && line.left < pageWidth * 0.76);
  let best: { gutter: number; score: number } | undefined;
  for (const candidate of candidates) {
    const right = candidates.filter((line) => Math.abs(line.left - candidate.left) < pageWidth * 0.025);
    const left = long.filter((line) => line.left < pageWidth * 0.35 && line.right < candidate.left - 8);
    if (right.length < 3 || left.length < 3) continue;
    const top = Math.max(Math.min(...left.map((line) => line.baseline)), Math.min(...right.map((line) => line.baseline)));
    const bottom = Math.min(Math.max(...left.map((line) => line.baseline)), Math.max(...right.map((line) => line.baseline)));
    const score = Math.min(left.filter((line) => line.baseline >= top && line.baseline <= bottom).length,
      right.filter((line) => line.baseline >= top && line.baseline <= bottom).length);
    if (score < 3 || (best && best.score >= score)) continue;
    best = { score, gutter: (quantile(left.map((line) => line.right), 0.85, 0) + Math.min(...right.map((line) => line.left))) / 2 };
  }
  return best?.gutter;
}

function groupParagraphs(lines: Line[], pageHeight: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const current = paragraphs.at(-1);
    const previous = current?.lines.at(-1);
    // Learn leading and text edges from nearby lines of the same font size.
    // Absolute gap thresholds merge spaced paragraphs in one template and
    // split every line in another.
    const peers = lines.slice(Math.max(0, i - 15), i + 16).filter((peer) => similarSize(line, peer));
    const pitches = peers.slice(1).flatMap((peer, index) => {
      const delta = peer.baseline - peers[index].baseline;
      return delta >= line.size * 0.85 && delta <= line.size * 1.65 ? [delta] : [];
    });
    const pitch = quantile(pitches, 0.25, line.size * 1.2);
    const left = quantile(peers.map((peer) => peer.left), 0.2, line.left);
    const right = quantile(peers.map((peer) => peer.right), 0.85, line.right);
    const next = lines[i + 1];
    const indented = line.left - left > line.size * 0.55 && line.left - left < line.size * 3
      && previous && Math.abs(previous.left - left) < line.size * 0.4
      && next && similarSize(line, next) && Math.abs(next.left - left) < line.size * 0.4;
    const shortEnd = previous && previous.right < right - Math.max(line.size * 2, (right - left) * 0.1)
      && /[.!?。！？][\])”’"']?$/.test(previous.text) && Math.abs(line.left - left) < line.size * 0.4;
    const startsNote = noteStart(line, pageHeight);
    const startsCaption = /^(?:fig(?:ure)?\.?|table)\s*\d+[:.\s]/i.test(line.text);
    const boundary = !previous || !similarSize(previous, line)
      || line.baseline - previous.baseline > pitch * 1.22 + 0.5
      || line.baseline - previous.baseline < line.size * 0.6
      || isHeading(line) || isHeading(previous)
      || indented || shortEnd || startsNote || startsCaption
      || (Math.abs(previous.left - line.left) > line.size * 3 && Math.abs(previous.right - line.right) > line.size * 3
        && Math.abs((previous.left + previous.right) - (line.left + line.right)) > line.size * 4);
    if (boundary) paragraphs.push({ lines: [line], kind: startsNote ? "footnote" : undefined });
    else current!.lines.push(line);
  }
  return paragraphs;
}

function joinLines(lines: Line[]): string {
  return lines.reduce((text, line) => {
    if (!text) return line.text;
    if (/[-‐]$/.test(text) && /^[A-Za-z]/.test(line.text)) {
      // Preserve explicit compound prefixes and proper names. Other line-end
      // hyphens usually split a word (e.g. "char-" / "acterized").
      const compound = /\b(?:post|pre|self|non|cross|on|off|multi|semi|low|high|token|policy|weight|rank|step|fine|in)-$/i.test(text)
        || /^[A-Z]/.test(line.text);
      if (/^or\b/i.test(line.text)) return `${text} ${line.text}`;
      return `${compound ? text : text.slice(0, -1)}${line.text}`;
    }
    return `${text} ${line.text}`;
  }, "");
}

/** Each output block is one natural paragraph or a separate structural unit
 * (title, heading, caption, note). Request batching must retain these boundaries.
 */
export function extractPdfParagraphs(items: ParagraphTextItem[], pageWidth: number, pageHeight: number, pageNumber: number): PdfTextBlock[] {
  const lines = reconstructLines(items, pageHeight);
  const gutter = columnGutter(lines, pageWidth);
  const paragraphs: Paragraph[] = [];
  if (gutter === undefined) paragraphs.push(...groupParagraphs(lines, pageHeight));
  else {
    let band: Line[] = [];
    let fullWidth: boolean | undefined;
    const flush = () => {
      if (!band.length) return;
      if (fullWidth) paragraphs.push(...groupParagraphs(band, pageHeight));
      else {
        const left = groupParagraphs(band.filter((line) => line.left < gutter), pageHeight);
        const right = groupParagraphs(band.filter((line) => line.left >= gutter), pageHeight);
        const notes = [...left, ...right].filter((paragraph) => paragraph.kind === "footnote");
        const leftBody = left.filter((paragraph) => paragraph.kind !== "footnote");
        const rightBody = right.filter((paragraph) => paragraph.kind !== "footnote");
        const tail = leftBody.at(-1);
        const head = rightBody[0];
        const last = tail?.lines.at(-1);
        const first = head?.lines[0];
        const rightEdge = quantile(leftBody.flatMap((paragraph) => paragraph.lines.map((line) => line.right)), 0.85, 0);
        const rightStart = quantile(rightBody.flatMap((paragraph) => paragraph.lines.map((line) => line.left)), 0.2, 0);
        // A paragraph may flow from the bottom of the left column to the top
        // of the right. Notes must not interrupt that continuation.
        if (tail && head && last && first && similarSize(last, first)
          && tail.lines.length >= 2 && !isHeading(first) && /^[a-zα-ω]/u.test(first.text)
          && !/[.!?:;][\])”’"']?$/.test(last.text)
          && last.right >= rightEdge - last.size * 2 && first.left <= rightStart + first.size * 0.4) {
          tail.lines.push(...head.lines);
          rightBody.shift();
        }
        paragraphs.push(...leftBody, ...rightBody, ...notes);
      }
      band = [];
    };
    for (const line of lines) {
      const spansGutter = line.left < gutter && line.right > gutter;
      if (fullWidth !== undefined && fullWidth !== spansGutter) flush();
      fullWidth = spansGutter;
      band.push(line);
    }
    flush();
  }
  return paragraphs.map((paragraph, order) => ({
    id: `v5-p${pageNumber}-b${order}`, pageNumber, order, text: joinLines(paragraph.lines), kind: paragraph.kind,
    column: gutter === undefined ? 0 : (paragraph.lines[0]?.left || 0) < gutter ? 0 : 1,
    // The parser has no learned detector confidence; expose a conservative
    // signal so callers can choose OCR/manual review for ambiguous pages.
    confidence: gutter === undefined ? 0.72 : 0.64,
    rects: paragraph.lines.map((line) => ({ left: line.left / pageWidth, top: line.top / pageHeight,
      width: (line.right - line.left) / pageWidth, height: (line.bottom - line.top) / pageHeight })),
    lines: paragraph.lines.map((line) => ({
      text: line.text,
      rect: { left: line.left / pageWidth, top: line.top / pageHeight,
        width: (line.right - line.left) / pageWidth, height: (line.bottom - line.top) / pageHeight },
    })),
  }));
}
