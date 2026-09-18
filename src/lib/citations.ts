import { invoke, isTauri } from "@tauri-apps/api/core";
import { readBrandedStorage } from "./brand-storage";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { CitationCard, CitationFormat } from "../types";

type CitationMetadata = Pick<CitationCard, "authors" | "title" | "year" | "venue" | "doi" | "url">;

type ReferenceLine = {
  text: string;
  x: number;
  y: number;
  height: number;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
};

type SemanticScholarPaper = {
  paperId?: string;
  title?: string;
  authors?: Array<{ name?: string }>;
  year?: number;
  venue?: string;
  abstract?: string;
  citationCount?: number;
  externalIds?: { DOI?: string; ArXiv?: string };
  openAccessPdf?: { url?: string };
  url?: string;
};

type SemanticScholarRelation = {
  citedPaper?: SemanticScholarPaper;
  citingPaper?: SemanticScholarPaper;
};

type MoonlightScholarPaper = {
  semantic_scholar_paper_id?: string;
  title?: string;
  authors?: Array<{ name?: string }>;
  year?: number;
  venue?: string;
  abstract?: string;
  citation_count?: number;
  pdf_url?: string;
  url?: string;
};

type MoonlightScholarBundle = {
  semanticScholarPaper?: MoonlightScholarPaper;
  semanticScholarPaperReferences?: MoonlightScholarPaper[];
  semanticScholarPaperCitations?: MoonlightScholarPaper[];
};

type OpenAlexWork = {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  referenced_works?: string[];
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string }; landing_page_url?: string; pdf_url?: string };
  best_oa_location?: { landing_page_url?: string; pdf_url?: string };
};

type CrossrefReference = {
  DOI?: string;
  author?: string;
  year?: string;
  "article-title"?: string;
  "journal-title"?: string;
  unstructured?: string;
};

type CrossrefWork = {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  published?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  "is-referenced-by-count"?: number;
  URL?: string;
  abstract?: string;
  reference?: CrossrefReference[];
};

type DesktopHttpResponse = { status: number; body: string; headers?: Record<string, string> };

export type CitationMetadataProvider = "semantic-scholar" | "moonlight" | "openalex" | "crossref";

export type CitationMetadataAttempt = {
  provider: CitationMetadataProvider;
  status: "ready" | "not-found" | "unavailable";
  message?: string;
};

export type OnlineCitationMetadataResult = {
  references: CitationCard[];
  citations: CitationCard[];
  provider?: CitationMetadataProvider;
  attempts: CitationMetadataAttempt[];
  allSourcesFailed: boolean;
};

export type OnlineCitationMetadataRequest = {
  documentId: string;
  title: string;
  fileName: string;
  firstPages: string;
  year?: number;
  semanticScholarApiKey: string;
};

