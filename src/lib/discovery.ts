import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocumentLibraryEntry } from "../types";
import { readBrandedStorage } from "./brand-storage";

export type DiscoverySource = "moonlight" | "semantic-scholar" | "openalex" | "huggingface" | "arxiv";

export type DiscoveryPaper = {
  slug: string;
  title: string;
  authors: string[];
  url: string;
  pdfUrl?: string;
  summary?: string;
  categories: string[];
  publishedDate?: string;
  venue?: string;
  citationCount?: number;
  upvotes?: number;
  huggingFaceUrl?: string;
  githubUrl?: string;
  githubUrlVerified?: boolean;
  projectUrl?: string;
  source: DiscoverySource;
  sources?: DiscoverySource[];
  popularityScore?: number;
  recommendationScore?: number;
  recommendationReason?: string;
  matchScore: number;
};

type MoonlightPaper = {
  slug?: string;
  title?: string;
  authors?: string[];
  url?: string;
  pdf_url?: string;
  one_line_summary?: string;
  categories?: string[];
  published_date?: string;
};

type MoonlightSearchResponse = { results?: MoonlightPaper[] };
type MoonlightReviewResponse = MoonlightPaper & { similar_papers?: MoonlightPaper[] };
type DesktopHttpResponse = { status: number; body: string };

type SemanticScholarPaper = {
  paperId?: string;
  title?: string;
  authors?: Array<{ name?: string }>;
  year?: number;
  venue?: string;
  abstract?: string;
  citationCount?: number;
  tldr?: { text?: string };
  openAccessPdf?: { url?: string };
  externalIds?: { ArXiv?: string; DOI?: string };
  fieldsOfStudy?: string[];
  url?: string;
};

type OpenAlexWork = {
  id?: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { landing_page_url?: string; pdf_url?: string; source?: { display_name?: string } };
  best_oa_location?: { landing_page_url?: string; pdf_url?: string };
};

type HuggingFaceAuthor = { name?: string } | string;
type HuggingFacePaper = {
  id?: string;
  title?: string;
  summary?: string;
  authors?: HuggingFaceAuthor[];
  publishedAt?: string;
  upvotes?: number;
  githubRepo?: string;
  projectPage?: string;
};
type HuggingFaceDailyItem = HuggingFacePaper & {
  paper?: HuggingFacePaper;
  submittedOnDailyAt?: string;
};

// Moonlight's web frontend is hosted on www.themoonlight.io, but its JSON API
// is served from a separate Express origin. The old www host is protected by
// Vercel's browser challenge and returns HTML/429 to native clients.
const MOONLIGHT_API = "https://api.themoonlight.io/api";
const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1";
const HUGGING_FACE_DAILY_API = "https://huggingface.co/api/daily_papers";
const MATCH_SCORE_KEY = "whalepaper.discovery-match-scores.v1";
const DAILY_CACHE_KEY = "whalepaper.huggingface-daily.v1";
const TRENDING_CACHE_KEY = "whalepaper.moonlight-trending.v1";
const DAILY_CACHE_TTL = 6 * 60 * 60 * 1000;
const TRENDING_CACHE_TTL = 30 * 60 * 1000;
const ARXIV_API = "https://export.arxiv.org/api/query";
const relatedRequests = new Map<string, Promise<DiscoveryPaper[]>>();
let popularRequest: Promise<DiscoveryPaper[]> | null = null;
let dailyRequest: Promise<DiscoveryPaper[]> | null = null;
let trendingRequest: Promise<DiscoveryPaper[]> | null = null;

