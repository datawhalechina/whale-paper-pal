import { useState } from "react";
import { Braces, Download, FileArchive, FileText, PenLine, X } from "lucide-react";
import type { Annotation, DocumentWorkspace, PdfDocumentState } from "../types";
import { createAnnotatedPdf, createResearchJson, createResearchMarkdown, safeExportBaseName } from "../lib/export";
import { saveBytes } from "../lib/files";
import { IconButton } from "./IconButton";

type ExportDialogProps = {
  open: boolean;
  document: PdfDocumentState | null;
  annotations: Annotation[];
  workspace: DocumentWorkspace;
  onClose: () => void;
};

export function ExportDialog({ open, document, annotations, workspace, onClose }: ExportDialogProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!open || !document) return null;

  const baseName = safeExportBaseName(document);
  const exportFile = async (type: "annotated" | "original" | "markdown" | "json") => {
    setPending(type);
    setError("");
    try {
      if (type === "annotated") {
        await saveBytes(`${baseName} - annotated.pdf`, await createAnnotatedPdf(document, annotations, workspace), "application/pdf");
      } else if (type === "original") {
        await saveBytes(`${baseName}.pdf`, document.file.data, "application/pdf");
      } else if (type === "markdown") {
        await saveBytes(`${baseName} - research notes.md`, new TextEncoder().encode(createResearchMarkdown(document, annotations, workspace)), "text/markdown;charset=utf-8");
      } else {
        await saveBytes(`${baseName} - research data.json`, new TextEncoder().encode(createResearchJson(document, annotations, workspace)), "application/json;charset=utf-8");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "导出失败。");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header><div><span><Download size={16} /></span><div><h2 id="export-title">导出论文</h2><p>{document.title}</p></div></div><IconButton label="关闭导出" onClick={onClose}><X size={18} /></IconButton></header>
        <div className="export-options">
          <button type="button" disabled={Boolean(pending)} onClick={() => void exportFile("annotated")}><span><PenLine size={19} /></span><div><strong>带批注 PDF</strong><small>把手动高亮和手写笔迹合并到 PDF</small></div><b>{pending === "annotated" ? "生成中" : "PDF"}</b></button>
          <button type="button" disabled={Boolean(pending)} onClick={() => void exportFile("markdown")}><span><FileText size={19} /></span><div><strong>研究笔记</strong><small>高亮、笔记、评论、引用卡片和译文</small></div><b>{pending === "markdown" ? "生成中" : "MD"}</b></button>
          <button type="button" disabled={Boolean(pending)} onClick={() => void exportFile("json")}><span><Braces size={19} /></span><div><strong>完整数据包</strong><small>可重新导入或交给其他工具处理的结构化数据</small></div><b>{pending === "json" ? "生成中" : "JSON"}</b></button>
          <button type="button" disabled={Boolean(pending)} onClick={() => void exportFile("original")}><span><FileArchive size={19} /></span><div><strong>原始 PDF</strong><small>不包含 WhalePaper 批注的原文件</small></div><b>{pending === "original" ? "导出中" : "PDF"}</b></button>
        </div>
        {error && <p className="export-error">{error}</p>}
      </section>
    </div>
  );
}