function clean(value?: string): string {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function titleSimilarity(left: string, right: string): number {
  const leftWords = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const rightWords = new Set(normalizeTitle(right).split(" ").filter(Boolean));
  if (!leftWords.size || !rightWords.size) return 0;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return (2 * overlap) / (leftWords.size + rightWords.size);
}

export function formatCitation(format: CitationFormat, metadata: CitationMetadata): string {
  const authors = clean(metadata.authors);
  const title = clean(metadata.title);
  const venue = clean(metadata.venue);
  const year = metadata.year;
  const locator = clean(metadata.doi) ? `https://doi.org/${clean(metadata.doi)}` : clean(metadata.url);

  if (format === "bibtex") {
    const key = `${authors.split(/[ ,]/)[0] || "paper"}${year || ""}`.replace(/[^a-z0-9]/gi, "");
    const fields = [
      title && `  title = {${title}}`,
      authors && `  author = {${authors}}`,
      year && `  year = {${year}}`,
      venue && `  journal = {${venue}}`,
      metadata.doi && `  doi = {${metadata.doi}}`,
      !metadata.doi && metadata.url && `  url = {${metadata.url}}`,
    ].filter(Boolean);
    return `@article{${key || "paper"},\n${fields.join(",\n")}\n}`;
  }
  const authorPart = authors ? `${authors}.` : "";
  const titlePart = title ? `${title}.` : "";
  const venuePart = venue ? `${venue}.` : "";
  const yearPart = year ? (format === "harvard" || format === "apa" ? `(${year}).` : `${year}.`) : "";
  const locatorPart = locator ? (format === "harvard" ? `Available at: ${locator}` : locator) : "";
  return [authorPart, yearPart, titlePart, venuePart, locatorPart].filter(Boolean).join(" ");
}

function appendLine(current: string, next: string): string {
  if (!current) return next;
  if (/[-‐‑‒–]$/.test(current) && /^[a-z]/.test(next)) return `${current.slice(0, -1)}${next}`;
  return `${current} ${next}`;
}

async function extractPageLines(pdf: PDFDocumentProxy, pageNumber: number): Promise<ReferenceLine[]> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const lines: ReferenceLine[] = [];
  let current: { text: string; x: number; y: number; endX: number; height: number } | null = null;

  const flush = () => {
    if (current?.text.trim()) {
      lines.push({
        text: clean(current.text),
        x: current.x,
        y: current.y,
        height: current.height,
        pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      });
    }
    current = null;
  };

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const text = item.str.trim();
    const x = item.transform[4];
    const y = item.transform[5];
    const height = Math.max(item.height || 0, 8);
    const startsNewLine = current && Math.abs(y - current.y) > Math.max(2.2, Math.min(current.height, height) * 0.42);
    if (startsNewLine) flush();
    if (text) {
      if (!current) current = { text, x, y, endX: x + item.width, height };
      else {
        const needsSpace = x - current.endX > Math.max(0.8, height * 0.08);
        current.text += `${needsSpace ? " " : ""}${text}`;
        current.endX = Math.max(current.endX, x + item.width);
        current.height = Math.max(current.height, height);
      }
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

function isReferenceHeading(text: string): boolean {
  return /^(?:references|bibliography|literature cited|works cited|参考文献)$/i.test(clean(text));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function isSectionAfterReferences(line: ReferenceLine, bodyHeight: number): boolean {
  const text = clean(line.text);
  if (/^(?:appendix|supplementary (?:material|materials|information)|acknowledg(?:e)?ments?)(?:\s|$)/i.test(text)) return true;
  if (/^(?:[A-Z]|[IVX]{1,5})\.?\s+(?:additional|extended|experimental|proofs?|datasets?|prompts?|results?|implementation|limitations?|theoretical|related|broader)\b/i.test(text)) return true;

  const looksLikeLabeledHeading = /^(?:[A-Z]|[IVX]{1,5})\.?\s+\p{Lu}[\p{L}\d]/u.test(text) && text.length <= 140;
  if (looksLikeLabeledHeading && bodyHeight > 0 && line.height >= bodyHeight * 1.1) return true;

  // Some papers switch directly from a numbered bibliography to an unnumbered
  // appendix heading (for example, "Attention Visualizations"). A short,
  // enlarged line at the top of a later page is a stronger boundary signal than
  // relying on a fixed list of possible section names.
  const looksLikeTopPageHeading = text.length <= 100
    && text.split(/\s+/).length <= 10
    && /^[\p{Lu}\d]/u.test(text)
    && !/[.;:,]$/.test(text)
    && line.y >= line.pageHeight * 0.82;
  return looksLikeTopPageHeading && bodyHeight > 0 && line.height >= bodyHeight * 1.1;
}

function stripReferenceMarker(text: string): string {
  return clean(text.replace(/^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s*/, ""));
}

function splitReferenceSegments(value: string): string[] {
  // A period after a single initial belongs to the author name (for example, "J. Hu").
  return value.split(/(?<!\b[A-Z])\.\s+(?=[A-Z0-9]|arXiv\b|https?:\/\/)/u).map(clean).filter(Boolean);
}

function looksLikeReference(value: string): boolean {
  const hasStableIdentifier = /\b(?:19|20)\d{2}[a-z]?\b|10\.\d{4,9}\/|https?:\/\/|\barXiv\b/i.test(value);
  const hasPublicationContext = /\b(?:proceedings|conference|journal|transactions|press|preprint|thesis|technical report|volume|pages?|editors?|association|dataset)\b/i.test(value);
  const hasAuthorTitleBoundary = /[\p{L})]\.(?:\s+)[\p{Lu}\d]/u.test(value);
  return hasStableIdentifier || hasPublicationContext || hasAuthorTitleBoundary;
}

function removeLastPublicationYear(value: string, year?: number): string {
  if (!year) return value;
  const matches = [...value.matchAll(new RegExp(`\\b${year}[a-z]?\\b[,;]?`, "gi"))];
  const match = matches.at(-1);
  if (match?.index === undefined) return value;
  return `${value.slice(0, match.index)}${value.slice(match.index + match[0].length)}`;
}

function parseReferenceMetadata(
  documentId: string,
  raw: string,
  referenceNumber: number,
  pageNumber: number,
): CitationCard | null {
  const value = stripReferenceMarker(raw)
    .replace(/https?:\s*\/\s*\/\s*/gi, (match) => match.toLocaleLowerCase().startsWith("https") ? "https://" : "http://")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
  if (value.length < 18 || value.split(/\s+/).length < 3) return null;
  if (!looksLikeReference(value)) return null;

  const yearMatches = [...value.matchAll(/\b((?:19|20)\d{2})[a-z]?\b/gi)];
  const year = yearMatches.length ? Number.parseInt(yearMatches[yearMatches.length - 1][1], 10) : undefined;
  const compactForDoi = value.replace(/\s+/g, "");
  const doi = compactForDoi.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0]?.replace(/[.,;)]$/, "");
  const arxiv = value.match(/(?:arXiv(?::|\s+)|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})/i)?.[1];
  const url = value.match(/https?:\/\/\S+/i)?.[0]?.replace(/[.,;)]$/, "") || (arxiv ? `https://arxiv.org/abs/${arxiv}` : undefined);

  const segments = splitReferenceSegments(value);
  let titleIndex = segments.findIndex((segment, index) => {
    if (index === 0 || segment.length < 12 || segment.length > 320) return false;
    if (/^(?:in\b|proceedings\b|journal\b|arxiv\b|volume\b|vol\.|pages?\b|pp\.|url\b|https?:)/i.test(segment)) return false;
    return segment.split(/\s+/).length >= 3;
  });
  if (titleIndex < 0) titleIndex = segments.length > 1 ? 1 : 0;
  const title = clean(segments[titleIndex] || value.slice(0, 220))
    .replace(/[.;\s]+$/, "")
    .replace(year ? new RegExp(`[,;]?\\s*${year}[a-z]?$`, "i") : /$^/, "")
    .replace(/[.;,\s]+$/, "");
  const authors = titleIndex > 0 ? clean(segments.slice(0, titleIndex).join(". ").replace(/\(?\b(?:19|20)\d{2}[a-z]?\)?[,;]?$/i, "")) : "";
  const venueWithoutLocator = segments.slice(titleIndex + 1).join(". ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bURL\b.*$/i, "");
  const venue = clean(removeLastPublicationYear(venueWithoutLocator, year)
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, ""));
  const formatted = formatCitation("apa", { authors, title, year, venue, doi, url });

  return {
    id: `pdf-reference-${documentId}-${referenceNumber}`,
    documentId,
    pageNumber,
    quote: "",
    title,
    authors,
    year,
    venue: venue || undefined,
    doi,
    url,
    referenceNumber,
    rawReference: value,
    source: "pdf-reference",
    saved: false,
    format: "apa",
    formatted: formatted || value,
    createdAt: new Date().toISOString(),
  };
}