function clean(value?: string): string {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function summaryConfirmsUrl(summary: string, url: string): boolean {
  if (!summary || !url) return false;
  const normalizedSummary = summary.toLocaleLowerCase();
  const normalizedUrl = url.toLocaleLowerCase().replace(/\/$/, "");
  return normalizedSummary.includes(normalizedUrl);
}

function normalizeTitle(value: string): string {
  return clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function titleSimilarity(left: string, right: string): number {
  const leftWords = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const rightWords = new Set(normalizeTitle(right).split(" ").filter(Boolean));
  if (!leftWords.size || !rightWords.size) return 0;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return (2 * overlap) / (leftWords.size + rightWords.size);
}

function stableMatchScore(key: string): number {
  let scores: Record<string, number> = {};
  try {
    scores = JSON.parse(readBrandedStorage(MATCH_SCORE_KEY) || "{}") as Record<string, number>;
  } catch {
    scores = {};
  }
  if (scores[key]) return scores[key];
  let hash = 0;
  for (const character of key) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  const score = 50 + Math.abs(hash % 41);
  try {
    localStorage.setItem(MATCH_SCORE_KEY, JSON.stringify({ ...scores, [key]: score }));
  } catch {
    // Recommendations remain usable when storage is unavailable.
  }
  return score;
}

async function requestJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  let status: number;
  let body: string;
  if (isTauri()) {
    const response = await invoke<DesktopHttpResponse>("ai_http_request", {
      request: { url, method: "GET", headers: { Accept: "application/json", ...headers } },
    });
    status = response.status;
    body = response.body;
  } else {
    const browserUrl = url.startsWith(MOONLIGHT_API)
      ? url.replace(MOONLIGHT_API, "/moonlight-api")
      : url.startsWith(SEMANTIC_SCHOLAR_API)
        ? url.replace(SEMANTIC_SCHOLAR_API, "/semantic-scholar-api")
        : url === HUGGING_FACE_DAILY_API
          ? "/huggingface-api/daily_papers"
          : url.startsWith(ARXIV_API)
            ? url.replace(ARXIV_API, "/arxiv-api")
            : url;
    const response = await fetch(browserUrl, { headers: { Accept: "application/json", ...headers } });
    status = response.status;
    body = await response.text();
  }
  if (status < 200 || status >= 300) throw new Error(`论文推荐服务返回 ${status}`);
  return JSON.parse(body) as T;
}

async function requestText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const mergedHeaders = { Accept: "application/atom+xml, application/xml, text/xml, */*", ...headers };
  if (isTauri()) {
    const response = await invoke<DesktopHttpResponse>("ai_http_request", {
      request: { url, method: "GET", headers: mergedHeaders },
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`论文推荐服务返回 ${response.status}`);
    return response.body;
  }
  const browserUrl = url.startsWith(ARXIV_API) ? url.replace(ARXIV_API, "/arxiv-api") : url;
  const response = await fetch(browserUrl, { headers: mergedHeaders });
  if (!response.ok) throw new Error(`论文推荐服务返回 ${response.status}`);
  return response.text();
}

function huggingFacePaper(item: HuggingFaceDailyItem): DiscoveryPaper | null {
  const paper = item.paper || item;
  const id = clean(paper.id);
  const title = clean(paper.title);
  if (!id || !title) return null;
  const arxivId = id.split("/").at(-1) || id;
  const summary = clean(paper.summary || item.summary);
  const candidateGithubUrl = clean(paper.githubRepo || item.githubRepo);
  const githubUrl = summaryConfirmsUrl(summary, candidateGithubUrl) ? candidateGithubUrl : undefined;
  const projectUrl = clean(paper.projectPage || item.projectPage) || undefined;
  const authors = (paper.authors || []).map((author) => clean(typeof author === "string" ? author : author.name)).filter(Boolean);
  return {
    slug: `hf-${arxivId}`,
    title,
    authors,
    url: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    summary: summary || undefined,
    categories: ["Hugging Face Daily Papers"],
    publishedDate: paper.publishedAt || item.submittedOnDailyAt,
    upvotes: paper.upvotes ?? item.upvotes,
    huggingFaceUrl: `https://huggingface.co/papers/${arxivId}`,
    githubUrl,
    githubUrlVerified: Boolean(githubUrl),
    projectUrl,
    source: "huggingface",
    matchScore: stableMatchScore(`hf-${arxivId}`),
  };
}

type PaperCache = { cachedAt: number; papers: DiscoveryPaper[] };

function readPaperCache(key: string): PaperCache | null {
  try {
    const cache = JSON.parse(readBrandedStorage(key) || "null") as PaperCache | null;
    if (!cache || !Array.isArray(cache.papers)) return null;
    return {
      ...cache,
      papers: cache.papers.map((paper) => ({
        ...paper,
        githubUrl: paper.githubUrlVerified ? paper.githubUrl : undefined,
      })),
    };
  } catch {
    return null;
  }
}

async function requestDailyPapers(): Promise<DiscoveryPaper[]> {
  const items = await requestJson<HuggingFaceDailyItem[]>(HUGGING_FACE_DAILY_API);
  const papers = items.flatMap((item) => {
    const paper = huggingFacePaper(item);
    return paper ? [paper] : [];
  });
  try {
    localStorage.setItem(DAILY_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), papers } satisfies PaperCache));
  } catch {
    // Live results remain available when local storage is full or unavailable.
  }
  return papers;
}

