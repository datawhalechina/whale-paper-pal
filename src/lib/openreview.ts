import { invoke, isTauri } from "@tauri-apps/api/core";

type DesktopHttpResponse = { status: number; body: string };

type OpenReviewValue = { value?: unknown } | string | number | string[] | null | undefined;

type OpenReviewNote = {
  id?: string;
  forum?: string;
  cdate?: number;
  tcdate?: number;
  domain?: string;
  invitations?: string[];
  parentInvitations?: string;
  signatures?: string[];
  content?: Record<string, OpenReviewValue>;
  forumContent?: Record<string, OpenReviewValue>;
};

type OpenReviewSearchResponse = {
  notes?: OpenReviewNote[];
  searchUnavailable?: boolean;
};

export type PublicPeerReview = {
  id: string;
  reviewer: string;
  rating?: string;
  confidence?: string;
  soundness?: string;
  presentation?: string;
  contribution?: string;
  summary?: string;
  strengths?: string;
  weaknesses?: string;
  questions?: string;
  date?: string;
};

export type OpenReviewResult = {
  forumId: string;
  title: string;
  venue?: string;
  decision?: string;
  reviews: PublicPeerReview[];
  url: string;
};

function valueOf(value: OpenReviewValue): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) return value.value;
  return value;
}

function textValue(value: OpenReviewValue): string {
  const raw = valueOf(value);
  if (Array.isArray(raw)) return raw.map(String).join("\n").trim();
  return typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
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

async function requestJson<T>(path: string): Promise<T> {
  const url = `https://api2.openreview.net${path}`;
  if (isTauri()) {
    const response = await invoke<DesktopHttpResponse>("ai_http_request", {
      request: { url, method: "GET", headers: { Accept: "application/json" } },
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`OpenReview 返回 ${response.status}`);
    return JSON.parse(response.body) as T;
  }
  const response = await fetch(`/openreview-api${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`OpenReview 返回 ${response.status}`);
  return response.json() as Promise<T>;
}

function isOfficialReview(note: OpenReviewNote): boolean {
  return [...(note.invitations || []), note.parentInvitations || ""].some((item) => /\/Official_Review(?:$|\/)/i.test(item));
}

function isDecision(note: OpenReviewNote): boolean {
  return [...(note.invitations || []), note.parentInvitations || ""].some((item) => /\/(?:Decision|Meta_Review)(?:$|\/)/i.test(item));
}

function distinctiveTerms(title: string): string[] {
  const ignored = new Set(["about", "after", "before", "between", "from", "into", "large", "learning", "model", "models", "network", "paper", "using", "with", "without"]);
  return [...new Set(title.match(/[\p{L}\p{N}][\p{L}\p{N}-]{3,}/gu) || [])]
    .filter((term) => !ignored.has(term.toLocaleLowerCase()))
    .sort((left, right) => Number(right.includes("-")) - Number(left.includes("-")) || right.length - left.length)
    .slice(0, 4);
}

function notePaperTitle(note: OpenReviewNote): string {
  return textValue(note.forumContent?.title) || textValue(note.content?.title);
}

function reviewFromNote(note: OpenReviewNote, index: number): PublicPeerReview {
  const content = note.content || {};
  const timestamp = note.tcdate || note.cdate;
  return {
    id: note.id || `${note.forum || "review"}-${index}`,
    reviewer: `匿名审稿人 ${index + 1}`,
    rating: textValue(content.rating) || textValue(content.recommendation) || undefined,
    confidence: textValue(content.confidence) || undefined,
    soundness: textValue(content.soundness) || textValue(content.correctness) || undefined,
    presentation: textValue(content.presentation) || textValue(content.clarity) || undefined,
    contribution: textValue(content.contribution) || textValue(content.novelty) || undefined,
    summary: textValue(content.summary) || textValue(content.review) || undefined,
    strengths: textValue(content.strengths) || undefined,
    weaknesses: textValue(content.weaknesses) || textValue(content.limitations) || undefined,
    questions: textValue(content.questions) || textValue(content.questions_for_authors) || undefined,
    date: timestamp ? new Date(timestamp).toLocaleDateString("zh-CN") : undefined,
  };
}

const openReviewRequests = new Map<string, Promise<OpenReviewResult | null>>();

async function loadOpenReviewUncached(title: string): Promise<OpenReviewResult | null> {
  const forumNotes = new Map<string, OpenReviewNote>();
  let forumSearchAvailable = false;
  for (const term of [title, ...distinctiveTerms(title)]) {
    const forumSearch = new URLSearchParams({ term, source: "forum", limit: "50" });
    const response = await requestJson<OpenReviewSearchResponse>(`/notes/search?${forumSearch}`);
    if (!response.searchUnavailable) forumSearchAvailable = true;
    for (const note of response.notes || []) {
      if (note.id) forumNotes.set(note.id, note);
    }
    if ([...forumNotes.values()].some((note) => titleSimilarity(title, notePaperTitle(note)) >= 0.98)) break;
  }
  if (!forumSearchAvailable) throw new Error("OpenReview 搜索服务暂时不可用，请稍后重试。");
  const candidates = [...forumNotes.values()]
    .map((note) => ({
      note,
      title: notePaperTitle(note),
      score: titleSimilarity(title, notePaperTitle(note))
        + (note.domain && !/^DBLP\./i.test(note.domain) ? 0.08 : 0)
        + ((note.invitations || []).some((item) => /Submission/i.test(item)) ? 0.05 : 0),
    }))
    .sort((left, right) => right.score - left.score);
  const match = candidates[0];
  if (!match || titleSimilarity(title, match.title) < 0.9) return null;

  const forumId = match.note.forum || match.note.id;
  if (!forumId) return null;

  const replies = new Map<string, OpenReviewNote>();
  let replySearchAvailable = false;
  for (const term of distinctiveTerms(match.title)) {
    const replySearch = new URLSearchParams({ term, source: "reply", limit: "100" });
    const response = await requestJson<OpenReviewSearchResponse>(`/notes/search?${replySearch}`);
    if (!response.searchUnavailable) replySearchAvailable = true;
    for (const note of response.notes || []) {
      if (note.forum === forumId && note.id) replies.set(note.id, note);
    }
    if ([...replies.values()].some(isOfficialReview)) break;
  }
  if (!replySearchAvailable) throw new Error("OpenReview 评审搜索暂时不可用，请稍后重试。");

  const notes = [...replies.values()];
  const reviewNotes = notes.filter(isOfficialReview).sort((left, right) => (left.tcdate || left.cdate || 0) - (right.tcdate || right.cdate || 0));
  const decisionNote = notes.find(isDecision);
  const decision = decisionNote
    ? textValue(decisionNote.content?.decision) || textValue(decisionNote.content?.recommendation) || textValue(decisionNote.content?.metareview)
    : "";
  return {
    forumId,
    title: match.title,
    venue: textValue(match.note.content?.venue) || textValue(match.note.content?.venueid) || undefined,
    decision: decision || undefined,
    reviews: reviewNotes.map(reviewFromNote),
    url: `https://openreview.net/forum?id=${encodeURIComponent(forumId)}`,
  };
}

export function loadOpenReview(title: string): Promise<OpenReviewResult | null> {
  const key = normalizeTitle(title);
  const existing = openReviewRequests.get(key);
  if (existing) return existing;
  const request = loadOpenReviewUncached(title).catch((error) => {
    openReviewRequests.delete(key);
    throw error;
  });
  openReviewRequests.set(key, request);
  return request;
}
