import type { RightPanelTab } from "../types";

export type ReaderFeature = {
  id: RightPanelTab;
  label: string;
  shortLabel: string;
  capability:
    | "assistant"
    | "quiz"
    | "annotation"
    | "explanation"
    | "translation"
    | "comment"
    | "note"
    | "citation"
    | "peer-review"
    | "metadata";
  persistence: "document-workspace" | "session" | "none";
  provider: "openai-compatible" | "local" | "hybrid" | "none";
};

export const READER_FEATURES: ReaderFeature[] = [
  { id: "assistant", label: "与AI一起", shortLabel: "AI", capability: "assistant", persistence: "document-workspace", provider: "openai-compatible" },
  { id: "quiz", label: "问答游戏", shortLabel: "问答游戏", capability: "quiz", persistence: "document-workspace", provider: "openai-compatible" },
  { id: "highlights", label: "高亮", shortLabel: "高亮", capability: "annotation", persistence: "document-workspace", provider: "openai-compatible" },
  { id: "explain", label: "解释", shortLabel: "解释", capability: "explanation", persistence: "session", provider: "openai-compatible" },
  { id: "translation", label: "划句翻译", shortLabel: "翻译", capability: "translation", persistence: "document-workspace", provider: "openai-compatible" },
  { id: "comments", label: "评论", shortLabel: "评论", capability: "comment", persistence: "document-workspace", provider: "local" },
  { id: "notes", label: "笔记", shortLabel: "笔记", capability: "note", persistence: "document-workspace", provider: "local" },
  { id: "citations", label: "引用卡片", shortLabel: "引用", capability: "citation", persistence: "document-workspace", provider: "local" },
  { id: "peer-reviews", label: "公开评审", shortLabel: "评审", capability: "peer-review", persistence: "session", provider: "hybrid" },
  { id: "details", label: "论文信息", shortLabel: "信息", capability: "metadata", persistence: "none", provider: "none" },
];

export const FEATURE_BY_ID = Object.fromEntries(READER_FEATURES.map((feature) => [feature.id, feature])) as Record<RightPanelTab, ReaderFeature>;