export function loadDailyPapers(forceRefresh = false): Promise<DiscoveryPaper[]> {
  const cache = readPaperCache(DAILY_CACHE_KEY);
  if (!forceRefresh && cache && Date.now() - cache.cachedAt < DAILY_CACHE_TTL) return Promise.resolve(cache.papers);
  if (!forceRefresh && dailyRequest) return dailyRequest;
  const request = requestDailyPapers().catch((error) => {
    if (cache?.papers.length) return cache.papers;
    throw error;
  }).finally(() => {
    dailyRequest = null;
  });
  dailyRequest = request;
  return request;
}

function moonlightPaper(paper: MoonlightPaper): DiscoveryPaper | null {
  const title = clean(paper.title);
  const slug = clean(paper.slug);
  const url = clean(paper.url);
  if (!title || !slug || !url) return null;
  const pdfUrl = clean(paper.pdf_url).replace(/^http:\/\//i, "https://") || undefined;
  return {
    slug,
    title,
    authors: paper.authors || [],
    url: url.replace(/^http:\/\//i, "https://"),
    pdfUrl,
    summary: clean(paper.one_line_summary) || undefined,
    categories: paper.categories || [],
    publishedDate: paper.published_date,
    source: "moonlight",
    matchScore: stableMatchScore(slug),
  };
}

function shortenedSummary(value?: string): string | undefined {
  const summary = clean(value);
  return summary ? `${summary.slice(0, 240)}${summary.length > 240 ? "..." : ""}` : undefined;
}

function semanticScholarPaper(paper: SemanticScholarPaper): DiscoveryPaper | null {
  const title = clean(paper.title);
  const paperId = clean(paper.paperId);
  if (!title || !paperId) return null;
  const arxivId = clean(paper.externalIds?.ArXiv);
  const doi = clean(paper.externalIds?.DOI);
  const url = clean(paper.url) || (arxivId ? `https://arxiv.org/abs/${arxivId}` : doi ? `https://doi.org/${doi}` : `https://www.semanticscholar.org/paper/${paperId}`);
  const pdfUrl = clean(paper.openAccessPdf?.url) || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : "");
  return {
    slug: `s2-${paperId}`,
    title,
    authors: (paper.authors || []).map((author) => clean(author.name)).filter(Boolean),
    url,
    pdfUrl: pdfUrl || undefined,
    summary: shortenedSummary(paper.tldr?.text || paper.abstract),
    categories: paper.fieldsOfStudy || [],
    publishedDate: paper.year ? `${paper.year}` : undefined,
    venue: clean(paper.venue) || undefined,
    citationCount: paper.citationCount,
    source: "semantic-scholar",
    matchScore: stableMatchScore(`s2-${paperId}`),
  };
}

function openAlexAbstract(index?: Record<string, number[]>): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) if (position >= 0 && position < 20_000) words[position] = word;
  }
  const abstract = clean(words.filter(Boolean).join(" "));
  return abstract ? `${abstract.slice(0, 190)}${abstract.length > 190 ? "..." : ""}` : undefined;
}