export async function extractPdfReferences(documentId: string, pdf: PDFDocumentProxy): Promise<CitationCard[]> {
  let foundHeading = false;
  const referenceLines: ReferenceLine[] = [];
  const referenceBodyHeights: number[] = [];
  const firstCandidatePage = Math.max(1, Math.floor(pdf.numPages * 0.35));

  for (let pageNumber = firstCandidatePage; pageNumber <= pdf.numPages; pageNumber += 1) {
    const lines = await extractPageLines(pdf, pageNumber);
    for (const line of lines) {
      if (!foundHeading) {
        if (isReferenceHeading(line.text)) foundHeading = true;
        continue;
      }
      if (referenceLines.length > 2 && isSectionAfterReferences(line, median(referenceBodyHeights))) {
        return parseReferenceLines(documentId, referenceLines);
      }
      if (line.y < 28 || line.y > line.pageHeight - 24 || /^\d{1,4}$/.test(line.text)) continue;
      referenceLines.push(line);
      if (referenceBodyHeights.length < 80) referenceBodyHeights.push(line.height);
    }
  }

  return foundHeading ? parseReferenceLines(documentId, referenceLines) : [];
}

function parseReferenceLines(documentId: string, lines: ReferenceLine[]): CitationCard[] {
  const repeatedMarginLines = new Map<string, Set<number>>();
  for (const line of lines) {
    const inMargin = line.y > line.pageHeight * 0.86 || line.y < line.pageHeight * 0.1;
    const key = normalizeTitle(line.text);
    if (!inMargin || key.length < 4 || key.length > 120) continue;
    const pages = repeatedMarginLines.get(key) || new Set<number>();
    pages.add(line.pageNumber);
    repeatedMarginLines.set(key, pages);
  }
  const contentLines = lines.filter((line) => {
    const pages = repeatedMarginLines.get(normalizeTitle(line.text));
    return !pages || pages.size < 2;
  });
  const numberedCount = contentLines.filter((line) => /^\s*(?:\[\d{1,3}\]|\d{1,3}[.)])\s+/.test(line.text)).length;
  const chunks: Array<{ text: string; pageNumber: number; number?: number }> = [];

  if (numberedCount >= 2) {
    let current: { text: string; pageNumber: number; number?: number } | null = null;
    for (const line of contentLines) {
      const marker = line.text.match(/^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+(.*)$/);
      if (marker) {
        if (current) chunks.push(current);
        current = { text: marker[3], pageNumber: line.pageNumber, number: Number(marker[1] || marker[2]) };
      } else if (current) current.text = appendLine(current.text, line.text);
    }
    if (current) chunks.push(current);
  } else {
    const bases = new Map<string, number>();
    for (const line of contentLines) {
      const column = line.x > line.pageWidth * 0.52 ? 1 : 0;
      const key = `${line.pageNumber}:${column}`;
      bases.set(key, Math.min(bases.get(key) ?? Number.POSITIVE_INFINITY, line.x));
    }

    let current: { text: string; pageNumber: number } | null = null;
    for (const line of contentLines) {
      const column = line.x > line.pageWidth * 0.52 ? 1 : 0;
      const base = bases.get(`${line.pageNumber}:${column}`) ?? line.x;
      const startsEntry = line.x <= base + 3.5;
      if (startsEntry && current) {
        chunks.push(current);
        current = { text: line.text, pageNumber: line.pageNumber };
      } else if (!current) current = { text: line.text, pageNumber: line.pageNumber };
      else current.text = appendLine(current.text, line.text);
    }
    if (current) chunks.push(current);
  }

  return chunks
    .slice(0, 300)
    .flatMap((chunk, index) => {
      const parsed = parseReferenceMetadata(documentId, chunk.text, chunk.number || index + 1, chunk.pageNumber);
      return parsed ? [parsed] : [];
    });
}

