import { PDFDocument, rgb } from "pdf-lib";
import type { Annotation, DocumentWorkspace, ExplanationRecord, PaperComment, PaperReview, PaperReviewPoint, PdfDocumentState } from "../types";

const HIGHLIGHT_COLORS = {
  yellow: "#f6cf4a",
  green: "#62c998",
  blue: "#73b8e8",
  rose: "#ef8e91",
};

function colorFromHex(hex: string) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#111111";
  return rgb(
    Number.parseInt(normalized.slice(1, 3), 16) / 255,
    Number.parseInt(normalized.slice(3, 5), 16) / 255,
    Number.parseInt(normalized.slice(5, 7), 16) / 255,
  );
}

export function safeExportBaseName(document: PdfDocumentState): string {
  return (document.title || document.file.name.replace(/\.pdf$/i, ""))
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "paper";
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createCsv(headers: string[], rows: unknown[][]): string {
  return `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function createHighlightsMarkdown(annotations: Annotation[], workspace: DocumentWorkspace): string {
  return [...annotations.filter((item) => item.type === "highlight").map((item) => (
    `## 第 ${item.pageNumber} 页 · ${item.color}\n\n> ${item.quote.replace(/\n/g, "\n> ")}`
  )), ...workspace.autoHighlights.map((item) => (
    `## 第 ${item.pageNumber} 页 · ${item.category}\n\n> ${item.quote.replace(/\n/g, "\n> ")}\n\n${item.explanation}`
  ))].join("\n\n");
}

export function createHighlightsCsv(annotations: Annotation[], workspace: DocumentWorkspace): string {
  return createCsv(["page", "source", "type", "quote", "explanation"], [
    ...annotations.filter((item) => item.type === "highlight").map((item) => [item.pageNumber, "manual", item.color, item.quote, item.note]),
    ...workspace.autoHighlights.map((item) => [item.pageNumber, "automatic", item.category, item.quote, item.explanation]),
  ]);
}

export function createExplanationsMarkdown(records: ExplanationRecord[]): string {
  return records.map((item) => `## 第 ${item.pageNumber} 页 · ${item.sourceType}\n\n> ${item.source.replace(/\n/g, "\n> ")}\n\n${item.response}`).join("\n\n");
}

export function createExplanationsCsv(records: ExplanationRecord[]): string {
  return createCsv(["page", "type", "source", "explanation", "created_at"], records.map((item) => (
    [item.pageNumber, item.sourceType, item.source, item.response, item.createdAt]
  )));
}

export function createCommentsMarkdown(comments: PaperComment[]): string {
  return comments.map((comment) => {
    const replies = (comment.replies || []).map((reply) => `- ${reply.body}`).join("\n");
    return `## 第 ${comment.pageNumber} 页${comment.resolved ? " · 已解决" : ""}\n\n${comment.quote ? `> ${comment.quote.replace(/\n/g, "\n> ")}\n\n` : ""}${comment.body}${replies ? `\n\n### 回复\n\n${replies}` : ""}`;
  }).join("\n\n");
}

export function createCommentsCsv(comments: PaperComment[]): string {
  return createCsv(["page", "quote", "comment", "resolved", "replies", "created_at", "updated_at"], comments.map((item) => (
    [item.pageNumber, item.quote, item.body, item.resolved, (item.replies || []).map((reply) => reply.body).join("\n"), item.createdAt, item.updatedAt]
  )));
}

export function createPaperReviewMarkdown(review: PaperReview, title = "论文深度解读"): string {
  if ("overviewMarkdown" in review) {
    return [`# ${title}`, review.overviewMarkdown, review.methodMarkdown, review.analysisMarkdown]
      .map((section) => section.trim())
      .filter(Boolean)
      .join("\n\n").concat("\n");
  }
  const pointSection = (heading: string, points: PaperReviewPoint[]) => [
    `## ${heading}`,
    ...points.flatMap((point, index) => [
      `### ${index + 1}. ${point.title}`,
      point.evidence ? `**依据：** ${point.evidence}` : "",
      point.significance ? `**影响：** ${point.significance}` : "",
      point.suggestion ? `**建议：** ${point.suggestion}` : "",
    ]),
  ];
  const lines = [
    `# ${title}`,
    "",
    `- **论文类型：** ${review.paperType || "未确定"}`,
    "",
    "## 摘要",
    review.executiveSummary,
    "",
    "## 研究问题",
    review.researchQuestion,
    "",
    "## 核心贡献",
    ...review.contributions.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## 方法解读",
    review.methodologySummary,
    "",
    "## 实验与证据",
    review.experimentalEvidence,
    "",
    ...pointSection("优点", review.strengths),
    "",
    ...pointSection("局限与注意事项", review.weaknesses),
    "",
    "## 可复现性",
    review.reproducibility,
    "",
    "## 文献定位",
    review.literaturePositioning,
    "",
    "## 阅读结论",
    ...review.takeaways.map((item, index) => `${index + 1}. ${item}`),
  ];
  return `${lines.filter((line, index) => line || lines[index - 1]).join("\n").trim()}\n`;
}

