import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Bookmark,
  Bot,
  Bold,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Edit2,
  Edit3,
  ExternalLink,
  FileText,
  Highlighter,
  Image as ImageIcon,
  Italic,
  KeyRound,
  Languages,
  Link,
  List,
  ListOrdered,
  LoaderCircle,
  MessageSquarePlus,
  MessageSquareText,
  Minus,
  MousePointer2,
  NotebookPen,
  Paperclip,
  Plus,
  Quote,
  Reply,
  RotateCcw,
  Search,
  Send,
  Settings,
  Sigma,
  Sparkles,
  Strikethrough,
  Trash2,
  Trophy,
  WifiOff,
  X,
} from "lucide-react";
import type {
  AiFeature,
  AiReasoningEffort,
  AiSettings,
  Annotation,
  AnnotationRect,
  AutoHighlight,
  ChatMessage,
  DocumentWorkspace,
  DiscussionThread,
  ExplanationRecord,
  ImageCapture,
  OutlineEntry,
  PaperReview,
  PdfDocumentState,
  ReaderFeatureAction,
  RightPanelTab,
  SelectionTranslationRecord,
  CitationCard,
  CitationFormat,
  DocumentLibraryEntry,
  QuizQuestion,
} from "../types";
import { AI_FEATURE_PROMPTS, askAssistant, askAssistantJson, askAssistantWithImage, defaultAiModelConfig, personalizedPrompt, providerPreset, resolveAiModelConfig, supportedReasoningEfforts } from "../lib/ai";
import type { AssistantContext } from "../lib/ai";
import {
  extractPdfReferences,
  formatCitation,
  loadOnlineCitationMetadata,
  mergeReferenceMetadata,
} from "../lib/citations";
import { FEATURE_BY_ID } from "../features/registry";
import { MarkdownContent } from "./MarkdownContent";
import {
  createCommentsCsv,
  createCommentsMarkdown,
  createExplanationsCsv,
  createExplanationsMarkdown,
  createHighlightsCsv,
  createHighlightsMarkdown,
  createPaperReviewMarkdown,
} from "../lib/export";
import { saveBytes } from "../lib/files";
import { protectTranslationTokens } from "../lib/translation-utils";
import { IconButton } from "./IconButton";
import { useResizablePanel } from "./useResizablePanel";
import { loadWorkspace } from "../lib/workspace";
import { loadOpenReview, type OpenReviewResult } from "../lib/openreview";
import { appendQuizQuestions, buildQuizEvidenceContext, createQuizSession, normalizeQuizPlan, validateQuizQuestion } from "../lib/quiz";
import { QuizStoryPlayer } from "./QuizStoryPlayer";

const RIGHT_PANEL_STORAGE_KEY = "whale-paper:right-panel-width";

function validateGeneratedQuiz(
  values: unknown[],
  sources: Map<string, { pageNumber: number; quote: string }>,
  pages: string[],
): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  values.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const candidate = item as Record<string, unknown>;
    const source = sources.get(typeof candidate.evidenceId === "string" ? candidate.evidenceId.trim() : "");
    const question = validateQuizQuestion(source ? { ...candidate, pageNumber: source.pageNumber, evidenceQuote: source.quote } : candidate, pages);
    const duplicate = question && questions.some((existing) => existing.question.replace(/\s+/g, " ").trim().toLocaleLowerCase() === question.question.replace(/\s+/g, " ").trim().toLocaleLowerCase());
    if (question && !duplicate) questions.push(question);
  });
  return questions;
}

function rightPanelMaxWidth(panel: HTMLElement): number {
  const shell = panel.parentElement;
  const parent = shell?.parentElement;
  if (!shell || !parent) return window.innerWidth - 470;
  if (getComputedStyle(shell).position === "absolute") return parent.clientWidth - 54;
  const occupiedWidth = Array.from(parent.children).reduce((total, child) => {
    if (child === shell || child.classList.contains("pdf-workspace")) return total;
    const element = child as HTMLElement;
    return getComputedStyle(element).position === "absolute" ? total : total + element.getBoundingClientRect().width;
  }, 0);
  const railWidth = shell.querySelector<HTMLElement>(".reader-tool-rail")?.getBoundingClientRect().width || 54;
  return parent.clientWidth - occupiedWidth - railWidth - 360;
}

