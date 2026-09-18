import type { PDFDocumentProxy } from "pdfjs-dist";

export type PdfFile = {
  name: string;
  data: Uint8Array;
  sourcePath?: string;
  libraryMode?: "remember" | "temporary";
  displayTitle?: string;
  displayAuthor?: string;
};

export type PdfDocumentState = {
  id: string;
  file: PdfFile;
  proxy: PDFDocumentProxy;
  title: string;
  author: string;
  pageCount: number;
  subject?: string;
  keywords?: string[];
  year?: number;
};

export type DocumentLibraryEntry = {
  id: string;
  title: string;
  author: string;
  fileName: string;
  sourcePath?: string;
  pageCount: number;
  lastPage: number;
  lastOpenedAt: string;
  addedAt?: string;
  folder?: string;
  tags?: string[];
  favorite?: boolean;
  rating?: number;
};

export type AnnotationRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type Annotation = {
  id: string;
  documentId: string;
  pageNumber: number;
  type: "highlight" | "note";
  color: "yellow" | "green" | "blue" | "rose";
  quote: string;
  note: string;
  rects: AnnotationRect[];
  createdAt: string;
  updatedAt: string;
};

export type TextSelection = {
  pageNumber: number;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  rects: AnnotationRect[];
  clientX: number;
  clientY: number;
  sourceType?: "text" | "url";
};

export type SearchHit = {
  pageNumber: number;
  excerpt: string;
  count: number;
};

export type OutlineEntry = {
  title: string;
  pageNumber?: number;
  items: OutlineEntry[];
};

export type AiProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "moonshot"
  | "qwen"
  | "ollama"
  | "lmstudio"
  | "custom";

export type AiPromptSettings = {
  system: string;
  review: string;
  explain: string;
  translation: string;
  chat: string;
};

export type AiFeature = "review" | "chat" | "desktopPet" | "explain" | "translation" | "highlights" | "quiz";

export type AiReasoningEffort = "auto" | "low" | "medium" | "high" | "max";
export type AgentRuntimeId = "claude_code" | "codex_runtime";
export type AgentAccessMode = "direct" | "thirdparty";
export type AgentPaths = Partial<Record<AgentRuntimeId, string>>;
export type AgentThirdPartyConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Models discovered from the configured compatible endpoint. */
  models?: string[];
};

export type AiModelConfig = {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  availableModels: string[];
  reasoningEffort: AiReasoningEffort;
};

export type DesktopPetWindowSize = "compact" | "standard" | "spacious";
export type DesktopPetSkin = "datawhale-spirit" | "cat-spirit" | "panda-spirit" | "robot-assistant" | "custom";

export type DesktopPetSettings = {
  enabled: boolean;
  alwaysOnTop: boolean;
  recommendationAlerts: boolean;
  avatarScale: number;
  skin: DesktopPetSkin;
  windowSize: DesktopPetWindowSize;
  openTarget: "reader" | "writer" | "discovery";
  customSpriteDataUrl: string;
  customSpriteName: string;
};

export type DesktopPetTtsProvider = "browser" | "edge-tts" | "openai-tts" | "elevenlabs" | "minimax-tts" | "fish-audio";

export type DesktopPetTtsSettings = {
  enabled: boolean;
  autoPlay: boolean;
  provider: DesktopPetTtsProvider;
  voice: string;
  rate: number;
  volume: number;
  splitEnabled: boolean;
  maxSentenceLength: number;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  extraConfigs: Record<string, Record<string, string | number | boolean>>;
};