function openAlexPaper(work: OpenAlexWork): DiscoveryPaper | null {
  const title = clean(work.title);
  const id = clean(work.id).split("/").at(-1) || "";
  if (!title || !id) return null;
  const doi = clean(work.doi);
  const url = doi || work.best_oa_location?.landing_page_url || work.primary_location?.landing_page_url || work.id || "";
  return {
    slug: id,
    title,
    authors: (work.authorships || []).map((item) => clean(item.author?.display_name)).filter(Boolean),
    url,
    pdfUrl: work.best_oa_location?.pdf_url || work.primary_location?.pdf_url,
    summary: openAlexAbstract(work.abstract_inverted_index),
    categories: [],
    publishedDate: work.publication_year ? `${work.publication_year}` : undefined,
    venue: clean(work.primary_location?.source?.display_name) || undefined,
    citationCount: work.cited_by_count,
    source: "openalex",
    matchScore: stableMatchScore(id),
  };
}

const OPENALEX_FIELDS = [
  "id", "doi", "title", "publication_year", "cited_by_count", "abstract_inverted_index",
  "authorships", "primary_location", "best_oa_location",
].join(",");

async function loadOpenAlexRelated(title: string): Promise<DiscoveryPaper[]> {
  const search = new URLSearchParams({ search: title, "per-page": "12", select: OPENALEX_FIELDS });
  const response = await requestJson<{ results?: OpenAlexWork[] }>(`https://api.openalex.org/works?${search}`);
  return (response.results || []).flatMap((work) => {
    const paper = openAlexPaper(work);
    if (!paper || normalizeTitle(paper.title) === normalizeTitle(title)) return [];
    return [paper];
  });
}