const METADATA_CACHE_KEY = "whalepaper.citation-http-cache.v1";
const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;
const METADATA_CACHE_MAX_BYTES = 2_500_000;
const METADATA_CACHE_MAX_ENTRIES = 24;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const HOST_INTERVALS: Record<string, number> = {
  "api.semanticscholar.org": 1100,
  "api.openalex.org": 150,
  "api.crossref.org": 250,
  "api.themoonlight.io": 250,
};

type CachedResponse = { body: string; storedAt: number; expiresAt: number };
type CachedResponses = Record<string, CachedResponse>;
type RawHttpResponse = { status: number; body: string; headers: Record<string, string> };

class MetadataRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MetadataRequestError";
  }
}

const requestInFlight = new Map<string, Promise<string>>();
const hostQueues = new Map<string, Promise<void>>();
const hostLastRequest = new Map<string, number>();

function readResponseCache(): CachedResponses {
  try {
    const cache = JSON.parse(readBrandedStorage(METADATA_CACHE_KEY) || "{}") as CachedResponses;
    const now = Date.now();
    return Object.fromEntries(Object.entries(cache).filter(([, entry]) => entry.expiresAt > now));
  } catch {
    return {};
  }
}

function cachedResponse(url: string): string | null {
  return readResponseCache()[url]?.body || null;
}

function cacheResponse(url: string, body: string): void {
  try {
    const now = Date.now();
    const entries = Object.entries({
      ...readResponseCache(),
      [url]: { body, storedAt: now, expiresAt: now + METADATA_CACHE_TTL },
    } satisfies CachedResponses).sort((left, right) => right[1].storedAt - left[1].storedAt).slice(0, METADATA_CACHE_MAX_ENTRIES);
    while (entries.length && JSON.stringify(Object.fromEntries(entries)).length > METADATA_CACHE_MAX_BYTES) entries.pop();
    localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Metadata remains usable when persistent storage is full or unavailable.
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function throttle(url: string): Promise<void> {
  const host = new URL(url).host;
  const interval = HOST_INTERVALS[host] || 250;
  const previous = hostQueues.get(host) || Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const remaining = interval - (Date.now() - (hostLastRequest.get(host) || 0));
    if (remaining > 0) await wait(remaining);
    hostLastRequest.set(host, Date.now());
  });
  hostQueues.set(host, next);
  await next;
}

async function rawGet(url: string, headers: Record<string, string>): Promise<RawHttpResponse> {
  if (isTauri()) {
    const response = await invoke<DesktopHttpResponse>("ai_http_request", { request: { url, method: "GET", headers } });
    return { status: response.status, body: response.body, headers: response.headers || {} };
  }
  const response = await fetch(url, { headers });
  return {
    status: response.status,
    body: await response.text(),
    headers: Object.fromEntries([...response.headers.entries()].map(([name, value]) => [name.toLocaleLowerCase(), value])),
  };
}

function retryDelay(headers: Record<string, string>, attempt: number): number {
  const retryAfter = Number.parseFloat(headers["retry-after"] || "");
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(15_000, retryAfter * 1000);
  return Math.min(8000, 700 * (2 ** attempt));
}

async function requestText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const cached = cachedResponse(url);
  if (cached !== null) return cached;
  const existing = requestInFlight.get(url);
  if (existing) return existing;

  const request = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await throttle(url);
      try {
        const response = await rawGet(url, { Accept: "application/json", ...headers });
        if (response.status >= 200 && response.status < 300) {
          cacheResponse(url, response.body);
          return response.body;
        }
        const error = new MetadataRequestError(`文献元数据服务返回 ${response.status}`, response.status);
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === 2) throw error;
        lastError = error;
        await wait(retryDelay(response.headers, attempt));
      } catch (error) {
        lastError = error;
        if (error instanceof MetadataRequestError || attempt === 2) throw error;
        await wait(700 * (2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("文献元数据网络不可用");
  })().finally(() => requestInFlight.delete(url));

  requestInFlight.set(url, request);
  return request;
}

