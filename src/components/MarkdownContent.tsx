import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import katex from "katex";
import "katex/dist/katex.min.css";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

function renderMarkdown(content: string): string {
  // Keep formula markup out of marked and DOMPurify's generic Markdown pass.
  // KaTeX needs inline style attributes for fractions, scripts and baselines.
  const formulas: Array<{ raw: string; display: boolean }> = [];
  const withPlaceholders = content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, raw: string) => { formulas.push({ raw, display: true }); return `\n\nMATHBLOCK${formulas.length - 1}MATHBLOCK\n\n`; })
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, raw: string) => { formulas.push({ raw, display: true }); return `\n\nMATHBLOCK${formulas.length - 1}MATHBLOCK\n\n`; })
    .replace(/\$([^$\n]+)\$/g, (_, raw: string) => { formulas.push({ raw, display: false }); return `MATHINLINE${formulas.length - 1}MATHINLINE`; });
  const renderedMarkdown = marked.parse(withPlaceholders, { async: false, breaks: true, gfm: true }) as string;
  let rendered = DOMPurify.sanitize(renderedMarkdown, {
    FORBID_TAGS: ["form", "iframe", "object", "script", "style"],
    FORBID_ATTR: ["style"],
  });
  formulas.forEach(({ raw, display }, index) => {
    const formulaHtml = katex.renderToString(raw.trim(), { displayMode: display, throwOnError: false });
    const safeFormula = DOMPurify.sanitize(formulaHtml, {
      FORBID_TAGS: ["form", "iframe", "object", "script"],
      ALLOWED_ATTR: ["class", "style", "aria-hidden"],
    });
    const replacement = display ? `<div class="math-block">${safeFormula}</div>` : `<span class="math-inline">${safeFormula}</span>`;
    rendered = rendered.replaceAll(`<p>MATHBLOCK${index}MATHBLOCK</p>`, replacement)
      .replaceAll(`MATHBLOCK${index}MATHBLOCK`, replacement)
      .replaceAll(`MATHINLINE${index}MATHINLINE`, replacement);
  });
  const document = new DOMParser().parseFromString(rendered, "text/html");
  document.querySelectorAll("a[href]").forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noreferrer noopener");
  });
  return document.body.innerHTML;
}

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return <div className={`markdown-body ml-reader-content ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
}