async function loadArxivSearch(query: string): Promise<DiscoveryPaper[]> {
  const url = `${ARXIV_API}?search_query=all:${encodeURIComponent(query)}&start=0&max_results=20&sortBy=relevance`;
  const xml = await requestText(url);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap((match) => {
    const block = match[1];
    const read = (tag: string) => (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const id = read("id").split("/").pop() || "";
    const title = read("title").replace(/\s+/g, " ");
    if (!id || !title) return [];
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map((m) => clean(m[1]));
    const summary = clean(read("summary"));
    return [{ slug: `arxiv-${id}`, title, authors, url: `https://arxiv.org/abs/${id}`, pdfUrl: `https://arxiv.org/pdf/${id}`, summary: shortenedSummary(summary), categories: ["arXiv"], publishedDate: read("published"), source: "arxiv", matchScore: stableMatchScore(`arxiv-${id}`) } satisfies DiscoveryPaper];
  });
}

export async function searchPapers(query: string): Promise<DiscoveryPaper[]> {
  const requests = await Promise.allSettled([
    settleWithin(loadMoonlightRelated(query), 6_000),
    settleWithin(loadOpenAlexRelated(query), 6_000),
    settleWithin(loadArxivSearch(query), 6_000),
  ]);
  return mergeRelatedPapers("", requests.flatMap((r) => r.status === "fulfilled" ? [r.value] : []));
}

async function loadSemanticScholarRelated(title: string, apiKey: string): Promise<DiscoveryPaper[]> {
  const fields = [
    "paperId", "title", "authors", "year", "venue", "abstract", "citationCount", "tldr",
    "openAccessPdf", "externalIds", "fieldsOfStudy", "url",
  ].join(",");
  const query = new URLSearchParams({ query: title, limit: "10", fields });
  const headers: Record<string, string> = apiKey.trim() ? { "x-api-key": apiKey.trim() } : {};
  const response = await requestJson<{ data?: SemanticScholarPaper[] }>(`${SEMANTIC_SCHOLAR_API}/paper/search?${query}`, headers);
  return (response.data || []).flatMap((paper) => {
    const result = semanticScholarPaper(paper);
    if (!result || normalizeTitle(result.title) === normalizeTitle(title)) return [];
    return [result];
  });
}

async function loadMoonlightRelated(title: string): Promise<DiscoveryPaper[]> {
  let searchCandidates: DiscoveryPaper[] = [];
  try {
    const search = await requestJson<MoonlightSearchResponse>(`${MOONLIGHT_API}/review/search?query=${encodeURIComponent(title)}`);
    const rankedResults = (search.results || [])
      .map((paper) => ({ paper, score: titleSimilarity(title, paper.title || "") }))
      .sort((left, right) => right.score - left.score);
    const match = rankedResults[0];
    searchCandidates = rankedResults.flatMap(({ paper }) => {
      if (normalizeTitle(paper.title || "") === normalizeTitle(title)) return [];
      const result = moonlightPaper(paper);
      return result ? [result] : [];
    });
    if (match?.paper.slug && match.score >= 0.68) {
      try {
        const review = await requestJson<MoonlightReviewResponse>(`${MOONLIGHT_API}/review/${encodeURIComponent(match.paper.slug)}?language=zh`);
        const papers = (review.similar_papers || []).flatMap((paper) => {
          const result = moonlightPaper(paper);
          return result ? [result] : [];
        });
        if (papers.length) return papers;
      } catch {
        // Search results below are the closest Moonlight fallback when a review is unavailable.
      }
    }
  } catch (error) {
    throw error;
  }
  return searchCandidates;
}

function mergeRelatedPapers(title: string, sources: DiscoveryPaper[][]): DiscoveryPaper[] {
  const currentTitle = normalizeTitle(title);
  const seenTitles = new Set<string>();
  const papers: DiscoveryPaper[] = [];
  for (const paper of sources.flat()) {
    const normalized = normalizeTitle(paper.title);
    if (!normalized || normalized === currentTitle || seenTitles.has(normalized)) continue;
    seenTitles.add(normalized);
    papers.push(paper);
    if (papers.length >= 10) break;
  }
  return papers;
}

async function requestRelatedPapers(title: string, semanticScholarApiKey: string): Promise<DiscoveryPaper[]> {
  const providers = [
    loadMoonlightRelated(title),
    ...(semanticScholarApiKey.trim() ? [loadSemanticScholarRelated(title, semanticScholarApiKey)] : []),
    loadOpenAlexRelated(title),
    loadArxivSearch(title),
  ].map((request) => settleWithin(request, 6_000));
  const requests = await Promise.allSettled(providers);
  const successful = requests.filter((request) => request.status === "fulfilled");
  if (!successful.length) throw new Error("论文推荐服务暂时不可用");
  const sources = successful.map((request) => request.value);
  return mergeRelatedPapers(title, sources);
}

export function loadRelatedPapers(title: string, semanticScholarApiKey = ""): Promise<DiscoveryPaper[]> {
  let keyHash = 0;
  for (const character of semanticScholarApiKey.trim()) keyHash = ((keyHash << 5) - keyHash + character.charCodeAt(0)) | 0;
  const key = `${normalizeTitle(title)}:${keyHash}`;
  const existing = relatedRequests.get(key);
  if (existing) return existing;
  const request = requestRelatedPapers(title, semanticScholarApiKey)
    .then((papers) => {
      if (!papers.length) relatedRequests.delete(key);
      return papers;
    })
    .catch((error) => {
      relatedRequests.delete(key);
      throw error;
    });
  relatedRequests.set(key, request);
  return request;
}

async function requestMoonlightTrending(): Promise<DiscoveryPaper[]> {
  const trending = await requestJson<{ results?: MoonlightPaper[] }>(`${MOONLIGHT_API}/review/trending?windowDays=7&limit=20&language=zh`);
  const papers = (trending.results || []).flatMap((paper) => {
    const result = moonlightPaper(paper);
    return result ? [result] : [];
  });
  try {
    localStorage.setItem(TRENDING_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), papers } satisfies PaperCache));
  } catch {
    // Live results remain available when local storage is unavailable.
  }
  return papers;
}