async function getJson<T>(url: string, apiKey = ""): Promise<T> {
  const body = await requestText(url, apiKey.trim() ? { "x-api-key": apiKey.trim() } : {});
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new MetadataRequestError("文献元数据服务返回了无法解析的数据");
  }
}

function paperIdentifiers(fileName: string, firstPages: string): { arxiv?: string; doi?: string } {
  const arxiv = `${fileName} ${firstPages}`.match(/(?:arXiv[:\s]*)?(\d{4}\.\d{4,5})(?:v\d+)?/i)?.[1];
  const doi = firstPages.replace(/\s+/g, "").match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0]?.replace(/[.,;)]$/, "");
  return { arxiv, doi };
}

export async function resolveSemanticScholarPaperId(
  title: string,
  fileName: string,
  firstPages: string,
  apiKey: string,
): Promise<string | null> {
  const { arxiv, doi } = paperIdentifiers(fileName, firstPages);
  const identifier = arxiv ? `ARXIV:${arxiv}` : doi ? `DOI:${doi}` : "";
  const fields = "paperId,title";
  if (identifier) {
    try {
      const paper = await getJson<SemanticScholarPaper>(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(identifier)}?fields=${fields}`, apiKey);
      if (paper.paperId && titleSimilarity(title, paper.title || "") >= 0.72) return paper.paperId;
    } catch (error) {
      if (!(error instanceof MetadataRequestError) || error.status !== 404) throw error;
    }
  }

  const query = new URLSearchParams({ query: title, limit: "5", fields });
  const result = await getJson<{ data?: SemanticScholarPaper[] }>(`https://api.semanticscholar.org/graph/v1/paper/search?${query}`, apiKey);
  const match = (result.data || [])
    .map((paper) => ({ paper, score: titleSimilarity(title, paper.title || "") }))
    .sort((left, right) => right.score - left.score)[0];
  return match && match.score >= 0.72 ? match.paper.paperId || null : null;
}

export async function loadSemanticScholarRelations(
  documentId: string,
  paperId: string,
  relation: "references" | "citations",
  apiKey: string,
): Promise<CitationCard[]> {
  const fields = "paperId,title,authors,year,venue,abstract,citationCount,externalIds,openAccessPdf,url";
  const query = new URLSearchParams({ limit: "100", fields });
  const result = await getJson<{ data?: SemanticScholarRelation[] }>(
    `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}/${relation}?${query}`,
    apiKey,
  );
  return (result.data || []).flatMap((entry, index) => {
    const paper = relation === "references" ? entry.citedPaper : entry.citingPaper;
    if (!paper?.paperId || !clean(paper.title)) return [];
    const authors = (paper.authors || []).map((author) => clean(author.name)).filter(Boolean).join(", ");
    const doi = paper.externalIds?.DOI;
    const url = paper.url || (doi ? `https://doi.org/${doi}` : paper.externalIds?.ArXiv ? `https://arxiv.org/abs/${paper.externalIds.ArXiv}` : undefined);
    const metadata = { authors, title: clean(paper.title), year: paper.year, venue: clean(paper.venue), doi, url };
    return [{
      id: `semantic-scholar-${paper.paperId}`,
      paperId: paper.paperId,
      documentId,
      pageNumber: 1,
      quote: "",
      title: metadata.title,
      authors,
      year: paper.year,
      venue: metadata.venue || undefined,
      doi,
      url,
      openAccessPdf: paper.openAccessPdf?.url,
      abstract: clean(paper.abstract) || undefined,
      citationCount: paper.citationCount,
      referenceNumber: relation === "references" ? index + 1 : undefined,
      source: "semantic-scholar",
      saved: false,
      format: "apa",
      formatted: formatCitation("apa", metadata),
      createdAt: new Date().toISOString(),
    } satisfies CitationCard];
  });
}

function moonlightCitation(documentId: string, paper: MoonlightScholarPaper, index: number, relation: "references" | "citations"): CitationCard | null {
  const title = clean(paper.title);
  const paperId = clean(paper.semantic_scholar_paper_id);
  if (!title || !paperId) return null;
  const authors = (paper.authors || []).map((author) => clean(author.name)).filter(Boolean).join(", ");
  const metadata = { authors, title, year: paper.year, venue: clean(paper.venue), url: paper.url };
  return {
    id: `moonlight-${paperId}`,
    paperId,
    documentId,
    pageNumber: 1,
    quote: "",
    title,
    authors,
    year: paper.year,
    venue: metadata.venue || undefined,
    url: paper.url,
    openAccessPdf: paper.pdf_url || undefined,
    abstract: clean(paper.abstract) || undefined,
    citationCount: paper.citation_count,
    referenceNumber: relation === "references" ? index + 1 : undefined,
    source: "moonlight",
    saved: false,
    format: "apa",
    formatted: formatCitation("apa", metadata),
    createdAt: new Date().toISOString(),
  };
}

async function loadMoonlightBundle(request: OnlineCitationMetadataRequest): Promise<{ references: CitationCard[]; citations: CitationCard[] } | null> {
  const url = `https://api.themoonlight.io/api/scholar/anonymous/search-with-ref?query=${encodeURIComponent(request.title)}`;
  const bundle = await getJson<MoonlightScholarBundle>(url);
  if (!bundle.semanticScholarPaper || titleSimilarity(request.title, bundle.semanticScholarPaper.title || "") < 0.72) return null;
  return {
    references: (bundle.semanticScholarPaperReferences || []).flatMap((paper, index) => {
      const citation = moonlightCitation(request.documentId, paper, index, "references");
      return citation ? [citation] : [];
    }),
    citations: (bundle.semanticScholarPaperCitations || []).flatMap((paper, index) => {
      const citation = moonlightCitation(request.documentId, paper, index, "citations");
      return citation ? [citation] : [];
    }),
  };
}

function openAlexId(value?: string): string {
  return clean(value).split("/").at(-1) || "";
}

function openAlexAbstract(index?: Record<string, number[]>): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      if (position >= 0 && position < 20_000) words[position] = word;
    }
  }
  return clean(words.filter(Boolean).join(" ")) || undefined;
}