export async function createAnnotatedPdf(
  document: PdfDocumentState,
  annotations: Annotation[],
  workspace: DocumentWorkspace,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(document.file.data);
  const pages = pdf.getPages();

  annotations.forEach((annotation) => {
    const page = pages[annotation.pageNumber - 1];
    if (!page) return;
    const { width, height } = page.getSize();
    const color = colorFromHex(HIGHLIGHT_COLORS[annotation.color]);
    annotation.rects.forEach((rect) => {
      page.drawRectangle({
        x: rect.left * width,
        y: height - (rect.top + rect.height) * height,
        width: rect.width * width,
        height: rect.height * height,
        color,
        opacity: 0.3,
        borderOpacity: 0,
      });
    });
  });

  workspace.autoHighlights.forEach((highlight) => {
    const page = pages[highlight.pageNumber - 1];
    if (!page || !highlight.rects?.length) return;
    const { width, height } = page.getSize();
    const colors = { novelty: "#ff8f8f", methods: "#73df9d", results: "#7aa9ef" };
    highlight.rects.forEach((rect) => page.drawRectangle({
      x: rect.left * width,
      y: height - (rect.top + rect.height) * height,
      width: rect.width * width,
      height: rect.height * height,
      color: colorFromHex(colors[highlight.category]),
      opacity: 0.22,
      borderOpacity: 0,
    }));
  });

  workspace.ink.forEach((stroke) => {
    const page = pages[stroke.pageNumber - 1];
    if (!page || stroke.points.length < 2) return;
    const { width, height } = page.getSize();
    for (let index = 1; index < stroke.points.length; index += 1) {
      const start = stroke.points[index - 1];
      const end = stroke.points[index];
      page.drawLine({
        start: { x: start.x * width, y: height - start.y * height },
        end: { x: end.x * width, y: height - end.y * height },
        color: colorFromHex(stroke.color),
        thickness: Math.max(0.7, stroke.width * width / 760),
        opacity: 0.96,
      });
    }
  });

  pdf.setModificationDate(new Date());
  return pdf.save();
}

export function createResearchMarkdown(
  document: PdfDocumentState,
  annotations: Annotation[],
  workspace: DocumentWorkspace,
): string {
  const lines = [
    `# ${document.title}`,
    "",
    document.author ? `**Authors:** ${document.author}` : "",
    `**File:** ${document.file.name}`,
    `**Pages:** ${document.pageCount}`,
    `**Exported:** ${new Date().toISOString()}`,
    "",
    "## Highlights",
    "",
  ].filter(Boolean);

  annotations.filter((item) => item.type === "highlight").forEach((item) => {
    lines.push(`### Page ${item.pageNumber}`, "", `> ${item.quote.replace(/\n/g, "\n> ")}`, "");
  });
  workspace.autoHighlights.forEach((item) => {
    lines.push(`### Page ${item.pageNumber} - ${item.category}`, "", `> ${item.quote.replace(/\n/g, "\n> ")}`, "", item.explanation, "");
  });

  lines.push("## Notes", "");
  workspace.notes.forEach((note) => lines.push(`### ${note.title}`, "", note.body, ""));
  annotations.filter((item) => item.type === "note").forEach((item) => lines.push(`### Page ${item.pageNumber}`, "", `> ${item.quote}`, "", item.note, ""));

  lines.push("## Comments", "");
  workspace.comments.forEach((comment) => lines.push(`### Page ${comment.pageNumber}${comment.resolved ? " (resolved)" : ""}`, "", comment.quote ? `> ${comment.quote}` : "", "", comment.body, ""));

  lines.push("## Citation Cards", "");
  workspace.citations.forEach((citation) => lines.push(`### ${citation.title}`, "", citation.formatted, "", citation.quote ? `> ${citation.quote}` : "", ""));

  lines.push("## Page Translations", "");
  [...workspace.translations].sort((left, right) => left.pageNumber - right.pageNumber).forEach((translation) => lines.push(`### Page ${translation.pageNumber}`, "", translation.content, ""));
  return `${lines.filter((line, index) => line || lines[index - 1]).join("\n").trim()}\n`;
}

export function createResearchJson(
  document: PdfDocumentState,
  annotations: Annotation[],
  workspace: DocumentWorkspace,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    document: {
      id: document.id,
      title: document.title,
      author: document.author,
      fileName: document.file.name,
      pageCount: document.pageCount,
    },
    annotations,
    workspace,
  }, null, 2);
}