function loadMoonlightTrending(forceRefresh = false): Promise<DiscoveryPaper[]> {
  const cache = readPaperCache(TRENDING_CACHE_KEY);
  if (!forceRefresh && cache && Date.now() - cache.cachedAt < TRENDING_CACHE_TTL) return Promise.resolve(cache.papers);
  if (!forceRefresh && trendingRequest) return trendingRequest;
  const request = requestMoonlightTrending().catch((error) => {
    if (cache?.papers.length) return cache.papers;
    throw error;
  }).finally(() => {
    trendingRequest = null;
  });
  trendingRequest = request;
  return request;
}

function mergePaper(left: DiscoveryPaper, right: DiscoveryPaper): DiscoveryPaper {
  const sources = Array.from(new Set([...(left.sources || [left.source]), ...(right.sources || [right.source])]));
  const richer = (right.summary?.length || 0) > (left.summary?.length || 0) ? right : left;
  return {
    ...left,
    authors: left.authors.length >= right.authors.length ? left.authors : right.authors,
    pdfUrl: left.pdfUrl || right.pdfUrl,
    summary: richer.summary,
    categories: Array.from(new Set([...left.categories, ...right.categories])),
    publishedDate: left.publishedDate || right.publishedDate,
    venue: left.venue || right.venue,
    upvotes: left.upvotes ?? right.upvotes,
    huggingFaceUrl: left.huggingFaceUrl || right.huggingFaceUrl,
    githubUrl: left.githubUrlVerified ? left.githubUrl : right.githubUrlVerified ? right.githubUrl : undefined,
    githubUrlVerified: Boolean(left.githubUrlVerified || right.githubUrlVerified),
    projectUrl: left.projectUrl || right.projectUrl,
    sources,
  };
}

function freshnessScore(value?: string): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return Math.max(0, 1 - days / 30);
}

function mergePopularPapers(daily: DiscoveryPaper[], trending: DiscoveryPaper[]): DiscoveryPaper[] {
  const merged = new Map<string, DiscoveryPaper>();
  for (const paper of [...daily, ...trending]) {
    const key = normalizeTitle(paper.title);
    const existing = merged.get(key);
    merged.set(key, existing ? mergePaper(existing, paper) : { ...paper, sources: paper.sources || [paper.source] });
  }
  const maxUpvotes = Math.max(1, ...daily.map((paper) => paper.upvotes || 0));
  const hfRanks = new Map(daily.map((paper, index) => [normalizeTitle(paper.title), index]));
  const moonlightRanks = new Map(trending.map((paper, index) => [normalizeTitle(paper.title), index]));
  const scored = [...merged.entries()].map(([key, paper]) => {
    const upvoteScore = Math.log1p(paper.upvotes || 0) / Math.log1p(maxUpvotes);
    const hfRank = hfRanks.get(key);
    const moonlightRank = moonlightRanks.get(key);
    const hfScore = hfRank === undefined ? 0 : Math.max(upvoteScore, 1 - hfRank / Math.max(1, daily.length));
    const moonlightScore = moonlightRank === undefined ? 0 : 1 - moonlightRank / Math.max(1, trending.length);
    const score = 0.4 * hfScore + 0.4 * moonlightScore + 0.2 * freshnessScore(paper.publishedDate);
    return { ...paper, popularityScore: Math.round(score * 100) };
  });
  const maxScore = Math.max(1, ...scored.map((paper) => paper.popularityScore || 0));
  return scored.map((paper) => ({
    ...paper,
    popularityScore: Math.round(((paper.popularityScore || 0) / maxScore) * 100),
  })).sort((left, right) => (right.popularityScore || 0) - (left.popularityScore || 0));
}