function openAlexCitation(documentId: string, paper: OpenAlexWork, referenceNumber?: number): CitationCard | null {
  const title = clean(paper.title || paper.display_name);
  const paperId = openAlexId(paper.id);
  if (!title || !paperId) return null;
  const authors = (paper.authorships || []).map((item) => clean(item.author?.display_name)).filter(Boolean).join(", ");
  const doi = clean(paper.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "") || undefined;
  const venue = clean(paper.primary_location?.source?.display_name) || undefined;
  const url = doi ? `https://doi.org/${doi}` : paper.best_oa_location?.landing_page_url || paper.primary_location?.landing_page_url || paper.id;
  const metadata = { authors, title, year: paper.publication_year, venue: venue || "", doi, url };
  return {
    id: `openalex-${paperId}`,
    paperId,
    documentId,
    pageNumber: 1,
    quote: "",
    title,
    authors,
    year: paper.publication_year,
    venue,
    doi,
    url,
    openAccessPdf: paper.best_oa_location?.pdf_url || paper.primary_location?.pdf_url,
    abstract: openAlexAbstract(paper.abstract_inverted_index),
    citationCount: paper.cited_by_count,
    referenceNumber,
    source: "openalex",
    saved: false,
    format: "apa",
    formatted: formatCitation("apa", metadata),
    createdAt: new Date().toISOString(),
  };
}

const OPENALEX_FIELDS = [
  "id", "doi", "title", "display_name", "publication_year", "cited_by_count", "referenced_works",
  "abstract_inverted_index", "authorships", "primary_location", "best_oa_location",
].join(",");

function openAlexMatchScore(request: OnlineCitationMetadataRequest, paper: OpenAlexWork): number {
  let score = titleSimilarity(request.title, paper.title || paper.display_name || "");
  if (request.year && paper.publication_year && Math.abs(request.year - paper.publication_year) > 2) score -= 0.35;
  return score;
}

async function resolveOpenAlexWork(request: OnlineCitationMetadataRequest): Promise<OpenAlexWork | null> {
  const { arxiv, doi } = paperIdentifiers(request.fileName, request.firstPages);
  const strongDoi = doi || (arxiv ? `10.48550/arXiv.${arxiv}` : "");
  if (strongDoi) {
    const query = new URLSearchParams({ filter: `doi:${strongDoi}`, "per-page": "1", select: OPENALEX_FIELDS });
    const exact = await getJson<{ results?: OpenAlexWork[] }>(`https://api.openalex.org/works?${query}`);
    const paper = exact.results?.[0];
    if (paper && openAlexMatchScore(request, paper) >= 0.62) return paper;
  }

  const query = new URLSearchParams({ search: request.title, "per-page": "10", select: OPENALEX_FIELDS });
  const result = await getJson<{ results?: OpenAlexWork[] }>(`https://api.openalex.org/works?${query}`);
  const match = (result.results || [])
    .map((paper) => ({ paper, score: openAlexMatchScore(request, paper) }))
    .sort((left, right) => right.score - left.score)[0];
  return match && match.score >= 0.72 ? match.paper : null;
}

