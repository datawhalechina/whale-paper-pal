import type { DocumentWorkspace, PaperReview, ReadingPreferences } from "../types";
import { migrateQuizSession } from "./quiz";
import { getReaderState, READER_WORKSPACE_KEY, setReaderState } from "./reader-store";

const STORAGE_KEY = READER_WORKSPACE_KEY;

function readPaperReview(value: unknown): PaperReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const markdownSections = ["overviewMarkdown", "methodMarkdown", "analysisMarkdown"];
  if (markdownSections.every((key) => typeof source[key] === "string")) return source as PaperReview;
  const requiredStrings = ["executiveSummary", "paperType", "researchQuestion", "methodologySummary", "experimentalEvidence", "reproducibility", "literaturePositioning"];
  const requiredArrays = ["contributions", "strengths", "weaknesses", "takeaways"];
  if (!requiredStrings.every((key) => typeof source[key] === "string") || !requiredArrays.every((key) => Array.isArray(source[key]))) return null;
  return source as PaperReview;
}

export function emptyWorkspace(): DocumentWorkspace {
  return {
    insights: {
      review: null,
    },
    comments: [],
    notes: [],
    citations: [],
    quiz: null,
    translations: [],
    autoHighlights: [],
    ink: [],
    chats: [],
    discussionThreads: [],
    activeDiscussionId: "",
    explanations: [],
    selectionTranslations: [],
    preferences: {
      theme: "original",
      zoom: 1,
      rotation: 0,
      translationFontSize: 15,
      translationViewOpen: false,
      autoTranslateEnabled: false,
      highlightVisibility: {
        manual: { yellow: true, green: true, blue: true, rose: true },
        automatic: true,
        categories: { novelty: true, methods: true, results: true },
        labels: true,
      },
    },
  };
}

function readAll(): Record<string, DocumentWorkspace> {
  try {
    return JSON.parse(getReaderState(STORAGE_KEY) || "{}") as Record<string, DocumentWorkspace>;
  } catch {
    return {};
  }
}

export function loadWorkspace(documentId: string, preferenceDefaults?: Partial<ReadingPreferences>): DocumentWorkspace {
  const defaults = emptyWorkspace();
  const stored = readAll()[documentId];
  return {
    ...defaults,
    ...stored,
    quiz: migrateQuizSession(stored?.quiz as unknown),
    insights: {
      review: readPaperReview(stored?.insights?.review),
      ...(typeof stored?.insights?.sessionContext === "string" ? { sessionContext: stored.insights.sessionContext } : {}),
      ...(typeof stored?.insights?.sessionPrompt === "string" ? { sessionPrompt: stored.insights.sessionPrompt } : {}),
      ...(typeof stored?.insights?.sessionResponse === "string" ? { sessionResponse: stored.insights.sessionResponse } : {}),
      ...(typeof stored?.insights?.cacheAffinityKey === "string" ? { cacheAffinityKey: stored.insights.cacheAffinityKey } : {}),
      ...(typeof stored?.insights?.updatedAt === "string" ? { updatedAt: stored.insights.updatedAt } : {}),
    },
    citations: (stored?.citations || []).filter((citation) => (
      citation.saved === true || citation.source === "manual" || (!citation.source && !citation.referenceNumber)
    )),
    autoHighlights: (stored?.autoHighlights || []).flatMap((highlight) => {
      const legacyCategory = (highlight as unknown as { category: string }).category;
      const category = legacyCategory === "contribution" ? "novelty"
        : legacyCategory === "method" ? "methods"
          : legacyCategory === "result" ? "results"
            : legacyCategory === "limitation" ? null
              : highlight.category;
      return category ? [{ ...highlight, category }] : [];
    }),
    selectionTranslations: stored?.selectionTranslations || [],
    preferences: {
      ...defaults.preferences,
      ...preferenceDefaults,
      ...stored?.preferences,
      highlightVisibility: {
        ...defaults.preferences.highlightVisibility,
        ...preferenceDefaults?.highlightVisibility,
        ...stored?.preferences?.highlightVisibility,
        manual: {
          ...defaults.preferences.highlightVisibility.manual,
          ...preferenceDefaults?.highlightVisibility?.manual,
          ...stored?.preferences?.highlightVisibility?.manual,
        },
        categories: {
          novelty: stored?.preferences?.highlightVisibility?.categories?.novelty
            ?? (stored?.preferences?.highlightVisibility?.categories as Record<string, boolean> | undefined)?.contribution
            ?? preferenceDefaults?.highlightVisibility?.categories?.novelty
            ?? true,
          methods: stored?.preferences?.highlightVisibility?.categories?.methods
            ?? (stored?.preferences?.highlightVisibility?.categories as Record<string, boolean> | undefined)?.method
            ?? preferenceDefaults?.highlightVisibility?.categories?.methods
            ?? true,
          results: stored?.preferences?.highlightVisibility?.categories?.results
            ?? (stored?.preferences?.highlightVisibility?.categories as Record<string, boolean> | undefined)?.result
            ?? preferenceDefaults?.highlightVisibility?.categories?.results
            ?? true,
        },
      },
    },
  };
}

export function saveWorkspace(documentId: string, workspace: DocumentWorkspace): void {
  const all = readAll();
  all[documentId] = workspace;
  setReaderState(STORAGE_KEY, JSON.stringify(all));
}