export type DiscoveryFeed = {
  latest: DiscoveryPaper[];
  popular: DiscoveryPaper[];
};

function settleWithin<T>(request: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("论文数据源响应超时")), milliseconds);
    request.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

export async function loadDiscoveryFeed(forceRefresh = false): Promise<DiscoveryFeed> {
  const [dailyResult, trendingResult] = await Promise.allSettled([
    settleWithin(loadDailyPapers(forceRefresh), 6_000),
    settleWithin(loadMoonlightTrending(forceRefresh), 6_000),
  ]);
  const daily = dailyResult.status === "fulfilled" ? dailyResult.value : [];
  const trending = trendingResult.status === "fulfilled" ? trendingResult.value : [];
  if (!daily.length && !trending.length) throw new Error("暂时无法读取论文发现内容。");
  const latest = [...(daily.length ? daily : trending)].sort((left, right) => (right.publishedDate || "").localeCompare(left.publishedDate || ""));
  return { latest, popular: mergePopularPapers(daily, trending) };
}

export function loadPopularPapers(forceRefresh = false): Promise<DiscoveryPaper[]> {
  if (!forceRefresh && popularRequest) return popularRequest;
  const request = loadDiscoveryFeed(forceRefresh).then((feed) => feed.popular).finally(() => {
    popularRequest = null;
  });
  popularRequest = request;
  return request;
}

const RECOMMENDATION_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "into", "using", "based", "paper", "study", "analysis",
  "this", "that", "these", "those", "are", "was", "were", "via", "towards", "toward", "new",
]);

function preferenceTokens(value: string): string[] {
  return normalizeTitle(value).split(" ").filter((token) => token.length > 2 && !RECOMMENDATION_STOP_WORDS.has(token));
}

export function buildPersonalRecommendations(papers: DiscoveryPaper[], entries: DocumentLibraryEntry[]): DiscoveryPaper[] {
  if (!entries.length) return [];
  const weights = new Map<string, number>();
  const addTokens = (value: string, weight: number) => {
    for (const token of preferenceTokens(value)) weights.set(token, (weights.get(token) || 0) + weight);
  };
  entries.slice(0, 50).forEach((entry, index) => {
    const recency = Math.max(0.4, 1 - index / 60);
    const interest = recency * (entry.favorite ? 2.5 : 1) * (entry.rating ? 1 + entry.rating / 5 : 1);
    addTokens(entry.title, interest);
    for (const tag of entry.tags || []) addTokens(tag, interest * 2);
  });
  const savedTitles = new Set(entries.map((entry) => normalizeTitle(entry.title)));
  const ranked = papers.filter((paper) => !savedTitles.has(normalizeTitle(paper.title))).map((paper) => {
    const fields = [paper.title, paper.summary || "", paper.categories.join(" ")];
    const matched = new Map<string, number>();
    fields.forEach((field, fieldIndex) => {
      const fieldWeight = [1.8, 0.7, 1.2][fieldIndex];
      for (const token of preferenceTokens(field)) {
        const preference = weights.get(token);
        if (preference) matched.set(token, Math.max(matched.get(token) || 0, preference * fieldWeight));
      }
    });
    const affinity = [...matched.values()].reduce((sum, value) => sum + value, 0);
    const score = affinity * 10 + (paper.popularityScore || 0) * 0.25;
    const topMatches = [...matched.entries()].sort((left, right) => right[1] - left[1]).slice(0, 2).map(([token]) => token);
    return {
      ...paper,
      recommendationScore: Math.round(score),
      recommendationReason: topMatches.length ? `与你关注的 ${topMatches.join("、")} 相关` : "结合近期优质论文推荐",
    };
  }).sort((left, right) => (right.recommendationScore || 0) - (left.recommendationScore || 0));
  return ranked;
}

export function discoveryLibraryId(paper: DiscoveryPaper): string {
  return `citation:${paper.slug}`;
}