async function loadOpenAlexWorks(ids: string[]): Promise<OpenAlexWork[]> {
  const uniqueIds = [...new Set(ids.map(openAlexId).filter(Boolean))].slice(0, 100);
  if (!uniqueIds.length) return [];
  const query = new URLSearchParams({
    filter: `openalex_id:${uniqueIds.join("|")}`,
    "per-page": String(uniqueIds.length),
    select: OPENALEX_FIELDS,
  });
  const result = await getJson<{ results?: OpenAlexWork[] }>(`https://api.openalex.org/works?${query}`);
  return result.results || [];
}

async function loadOpenAlexBundle(request: OnlineCitationMetadataRequest): Promise<{ references: CitationCard[]; citations: CitationCard[] } | null> {
  const paper = await resolveOpenAlexWork(request);
  const paperId = openAlexId(paper?.id);
  if (!paper || !paperId) return null;

  const referenceIds = paper.referenced_works || [];
  const [referenceWorks, citationResult] = await Promise.all([
    loadOpenAlexWorks(referenceIds),
    getJson<{ results?: OpenAlexWork[] }>(`https://api.openalex.org/works?${new URLSearchParams({
      filter: `cites:${paperId}`,
      "per-page": "100",
      sort: "cited_by_count:desc",
      select: OPENALEX_FIELDS,
    })}`),
  ]);
  const referenceById = new Map(referenceWorks.map((item) => [openAlexId(item.id), item]));
  return {
    references: referenceIds.flatMap((id, index) => {
      const citation = openAlexCitation(request.documentId, referenceById.get(openAlexId(id)) || {}, index + 1);
      return citation ? [citation] : [];
    }),
    citations: (citationResult.results || []).flatMap((item) => {
      const citation = openAlexCitation(request.documentId, item);
      return citation ? [citation] : [];
    }),
  };
}

async function loadSemanticScholarBundle(request: OnlineCitationMetadataRequest, apiKey: string): Promise<{ references: CitationCard[]; citations: CitationCard[] } | null> {
  const paperId = await resolveSemanticScholarPaperId(request.title, request.fileName, request.firstPages, apiKey);
  if (!paperId) return null;
  const [references, citations] = await Promise.all([
    loadSemanticScholarRelations(request.documentId, paperId, "references", apiKey),
    loadSemanticScholarRelations(request.documentId, paperId, "citations", apiKey),
  ]);
  return { references, citations };
}