type RightPanelProps = {
  document: PdfDocumentState;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  annotations: Annotation[];
  workspace: DocumentWorkspace;
  currentPage: number;
  currentPageText: string;
  textIndex: string[];
  outline: OutlineEntry[];
  selectedText: string;
  selectedTextContext: { before: string; after: string };
  selectedTextRects: AnnotationRect[];
  selectedTextPage: number;
  imageCapture: ImageCapture | null;
  actionRequest: ReaderFeatureAction | null;
  citationTarget: number | null;
  aiSettings: AiSettings;
  libraryEntries: DocumentLibraryEntry[];
  onAiSettingsChange: (settings: AiSettings) => void;
  onToggleCitationLibrary: (citation: CitationCard, inLibrary: boolean) => void;
  onOpenSettings: (section?: "metadata" | "models") => void;
  onWorkspaceChange: React.Dispatch<React.SetStateAction<DocumentWorkspace>>;
  onSelectionTranslationResult: (requestId: string, response: string, isError: boolean) => void;
  onUpdateAnnotation: (id: string, note: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onClearSelection: () => void;
  onNavigate: (page: number) => void;
  onQuizEvidence: (question: QuizQuestion) => void;
  onClose: () => void;
};

type CitationTab = "saved" | "references" | "cited-by";
type LoadState = "idle" | "loading" | "ready" | "error";
type AssistantSection = "overview" | "method" | "analysis" | "discussion";
type ReviewSection = Exclude<AssistantSection, "discussion">;
type DiscussionRequest = { context: AssistantContext; prefixMessages: ChatMessage[] };

function PanelEmpty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="panel-empty feature-panel-empty">
      {icon}
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function buildPaperContext(pages: string[], maxCharacters = 45000): string {
  const normalizedPages = pages
    .map((page, index) => ({ page: page.trim(), pageNumber: index + 1 }))
    .filter((item) => Boolean(item.page));
  if (!normalizedPages.length) return "";
  const complete = normalizedPages.map((item) => `[第 ${item.pageNumber} 页]\n${item.page}`).join("\n\n");
  if (complete.length <= maxCharacters) return complete;
  const perPage = Math.max(120, Math.floor((maxCharacters - normalizedPages.length * 16) / normalizedPages.length));
  const sampled = normalizedPages.map(({ page, pageNumber }) => {
    if (page.length <= perPage) return `[第 ${pageNumber} 页]\n${page}`;
    const headLength = Math.floor(perPage * 0.62);
    const tailLength = perPage - headLength;
    return `[第 ${pageNumber} 页，内容节选]\n${page.slice(0, headLength)}\n[本页中间内容因上下文长度省略]\n${page.slice(-tailLength)}`;
  }).join("\n\n");
  return sampled;
}

type DeferredPaperSection = {
  pageNumber: number;
  title: string;
};

const DEFERRED_SECTION_PATTERN = /^(?:references?|bibliography|reference list|works cited|literature cited|appendix|appendices|supplementary(?: materials?| information)?|supplemental(?: materials?| information)?|additional (?:examples?|case studies)|参考文献|引用文献|附录|补充(?:材料|信息)|更多示例|补充示例)(?:\s|$|[:：.\-])/i;

function normalizeSectionTitle(title: string): string {
  return title
    .replace(/^\s*(?:\d+(?:\.\d+)*|[ivxlcdm]+)[.):\-]?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findDeferredPaperSection(
  outline: OutlineEntry[],
  referenceStartPage?: number,
): DeferredPaperSection | null {
  const candidates: DeferredPaperSection[] = [];
  const visit = (entries: OutlineEntry[]) => {
    for (const entry of entries) {
      const title = normalizeSectionTitle(entry.title);
      if (entry.pageNumber && DEFERRED_SECTION_PATTERN.test(title)) {
        candidates.push({ pageNumber: entry.pageNumber, title: entry.title.trim() || title });
      }
      visit(entry.items || []);
    }
  };
  visit(outline);
  if (referenceStartPage && referenceStartPage > 0) {
    candidates.push({ pageNumber: referenceStartPage, title: "References" });
  }
  return candidates.sort((left, right) => left.pageNumber - right.pageNumber)[0] || null;
}

function findSectionOffset(page: string, title: string): number {
  const normalizedPage = page.toLocaleLowerCase();
  const titles = [
    title,
    normalizeSectionTitle(title),
    "References",
    "Bibliography",
    "Reference List",
    "Works Cited",
    "Literature Cited",
    "参考文献",
    "引用文献",
  ];
  const offsets = titles
    .map((candidate) => candidate.replace(/\s+/g, " ").trim().toLocaleLowerCase())
    .filter(Boolean)
    .map((candidate) => normalizedPage.indexOf(candidate))
    .filter((offset) => offset >= 0);
  return offsets.length ? Math.min(...offsets) : -1;
}

function buildInitialPaperContext(
  pages: string[],
  outline: OutlineEntry[],
  referenceStartPage?: number,
): string {
  const boundary = findDeferredPaperSection(outline, referenceStartPage);
  if (!boundary || boundary.pageNumber > pages.length) return buildPaperContext(pages);

  const retainedPages = pages.slice(0, boundary.pageNumber);
  const boundaryIndex = boundary.pageNumber - 1;
  const boundaryPage = retainedPages[boundaryIndex] || "";
  const sectionOffset = findSectionOffset(boundaryPage, boundary.title);
  if (sectionOffset >= 0) retainedPages[boundaryIndex] = boundaryPage.slice(0, sectionOffset).trim();

  return buildPaperContext(retainedPages);
}

const DISCUSSION_INTENTS: Array<{ query: RegExp; terms: string[] }> = [
  { query: /核心|贡献|摘要|main|core|contribution|summary/i, terms: ["abstract", "introduction", "contribution", "conclusion"] },
  { query: /不同|现有研究|相关工作|对比|different|related work|prior work|compare/i, terms: ["related work", "prior work", "previous work", "compared with", "baseline"] },
  { query: /方法|模型|架构|算法|机制|method|model|architecture|algorithm/i, terms: ["method", "methodology", "approach", "architecture", "algorithm"] },
  { query: /实验|结果|数据集|消融|experiment|result|dataset|ablation/i, terms: ["experiment", "evaluation", "result", "dataset", "ablation"] },
  { query: /局限|缺点|不足|未来工作|limitation|weakness|future work/i, terms: ["limitation", "discussion", "future work", "conclusion", "threats to validity"] },
];

function discussionSearchTerms(query: string): string[] {
  const normalized = query.toLocaleLowerCase();
  const directTerms = normalized.match(/[a-z\d][a-z\d_-]{1,}/g) || [];
  const intentTerms = DISCUSSION_INTENTS
    .filter((intent) => intent.query.test(query))
    .flatMap((intent) => intent.terms);
  return Array.from(new Set([...directTerms, ...intentTerms]));
}

function countTerm(text: string, term: string): number {
  let count = 0;
  let offset = 0;
  while (count < 6 && (offset = text.indexOf(term, offset)) >= 0) {
    count += 1;
    offset += term.length;
  }
  return count;
}

function relevantPageSnippet(page: string, terms: string[], budget: number): string {
  if (page.length <= budget) return page;
  const normalized = page.toLocaleLowerCase();
  const offsets = terms.map((term) => normalized.indexOf(term)).filter((offset) => offset >= 0);
  if (!offsets.length) return `${page.slice(0, Math.floor(budget * 0.72))}\n[中间内容省略]\n${page.slice(-Math.floor(budget * 0.28))}`;
  const focus = Math.min(...offsets);
  const start = Math.max(0, focus - Math.floor(budget * 0.3));
  const end = Math.min(page.length, start + budget);
  return `${start > 0 ? "[前文省略]\n" : ""}${page.slice(start, end)}${end < page.length ? "\n[后文省略]" : ""}`;
}

function visibleUserMessage(content: string): string {
  if (!content.includes("[划线内容]")) return content;
  const questionMarker = "[问题]\n";
  const questionOffset = content.lastIndexOf(questionMarker);
  return questionOffset >= 0 ? content.slice(questionOffset + questionMarker.length).trim() : content;
}

function buildDeferredPaperContext(
  pages: string[],
  query: string,
  boundary: DeferredPaperSection | null,
  maxCharacters: number,
): string {
  const terms = discussionSearchTerms(query);
  const asksForDeferredContent = /参考文献|引用|附录|补充材料|references?|citations?|appendix|supplement/i.test(query);
  if (!asksForDeferredContent) return "";
  const candidates = pages.flatMap((page, index) => {
    if (!page.trim()) return [];
    const pageNumber = index + 1;
    if (boundary && pageNumber < boundary.pageNumber) return [];
    const normalized = page.toLocaleLowerCase();
    const lexicalScore = terms.reduce((score, term) => score + countTerm(normalized, term) * 4, 0);
    const overviewScore = index === 0 ? 6 : index === 1 ? 2 : 0;
    return [{ page, pageNumber, score: lexicalScore + overviewScore }];
  });
  const selected = candidates
    .sort((left, right) => right.score - left.score || left.pageNumber - right.pageNumber)
    .slice(0, 4)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  if (!selected.length) return "";
  const perPageBudget = Math.max(1200, Math.floor(maxCharacters / selected.length) - 24);
  return selected.map(({ page, pageNumber }) => (
    `[第 ${pageNumber} 页，本轮相关内容]\n${relevantPageSnippet(page, terms, perPageBudget)}`
  )).join("\n\n");
}

function isMarkdownPaperReview(review: PaperReview): review is Extract<PaperReview, { overviewMarkdown: string }> {
  return "overviewMarkdown" in review;
}

function emptyMarkdownPaperReview(): Extract<PaperReview, { overviewMarkdown: string }> {
  return { overviewMarkdown: "", methodMarkdown: "", analysisMarkdown: "" };
}

const REVIEW_SECTION_LABELS: Record<ReviewSection, string> = {
  overview: "概览",
  method: "方法与实验",
  analysis: "评析",
};

const REVIEW_SECTION_REQUIREMENTS: Record<ReviewSection, string> = {
  overview: [
    "使用以下二级标题：## 论文类型、## 摘要、## 研究问题、## 核心贡献、## 阅读结论。",
    "核心贡献列出 2–5 项；阅读结论列出 3–6 项，并说明适用条件和边界。",
  ].join("\n"),
  method: [
    "使用以下二级标题：## 方法解读、## 实验与证据、## 可复现性。",
    "方法部分说明关键机制、输入输出和重要假设；实验部分覆盖数据、基线、指标、主要结果、消融或论证依据。",
  ].join("\n"),
  analysis: [
    "使用以下二级标题：## 优点、## 局限与注意事项、## 文献定位。",
    "优点和局限各给出 2–4 项，每项使用三级标题，并分别说明论文内依据及其影响；局限可补充使用建议。",
  ].join("\n"),
};

function buildReviewSectionPrompt(
  section: ReviewSection,
  title: string,
  author: string,
  customPrompt: string,
): string {
  return `${personalizedPrompt(AI_FEATURE_PROMPTS.review, customPrompt)}\n\n论文标题：${title}\n作者信息：${author || "PDF 未提供"}\n\n本次只生成“${REVIEW_SECTION_LABELS[section]}”部分。${REVIEW_SECTION_REQUIREMENTS[section]}\n直接返回 Markdown 正文，不要返回 JSON，不要使用代码围栏，也不要输出本部分之外的内容。`;
}

function PaperReviewView({ review, view }: { review: PaperReview; view: Exclude<AssistantSection, "discussion"> }) {
  if (isMarkdownPaperReview(review)) {
    const content = view === "overview" ? review.overviewMarkdown
      : view === "method" ? review.methodMarkdown
        : review.analysisMarkdown;
    return content ? <MarkdownContent className="paper-review" content={content} /> : <p className="assistant-section-placeholder">这一部分尚未生成。</p>;
  }
  return (
    <div className="paper-review">
      {view === "overview" && <>
        <section><h3>摘要</h3><MarkdownContent content={review.executiveSummary} /></section>
        <section><h3>研究问题</h3><MarkdownContent content={review.researchQuestion} /></section>
        <section><h3>核心贡献</h3><ol>{review.contributions.map((item) => <li key={item}><MarkdownContent content={item} /></li>)}</ol></section>
        <section><h3>阅读结论</h3><ol>{review.takeaways.map((item) => <li key={item}><MarkdownContent content={item} /></li>)}</ol></section>
      </>}
      {view === "method" && <>
        <section><h3>方法解读</h3><MarkdownContent content={review.methodologySummary} /></section>
        <section><h3>实验与证据</h3><MarkdownContent content={review.experimentalEvidence} /></section>
        <section><h3>可复现性</h3><MarkdownContent content={review.reproducibility} /></section>
      </>}
      {view === "analysis" && <>
        <section><h3>优点</h3>{review.strengths.map((point) => <article key={point.title}><strong>{point.title}</strong><p><b>依据</b><MarkdownContent content={point.evidence} /></p><p><b>影响</b><MarkdownContent content={point.significance} /></p></article>)}</section>
        <section><h3>局限与注意事项</h3>{review.weaknesses.map((point) => <article key={point.title}><strong>{point.title}</strong><p><b>依据</b><MarkdownContent content={point.evidence} /></p><p><b>影响</b><MarkdownContent content={point.significance} /></p>{point.suggestion && <p><b>建议</b><MarkdownContent content={point.suggestion} /></p>}</article>)}</section>
        {review.literaturePositioning && <section><h3>文献定位</h3><MarkdownContent content={review.literaturePositioning} /></section>}
      </>}
    </div>
  );
}

function paperReviewSectionText(review: PaperReview, section: Exclude<AssistantSection, "discussion">): string {
  if (isMarkdownPaperReview(review)) {
    return section === "overview" ? review.overviewMarkdown
      : section === "method" ? review.methodMarkdown
        : review.analysisMarkdown;
  }
  if (section === "overview") return [
    `## 摘要\n\n${review.executiveSummary}`,
    `## 研究问题\n\n${review.researchQuestion}`,
    `## 核心贡献\n\n${review.contributions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    `## 阅读结论\n\n${review.takeaways.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
  ].join("\n\n");
  if (section === "method") return [
    `## 方法解读\n\n${review.methodologySummary}`,
    `## 实验与证据\n\n${review.experimentalEvidence}`,
    `## 可复现性\n\n${review.reproducibility}`,
  ].join("\n\n");
  return [
    `## 优点\n\n${review.strengths.map((point) => `### ${point.title}\n\n依据：${point.evidence}\n\n影响：${point.significance}`).join("\n\n")}`,
    `## 局限与注意事项\n\n${review.weaknesses.map((point) => `### ${point.title}\n\n依据：${point.evidence}\n\n影响：${point.significance}${point.suggestion ? `\n\n建议：${point.suggestion}` : ""}`).join("\n\n")}`,
    review.literaturePositioning ? `## 文献定位\n\n${review.literaturePositioning}` : "",
  ].filter(Boolean).join("\n\n");
}

export function RightPanel(props: RightPanelProps) {
  const rightPanelResize = useResizablePanel({
    storageKey: RIGHT_PANEL_STORAGE_KEY,
    defaultWidth: 400,
    minWidth: 350,
    edge: "left",
    label: "调整右侧功能栏宽度",
    getMaxWidth: rightPanelMaxWidth,
  });
  const [messages, setMessages] = useState<ChatMessage[]>(props.workspace.chats);
  const [activeDiscussionId, setActiveDiscussionId] = useState(() => props.workspace.activeDiscussionId || crypto.randomUUID());
  const [discussionMenuOpen, setDiscussionMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingMessageDraft, setEditingMessageDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [imageExplanation, setImageExplanation] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState("");
  const [editingCommentDraft, setEditingCommentDraft] = useState("");
  const [commentReplyDrafts, setCommentReplyDrafts] = useState<Record<string, string>>({});
  const [notePreview, setNotePreview] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [quizExtensionTick, setQuizExtensionTick] = useState(0);
  const [highlightError, setHighlightError] = useState("");
  const [highlightQuery, setHighlightQuery] = useState("");
  const [explanationQuery, setExplanationQuery] = useState("");
  const [explanationTypes, setExplanationTypes] = useState<Record<ExplanationRecord["sourceType"], boolean>>({ text: true, image: true, table: true, formula: true, url: true });
  const [translationQuery, setTranslationQuery] = useState("");
  const [translationTypes, setTranslationTypes] = useState<Record<SelectionTranslationRecord["sourceType"], boolean>>({ text: true, image: true });
  const [explanationDrafts, setExplanationDrafts] = useState<Record<string, string>>({});
  const [explanationPendingId, setExplanationPendingId] = useState("");
  const [citationQuery, setCitationQuery] = useState("");
  const [citationFormat, setCitationFormat] = useState<CitationFormat>("bibtex");
  const [citationTab, setCitationTab] = useState<CitationTab>("saved");
  const [paperReferences, setPaperReferences] = useState<CitationCard[]>([]);
  const [citedByPapers, setCitedByPapers] = useState<CitationCard[]>([]);
  const [referenceState, setReferenceState] = useState<LoadState>("idle");
  const [citedByState, setCitedByState] = useState<LoadState>("idle");
  const [metadataState, setMetadataState] = useState<LoadState>("idle");
  const [citationError, setCitationError] = useState("");
  const [showMetadataKeyPrompt, setShowMetadataKeyPrompt] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [insightPending, setInsightPending] = useState<ReviewSection | "all" | null>(null);
  const [assistantSections, setAssistantSections] = useState<Record<AssistantSection, boolean>>({ overview: true, method: true, analysis: true, discussion: true });
  const [expandedAssistantContent, setExpandedAssistantContent] = useState<Record<Exclude<AssistantSection, "discussion">, boolean>>({ overview: false, method: false, analysis: false });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [citationDetail, setCitationDetail] = useState<Record<string, "citation" | "reason" | "worth" | "">>({});
  const [expandedCitationAbstracts, setExpandedCitationAbstracts] = useState<Record<string, boolean>>({});
  const [citationAnalysisPending, setCitationAnalysisPending] = useState("");
  const [peerReviewState, setPeerReviewState] = useState<LoadState>("idle");
  const [peerReviewResult, setPeerReviewResult] = useState<OpenReviewResult | null>(null);
  const [peerReviewError, setPeerReviewError] = useState("");
  const [expandedPeerReviews, setExpandedPeerReviews] = useState<Record<string, boolean>>({});
  const [autoHighlightRunning, setAutoHighlightRunning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const noteEditorRef = useRef<HTMLTextAreaElement>(null);
  const metadataAttemptRef = useRef("");
  const metadataPromptDismissedRef = useRef(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const effortPickerRef = useRef<HTMLDivElement>(null);
  const discussionMenuRef = useRef<HTMLDivElement>(null);
  const autoHighlightRunRef = useRef(0);
  const quizExtensionRef = useRef(false);
  const quizExtensionAttemptsRef = useRef(0);
  const quizExtensionProgressRef = useRef("");
  const explainedCaptureRef = useRef("");
  const feature = FEATURE_BY_ID[props.activeTab];

  useEffect(() => {
    const activeThread = props.workspace.discussionThreads.find((thread) => thread.id === props.workspace.activeDiscussionId);
    setMessages(activeThread?.messages || props.workspace.chats);
    setActiveDiscussionId(activeThread?.id || crypto.randomUUID());
    setDiscussionMenuOpen(false);
    setEditingMessageId("");
    setEditingMessageDraft("");
    setExplanation("");
    setImageExplanation("");
    setQuizError("");
    setHighlightError("");
    setCommentComposerOpen(false);
    setEditingCommentId("");
    setEditingCommentDraft("");
    setCommentReplyDrafts({});
    setNotePreview(false);
    setExplanationDrafts({});
    setExplanationPendingId("");
    setCitationQuery("");
    setCitationTab("saved");
    setPaperReferences([]);
    setCitedByPapers([]);
    setReferenceState("idle");
    setCitedByState("idle");
    setMetadataState("idle");
    setCitationError("");
    setShowMetadataKeyPrompt(false);
    setInsightError("");
    setInsightPending(null);
    setAssistantSections({ overview: true, method: true, analysis: true, discussion: true });
    setExpandedAssistantContent({ overview: false, method: false, analysis: false });
    setReferencePickerOpen(false);
    setSelectedReferenceIds(activeThread?.referencePaperIds || []);
    setCitationDetail({});
    setExpandedCitationAbstracts({});
    setCitationAnalysisPending("");
    setPeerReviewState("idle");
    setPeerReviewResult(null);
    setPeerReviewError("");
    setExpandedPeerReviews({});
    setAutoHighlightRunning(false);
    explainedCaptureRef.current = "";
    metadataAttemptRef.current = "";
    metadataPromptDismissedRef.current = false;
  }, [props.document.id]);

  useEffect(() => {
    if (props.activeTab === "comments" && props.selectedText) setCommentComposerOpen(true);
  }, [props.activeTab, props.selectedText]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const closeModelMenu = (event: MouseEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", closeModelMenu);
    return () => document.removeEventListener("mousedown", closeModelMenu);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!effortMenuOpen) return;
    const closeEffortMenu = (event: MouseEvent) => {
      if (!effortPickerRef.current?.contains(event.target as Node)) setEffortMenuOpen(false);
    };
    document.addEventListener("mousedown", closeEffortMenu);
    return () => document.removeEventListener("mousedown", closeEffortMenu);
  }, [effortMenuOpen]);

  useEffect(() => {
    if (!discussionMenuOpen) return;
    const closeDiscussionMenu = (event: MouseEvent) => {
      if (!discussionMenuRef.current?.contains(event.target as Node)) setDiscussionMenuOpen(false);
    };
    document.addEventListener("mousedown", closeDiscussionMenu);
    return () => document.removeEventListener("mousedown", closeDiscussionMenu);
  }, [discussionMenuOpen]);

  useEffect(() => {
    if (props.activeTab !== "citations" || referenceState !== "idle") return;
    let cancelled = false;
    setReferenceState("loading");
    setCitationError("");
    void extractPdfReferences(props.document.id, props.document.proxy)
      .then((references) => {
        if (cancelled) return;
        setPaperReferences((current) => mergeReferenceMetadata(references, current));
        setReferenceState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setReferenceState("error");
        setCitationError(error instanceof Error ? error.message : "无法解析这篇论文的参考文献。");
      });
    return () => { cancelled = true; };
  }, [props.activeTab, props.document.id, props.document.proxy]);

  useEffect(() => {
    if (props.activeTab !== "citations") return;
    const attemptKey = `${props.document.id}:${props.aiSettings.semanticScholarApiKey}`;
    if (metadataAttemptRef.current === attemptKey) return;
    metadataAttemptRef.current = attemptKey;
    let cancelled = false;
    setMetadataState("loading");
    setCitedByState("loading");
    setCitationError("");
    void loadOnlineCitationMetadata({
      documentId: props.document.id,
      title: props.document.title,
      fileName: props.document.file.name,
      firstPages: props.textIndex.slice(0, 3).join("\n"),
      year: props.document.year,
      semanticScholarApiKey: props.aiSettings.semanticScholarApiKey,
    }).then((result) => {
      if (cancelled) return;
      setPaperReferences((current) => mergeReferenceMetadata(current, result.references));
      setCitedByPapers(result.citations);
      setCitedByState("ready");
      setMetadataState(result.allSourcesFailed ? "error" : "ready");
      if (result.allSourcesFailed) {
        setCitationError(props.aiSettings.semanticScholarApiKey.trim()
          ? "在线文献源均无法连接；已保留本地参考文献。请检查网络或 Semantic Scholar API Key。"
          : "在线文献源均无法连接；已保留本地参考文献。");
        if (!props.aiSettings.semanticScholarApiKey.trim() && !metadataPromptDismissedRef.current) setShowMetadataKeyPrompt(true);
      } else if (!result.provider) {
        setCitationError("未找到与当前论文匹配的在线记录；已保留本地参考文献。");
      }
    }).catch(() => {
      if (cancelled) return;
      setMetadataState("error");
      setCitedByState("error");
      setCitationError("在线文献元数据处理失败；已保留本地参考文献。");
      if (!props.aiSettings.semanticScholarApiKey.trim() && !metadataPromptDismissedRef.current) setShowMetadataKeyPrompt(true);
    });
    return () => { cancelled = true; };
  }, [props.activeTab, props.aiSettings.semanticScholarApiKey, props.document.file.name, props.document.id, props.document.title, props.document.year]);

  useEffect(() => {
    if (props.activeTab !== "peer-reviews" || peerReviewState !== "idle") return;
    let cancelled = false;
    setPeerReviewState("loading");
    setPeerReviewError("");
    void loadOpenReview(props.document.title).then((result) => {
      if (cancelled) return;
      setPeerReviewResult(result);
      setExpandedPeerReviews(Object.fromEntries((result?.reviews || []).map((review, index) => [review.id, index === 0])));
      setPeerReviewState("ready");
    }).catch((error) => {
      if (cancelled) return;
      setPeerReviewError(error instanceof Error ? error.message : "无法读取 OpenReview 公开评审。");
      setPeerReviewState("error");
    });
    return () => { cancelled = true; };
    // The document reset above returns this state to idle before a new title is queried.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.activeTab, props.document.title]);

  useEffect(() => {
    if (!props.aiSettings.semanticScholarApiKey.trim()) return;
    setShowMetadataKeyPrompt(false);
  }, [props.aiSettings.semanticScholarApiKey]);

  const context = props.selectedText || props.currentPageText.slice(0, 12000);
  const fullPaperContext = useMemo(() => buildPaperContext(props.textIndex), [props.textIndex]);
  const referenceStartPage = paperReferences.length
    ? Math.min(...paperReferences.map((reference) => reference.pageNumber))
    : undefined;
  const initialPaperContext = useMemo(
    () => buildInitialPaperContext(props.textIndex, props.outline, referenceStartPage),
    [props.outline, props.textIndex, referenceStartPage],
  );
  const deferredPaperSection = useMemo(
    () => findDeferredPaperSection(props.outline, referenceStartPage),
    [props.outline, referenceStartPage],
  );
  const paperCacheAffinityKey = props.workspace.insights.cacheAffinityKey
    || `whalepaper:${props.document.id}`.replace(/[^a-z\d_.:\-]/gi, "_").slice(0, 64);
  const currentPaperSessionContext = `[论文会话起点]\n论文：${props.document.title}\n\n${initialPaperContext}`;
  const buildAssistantDiscussionRequest = (query: string, history: ChatMessage[] = messages): DiscussionRequest => {
    const review = props.workspace.insights.review;
    const previousQuestion = [...history].reverse().find((message) => message.role === "user")?.content || "";
    const retrievalQuery = query.trim().length < 12 && previousQuestion
      ? `${previousQuestion}\n${query}`
      : query;
    const deferredPages = buildDeferredPaperContext(
      props.textIndex,
      retrievalQuery,
      deferredPaperSection,
      14000,
    );
    const sessionContext = props.workspace.insights.sessionContext || currentPaperSessionContext;
    const prefixMessages: ChatMessage[] = review ? [
      {
        id: "paper-session-review-request",
        role: "user",
        content: props.workspace.insights.sessionPrompt || personalizedPrompt(AI_FEATURE_PROMPTS.review, props.aiSettings.prompts.review),
      },
      {
        id: "paper-session-review-response",
        role: "assistant",
        content: props.workspace.insights.sessionResponse || createPaperReviewMarkdown(review),
      },
    ] : [];
    const relatedPaperContext = selectedReferenceIds.flatMap((id) => {
      const paper = props.libraryEntries.find((entry) => entry.id === id);
      if (!paper) return [];
      const review = loadWorkspace(id).insights.review;
      return [`[参考论文]\n标题：${paper.title}\n作者：${paper.author || "未知"}${review ? `\n已有解读：\n${createPaperReviewMarkdown(review)}` : ""}`];
    }).join("\n\n");
    const turnContext = [
      deferredPages ? `[本轮要求的参考文献或补充材料]\n${deferredPages}` : "",
      relatedPaperContext,
    ].filter(Boolean).join("\n\n");
    return {
      context: {
        session: sessionContext,
        ...(turnContext ? { turn: turnContext } : {}),
      },
      prefixMessages,
    };
  };
  const highlighted = useMemo(() => props.annotations.filter((annotation) => annotation.type === "highlight"), [props.annotations]);
  const highlightVisibility = props.workspace.preferences.highlightVisibility;
  const activeNote = props.workspace.notes[0];
  const assistantConfig = resolveAiModelConfig(props.aiSettings, "chat");
  const assistantModel = assistantConfig.model;
  const assistantEffortLevels = supportedReasoningEfforts(assistantConfig);
  const assistantEffort = assistantEffortLevels.includes(assistantConfig.reasoningEffort) ? assistantConfig.reasoningEffort : "auto";
  const assistantModels = Array.from(new Set([
    ...(assistantConfig.availableModels.length ? assistantConfig.availableModels : providerPreset(assistantConfig.provider).models),
    assistantModel,
  ].filter(Boolean)));
  const activeDiscussion = props.workspace.discussionThreads.find((thread) => thread.id === activeDiscussionId);
  const firstUserMessage = messages.find((message) => message.role === "user");
  const discussionTitle = activeDiscussion?.title || (firstUserMessage ? visibleUserMessage(firstUserMessage.content).slice(0, 40) : "") || "新讨论";
  const referencePapers = props.libraryEntries.filter((entry) => selectedReferenceIds.includes(entry.id));

  const updateWorkspace = (patch: Partial<DocumentWorkspace>) => {
    props.onWorkspaceChange((current) => ({ ...current, ...patch }));
  };

  const persistDiscussionState = (nextMessages: ChatMessage[]) => {
    props.onWorkspaceChange((current) => {
      const timestamp = new Date().toISOString();
      const existing = current.discussionThreads.find((thread) => thread.id === activeDiscussionId);
      const firstQuestion = nextMessages.find((message) => message.role === "user")?.content.trim();
      const thread: DiscussionThread = {
        id: activeDiscussionId,
        title: existing?.title || firstQuestion?.slice(0, 40) || "新讨论",
        messages: nextMessages,
        referencePaperIds: selectedReferenceIds,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      };
      return {
        ...current,
        chats: nextMessages,
        activeDiscussionId,
        discussionThreads: [thread, ...current.discussionThreads.filter((item) => item.id !== activeDiscussionId)],
      };
    });
  };

  const startNewDiscussion = () => {
    const id = crypto.randomUUID();
    setActiveDiscussionId(id);
    setMessages([]);
    setDraft("");
    setEditingMessageId("");
    setSelectedReferenceIds([]);
    setReferencePickerOpen(false);
    setDiscussionMenuOpen(false);
    props.onWorkspaceChange((current) => ({ ...current, chats: [], activeDiscussionId: id }));
    requestAnimationFrame(() => chatInputRef.current?.focus());
  };

  const selectDiscussion = (thread: DiscussionThread) => {
    setActiveDiscussionId(thread.id);
    setMessages(thread.messages);
    setDraft("");
    setEditingMessageId("");
    setSelectedReferenceIds(thread.referencePaperIds || []);
    setReferencePickerOpen(false);
    setDiscussionMenuOpen(false);
    props.onWorkspaceChange((current) => ({ ...current, chats: thread.messages, activeDiscussionId: thread.id }));
  };

  const renameDiscussion = (thread: DiscussionThread) => {
    const title = window.prompt("重命名讨论", thread.title)?.trim();
    if (!title || title.length > 50) return;
    props.onWorkspaceChange((current) => ({
      ...current,
      discussionThreads: current.discussionThreads.map((item) => item.id === thread.id ? { ...item, title, updatedAt: new Date().toISOString() } : item),
    }));
  };

  const deleteDiscussion = (thread: DiscussionThread) => {
    if (!window.confirm("确定要删除此讨论吗？")) return;
    const remaining = props.workspace.discussionThreads.filter((item) => item.id !== thread.id);
    const next = remaining[0];
    const nextId = next?.id || crypto.randomUUID();
    const nextMessages = next?.messages || [];
    setActiveDiscussionId(nextId);
    setMessages(nextMessages);
    setSelectedReferenceIds(next?.referencePaperIds || []);
    setDiscussionMenuOpen(false);
    props.onWorkspaceChange((current) => ({ ...current, discussionThreads: remaining, activeDiscussionId: nextId, chats: nextMessages }));
  };

  const copyDiscussion = () => {
    const content = messages.map((message) => `${message.role === "user" ? "You" : "AI"}: ${message.role === "user" ? visibleUserMessage(message.content) : message.content}`).join("\n\n---\n\n");
    if (content) void navigator.clipboard.writeText(content);
  };

  const downloadText = (suffix: string, content: string, mime: string) => void saveBytes(
    `${props.document.title}-${suffix}`,
    new TextEncoder().encode(content),
    mime,
  );

  const generateInsight = async (targetSection?: ReviewSection) => {
    if (!initialPaperContext.trim() || pending) return;
    const sections: ReviewSection[] = targetSection ? [targetSection] : ["overview", "method", "analysis"];
    const prompts = sections.map((section) => ({
      section,
      prompt: buildReviewSectionPrompt(
        section,
        props.document.title,
        props.document.author || "",
        props.aiSettings.prompts.review,
      ),
    }));
    setPending(true);
    setInsightPending(targetSection || "all");
    setInsightError("");
    try {
      const results = await Promise.allSettled(prompts.map(async ({ section, prompt }) => ({
        section,
        content: (await askAssistant(
          props.aiSettings,
          [{ id: crypto.randomUUID(), role: "user", content: prompt }],
          { session: currentPaperSessionContext },
          "review",
          { cacheAffinityKey: paperCacheAffinityKey, maxOutputTokens: 3072 },
        )).trim(),
      })));
      const previous = props.workspace.insights.review;
      const review = previous ? {
        overviewMarkdown: paperReviewSectionText(previous, "overview"),
        methodMarkdown: paperReviewSectionText(previous, "method"),
        analysisMarkdown: paperReviewSectionText(previous, "analysis"),
      } : emptyMarkdownPaperReview();
      const failures: string[] = [];
      results.forEach((result, index) => {
        const section = prompts[index].section;
        if (result.status === "fulfilled" && result.value.content) {
          const key = `${section}Markdown` as keyof typeof review;
          review[key] = result.value.content;
          return;
        }
        const reason = result.status === "rejected" && result.reason instanceof Error
          ? result.reason.message
          : "模型没有返回文本内容。";
        failures.push(`${REVIEW_SECTION_LABELS[section]}：${reason}`);
      });
      if (failures.length === sections.length) throw new Error(failures.join("\n"));
      const sessionPrompt = prompts.map(({ section, prompt }) => `[${REVIEW_SECTION_LABELS[section]}]\n${prompt}`).join("\n\n");
      const sessionResponse = createPaperReviewMarkdown(review);
      props.onWorkspaceChange((current) => ({
        ...current,
        insights: {
          ...current.insights,
          review,
          sessionContext: currentPaperSessionContext,
          sessionPrompt,
          sessionResponse,
          cacheAffinityKey: paperCacheAffinityKey,
          updatedAt: new Date().toISOString(),
        },
      }));
      if (failures.length) setInsightError(`部分内容生成失败，可单独重试：\n${failures.join("\n")}`);
    } catch (error) {
      setInsightError(error instanceof Error ? error.message : "论文内容生成失败。");
    } finally {
      setInsightPending(null);
      setPending(false);
    }
  };

  const updateHighlightVisibility = (next: Partial<typeof highlightVisibility>) => {
    props.onWorkspaceChange((current) => ({
      ...current,
      preferences: {
        ...current.preferences,
        highlightVisibility: { ...current.preferences.highlightVisibility, ...next },
      },
    }));
  };

  const addExplanationRecord = (record: Omit<ExplanationRecord, "id" | "createdAt">) => {
    const item: ExplanationRecord = { ...record, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    props.onWorkspaceChange((current) => ({ ...current, explanations: [item, ...current.explanations] }));
  };

  const addSelectionTranslation = (record: Omit<SelectionTranslationRecord, "id" | "createdAt">) => {
    const item: SelectionTranslationRecord = { ...record, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    props.onWorkspaceChange((current) => ({ ...current, selectionTranslations: [item, ...current.selectionTranslations] }));
  };

  const autoHighlightPage = async () => {
    if (autoHighlightRunning) {
      autoHighlightRunRef.current += 1;
      setAutoHighlightRunning(false);
      setPending(false);
      return;
    }
    if (!initialPaperContext.trim() || pending) return;
    const runId = ++autoHighlightRunRef.current;
    setAutoHighlightRunning(true);
    setPending(true);
    setHighlightError("");
    try {
      const response = await askAssistantJson<unknown>(
        props.aiSettings,
        "从论文正文中选择最多 18 句最值得高亮的完整原句，覆盖独创性、方法和结果。只返回 JSON 数组，每项必须是 {\"pageNumber\":1,\"quote\":\"原文逐字引用\",\"category\":\"novelty|methods|results\",\"explanation\":\"为什么重要\"}。不得改写 quote，不得补充原文没有的信息。",
        initialPaperContext,
        "highlights",
      );
      if (runId !== autoHighlightRunRef.current) return;
      if (!Array.isArray(response)) throw new Error("模型返回的高亮数据格式不正确。");
      const categories: AutoHighlight["category"][] = ["novelty", "methods", "results"];
      const generated = response.flatMap((item): AutoHighlight[] => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Record<string, unknown>;
        const pageNumber = Number(candidate.pageNumber);
        const quote = typeof candidate.quote === "string" ? candidate.quote.trim() : "";
        const explanation = typeof candidate.explanation === "string" ? candidate.explanation.trim() : "";
        const category = candidate.category as AutoHighlight["category"];
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > props.textIndex.length || !quote || !explanation || !categories.includes(category)) return [];
        const normalizedPage = (props.textIndex[pageNumber - 1] || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
        if (!normalizedPage.includes(quote.replace(/\s+/g, " ").trim().toLocaleLowerCase())) return [];
        return [{ id: crypto.randomUUID(), pageNumber, quote, category, explanation }];
      }).slice(0, 18);
      if (!generated.length) throw new Error("模型没有返回可在论文原文中核验的高亮句子。");
      props.onWorkspaceChange((current) => ({
        ...current,
        autoHighlights: [
          ...current.autoHighlights,
          ...generated.filter((candidate) => !current.autoHighlights.some((existing) => (
            existing.pageNumber === candidate.pageNumber
            && existing.quote.replace(/\s+/g, " ").trim() === candidate.quote.replace(/\s+/g, " ").trim()
          ))),
        ],
        preferences: {
          ...current.preferences,
          highlightVisibility: {
            ...current.preferences.highlightVisibility,
            automatic: true,
            categories: generated.reduce((categories, item) => ({ ...categories, [item.category]: true }), current.preferences.highlightVisibility.categories),
          },
        },
      }));
    } catch (error) {
      setHighlightError(error instanceof Error ? error.message : "自动高亮请求失败。");
    } finally {
      if (runId === autoHighlightRunRef.current) {
        setPending(false);
        setAutoHighlightRunning(false);
      }
    }
  };

  const generateQuiz = async () => {
    if (!initialPaperContext.trim() || pending) return;
    setPending(true);
    setQuizError("");
    try {
      const groundedPaper = buildQuizEvidenceContext(props.textIndex);
      if (!groundedPaper.context) throw new Error("论文原文尚未解析完成，请稍后再开始问答游戏。");
      const response = await askAssistantJson<unknown>(
        props.aiSettings,
        `先根据论文长度、概念密度、方法与实验复杂度，规划完整测验应有多少题（5–30 题），以及其中基础题和困难题各多少。然后只生成首批 5 道单选题，难度按总体比例混合。只返回 JSON 对象：{"plan":{"totalQuestions":整数,"basicQuestions":数量,"hardQuestions":数量},"questions":[...]}。每题必须包含 difficulty（basic 或 hard）、question、options、answerIndex、hint、explanation、intro、correctFeedback、incorrectFeedback 和 evidenceId。answerIndex 从 0 开始。evidenceId 必须直接选择上下文中 [pN-eN] 的证据编号。题目与答案必须能由该原文直接验证，五道题覆盖不同要点。`,
        groundedPaper.context,
        "quiz",
        { maxOutputTokens: 6000 },
      );
      const payload = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : {};
      const rawQuestions = Array.isArray(payload.questions) ? payload.questions : Array.isArray(response) ? response : [];
      const plan = normalizeQuizPlan(payload.plan, props.textIndex.length);
      const quiz = validateGeneratedQuiz(rawQuestions, groundedPaper.sources, props.textIndex).slice(0, 5);
      if (!quiz.length) throw new Error("模型没有生成可在论文原文中验证的题目，请重试或更换模型。");
      updateWorkspace({ quiz: createQuizSession(quiz, "basic", new Date().toISOString(), plan) });
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : "问答游戏准备失败。");
    } finally {
      setPending(false);
    }
  };

  const extendQuiz = async (session: NonNullable<DocumentWorkspace["quiz"]>) => {
    if (quizExtensionRef.current || session.questions.length >= session.targetQuestionCount) return;
    quizExtensionRef.current = true;
    try {
      const groundedPaper = buildQuizEvidenceContext(props.textIndex);
      const remaining = session.targetQuestionCount - session.questions.length;
      const count = Math.min(5, remaining);
      const generatedBasic = session.questions.filter((question) => question.difficulty !== "hard").length;
      const generatedHard = session.questions.filter((question) => question.difficulty === "hard").length;
      const basicNeeded = Math.max(0, session.difficultyPlan.basic - generatedBasic);
      const hardNeeded = Math.max(0, session.difficultyPlan.hard - generatedHard);
      const existing = session.questions.map((question, index) => `${index + 1}. ${question.question}`).join("\n");
      const response = await askAssistantJson<unknown>(props.aiSettings,
        `继续同一份论文测验，再生成 ${count} 道不重复的单选题。整体还需要基础题 ${basicNeeded} 道、困难题 ${hardNeeded} 道，本批按这个剩余比例分配。只返回 JSON 数组。每题包含 difficulty（basic/hard）、question、options、answerIndex、hint、explanation、intro、correctFeedback、incorrectFeedback、evidenceId。evidenceId 只能选择 [pN-eN] 原文证据编号。\n\n已有题目（不得重复）：\n${existing}`,
        groundedPaper.context, "quiz", { maxOutputTokens: Math.min(6000, count * 900) });
      const questions = validateGeneratedQuiz(Array.isArray(response) ? response : [], groundedPaper.sources, props.textIndex);
      if (!questions.length) throw new Error("No valid background quiz questions");
      props.onWorkspaceChange((current) => current.quiz?.createdAt === session.createdAt
        ? { ...current, quiz: appendQuizQuestions(current.quiz, questions) }
        : current);
      quizExtensionAttemptsRef.current = 0;
    } catch {
      quizExtensionAttemptsRef.current += 1;
      if (quizExtensionAttemptsRef.current < 3) window.setTimeout(() => setQuizExtensionTick((tick) => tick + 1), 1800);
    } finally {
      quizExtensionRef.current = false;
    }
  };

  useEffect(() => {
    const session = props.workspace.quiz;
    if (!session || session.completed || session.questions.length >= session.targetQuestionCount) return;
    const progressKey = `${session.createdAt}:${Object.keys(session.answers).length}`;
    if (quizExtensionProgressRef.current !== progressKey) {
      quizExtensionProgressRef.current = progressKey;
      quizExtensionAttemptsRef.current = 0;
    }
    const unansweredBuffered = session.questions.length - Object.keys(session.answers).length;
    if (unansweredBuffered <= 3) void extendQuiz(session);
  }, [props.workspace.quiz?.currentIndex, props.workspace.quiz?.questions.length, Object.keys(props.workspace.quiz?.answers || {}).length, quizExtensionTick]);

  const explainCapturedImage = async () => {
    if (!props.imageCapture || pending) return;
    setPending(true);
    setImageExplanation("");
    try {
      const translating = props.imageCapture.intent === "translate";
      const answer = await askAssistantWithImage(
        props.aiSettings,
        [
          translating
            ? personalizedPrompt("识别并翻译这张论文图片中的全部可辨认文字，保留标题、标签、图例、表头、行列和层级结构。不要补写无法辨认的内容。", props.aiSettings.prompts.translation)
            : personalizedPrompt(AI_FEATURE_PROMPTS.explain, props.aiSettings.prompts.explain),
          translating ? "翻译后简要说明各文字在图中的位置。" : "先判断选区主要是论文插图、数据表格还是公式，再按对应方式解读。",
          translating ? "只输出翻译结果与必要的位置说明。" : "如果是插图，解释坐标轴、图例、视觉编码、比较对象和主要趋势；如果是表格，读取行列含义、关键数值、最佳或异常结果及比较关系；如果是公式，解释符号、输入输出、假设和推导作用。",
          translating ? "" : "只陈述图中可辨认的信息；文字或数值无法确认时明确说明。最后结合当前页原文，说明它如何支持论文论证。",
        ].join("\n\n"),
        props.imageCapture.dataUrl,
        `[当前页原文]\n${props.currentPageText}\n\n[论文会话摘要]\n${initialPaperContext}`,
        translating ? "translation" : "explain",
      );
      setImageExplanation(answer);
      const record = {
        pageNumber: props.imageCapture.pageNumber,
        sourceType: props.imageCapture.sourceType || "image",
        source: props.imageCapture.sourceText || `第 ${props.imageCapture.pageNumber} 页图像选区`,
        response: answer,
        imageDataUrl: props.imageCapture.dataUrl,
      };
      if (translating) addSelectionTranslation({ ...record, sourceType: "image" });
      else addExplanationRecord(record);
    } catch (error) {
      setImageExplanation(error instanceof Error ? error.message : "图片解释请求失败。");
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    const captureTab = props.imageCapture?.intent === "translate" ? "translation" : "explain";
    if (props.activeTab !== captureTab || !props.imageCapture || pending) return;
    const captureKey = `${props.imageCapture.intent || "explain"}:${props.imageCapture.pageNumber}:${props.imageCapture.dataUrl.slice(-80)}`;
    if (explainedCaptureRef.current === captureKey) return;
    explainedCaptureRef.current = captureKey;
    void explainCapturedImage();
    // Image captures are edge-triggered; the generated record becomes the persistent UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.activeTab, props.imageCapture?.dataUrl, props.imageCapture?.intent]);

  useEffect(() => {
    if (!props.actionRequest) return;
    if (props.actionRequest.type === "auto-highlight") void autoHighlightPage();
    else if (props.actionRequest.type === "explain-selection") void sendMessage(personalizedPrompt(AI_FEATURE_PROMPTS.explain, props.aiSettings.prompts.explain), true, undefined, "explain");
    else if (props.actionRequest.type === "translate-selection") void sendMessage(personalizedPrompt(AI_FEATURE_PROMPTS.translation, props.aiSettings.prompts.translation), true, undefined, "translation", [], messages, props.actionRequest.id);
    else if (props.actionRequest.type === "ask-selection") {
      setAssistantSections((current) => ({ ...current, discussion: true }));
      setDraft("");
      requestAnimationFrame(() => chatInputRef.current?.focus());
    }
    else {
      setAssistantSections((current) => ({ ...current, discussion: true }));
      setDraft("");
      requestAnimationFrame(() => chatInputRef.current?.focus());
    }
    // The request id intentionally makes toolbar actions edge-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.actionRequest?.id]);

  const sendMessage = async (
    content: string,
    explainOnly = false,
    overrideContext?: AssistantContext,
    feature: AiFeature = "chat",
    prefixMessages: ChatMessage[] = [],
    baseMessages: ChatMessage[] = messages,
    userMessageId?: string,
    requestContent?: string,
  ) => {
    const text = content.trim();
    if (!text || pending) return;
    const userMessage: ChatMessage = { id: userMessageId || crypto.randomUUID(), role: "user", content: text, createdAt: new Date().toISOString() };
    const nextMessages = explainOnly ? [userMessage] : [...baseMessages, userMessage];
    if (!explainOnly) {
      setMessages(nextMessages);
      persistDiscussionState(nextMessages);
      setDraft("");
    }
    setPending(true);
    try {
      const requestMessages = [...prefixMessages, ...nextMessages].map((message) => (
        message.role === "user" ? { ...message, content: visibleUserMessage(message.content) } : message
      ));
      if (requestContent?.trim()) {
        requestMessages[requestMessages.length - 1] = { ...userMessage, content: requestContent.trim() };
      }
      const rawContext = overrideContext ?? context;
      const protectedContext = feature === "translation" && typeof rawContext === "string"
        ? protectTranslationTokens(rawContext)
        : null;
      const answer = await askAssistant(
        props.aiSettings,
        requestMessages,
        protectedContext ? protectedContext.text : rawContext,
        feature,
        feature === "chat" ? {
          cacheAffinityKey: paperCacheAffinityKey,
          cachePrefixMessages: prefixMessages.length || undefined,
        } : undefined,
      );
      const restoredAnswer = protectedContext ? protectedContext.restore(answer) : answer;
      if (explainOnly) {
        setExplanation(restoredAnswer);
        const record = { pageNumber: props.selectedTextPage || props.currentPage, sourceType: props.actionRequest?.sourceType || "text" as const, source: props.selectedText || context.slice(0, 1200), response: restoredAnswer };
        if (feature === "translation") {
          addSelectionTranslation({ pageNumber: record.pageNumber, sourceType: "text", source: props.selectedText || record.source, response: restoredAnswer });
          if (userMessageId) props.onSelectionTranslationResult(userMessageId, restoredAnswer, false);
        }
        else addExplanationRecord(record);
      } else {
        const assistantMessage: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: restoredAnswer, createdAt: new Date().toISOString() };
        const updated = [...nextMessages, assistantMessage];
        setMessages(updated);
        persistDiscussionState(updated);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "请求失败，请检查模型设置。";
      if (explainOnly) {
        setExplanation(message);
        if (feature === "translation" && userMessageId) props.onSelectionTranslationResult(userMessageId, message, true);
      }
      else {
        const updated = [...nextMessages, { id: crypto.randomUUID(), role: "assistant" as const, content: message, createdAt: new Date().toISOString() }];
        setMessages(updated);
        persistDiscussionState(updated);
      }
    } finally {
      setPending(false);
    }
  };

  const sendDiscussionMessage = (content: string, history: ChatMessage[] = messages, userMessageId?: string) => {
    const question = content.trim();
    const message = props.selectedText
      ? [
        "[任务说明]",
        "用户正在针对“划线内容”提问。请直接回答用户问题，并始终以划线内容为分析主体。划线前文和划线后文只是帮助理解语境、指代和术语的补充材料，不是用户要求分析、翻译或总结的对象。除非回答问题确有必要，不要复述补充材料；回答中不要输出这些字段标签。",
        props.selectedTextContext.before ? `[补充：划线前文]\n${props.selectedTextContext.before}` : "",
        `[划线内容]\n${props.selectedText}`,
        props.selectedTextContext.after ? `[补充：划线后文]\n${props.selectedTextContext.after}` : "",
        `[用户问题]\n${question}`,
      ].filter(Boolean).join("\n\n")
      : question;
    const request = buildAssistantDiscussionRequest(question, history);
    const result = sendMessage(question, false, request.context, "chat", request.prefixMessages, history, userMessageId, message);
    if (content.trim() && props.selectedText) props.onClearSelection();
    return result;
  };

  const resendEditedMessage = (messageId: string) => {
    const messageIndex = messages.findIndex((message) => message.id === messageId && message.role === "user");
    const content = editingMessageDraft.trim();
    if (messageIndex < 0 || !content || pending) return;
    setEditingMessageId("");
    setEditingMessageDraft("");
    void sendDiscussionMessage(content, messages.slice(0, messageIndex), messageId);
  };

  const addComment = () => {
    const body = commentDraft.trim();
    if (!body) return;
    const timestamp = new Date().toISOString();
    updateWorkspace({
      comments: [{
        id: crypto.randomUUID(),
        documentId: props.document.id,
        pageNumber: props.selectedText ? props.selectedTextPage : props.currentPage,
        quote: props.selectedText,
        rects: props.selectedText ? props.selectedTextRects : [],
        body,
        resolved: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      }, ...props.workspace.comments],
    });
    setCommentDraft("");
    setCommentComposerOpen(false);
  };

  const commitActiveNote = (patch: { title?: string; body?: string }) => {
    const timestamp = new Date().toISOString();
    if (activeNote) {
      updateWorkspace({ notes: props.workspace.notes.map((note) => note.id === activeNote.id ? { ...note, ...patch, updatedAt: timestamp } : note) });
      return;
    }
    const id = crypto.randomUUID();
    updateWorkspace({ notes: [{
      id,
      documentId: props.document.id,
      title: patch.title ?? "论文笔记",
      body: patch.body ?? "",
      createdAt: timestamp,
      updatedAt: timestamp,
    }] });
  };

  const saveCommentEdit = (commentId: string) => {
    const body = editingCommentDraft.trim();
    if (!body) return;
    props.onWorkspaceChange((current) => ({
      ...current,
      comments: current.comments.map((comment) => comment.id === commentId
        ? { ...comment, body, updatedAt: new Date().toISOString() }
        : comment),
    }));
    setEditingCommentId("");
    setEditingCommentDraft("");
  };

  const toggleCommentResolved = (commentId: string) => {
    props.onWorkspaceChange((current) => ({
      ...current,
      comments: current.comments.map((comment) => comment.id === commentId
        ? { ...comment, resolved: !comment.resolved, updatedAt: new Date().toISOString() }
        : comment),
    }));
  };

  const addCommentReply = (commentId: string) => {
    const body = (commentReplyDrafts[commentId] || "").trim();
    if (!body) return;
    const timestamp = new Date().toISOString();
    props.onWorkspaceChange((current) => ({
      ...current,
      comments: current.comments.map((comment) => comment.id === commentId ? {
        ...comment,
        replies: [...(comment.replies || []), { id: crypto.randomUUID(), body, createdAt: timestamp, updatedAt: timestamp }],
        updatedAt: timestamp,
      } : comment),
    }));
    setCommentReplyDrafts((current) => ({ ...current, [commentId]: "" }));
  };

  const sendExplanationFollowup = async (record: ExplanationRecord) => {
    const content = (explanationDrafts[record.id] || "").trim();
    if (!content || explanationPendingId) return;
    const baseConversation = record.conversation?.length
      ? record.conversation
      : [{ id: `${record.id}-answer`, role: "assistant" as const, content: record.response, createdAt: record.createdAt }];
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: new Date().toISOString() };
    const nextConversation = [...baseConversation, userMessage];
    setExplanationDrafts((current) => ({ ...current, [record.id]: "" }));
    setExplanationPendingId(record.id);
    props.onWorkspaceChange((current) => ({
      ...current,
      explanations: current.explanations.map((item) => item.id === record.id ? { ...item, conversation: nextConversation } : item),
    }));
    try {
      const answer = record.imageDataUrl
        ? await askAssistantWithImage(
          props.aiSettings,
          [
            "继续回答用户关于该论文图表或公式的问题。必须结合图片、论文当前页和已有解释，不要猜测无法辨认的文字或数值。",
            `[已有解释]\n${record.response}`,
            `[对话记录]\n${nextConversation.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n")}`,
          ].join("\n\n"),
          record.imageDataUrl,
          props.textIndex[record.pageNumber - 1] || "",
          "explain",
        )
        : await askAssistant(
          props.aiSettings,
          nextConversation,
          `[解释对象]\n${record.source}\n\n[论文当前页]\n${props.textIndex[record.pageNumber - 1] || ""}`,
          "explain",
        );
      const assistantMessage: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: answer, createdAt: new Date().toISOString() };
      props.onWorkspaceChange((current) => ({
        ...current,
        explanations: current.explanations.map((item) => item.id === record.id
          ? { ...item, conversation: [...nextConversation, assistantMessage] }
          : item),
      }));
    } catch (error) {
      setExplanationDrafts((current) => ({ ...current, [record.id]: content }));
    } finally {
      setExplanationPendingId("");
    }
  };

  const updateCitationAnalysis = (citation: CitationCard, patch: Partial<CitationCard>) => {
    const key = citationIdentity(citation);
    const apply = (items: CitationCard[]) => items.map((item) => citationIdentity(item) === key ? { ...item, ...patch } : item);
    setPaperReferences(apply);
    setCitedByPapers(apply);
    props.onWorkspaceChange((current) => ({ ...current, citations: apply(current.citations) }));
  };

  const analyzeCitation = async (citation: CitationCard, kind: "reason" | "worth") => {
    const existing = kind === "reason" ? citation.reasonCited : citation.worthReading;
    if (existing || citationAnalysisPending) return;
    const key = citationIdentity(citation);
    setCitationAnalysisPending(`${key}:${kind}`);
    try {
      const prompt = kind === "reason"
        ? `结合当前论文原文，解释作者为什么引用以下论文。指出它在论证中的具体作用，不要只复述摘要。\n\n被引论文：${citation.title}\n${citation.authors}\n${citation.abstract || citation.rawReference || ""}`
        : `判断以下论文对理解当前论文是否值得阅读。第一行只能是“全文阅读”“略读”“仅摘要”或“跳过”之一，随后说明判断依据。\n\n论文：${citation.title}\n${citation.authors}\n${citation.abstract || citation.rawReference || ""}`;
      const answer = await askAssistant(
        props.aiSettings,
        [{ id: crypto.randomUUID(), role: "user", content: prompt }],
        initialPaperContext,
        "chat",
        { cacheAffinityKey: paperCacheAffinityKey },
      );
      updateCitationAnalysis(citation, kind === "reason" ? { reasonCited: answer } : { worthReading: answer });
    } catch (error) {
      updateCitationAnalysis(citation, kind === "reason"
        ? { reasonCited: error instanceof Error ? error.message : "引用原因生成失败。" }
        : { worthReading: error instanceof Error ? error.message : "阅读建议生成失败。" });
    } finally {
      setCitationAnalysisPending("");
    }
  };

  const toggleReferencePaper = (paperId: string) => {
    setSelectedReferenceIds((current) => {
      const next = current.includes(paperId) ? current.filter((id) => id !== paperId) : [...current, paperId];
      props.onWorkspaceChange((workspace) => ({
        ...workspace,
        discussionThreads: workspace.discussionThreads.map((thread) => thread.id === activeDiscussionId ? { ...thread, referencePaperIds: next, updatedAt: new Date().toISOString() } : thread),
      }));
      return next;
    });
  };

  const applyNoteMarkup = (before: string, after = before, placeholder = "文本") => {
    const textarea = noteEditorRef.current;
    const body = activeNote?.body || "";
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? start;
    const selected = body.slice(start, end) || placeholder;
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`;
    commitActiveNote({ body: next });
    requestAnimationFrame(() => {
      noteEditorRef.current?.focus();
      noteEditorRef.current?.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const applyNoteLinePrefix = (prefix: string) => {
    const textarea = noteEditorRef.current;
    const body = activeNote?.body || "";
    const cursor = textarea?.selectionStart ?? body.length;
    const lineStart = body.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
    const lineEndValue = body.indexOf("\n", cursor);
    const lineEnd = lineEndValue < 0 ? body.length : lineEndValue;
    const line = body.slice(lineStart, lineEnd).replace(/^#{1,6}\s+/, "");
    const next = `${body.slice(0, lineStart)}${prefix}${line}${body.slice(lineEnd)}`;
    commitActiveNote({ body: next });
    requestAnimationFrame(() => noteEditorRef.current?.focus());
  };

  const changeCitationFormat = (format: CitationFormat) => {
    setCitationFormat(format);
    updateWorkspace({
      citations: props.workspace.citations.map((citation) => ({
        ...citation,
        format,
        formatted: formatCitation(format, citation) || citation.rawReference || citation.formatted,
      })),
    });
  };

  const citationIdentity = (citation: CitationCard) => citation.paperId || citation.doi || citation.rawReference || citation.title.toLocaleLowerCase();
  const savedCitations = props.workspace.citations.filter((citation) => (
    citation.saved === true || citation.source === "manual" || (!citation.source && !citation.referenceNumber)
  ));
  const savedCitationKeys = new Set(savedCitations.map(citationIdentity));

  const toggleSavedCitation = (citation: CitationCard) => {
    const key = citationIdentity(citation);
    if (savedCitationKeys.has(key)) {
      updateWorkspace({ citations: savedCitations.filter((item) => citationIdentity(item) !== key) });
      return;
    }
    updateWorkspace({
      citations: [{
        ...citation,
        id: `saved-${crypto.randomUUID()}`,
        saved: true,
        format: citationFormat,
        formatted: formatCitation(citationFormat, citation) || citation.rawReference || citation.formatted,
        createdAt: new Date().toISOString(),
      }, ...savedCitations],
    });
  };

  useEffect(() => {
    if (!props.citationTarget) return;
    setCitationTab("references");
    setCitationQuery(String(props.citationTarget));
  }, [props.citationTarget]);

  const allHighlightsVisible = Object.values(highlightVisibility.manual).every(Boolean);
  const filteredHighlights = highlighted.filter((annotation) => highlightVisibility.manual[annotation.color] && annotation.quote.toLocaleLowerCase().includes(highlightQuery.toLocaleLowerCase()));
  const filteredAutoHighlights = props.workspace.autoHighlights.filter((item) => highlightVisibility.automatic && highlightVisibility.categories[item.category] && `${item.quote} ${item.explanation}`.toLocaleLowerCase().includes(highlightQuery.toLocaleLowerCase()));
  const allExplanationTypes = Object.values(explanationTypes).every(Boolean);
  const filteredExplanations = props.workspace.explanations.filter((item) => explanationTypes[item.sourceType] && `${item.source} ${item.response}`.toLocaleLowerCase().includes(explanationQuery.toLocaleLowerCase()));
  const filteredSelectionTranslations = props.workspace.selectionTranslations.filter((item) => translationTypes[item.sourceType] && `${item.source} ${item.response}`.toLocaleLowerCase().includes(translationQuery.toLocaleLowerCase()));
  const activeCitations = citationTab === "saved" ? savedCitations : citationTab === "references" ? paperReferences : citedByPapers;
  const filteredCitations = activeCitations.filter((citation) => {
    const normalizedQuery = citationQuery.trim().toLocaleLowerCase();
    if (/^\d+$/.test(normalizedQuery)) return citation.referenceNumber === Number(normalizedQuery);
    return `${citation.referenceNumber || ""} ${citation.title} ${citation.authors} ${citation.formatted} ${citation.rawReference || ""}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const citationText = filteredCitations.map((citation) => formatCitation(citationFormat, citation) || citation.rawReference || citation.formatted).join("\n\n");

  const panelText = (() => {
    if (props.activeTab === "assistant") return [
      props.workspace.insights.review ? createPaperReviewMarkdown(props.workspace.insights.review, `${props.document.title} · 深度解读`) : "",
      messages.length ? `# 讨论\n\n${messages.map((message) => `${message.role === "user" ? "你" : "AI"}：${message.role === "user" ? visibleUserMessage(message.content) : message.content}`).join("\n\n")}` : "",
    ].filter(Boolean).join("\n\n");
    if (props.activeTab === "quiz") return (props.workspace.quiz?.questions || []).map((question, index) => `${index + 1}. ${question.question}\n${question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join("\n")}`).join("\n\n");
    if (props.activeTab === "highlights") return [...highlighted.map((item) => `第 ${item.pageNumber} 页\n${item.quote}`), ...props.workspace.autoHighlights.map((item) => `第 ${item.pageNumber} 页 · ${item.category}\n${item.quote}\n${item.explanation}`)].join("\n\n");
    if (props.activeTab === "explain") return props.workspace.explanations.map((item) => `第 ${item.pageNumber} 页\n${item.source}\n${item.response}`).join("\n\n");
    if (props.activeTab === "translation") return props.workspace.selectionTranslations.map((item) => `第 ${item.pageNumber} 页\n${item.source}\n${item.response}`).join("\n\n");
    if (props.activeTab === "comments") return props.workspace.comments.map((comment) => `第 ${comment.pageNumber} 页\n${comment.quote}\n${comment.body}`).join("\n\n");
    if (props.activeTab === "notes") return props.workspace.notes[0]?.body || "";
    if (props.activeTab === "citations") return citationText;
    if (props.activeTab === "peer-reviews") return peerReviewResult ? [
      `# ${peerReviewResult.title}`,
      peerReviewResult.venue ? `**会议：** ${peerReviewResult.venue}` : "",
      peerReviewResult.decision ? `**决定：** ${peerReviewResult.decision}` : "",
      ...peerReviewResult.reviews.map((review) => [
        `## ${review.reviewer}`,
        review.rating ? `**评分：** ${review.rating}` : "",
        review.confidence ? `**置信度：** ${review.confidence}` : "",
        review.summary ? `### 摘要\n\n${review.summary}` : "",
        review.strengths ? `### 优点\n\n${review.strengths}` : "",
        review.weaknesses ? `### 缺点\n\n${review.weaknesses}` : "",
        review.questions ? `### 给作者的问题\n\n${review.questions}` : "",
      ].filter(Boolean).join("\n\n")),
    ].filter(Boolean).join("\n\n") : "";
    return `${props.document.title}\n${props.document.author}\n${props.document.file.name}`;
  })();

  const exportPanel = () => void saveBytes(
    `${props.document.title}-${props.activeTab}.md`,
    new TextEncoder().encode(panelText),
    "text/markdown",
  );

  return (
    <aside ref={rightPanelResize.panelRef} className={`right-panel ${props.activeTab === "assistant" ? "right-panel-assistant" : ""}`} style={rightPanelResize.panelStyle}>
      <div {...rightPanelResize.resizerProps}><span /></div>
      <div className="panel-header feature-panel-header">
        <strong>{feature.label}</strong>
        <div className="feature-panel-actions">
          {props.activeTab === "assistant" ? (
            <>
              <IconButton label="复制 AI 内容" disabled={!panelText} onClick={() => void navigator.clipboard.writeText(panelText)}><Copy size={14} /></IconButton>
              <IconButton label="导出 AI 内容" disabled={!panelText} onClick={exportPanel}><Download size={14} /></IconButton>
              <IconButton label="模型设置" onClick={() => props.onOpenSettings("models")}><Settings size={15} /></IconButton>
            </>
          ) : props.activeTab !== "quiz" ? (
            <>
              <IconButton label={`复制${feature.label}`} disabled={!panelText} onClick={() => void navigator.clipboard.writeText(panelText)}><Copy size={14} /></IconButton>
              <IconButton label={`导出${feature.label}`} disabled={!panelText} onClick={exportPanel}><Download size={14} /></IconButton>
            </>
          ) : null}
        </div>
      </div>

      {props.activeTab === "assistant" && (
        <div className="assistant-panel">
          <div className="assistant-sections-scroll">
            {(["overview", "method", "analysis"] as const).map((section) => {
              const review = props.workspace.insights.review;
              const sectionText = review ? paperReviewSectionText(review, section) : "";
              const sectionPending = insightPending === "all" || insightPending === section;
              return <section className={`assistant-section ${assistantSections[section] ? "is-open" : ""}`} key={section}>
                <header className="assistant-section-header">
                  <button className="assistant-section-toggle" type="button" aria-expanded={assistantSections[section]} onClick={() => setAssistantSections((current) => ({ ...current, [section]: !current[section] }))}>
                    <ChevronDown size={14} /><strong>{REVIEW_SECTION_LABELS[section]}</strong>
                  </button>
                  <div>
                    <IconButton label={`复制${REVIEW_SECTION_LABELS[section]}`} disabled={!sectionText} onClick={() => sectionText && void navigator.clipboard.writeText(sectionText)}><Copy size={13} /></IconButton>
                    <IconButton label={review ? `重新生成${REVIEW_SECTION_LABELS[section]}` : "生成完整解读"} disabled={!fullPaperContext || pending} onClick={() => void generateInsight(review ? section : undefined)}>
                      {sectionPending ? <LoaderCircle className="is-spinning" size={13} /> : <RotateCcw size={13} />}
                    </IconButton>
                  </div>
                </header>
                {assistantSections[section] && <div className="assistant-section-content" role="region" aria-label={REVIEW_SECTION_LABELS[section]}>
                  {sectionPending && <div className="assistant-review-loading"><div className="thinking"><i /><i /><i /></div><span>正在生成{REVIEW_SECTION_LABELS[section]}</span></div>}
                  {!sectionPending && review && <>
                    <div className={`assistant-content-clip ${expandedAssistantContent[section] ? "is-expanded" : ""}`}>
                      <PaperReviewView review={review} view={section} />
                      {!expandedAssistantContent[section] && <div className="assistant-content-fade">
                        <button type="button" className="assistant-show-more-button" onClick={() => setExpandedAssistantContent((current) => ({ ...current, [section]: true }))}>
                          <span>查看全部</span><ChevronDown size={12} aria-hidden="true" />
                        </button>
                      </div>}
                    </div>
                    {expandedAssistantContent[section] && <div className="assistant-show-less-row">
                      <button type="button" className="assistant-show-more-button" onClick={() => setExpandedAssistantContent((current) => ({ ...current, [section]: false }))}>
                        <span>收起</span><ChevronDown className="is-up" size={12} aria-hidden="true" />
                      </button>
                    </div>}
                  </>}
                  {!sectionPending && !review && section === "overview" && <div className="assistant-review-empty"><span>尚未生成深度解读。</span></div>}
                  {!sectionPending && !review && section !== "overview" && <p className="assistant-section-placeholder">尚无内容。</p>}
                </div>}
              </section>;
            })}

            <section className={`assistant-section assistant-discussion-section ${assistantSections.discussion ? "is-open" : ""}`}>
              <header className="assistant-section-header">
                <button className="assistant-section-toggle" type="button" aria-expanded={assistantSections.discussion} onClick={() => setAssistantSections((current) => ({ ...current, discussion: !current.discussion }))}>
                  <ChevronDown size={14} /><strong>讨论</strong>{messages.length > 0 ? <small>{messages.length}</small> : null}
                </button>
                <div className="discussion-header-actions">
                  <IconButton label="复制整个对话" disabled={!messages.length} onClick={copyDiscussion}><Copy size={13} /></IconButton>
                  <IconButton label="新讨论" onClick={startNewDiscussion}><Plus size={14} /></IconButton>
                </div>
              </header>
              {assistantSections.discussion && <div className="assistant-section-content assistant-discussion">
                <div className="discussion-thread-picker" ref={discussionMenuRef}>
                  <button type="button" className="discussion-thread-title" aria-haspopup="menu" aria-expanded={discussionMenuOpen} onClick={() => setDiscussionMenuOpen((open) => !open)}>
                    <MessageSquarePlus size={13} /><span>{discussionTitle}</span><ChevronDown className={discussionMenuOpen ? "is-open" : ""} size={13} />
                  </button>
                  {discussionMenuOpen && <div className="discussion-thread-menu" role="menu">
                    <div className="discussion-thread-menu-label">当前论文的讨论</div>
                    {!props.workspace.discussionThreads.length && <p>暂无历史记录</p>}
                    {props.workspace.discussionThreads.map((thread) => <div className={`discussion-thread-menu-item ${thread.id === activeDiscussionId ? "is-active" : ""}`} key={thread.id}>
                      <button type="button" onClick={() => selectDiscussion(thread)}><span>{thread.title}</span><small>{thread.messages.length} 条消息</small></button>
                      <IconButton label="重命名讨论" onClick={() => renameDiscussion(thread)}><Edit2 size={12} /></IconButton>
                      <IconButton label="删除讨论" onClick={() => deleteDiscussion(thread)}><Trash2 size={12} /></IconButton>
                    </div>)}
                  </div>}
                </div>
                <div className="chat-messages">
                  {!messages.length && <div className="discussion-empty"><span>有什么尽管问我。</span></div>}
                  {messages.map((message) => <article key={message.id} className={`chat-message ${message.role}`}>
                    {editingMessageId === message.id ? <div className="chat-message-editor">
                      <textarea autoFocus rows={3} value={editingMessageDraft} onChange={(event) => setEditingMessageDraft(event.target.value)} />
                      <div><button type="button" onClick={() => { setEditingMessageId(""); setEditingMessageDraft(""); }}>取消</button><button type="button" disabled={!editingMessageDraft.trim() || pending} onClick={() => resendEditedMessage(message.id)}>发送</button></div>
                    </div> : message.role === "assistant"
                      ? <MarkdownContent className="chat-message-content" content={message.content} />
                      : <div className="chat-message-content ml-reader-content">{visibleUserMessage(message.content)}</div>}
                    {editingMessageId !== message.id && <div className="chat-message-actions">
                      <IconButton label="复制" onClick={() => void navigator.clipboard.writeText(message.role === "user" ? visibleUserMessage(message.content) : message.content)}><Copy size={13} /></IconButton>
                      {message.role === "user" && <IconButton label="编辑问题" disabled={pending} onClick={() => { setEditingMessageId(message.id); setEditingMessageDraft(visibleUserMessage(message.content)); }}><Edit2 size={13} /></IconButton>}
                    </div>}
                  </article>)}
                  {pending && !insightPending && <div className="thinking"><i /><i /><i /></div>}
                  <div ref={messagesEndRef} />
                </div>
              </div>}
              {insightError && <div className="feature-error assistant-error feature-error-action"><span>{insightError}</span><button type="button" onClick={() => props.onOpenSettings("models")}><Settings size={12} />模型设置</button></div>}
            </section>
          </div>

          <div className="assistant-compose-dock">
            {props.selectedText && <div className="assistant-selection-context"><span><Sparkles size={11} />当前选区</span><p>{props.selectedText}</p><button type="button" aria-label="移除选区" title="移除选区" onClick={props.onClearSelection}><X size={12} /></button></div>}
            {referencePapers.length > 0 && <div className="discussion-reference-chips">
              {referencePapers.map((paper) => <span key={paper.id}><span>{paper.title}</span><button type="button" aria-label={`移除 ${paper.title}`} onClick={() => toggleReferencePaper(paper.id)}><X size={11} /></button></span>)}
            </div>}
            {!messages.length && <div className="assistant-suggested-questions">
              {["这篇论文的核心是什么？", "与现有研究有什么不同？", "有什么局限性？"].map((question) => <button type="button" key={question} disabled={pending || !fullPaperContext} onClick={() => { setAssistantSections((current) => ({ ...current, discussion: true })); void sendDiscussionMessage(question); }}>{question}</button>)}
            </div>}
            <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); setAssistantSections((current) => ({ ...current, discussion: true })); void sendDiscussionMessage(draft); }}>
              <div className="assistant-composer-main">
                <textarea ref={chatInputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="有什么尽管问我。" rows={1} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); setAssistantSections((current) => ({ ...current, discussion: true })); void sendDiscussionMessage(draft); }
                }} />
                <button type="submit" aria-label="发送" title="发送" disabled={!draft.trim() || pending}>{pending && !insightPending ? <LoaderCircle className="is-spinning" size={16} /> : <ArrowUp size={16} />}</button>
              </div>
              <div className="assistant-composer-footer">
                <div className="discussion-reference-picker">
                  <button type="button" className="assistant-chip-button" aria-haspopup="dialog" aria-expanded={referencePickerOpen} onClick={() => setReferencePickerOpen((open) => !open)}><Paperclip size={12} />添加参考论文</button>
                  {referencePickerOpen && <div className="discussion-reference-menu" role="dialog" aria-label="添加参考论文">
                    <strong>论文库</strong>
                    {props.libraryEntries.filter((entry) => entry.id !== props.document.id).length === 0 && <p>论文库中没有其他论文</p>}
                    {props.libraryEntries.filter((entry) => entry.id !== props.document.id).map((paper) => <label key={paper.id}>
                      <input type="checkbox" checked={selectedReferenceIds.includes(paper.id)} onChange={() => toggleReferencePaper(paper.id)} />
                      <span><strong>{paper.title}</strong><small>{paper.author || paper.fileName}</small></span>
                    </label>)}
                  </div>}
                </div>
                <div className="assistant-model-picker" ref={modelPickerRef}>
                  <button type="button" className="assistant-model-trigger" aria-haspopup="menu" aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen((open) => !open)}>
                    <span>{assistantModel || "默认模型"}</span><ChevronDown size={12} />
                  </button>
                  {modelMenuOpen && <div className="assistant-model-menu" role="menu" aria-label="选择模型">
                    <div className="assistant-model-menu-list">
                      {props.aiSettings.featureModels.chat && <button type="button" role="menuitemradio" aria-checked={false} onClick={() => {
                        const featureModels = { ...props.aiSettings.featureModels };
                        delete featureModels.chat;
                        props.onAiSettingsChange({ ...props.aiSettings, featureModels });
                        setModelMenuOpen(false);
                      }}><span>使用默认模型 · {props.aiSettings.defaultModel}</span></button>}
                      {assistantModels.map((model) => <button type="button" role="menuitemradio" aria-checked={model === assistantModel} className={model === assistantModel ? "is-active" : ""} key={model} onClick={() => {
                        const config = props.aiSettings.featureModels.chat || defaultAiModelConfig(props.aiSettings);
                        props.onAiSettingsChange({ ...props.aiSettings, featureModels: { ...props.aiSettings.featureModels, chat: { ...config, model, reasoningEffort: "auto" } } });
                        setModelMenuOpen(false);
                      }}><span>{model}</span>{model === assistantModel && <Check size={13} />}</button>)}
                    </div>
                    <button type="button" className="assistant-model-settings" onClick={() => { setModelMenuOpen(false); props.onOpenSettings("models"); }}><Settings size={13} /><span>模型设置</span></button>
                  </div>}
                </div>
                {assistantEffortLevels.length > 0 && <div className="assistant-model-picker assistant-effort-picker" ref={effortPickerRef}>
                  <button type="button" className="assistant-model-trigger" aria-haspopup="menu" aria-expanded={effortMenuOpen} onClick={() => setEffortMenuOpen((open) => !open)}>
                    <span>推理·{{ auto: "默认", low: "低", medium: "中", high: "高", max: "最大" }[assistantEffort]}</span><ChevronDown size={12} />
                  </button>
                  {effortMenuOpen && <div className="assistant-model-menu assistant-effort-menu" role="menu" aria-label="选择推理强度">
                    <div className="assistant-model-menu-list">
                      {assistantEffortLevels.map((effort) => <button type="button" role="menuitemradio" aria-checked={effort === assistantEffort} className={effort === assistantEffort ? "is-active" : ""} key={effort} onClick={() => {
                        const config = props.aiSettings.featureModels.chat || defaultAiModelConfig(props.aiSettings);
                        props.onAiSettingsChange({ ...props.aiSettings, featureModels: { ...props.aiSettings.featureModels, chat: { ...config, reasoningEffort: effort as AiReasoningEffort } } });
                        setEffortMenuOpen(false);
                      }}><span>{{ auto: "默认", low: "低", medium: "中", high: "高", max: "最大" }[effort]}</span>{effort === assistantEffort && <Check size={13} />}</button>)}
                    </div>
                  </div>}
                </div>}
              </div>
            </form>
          </div>
        </div>
      )}

      {props.activeTab === "quiz" && (
        <div className="feature-panel quiz-panel">
          {!props.workspace.quiz && <>
            <button className="primary-button feature-command" type="button" disabled={!fullPaperContext.trim() || pending} onClick={() => void generateQuiz()}>
              {pending ? <LoaderCircle className="is-spinning" size={15} /> : null}{pending ? "准备中..." : "开始问答游戏"}
            </button>
            {quizError && <div className="feature-error feature-error-action"><span>{quizError}</span><button type="button" onClick={() => props.onOpenSettings("models")}><Settings size={12} />打开模型设置</button></div>}
          </>}

          {props.workspace.quiz && <QuizStoryPlayer session={props.workspace.quiz} onChange={(quiz) => updateWorkspace({ quiz })} onEvidence={props.onQuizEvidence} onRegenerate={() => { if (window.confirm("生成新问答游戏将覆盖当前进度，继续吗？")) updateWorkspace({ quiz: null }); }} />}
        </div>
      )}

      {props.activeTab === "highlights" && (
        <div className="feature-panel highlights-panel">
          <div className="highlight-visibility">
            <div className="highlight-manual-row">
              <label className="highlight-master"><input type="checkbox" checked={allHighlightsVisible} onChange={() => { const visible = !allHighlightsVisible; updateHighlightVisibility({ manual: { yellow: visible, green: visible, blue: visible, rose: visible } }); }} /><span>全部</span></label>
              <div className="highlight-color-palette">{(["yellow", "green", "blue", "rose"] as const).map((color) => <label key={color} title={{ yellow: "黄色", green: "绿色", blue: "蓝色", rose: "红色" }[color]}><input type="checkbox" checked={highlightVisibility.manual[color]} onChange={(event) => updateHighlightVisibility({ manual: { ...highlightVisibility.manual, [color]: event.target.checked } })} /><span className={`highlight-filter-swatch color-${color}`} /></label>)}</div>
            </div>
            <div className="auto-highlight-header"><span>AI 自动高亮论文的关键部分</span><button type="button" disabled={!initialPaperContext.trim() || (pending && !autoHighlightRunning)} onClick={() => void autoHighlightPage()}>{autoHighlightRunning ? "停止" : "开始自动高亮"}</button></div>
            <div className="auto-highlight-controls">
              <div><label><input type="checkbox" checked={highlightVisibility.automatic} onChange={(event) => updateHighlightVisibility({ automatic: event.target.checked })} /><span>自动高亮</span></label><label><input type="checkbox" checked={highlightVisibility.labels} onChange={(event) => updateHighlightVisibility({ labels: event.target.checked })} /><span>标签</span></label></div>
              <div>{(["novelty", "methods", "results"] as const).map((category) => <label key={category}><input type="checkbox" checked={highlightVisibility.categories[category]} onChange={(event) => updateHighlightVisibility({ categories: { ...highlightVisibility.categories, [category]: event.target.checked } })} /><span className={`highlight-type ${category}`}>{{ novelty: "独创性", methods: "方法", results: "结果" }[category]}</span></label>)}</div>
            </div>
          </div>
          {highlightError && <div className="feature-error feature-error-action"><span>{highlightError}</span><button type="button" onClick={() => props.onOpenSettings("models")}><Settings size={12} />模型设置</button></div>}
          <label className="panel-search"><Search size={14} /><input value={highlightQuery} onChange={(event) => setHighlightQuery(event.target.value)} placeholder="搜索" />{highlightQuery && <button type="button" aria-label="清除高亮搜索" onClick={() => setHighlightQuery("")}><X size={13} /></button>}</label>
          {!highlighted.length && !props.workspace.autoHighlights.length && <PanelEmpty icon={<Highlighter size={24} />} title="还没有高亮" body="选中 PDF 文本后创建高亮，或使用顶部的自动高亮。" />}
          {filteredHighlights.map((annotation) => (
            <article className={`note-item color-${annotation.color}`} key={annotation.id}><header><button type="button" onClick={() => props.onNavigate(annotation.pageNumber)}>第 {annotation.pageNumber} 页</button><IconButton label="删除高亮" onClick={() => props.onDeleteAnnotation(annotation.id)}><Trash2 size={14} /></IconButton></header><blockquote>{annotation.quote}</blockquote></article>
          ))}
          {filteredAutoHighlights.map((item) => <article className={`auto-highlight-item category-${item.category}`} key={item.id}><header><span>{{ novelty: "独创性", methods: "方法", results: "结果" }[item.category]}</span><button type="button" onClick={() => props.onNavigate(item.pageNumber)}>第 {item.pageNumber} 页</button><IconButton label="删除自动高亮" onClick={() => updateWorkspace({ autoHighlights: props.workspace.autoHighlights.filter((highlight) => highlight.id !== item.id) })}><Trash2 size={13} /></IconButton></header><p>{item.quote}</p><small>{item.explanation}</small></article>)}
        </div>
      )}

      {props.activeTab === "explain" && (
        <div className="feature-panel explain-panel">
          {pending && props.actionRequest?.type === "explain-selection" && <div className="explanation-pending-banner" role="status" aria-live="polite"><LoaderCircle className="is-spinning" size={15} /><span>正在思考，请稍等…</span></div>}
          <div className="panel-filter-grid explanation-filters"><label><input type="checkbox" checked={allExplanationTypes} onChange={() => { const value = !allExplanationTypes; setExplanationTypes({ text: value, image: value, table: value, formula: value, url: value }); }} /><span>全部</span></label>{(["text", "image", "url", "table", "formula"] as ExplanationRecord["sourceType"][]).map((type) => <label key={type}><input type="checkbox" checked={explanationTypes[type]} onChange={(event) => setExplanationTypes((current) => ({ ...current, [type]: event.target.checked }))} /><span>{{ text: "文本", image: "图片", table: "表格", formula: "数学公式", url: "URL" }[type]}</span></label>)}</div>
          <label className="panel-search"><Search size={14} /><input value={explanationQuery} onChange={(event) => setExplanationQuery(event.target.value)} placeholder="搜索" />{explanationQuery && <button type="button" aria-label="清除解释搜索" onClick={() => setExplanationQuery("")}><X size={13} /></button>}</label>
          {!props.workspace.explanations.length && <PanelEmpty icon={<Sparkles size={24} />} title="还没有解释。" body="选择文本、图片、表格或公式后，AI 解释会汇集在这里。" />}
          <div className="explanation-history">{filteredExplanations.map((item) => {
            const conversation = item.conversation || [];
            return <article key={item.id} className="explanation-thread">
              <header><button type="button" onClick={() => props.onNavigate(item.pageNumber)}>第 {item.pageNumber} 页</button><span>{{ text: "文本", image: "图片", table: "表格", formula: "数学公式", url: "URL" }[item.sourceType]}</span><div><IconButton label="复制解释" onClick={() => void navigator.clipboard.writeText(`${item.source}\n\n${item.response}`)}><Copy size={13} /></IconButton><IconButton label="删除解释" onClick={() => updateWorkspace({ explanations: props.workspace.explanations.filter((record) => record.id !== item.id) })}><Trash2 size={13} /></IconButton></div></header>
              {item.imageDataUrl && <img src={item.imageDataUrl} alt="解释记录的图像选区" />}
              <blockquote>{item.source}</blockquote>
              <MarkdownContent className="explanation-answer" content={item.response} />
              {conversation.slice(conversation[0]?.role === "assistant" ? 1 : 0).map((message) => message.role === "assistant"
                ? <MarkdownContent key={message.id} className="explanation-followup assistant" content={message.content} />
                : <div key={message.id} className="explanation-followup user">{message.content}</div>)}
              {explanationPendingId === item.id && <div className="thinking feature-thinking"><i /><i /><i /></div>}
              <form className="explanation-composer" onSubmit={(event) => { event.preventDefault(); void sendExplanationFollowup(item); }}>
                <textarea rows={1} value={explanationDrafts[item.id] || ""} onChange={(event) => setExplanationDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="继续提出您想了解的问题。" />
                <button type="submit" aria-label="发送追问" disabled={!explanationDrafts[item.id]?.trim() || Boolean(explanationPendingId)}><ArrowUp size={14} /></button>
              </form>
            </article>;
          })}</div>
        </div>
      )}

      {props.activeTab === "translation" && (
        <div className="feature-panel explain-panel selection-translation-panel">
          <div className="panel-filter-grid explanation-filters">
            {(["text", "image"] as SelectionTranslationRecord["sourceType"][]).map((type) => (
              <label key={type}>
                <input type="checkbox" checked={translationTypes[type]} onChange={(event) => setTranslationTypes((current) => ({ ...current, [type]: event.target.checked }))} />
                <span>{{ text: "文本", image: "图片" }[type]}</span>
              </label>
            ))}
          </div>
          <label className="panel-search"><Search size={14} /><input value={translationQuery} onChange={(event) => setTranslationQuery(event.target.value)} placeholder="搜索" />{translationQuery && <button type="button" aria-label="清除翻译搜索" onClick={() => setTranslationQuery("")}><X size={13} /></button>}</label>
          {!props.workspace.selectionTranslations.length && <PanelEmpty icon={<Languages size={24} />} title="还没有划句翻译" body="在论文中选择文本或图片，然后点击“翻译”。" />}
          <div className="explanation-history">{filteredSelectionTranslations.map((item) => (
            <article key={item.id} className="explanation-thread selection-translation-item">
              <header>
                <button type="button" onClick={() => props.onNavigate(item.pageNumber)}>第 {item.pageNumber} 页</button>
                <span>{{ text: "文本", image: "图片" }[item.sourceType]}</span>
                <div>
                  <IconButton label="复制翻译" onClick={() => void navigator.clipboard.writeText(`${item.source}\n\n${item.response}`)}><Copy size={13} /></IconButton>
                  <IconButton label="删除翻译" onClick={() => updateWorkspace({ selectionTranslations: props.workspace.selectionTranslations.filter((record) => record.id !== item.id) })}><Trash2 size={13} /></IconButton>
                </div>
              </header>
              {item.imageDataUrl && <img src={item.imageDataUrl} alt="翻译记录的图像选区" />}
              <blockquote>{item.source}</blockquote>
              <MarkdownContent className="explanation-answer" content={item.response} />
            </article>
          ))}</div>
        </div>
      )}

      {props.activeTab === "comments" && (
        <div className="feature-panel comments-panel">
          <div className="comment-how-to"><MousePointer2 size={23} /><div><strong>添加评论</strong><p>在论文中选择文本，然后从出现的菜单中选择“评论”。</p></div></div>
          <button className="add-comment-button" type="button" aria-label="添加评论" onClick={() => setCommentComposerOpen(true)}><Plus size={18} /></button>
          {commentComposerOpen && <div className="comment-compose-region">{props.selectedText && <div className="selected-context comment-selected-context"><span>评论选区</span><button type="button" onClick={props.onClearSelection}>仅评论页面</button><p>{props.selectedText}</p></div>}<div className="comment-composer"><textarea autoFocus rows={3} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder={props.selectedText ? "添加选区评论..." : `添加第 ${props.currentPage} 页评论...`} /><div><button className="comment-cancel" type="button" onClick={() => { setCommentDraft(""); setCommentComposerOpen(false); }}>取消</button><button type="button" onClick={addComment} disabled={!commentDraft.trim()}><Send size={14} />添加</button></div></div></div>}
          <div className="comment-list">{props.workspace.comments.map((comment) => <article className={`comment-item ${comment.resolved ? "is-resolved" : ""}`} key={comment.id} onClick={() => props.onNavigate(comment.pageNumber)}>
            <header><button type="button" onClick={(event) => { event.stopPropagation(); props.onNavigate(comment.pageNumber); }}>第 {comment.pageNumber} 页{comment.resolved ? " · 已解决" : ""}</button><div><IconButton label={comment.resolved ? "重新打开评论" : "解决评论"} onClick={() => toggleCommentResolved(comment.id)}><Check size={13} /></IconButton><IconButton label="编辑评论" onClick={() => { setEditingCommentId(comment.id); setEditingCommentDraft(comment.body); }}><Edit3 size={13} /></IconButton><IconButton label="删除评论" onClick={() => { if (window.confirm("确定要删除此评论吗？")) updateWorkspace({ comments: props.workspace.comments.filter((item) => item.id !== comment.id) }); }}><Trash2 size={13} /></IconButton></div></header>
            {comment.quote && <blockquote>{comment.quote}</blockquote>}
            {editingCommentId === comment.id ? <div className="comment-inline-editor" onClick={(event) => event.stopPropagation()}><textarea autoFocus rows={3} value={editingCommentDraft} onChange={(event) => setEditingCommentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveCommentEdit(comment.id); } }} /><div><button type="button" onClick={() => setEditingCommentId("")}>取消</button><button type="button" onClick={() => saveCommentEdit(comment.id)} disabled={!editingCommentDraft.trim()}>保存</button></div></div> : <p>{comment.body}</p>}
            {!!comment.replies?.length && <div className="comment-replies">{comment.replies.map((reply) => <p key={reply.id}><Reply size={12} />{reply.body}</p>)}</div>}
            <form className="comment-reply-composer" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); addCommentReply(comment.id); }}><input value={commentReplyDrafts[comment.id] || ""} onChange={(event) => setCommentReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))} placeholder="回复评论" /><button type="submit" aria-label="发送回复" disabled={!commentReplyDrafts[comment.id]?.trim()}><Reply size={13} /></button></form>
          </article>)}</div>
        </div>
      )}

      {props.activeTab === "notes" && (
        <div className="feature-panel notes-panel">
          <div className="note-editor-shell">
            <div className="note-toolbar" role="toolbar" aria-label="笔记工具栏">
              <div className="note-view-switch"><button type="button" className={!notePreview ? "is-active" : ""} onClick={() => setNotePreview(false)}>编辑</button><button type="button" className={notePreview ? "is-active" : ""} onClick={() => setNotePreview(true)}>预览</button></div>
              <span className="note-toolbar-divider" />
              <select aria-label="段落样式" value="" onChange={(event) => { applyNoteLinePrefix(event.target.value); event.currentTarget.value = ""; }}><option value="">正文</option><option value="# ">标题 1</option><option value="## ">标题 2</option><option value="### ">标题 3</option></select>
              <span className="note-toolbar-divider" />
              <IconButton label="粗体" onClick={() => applyNoteMarkup("**")}><Bold size={14} /></IconButton>
              <IconButton label="斜体" onClick={() => applyNoteMarkup("*")}><Italic size={14} /></IconButton>
              <IconButton label="删除线" onClick={() => applyNoteMarkup("~~")}><Strikethrough size={14} /></IconButton>
              <span className="note-toolbar-divider" />
              <IconButton label="项目符号列表" onClick={() => applyNoteLinePrefix("- ")}><List size={14} /></IconButton>
              <IconButton label="编号列表" onClick={() => applyNoteLinePrefix("1. ")}><ListOrdered size={14} /></IconButton>
              <IconButton label="代码块" onClick={() => applyNoteMarkup("```\n", "\n```", "代码")}><Code2 size={14} /></IconButton>
              <IconButton label="分隔线" onClick={() => applyNoteMarkup("\n\n---\n\n", "", "")}><Minus size={14} /></IconButton>
              <IconButton label="链接" onClick={() => { const url = window.prompt("请输入网址")?.trim(); if (url) applyNoteMarkup("[", `](${url})`, "链接文本"); }}><Link size={14} /></IconButton>
            </div>
            <div className="note-editor-body">
              {notePreview ? <MarkdownContent className="note-preview" content={activeNote?.body || ""} /> : <textarea ref={noteEditorRef} aria-label="论文笔记" value={activeNote?.body || ""} onChange={(event) => commitActiveNote({ body: event.target.value })} placeholder="在此自由记录……" spellCheck />}
            </div>
          </div>
        </div>
      )}

      {props.activeTab === "citations" && (
        <div className="feature-panel citations-panel">
          <label className="panel-search citation-search"><Search size={14} /><input value={citationQuery} onChange={(event) => setCitationQuery(event.target.value)} placeholder="搜索" />{citationQuery && <button type="button" aria-label="清除引用搜索" onClick={() => setCitationQuery("")}><X size={13} /></button>}</label>
          <div className="citation-format-row">
            <select aria-label="引用格式" value={citationFormat} onChange={(event) => changeCitationFormat(event.target.value as CitationFormat)}><option value="apa">APA</option><option value="harvard">Harvard</option><option value="vancouver">Vancouver</option><option value="bibtex">BibTeX</option></select>
          </div>
          <div className="citation-tabs" role="tablist" aria-label="文献类型">
            <button type="button" role="tab" aria-selected={citationTab === "saved"} className={citationTab === "saved" ? "is-active" : ""} onClick={() => { setCitationTab("saved"); setCitationQuery(""); }}>已保存 ({savedCitations.length})</button>
            <button type="button" role="tab" aria-selected={citationTab === "references"} className={citationTab === "references" ? "is-active" : ""} onClick={() => { setCitationTab("references"); setCitationQuery(""); }}>参考文献 ({paperReferences.length})</button>
            <button type="button" role="tab" aria-selected={citationTab === "cited-by"} className={citationTab === "cited-by" ? "is-active" : ""} onClick={() => { setCitationTab("cited-by"); setCitationQuery(""); }}>被引用 ({citedByPapers.length})</button>
          </div>

          {citationError && <div className="citation-notice">{citationError}{!props.aiSettings.semanticScholarApiKey.trim() && <button type="button" onClick={() => props.onOpenSettings("metadata")}>填写 Key</button>}</div>}
          {((citationTab === "references" && referenceState === "loading") || (citationTab === "cited-by" && (citedByState === "loading" || metadataState === "loading"))) && (
            <div className="citation-loading"><LoaderCircle className="is-spinning" size={18} /><span>{citationTab === "references" ? "正在解析参考文献" : "正在读取被引用论文"}</span></div>
          )}
          {citationTab === "saved" && !filteredCitations.length && <PanelEmpty icon={<Bookmark size={24} />} title="还没有已保存文献" body="" />}
          {citationTab === "references" && referenceState === "ready" && !filteredCitations.length && <PanelEmpty icon={<Quote size={24} />} title={citationQuery ? "没有匹配的参考文献" : "未识别到参考文献"} body="" />}
          {citationTab === "cited-by" && citedByState !== "loading" && metadataState !== "loading" && !filteredCitations.length && <PanelEmpty icon={<Quote size={24} />} title={citationQuery ? "没有匹配的被引用论文" : "没有可显示的被引用论文"} body="" />}

          <div className="citation-list">
            {filteredCitations.map((citation) => {
              const isSaved = savedCitationKeys.has(citationIdentity(citation));
              const citationKey = citationIdentity(citation);
              const detail = citationDetail[citationKey] || "";
              const paperUrl = citation.url
                || (citation.doi ? `https://doi.org/${citation.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}` : "")
                || (citation.paperId ? `https://www.semanticscholar.org/paper/${citation.paperId}` : "")
                || `https://www.semanticscholar.org/search?q=${encodeURIComponent([citation.title, citation.authors].filter(Boolean).join(" "))}`;
              const pdfUrl = citation.openAccessPdf || (paperUrl && /\.pdf(?:$|[?#])/i.test(paperUrl) ? paperUrl : "");
              const formatted = formatCitation(citationFormat, citation) || citation.rawReference || citation.formatted;
              const inLibrary = props.libraryEntries.some((entry) => entry.title.trim().toLocaleLowerCase() === citation.title.trim().toLocaleLowerCase());
              const abstract = citation.abstract || citation.rawReference || "";
              const expandedAbstract = expandedCitationAbstracts[citationKey];
              return (
                <article className="citation-card" key={citation.id}>
                  <div className="citation-card-main">
                    <h3>
                      <a href={paperUrl} target="_blank" rel="noreferrer">{citation.title}<ExternalLink size={12} /></a><IconButton label="复制论文标题" onClick={() => void navigator.clipboard.writeText(citation.title)}><Copy size={12} /></IconButton>
                    </h3>
                    {citation.authors && <p className="citation-authors">{citation.authors}</p>}
                    {(citation.year || citation.venue) && <p className="citation-meta">{[citation.year, citation.venue].filter(Boolean).join(" · ")}</p>}
                    {abstract && <p className={`citation-abstract ${expandedAbstract ? "is-expanded" : ""}`}>{abstract}{abstract.length > 400 && <button type="button" onClick={() => setExpandedCitationAbstracts((current) => ({ ...current, [citationKey]: !current[citationKey] }))}>{expandedAbstract ? "收起" : "查看更多"}</button>}</p>}
                    <div className="citation-card-actions">
                      <button type="button" className={isSaved ? "is-saved" : ""} onClick={() => toggleSavedCitation(citation)}><Bookmark size={13} fill={isSaved ? "currentColor" : "none"} />{isSaved ? "已保存" : "保存"}</button>
                      {pdfUrl ? <button type="button" className={inLibrary ? "is-saved" : ""} onClick={() => props.onToggleCitationLibrary(citation, inLibrary)}>{inLibrary ? "从论文库移除" : "添加到论文库"}</button> : <span><ExternalLink size={13} />无 PDF</span>}
                    </div>
                    <small className="citation-disclaimer">*此信息可能会变更或有误。</small>
                  </div>
                  <footer>
                    {citation.citationCount !== undefined && <a href={paperUrl} target="_blank" rel="noreferrer">{citation.citationCount.toLocaleString()}</a>}
                    <button type="button" onClick={() => setCitationDetail((current) => ({ ...current, [citationKey]: detail === "citation" ? "" : "citation" }))}>{citationFormat === "bibtex" ? "BibTeX" : citationFormat.toUpperCase()}</button>
                    <span />
                    {citation.referenceNumber && <><button type="button" onClick={() => { setCitationDetail((current) => ({ ...current, [citationKey]: detail === "reason" ? "" : "reason" })); if (!citation.reasonCited) void analyzeCitation(citation, "reason"); }}>引用原因</button><button type="button" onClick={() => { setCitationDetail((current) => ({ ...current, [citationKey]: detail === "worth" ? "" : "worth" })); if (!citation.worthReading) void analyzeCitation(citation, "worth"); }}>值得阅读吗？</button></>}
                  </footer>
                  {detail && <div className="citation-details">
                    {detail === "citation" && <section><header><strong>{citationFormat === "bibtex" ? "BibTeX" : citationFormat.toUpperCase()}</strong><IconButton label="复制引用" onClick={() => void navigator.clipboard.writeText(formatted)}><Copy size={12} /></IconButton></header><pre>{formatted}</pre></section>}
                    {detail === "reason" && <section><header><strong>引用原因</strong></header>{citationAnalysisPending === `${citationKey}:reason` ? <div className="thinking"><i /><i /><i /></div> : <MarkdownContent content={citation.reasonCited || ""} />}</section>}
                    {detail === "worth" && <section><header><strong>值得阅读吗？</strong><div className="citation-worth-levels">{["全文阅读", "略读", "仅摘要", "跳过"].map((level) => <span className={citation.worthReading?.trim().startsWith(level) ? "is-active" : ""} key={level}>{level}</span>)}</div></header>{citationAnalysisPending === `${citationKey}:worth` ? <div className="thinking"><i /><i /><i /></div> : <MarkdownContent content={(citation.worthReading || "").replace(/^(全文阅读|略读|仅摘要|跳过)\s*/, "")} />}</section>}
                  </div>}
                </article>
              );
            })}
          </div>

          {showMetadataKeyPrompt && (
            <div className="dialog-backdrop metadata-key-backdrop" role="presentation">
              <section className="metadata-key-dialog" role="dialog" aria-modal="true" aria-labelledby="metadata-key-title">
                <header>
                  <span><WifiOff size={18} /></span>
                  <div><h2 id="metadata-key-title">在线文献源暂不可用</h2><p>本地解析结果仍可继续使用</p></div>
                </header>
                <div className="metadata-key-body">
                  <KeyRound size={22} />
                  <p>公共元数据服务均未能连接。可以继续离线阅读，或填写自己的 Semantic Scholar API Key 后重新获取摘要、开放 PDF 和被引用论文。</p>
                </div>
                <footer>
                  <button className="secondary-button" type="button" onClick={() => { metadataPromptDismissedRef.current = true; setShowMetadataKeyPrompt(false); }}>继续离线</button>
                  <button className="primary-button compact" type="button" onClick={() => { setShowMetadataKeyPrompt(false); props.onOpenSettings("metadata"); }}><Settings size={14} />填写 API Key</button>
                </footer>
              </section>
            </div>
          )}
        </div>
      )}

      {props.activeTab === "peer-reviews" && (
        <div className="feature-panel peer-reviews-panel">
          {peerReviewState === "loading" && <div className="citation-loading"><LoaderCircle className="is-spinning" size={18} /><span>正在匹配 OpenReview 公开评审</span></div>}
          {peerReviewState === "error" && <div className="citation-notice">{peerReviewError}</div>}
          {peerReviewState === "ready" && !peerReviewResult && <PanelEmpty icon={<MessageSquareText size={24} />} title="没有公开评审" body="" />}
          {peerReviewResult && <>
            <section className="peer-review-paper">
              <div>
                <strong>{peerReviewResult.title}</strong>
                {peerReviewResult.venue && <span>{peerReviewResult.venue}</span>}
              </div>
              <a href={peerReviewResult.url} target="_blank" rel="noreferrer" aria-label="在 OpenReview 打开"><ExternalLink size={14} /></a>
            </section>
            {peerReviewResult.decision && <section className="peer-review-decision"><span>最终决定</span><strong>{peerReviewResult.decision}</strong></section>}
            {!peerReviewResult.reviews.length && <PanelEmpty icon={<MessageSquareText size={24} />} title="该记录没有公开审稿意见" body="" />}
            <div className="peer-review-list">
              {peerReviewResult.reviews.map((review) => {
                const expanded = expandedPeerReviews[review.id];
                const metrics = [
                  review.rating ? ["评分", review.rating] : null,
                  review.confidence ? ["置信度", review.confidence] : null,
                  review.soundness ? ["可靠性", review.soundness] : null,
                  review.presentation ? ["表达", review.presentation] : null,
                  review.contribution ? ["贡献", review.contribution] : null,
                ].filter((metric): metric is string[] => Boolean(metric));
                return <article className={`peer-review-card ${expanded ? "is-expanded" : ""}`} key={review.id}>
                  <button type="button" aria-expanded={expanded} onClick={() => setExpandedPeerReviews((current) => ({ ...current, [review.id]: !current[review.id] }))}>
                    <span><MessageSquareText size={15} /><strong>{review.reviewer}</strong>{review.date && <small>{review.date}</small>}</span>
                    <ChevronDown size={15} />
                  </button>
                  {!!metrics.length && <div className="peer-review-metrics">{metrics.map(([label, value]) => <span key={label}><b>{label}</b>{value}</span>)}</div>}
                  {expanded && <div className="peer-review-content">
                    {review.summary && <section><h3>评审摘要</h3><MarkdownContent content={review.summary} /></section>}
                    {review.strengths && <section><h3>优点</h3><MarkdownContent content={review.strengths} /></section>}
                    {review.weaknesses && <section><h3>缺点</h3><MarkdownContent content={review.weaknesses} /></section>}
                    {review.questions && <section><h3>给作者的问题</h3><MarkdownContent content={review.questions} /></section>}
                  </div>}
                </article>;
              })}
            </div>
          </>}
        </div>
      )}

      {props.activeTab === "details" && (
        <div className="details-panel"><div className="details-icon"><FileText size={22} /></div><h2>{props.document.title}</h2>{props.document.author && <p className="document-author">{props.document.author}</p>}<dl><div><dt>文件</dt><dd>{props.document.file.name}</dd></div><div><dt>页数</dt><dd>{props.document.pageCount}</dd></div><div><dt>渲染器</dt><dd>Mozilla PDF.js</dd></div><div><dt>存储</dt><dd>本地设备</dd></div></dl></div>
      )}
    </aside>
  );
}