export type AiSettings = {
  agentRuntime: AgentRuntimeId;
  agentAccess: Record<AgentRuntimeId, AgentAccessMode>;
  /** Optional local CLI paths. Empty values use automatic discovery. */
  agentPaths: AgentPaths;
  agentThirdParty: Partial<Record<AgentRuntimeId, AgentThirdPartyConfig>>;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  availableModels: string[];
  defaultReasoningEffort: AiReasoningEffort;
  featureModels: Partial<Record<AiFeature, AiModelConfig>>;
  language: "zh-CN" | "en-US";
  semanticScholarApiKey: string;
  prompts: AiPromptSettings;
  appearance: {
    documentTheme: DocumentTheme;
    reduceMotion: boolean;
  };
  desktopPet: DesktopPetSettings;
  desktopPetTts: DesktopPetTtsSettings;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type DiscussionThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  referencePaperIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type FeatureStatus = "idle" | "loading" | "ready" | "error";

export type PaperComment = {
  id: string;
  documentId: string;
  pageNumber: number;
  quote: string;
  rects?: AnnotationRect[];
  body: string;
  resolved: boolean;
  replies?: PaperCommentReply[];
  createdAt: string;
  updatedAt: string;
};

export type PaperCommentReply = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type PaperNote = {
  id: string;
  documentId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type PaperReviewPoint = {
  title: string;
  evidence: string;
  significance: string;
  suggestion?: string;
};

export type LegacyPaperReview = {
  executiveSummary: string;
  paperType: string;
  researchQuestion: string;
  contributions: string[];
  methodologySummary: string;
  experimentalEvidence: string;
  strengths: PaperReviewPoint[];
  weaknesses: PaperReviewPoint[];
  reproducibility: string;
  literaturePositioning: string;
  takeaways: string[];
};

export type MarkdownPaperReview = {
  overviewMarkdown: string;
  methodMarkdown: string;
  analysisMarkdown: string;
};

export type PaperReview = LegacyPaperReview | MarkdownPaperReview;

export type PaperInsights = {
  review: PaperReview | null;
  sessionContext?: string;
  sessionPrompt?: string;
  sessionResponse?: string;
  cacheAffinityKey?: string;
  updatedAt?: string;
};

export type CitationCard = {
  id: string;
  documentId: string;
  pageNumber: number;
  quote: string;
  title: string;
  authors: string;
  formatted: string;
  format?: CitationFormat;
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  citationCount?: number;
  referenceNumber?: number;
  rawReference?: string;
  paperId?: string;
  openAccessPdf?: string;
  source?: "manual" | "pdf-reference" | "semantic-scholar" | "moonlight" | "openalex" | "crossref" | "huggingface" | "arxiv";
  saved?: boolean;
  inLibrary?: boolean;
  reasonCited?: string;
  worthReading?: string;
  createdAt: string;
};

export type CitationFormat = "apa" | "harvard" | "vancouver" | "bibtex";

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  hint?: string;
  explanation: string;
  intro: string;
  correctFeedback: string;
  incorrectFeedback: string;
  difficulty?: "basic" | "hard";
  evidence: {
    pageNumber: number;
    evidenceQuote: string;
    rects?: AnnotationRect[];
  };
};

export type QuizAnswer = { selectedIndex: number; correct: boolean; answeredAt: string };
export type QuizPlaybackStage = "intro" | "answer" | "feedback";
export type QuizSession = {
  version: 3;
  questions: QuizQuestion[];
  currentIndex: number;
  stage: QuizPlaybackStage;
  answers: Record<string, QuizAnswer>;
  hintShown: Record<string, boolean>;
  completed: boolean;
  score: number;
  difficulty: "basic" | "hard";
  targetQuestionCount: number;
  difficultyPlan: { basic: number; hard: number };
  createdAt: string;
  updatedAt: string;
};

export type PageTranslation = {
  pageNumber: number;
  layoutVersion?: number;
  sourceLanguage: string;
  targetLanguage: string;
  content: string;
  segments?: TranslationSegment[];
  updatedAt: string;
};

export type TextRange = { start: number; end: number };

export type TranslationSegment = {
  id: string;
  kind?: "text" | "figure-caption" | "table" | "formula" | "footnote";
  sourceBlockId?: string;
  sourceBlockIds?: string[];
  sourceText: string;
  sourceRange: TextRange;
  targetText: string;
  targetRange: TextRange;
  rects?: AnnotationRect[];
};

export type PdfVisualRegion = AnnotationRect & {
  kind: "image" | "table" | "formula";
};

export type PdfTextBlock = {
  id: string;
  pageNumber: number;
  text: string;
  rects: AnnotationRect[];
  order: number;
  /** Visual column assigned by the layout parser (0 for single-column pages). */
  column?: number;
  /** Heuristic confidence for the inferred block boundary/order. */
  confidence?: number;
  /** Structural blocks are translated independently from body paragraphs. */
  kind?: NonNullable<TranslationSegment["kind"]>;
  /** Source lines retain geometry so text inside figures/tables can be omitted. */
  lines?: Array<{ text: string; rect: AnnotationRect }>;
};

export type AutoHighlight = {
  id: string;
  pageNumber: number;
  quote: string;
  category: "novelty" | "methods" | "results";
  explanation: string;
  rects?: AnnotationRect[];
};

export type InkPoint = {
  x: number;
  y: number;
};

export type InkStroke = {
  id: string;
  documentId: string;
  pageNumber: number;
  color: string;
  width: number;
  points: InkPoint[];
  createdAt: string;
};

export type ReaderMode = "select" | "pan" | "draw" | "erase" | "image";

export type ImageCapture = {
  id: string;
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
  sourceType?: "image" | "table" | "formula";
  sourceText?: string;
  intent?: "explain" | "translate" | "comment" | "ask-ai";
};

export type ExplanationRecord = {
  id: string;
  pageNumber: number;
  sourceType: "text" | "image" | "table" | "formula" | "url";
  source: string;
  response: string;
  conversation?: ChatMessage[];
  imageDataUrl?: string;
  createdAt: string;
};

export type SelectionTranslationRecord = {
  id: string;
  pageNumber: number;
  sourceType: "text" | "image";
  source: string;
  response: string;
  imageDataUrl?: string;
  createdAt: string;
};

export type DocumentTheme = "original" | "sepia" | "night";

export type HighlightVisibility = {
  manual: Record<Annotation["color"], boolean>;
  automatic: boolean;
  categories: Record<AutoHighlight["category"], boolean>;
  labels: boolean;
};

export type ReadingPreferences = {
  theme: DocumentTheme;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  translationFontSize: number;
  translationViewOpen: boolean;
  autoTranslateEnabled: boolean;
  highlightVisibility: HighlightVisibility;
};

export type ReaderFeatureAction = {
  id: string;
  type:
    | "auto-highlight"
    | "explain-selection"
    | "translate-selection"
    | "ask-selection";
  sourceType?: "text" | "url";
};

export type SelectionAction = "explain" | "translate" | "comment" | "ask-ai";

export type DocumentWorkspace = {
  insights: PaperInsights;
  comments: PaperComment[];
  notes: PaperNote[];
  citations: CitationCard[];
  quiz: QuizSession | null;
  translations: PageTranslation[];
  autoHighlights: AutoHighlight[];
  ink: InkStroke[];
  chats: ChatMessage[];
  discussionThreads: DiscussionThread[];
  activeDiscussionId: string;
  explanations: ExplanationRecord[];
  selectionTranslations: SelectionTranslationRecord[];
  preferences: ReadingPreferences;
};

export type RightPanelTab =
  | "assistant"
  | "quiz"
  | "highlights"
  | "explain"
  | "translation"
  | "comments"
  | "notes"
  | "citations"
  | "peer-reviews"
  | "details";
export type LeftPanelTab = "thumbnails" | "outline" | "search";