function stripMarkup(value?: string): string {
  return clean(value?.replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|#160);/gi, " ").replace(/&amp;/gi, "&"));
}

function crossrefYear(work: CrossrefWork): number | undefined {
  const year = work.published?.["date-parts"]?.[0]?.[0];
  return Number.isInteger(year) ? year : undefined;
}

function crossrefMatchScore(request: OnlineCitationMetadataRequest, work: CrossrefWork): number {
  const year = crossrefYear(work);
  let score = titleSimilarity(request.title, work.title?.[0] || "");
  if (request.year && year) score += Math.abs(request.year - year) <= 1 ? 0.08 : -0.35;
  return score;
}

async function resolveCrossrefWork(request: OnlineCitationMetadataRequest): Promise<CrossrefWork | null> {
  const { doi } = paperIdentifiers(request.fileName, request.firstPages);
  if (doi) {
    try {
      const result = await getJson<{ message?: CrossrefWork }>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      if (result.message && crossrefMatchScore(request, result.message) >= 0.78) return result.message;
    } catch (error) {
      if (!(error instanceof MetadataRequestError) || error.status !== 404) throw error;
    }
  }

  const query = new URLSearchParams({
    "query.title": request.title,
    rows: "5",
    select: "DOI,title,author,published,container-title,is-referenced-by-count,URL,abstract,reference",
  });
  const result = await getJson<{ message?: { items?: CrossrefWork[] } }>(`https://api.crossref.org/works?${query}`);
  const match = (result.message?.items || [])
    .map((work) => ({ work, score: crossrefMatchScore(request, work) }))
    .sort((left, right) => right.score - left.score)[0];
  return match && match.score >= 0.88 ? match.work : null;
}

function crossrefReferenceCitation(documentId: string, reference: CrossrefReference, index: number): CitationCard | null {
  const title = clean(reference["article-title"]);
  if (!title) return null;
  const doi = clean(reference.DOI) || undefined;
  const yearValue = Number.parseInt(reference.year || "", 10);
  const year = Number.isInteger(yearValue) ? yearValue : undefined;
  const authors = clean(reference.author);
  const venue = clean(reference["journal-title"]) || undefined;
  const url = doi ? `https://doi.org/${doi}` : undefined;
  const metadata = { title, authors, year, venue: venue || "", doi, url };
  return {
    id: `crossref-${doi || normalizeTitle(title)}-${index}`,
    documentId,
    pageNumber: 1,
    quote: "",
    title,
    authors,
    year,
    venue,
    doi,
    url,
    referenceNumber: index + 1,
    rawReference: clean(reference.unstructured) || undefined,
    source: "crossref",
    saved: false,
    format: "apa",
    formatted: formatCitation("apa", metadata),
    createdAt: new Date().toISOString(),
  };
}

async function loadCrossrefBundle(request: OnlineCitationMetadataRequest): Promise<{ references: CitationCard[]; citations: CitationCard[] } | null> {
  const work = await resolveCrossrefWork(request);
  if (!work) return null;
  return {
    references: (work.reference || []).flatMap((reference, index) => {
      const citation = crossrefReferenceCitation(request.documentId, reference, index);
      return citation ? [citation] : [];
    }),
    citations: [],
  };
}

function enrichReferenceMetadata(primary: CitationCard[], supplemental: CitationCard[]): CitationCard[] {
  if (!primary.length) return supplemental;
  if (!supplemental.length) return primary;
  return primary.map((item) => {
    const match = supplemental
      .map((candidate) => ({ candidate, score: titleSimilarity(item.title, candidate.title) }))
      .sort((left, right) => right.score - left.score)[0];
    if (!match || match.score < 0.72) return item;
    return {
      ...item,
      authors: item.authors || match.candidate.authors,
      year: item.year || match.candidate.year,
      venue: item.venue || match.candidate.venue,
      doi: item.doi || match.candidate.doi,
      url: item.url || match.candidate.url,
      abstract: item.abstract || match.candidate.abstract,
    };
  });
}

export async function loadOnlineCitationMetadata(request: OnlineCitationMetadataRequest): Promise<OnlineCitationMetadataResult> {
  const key = request.semanticScholarApiKey.trim();
  const desktop = isTauri();
  const providers: Array<{
    id: CitationMetadataProvider;
    load: () => Promise<{ references: CitationCard[]; citations: CitationCard[] } | null>;
  }> = [
    ...(desktop && key ? [{ id: "semantic-scholar" as const, load: () => loadSemanticScholarBundle(request, key) }] : []),
    ...(desktop ? [{ id: "moonlight" as const, load: () => loadMoonlightBundle(request) }] : []),
    { id: "openalex", load: () => loadOpenAlexBundle(request) },
    ...(desktop && !key ? [{ id: "semantic-scholar" as const, load: () => loadSemanticScholarBundle(request, "") }] : []),
  ];
  const attempts: CitationMetadataAttempt[] = [];

  let primary: { references: CitationCard[]; citations: CitationCard[] } | null = null;
  let primaryProvider: CitationMetadataProvider | undefined;

  for (const provider of providers) {
    try {
      const result = await provider.load();
      if (!result) {
        attempts.push({ provider: provider.id, status: "not-found" });
        continue;
      }
      attempts.push({ provider: provider.id, status: "ready" });
      primary = result;
      primaryProvider = provider.id;
      break;
    } catch (error) {
      attempts.push({
        provider: provider.id,
        status: "unavailable",
        message: error instanceof Error ? error.message : "网络请求失败",
      });
    }
  }

  let crossref: { references: CitationCard[]; citations: CitationCard[] } | null = null;
  try {
    crossref = await loadCrossrefBundle(request);
    attempts.push({ provider: "crossref", status: crossref ? "ready" : "not-found" });
  } catch (error) {
    attempts.push({
      provider: "crossref",
      status: "unavailable",
      message: error instanceof Error ? error.message : "网络请求失败",
    });
  }

  if (primary || crossref) {
    const references = enrichReferenceMetadata(primary?.references || [], crossref?.references || []);
    return {
      references,
      citations: primary?.citations || [],
      provider: primaryProvider || (crossref ? "crossref" : undefined),
      attempts,
      allSourcesFailed: false,
    };
  }

  return {
    references: [],
    citations: [],
    attempts,
    allSourcesFailed: attempts.length > 0 && attempts.every((attempt) => attempt.status === "unavailable"),
  };
}

export function mergeReferenceMetadata(local: CitationCard[], remote: CitationCard[]): CitationCard[] {
  if (!remote.length) return local;
  if (!local.length) return remote;
  const unmatchedRemote = [...remote];
  const merged = local.map((item) => {
    const matchIndex = unmatchedRemote
      .map((candidate, candidateIndex) => ({ candidateIndex, score: titleSimilarity(item.title, candidate.title) }))
      .sort((left, right) => right.score - left.score)[0];
    const remoteMatch = matchIndex && matchIndex.score >= 0.58 ? unmatchedRemote.splice(matchIndex.candidateIndex, 1)[0] : undefined;
    if (!remoteMatch) return item;
    return {
      ...item,
      ...remoteMatch,
      id: item.id,
      documentId: item.documentId,
      pageNumber: item.pageNumber,
      referenceNumber: item.referenceNumber,
      rawReference: item.rawReference,
      saved: false,
    };
  });
  return [...merged, ...unmatchedRemote.map((item, index) => ({
    ...item,
    referenceNumber: item.referenceNumber || merged.length + index + 1,
  }))];
}
