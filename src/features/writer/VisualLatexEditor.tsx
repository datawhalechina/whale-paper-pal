import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Bold,
  BookOpen,
  Braces,
  ChevronDown,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  Pilcrow,
  Redo2,
  Search,
  Sigma,
  Table2,
  Tag,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { IconButton } from "../../components/IconButton";

type VisualLatexEditorProps = {
  source: string;
  onChange: (source: string) => void;
  onAddComment: (selection: { from: number; to: number; quote: string }) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
};

type SourceParts = {
  preamble: string;
  body: string;
  suffix: string;
  bodyOffset: number;
  hasDocument: boolean;
};

type VisualBlock = {
  id: number;
  start: number;
  end: number;
  raw: string;
  type: "heading" | "paragraph" | "list" | "environment" | "maketitle" | "raw" | "comment";
  level?: number;
  command?: string;
  environment?: "itemize" | "enumerate";
  items?: string[];
  content?: string;
  label?: string;
};

const BLOCK_COMMAND = /^\\(part|chapter|section|subsection|subsubsection|paragraph)(\*)?\{([\s\S]*)\}$/;
const ENVIRONMENT_START = /^\\begin\{([^}]+)\}/;
const SIMPLE_LIST_ENVIRONMENTS = new Set(["itemize", "enumerate"]);

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function splitSource(source: string): SourceParts {
  const begin = source.indexOf("\\begin{document}");
  if (begin < 0) return { preamble: "", body: source, suffix: "", bodyOffset: 0, hasDocument: false };
  const bodyOffset = begin + "\\begin{document}".length;
  const end = source.lastIndexOf("\\end{document}");
  if (end < bodyOffset) {
    return { preamble: source.slice(0, bodyOffset), body: source.slice(bodyOffset), suffix: "", bodyOffset, hasDocument: true };
  }
  return {
    preamble: source.slice(0, bodyOffset),
    body: source.slice(bodyOffset, end),
    suffix: source.slice(end),
    bodyOffset,
    hasDocument: true,
  };
}

function lineEnd(source: string, start: number): number {
  const end = source.indexOf("\n", start);
  return end < 0 ? source.length : end;
}

function isBlockStart(line: string): boolean {
  const value = line.trim();
  return value.startsWith("\\begin{")
    || value.startsWith("\\[")
    || value === "\\maketitle"
    || /^\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\{/.test(value)
    || /^%/.test(value);
}

function parseBlocks(body: string): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  let cursor = 0;
  let id = 0;
  while (cursor < body.length) {
    while (cursor < body.length && /\s/.test(body[cursor])) cursor += 1;
    if (cursor >= body.length) break;
    const start = cursor;
    const firstEnd = lineEnd(body, start);
    const firstLine = body.slice(start, firstEnd).trim();

    if (firstLine.startsWith("%")) {
      let end = firstEnd;
      while (end < body.length) {
        const nextStart = end + 1;
        const nextEnd = lineEnd(body, nextStart);
        if (!body.slice(nextStart, nextEnd).trim().startsWith("%")) break;
        end = nextEnd;
      }
      blocks.push({ id: id++, start, end, raw: body.slice(start, end), type: "comment", label: "注释" });
      cursor = end;
      continue;
    }

    const heading = firstLine.match(BLOCK_COMMAND);
    if (heading) {
      const levels: Record<string, number> = { part: 1, chapter: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
      blocks.push({
        id: id++, start, end: firstEnd, raw: body.slice(start, firstEnd), type: "heading",
        level: levels[heading[1]] || 2, command: `${heading[1]}${heading[2] || ""}`,
      });
      cursor = firstEnd;
      continue;
    }

    if (firstLine === "\\maketitle") {
      blocks.push({ id: id++, start, end: firstEnd, raw: body.slice(start, firstEnd), type: "maketitle" });
      cursor = firstEnd;
      continue;
    }

    const environment = firstLine.match(ENVIRONMENT_START)?.[1];
    if (environment) {
      const marker = `\\end{${environment}}`;
      const markerIndex = body.indexOf(marker, firstEnd);
      const end = markerIndex < 0 ? firstEnd : markerIndex + marker.length;
      const raw = body.slice(start, end);
      if (environment === "abstract") {
        const innerStart = raw.indexOf("\n") + 1;
        const innerEnd = raw.lastIndexOf(marker);
        blocks.push({ id: id++, start, end, raw, type: "environment", command: environment, content: raw.slice(Math.max(0, innerStart), innerEnd).trim() });
      } else if (SIMPLE_LIST_ENVIRONMENTS.has(environment) && !/\\begin\{(?:itemize|enumerate)\}/.test(raw.slice(firstLine.length))) {
        const innerStart = raw.indexOf("\n") + 1;
        const innerEnd = raw.lastIndexOf(marker);
        const inner = raw.slice(Math.max(0, innerStart), innerEnd);
        const items = inner.split(/(?:^|\n)\s*\\item(?:\[[^\]]*\])?\s*/).map((item) => item.trim()).filter(Boolean);
        blocks.push({ id: id++, start, end, raw, type: "list", environment: environment as "itemize" | "enumerate", items });
      } else {
        blocks.push({ id: id++, start, end, raw, type: "raw", label: environment });
      }
      cursor = end;
      continue;
    }

    if (firstLine.startsWith("\\[")) {
      const markerIndex = body.indexOf("\\]", firstEnd);
      const end = markerIndex < 0 ? firstEnd : markerIndex + 2;
      blocks.push({ id: id++, start, end, raw: body.slice(start, end), type: "raw", label: "公式" });
      cursor = end;
      continue;
    }

    let end = firstEnd;
    while (end < body.length) {
      const nextStart = end + 1;
      const nextEnd = lineEnd(body, nextStart);
      const nextLine = body.slice(nextStart, nextEnd);
      if (!nextLine.trim() || isBlockStart(nextLine)) break;
      end = nextEnd;
    }
    blocks.push({ id: id++, start, end, raw: body.slice(start, end), type: "paragraph" });
    cursor = end;
  }
  return blocks;
}

function findClosingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "\\") { index += 1; continue; }
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function renderInline(source: string): string {
  let html = "";
  let cursor = 0;
  const pushText = (value: string) => {
    html += escapeHtml(value.replaceAll("~", "\u00a0").replace(/\r?\n/g, " "));
  };
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    const style = rest.match(/^\\(textbf|textit|emph|underline)\{/);
    if (style) {
      const open = cursor + style[0].length - 1;
      const close = findClosingBrace(source, open);
      if (close >= 0) {
        const tag = style[1] === "textbf" ? "strong" : style[1] === "underline" ? "u" : "em";
        html += `<${tag}>${renderInline(source.slice(open + 1, close))}</${tag}>`;
        cursor = close + 1;
        continue;
      }
    }
    const command = rest.match(/^\\(?:cite\w*|ref|eqref|pageref|label|url|href|footnote|includegraphics)(?:\[[^\]]*\])?\{/);
    if (command) {
      const open = cursor + command[0].length - 1;
      let close = findClosingBrace(source, open);
      if (close >= 0 && command[0].startsWith("\\href") && source[close + 1] === "{") close = findClosingBrace(source, close + 1);
      if (close >= 0) {
        const raw = source.slice(cursor, close + 1);
        const label = raw.replace(/^\\/, "").replace(/\{([\s\S]*)\}$/, ": $1");
        html += `<span class="visual-latex-token" contenteditable="false" data-latex="${escapeAttribute(raw)}">${escapeHtml(label)}</span>`;
        cursor = close + 1;
        continue;
      }
    }
    if (source[cursor] === "$" && source[cursor - 1] !== "\\") {
      const close = source.indexOf("$", cursor + 1);
      if (close > cursor + 1) {
        const raw = source.slice(cursor, close + 1);
        html += `<span class="visual-latex-math" contenteditable="false" data-latex="${escapeAttribute(raw)}">${escapeHtml(raw.slice(1, -1))}</span>`;
        cursor = close + 1;
        continue;
      }
    }
    const escaped = rest.match(/^\\([%&#_$\{\}])/);
    if (escaped) {
      pushText(escaped[1]);
      cursor += escaped[0].length;
      continue;
    }
    const unknown = rest.match(/^\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})?/);
    if (unknown) {
      html += `<span class="visual-latex-token" contenteditable="false" data-latex="${escapeAttribute(unknown[0])}">${escapeHtml(unknown[0])}</span>`;
      cursor += unknown[0].length;
      continue;
    }
    let next = cursor + 1;
    while (next < source.length && !/[\\$]/.test(source[next])) next += 1;
    pushText(source.slice(cursor, next));
    cursor = next;
  }
  return html;
}

function commandContent(source: string, command: string): string {
  const marker = `\\${command}`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const open = source.indexOf("{", start + marker.length);
  if (open < 0) return "";
  const close = findClosingBrace(source, open);
  return close < 0 ? "" : source.slice(open + 1, close);
}

function replaceCommandContent(source: string, command: string, content: string): string {
  const marker = `\\${command}`;
  const start = source.indexOf(marker);
  if (start < 0) return `${source}\n\\${command}{${content}}`;
  const open = source.indexOf("{", start + marker.length);
  if (open < 0) return source;
  const close = findClosingBrace(source, open);
  if (close < 0) return source;
  return `${source.slice(0, open + 1)}${content}${source.slice(close)}`;
}

function renderBlock(block: VisualBlock, parts: SourceParts): string {
  if (block.type === "heading") {
    const match = block.raw.trim().match(BLOCK_COMMAND);
    const tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : block.level === 3 ? "h4" : "h5";
    return `<${tag} class="visual-latex-editable" contenteditable="true" spellcheck="true">${renderInline(match?.[3] || block.raw)}</${tag}>`;
  }
  if (block.type === "paragraph") {
    return `<p class="visual-latex-editable" contenteditable="true" spellcheck="true">${renderInline(block.raw.trim())}</p>`;
  }
  if (block.type === "list") {
    const tag = block.environment === "enumerate" ? "ol" : "ul";
    return `<${tag} class="visual-latex-editable" contenteditable="true">${(block.items || []).map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "environment") {
    return `<div class="visual-latex-environment"><span>${escapeHtml(block.command || "")}</span><p class="visual-latex-editable" contenteditable="true" spellcheck="true">${renderInline(block.content || "")}</p></div>`;
  }
  if (block.type === "maketitle") {
    const title = commandContent(parts.preamble, "title") || "论文标题";
    const author = commandContent(parts.preamble, "author");
    return `<div class="visual-latex-maketitle"><h1 class="visual-latex-editable" data-meta="title" contenteditable="true">${renderInline(title)}</h1>${author ? `<p class="visual-latex-editable" data-meta="author" contenteditable="true">${renderInline(author)}</p>` : ""}</div>`;
  }
  return `<div class="visual-latex-raw" contenteditable="false"><span>${escapeHtml(block.label || "LaTeX")}</span><pre>${escapeHtml(block.raw)}</pre></div>`;
}

function renderDocument(source: string): { html: string; blocks: VisualBlock[]; parts: SourceParts } {
  const parts = splitSource(source);
  const blocks = parseBlocks(parts.body);
  const html = blocks.map((block) => `<section class="visual-latex-block is-${block.type}" data-block-id="${block.id}" data-source-start="${parts.bodyOffset + block.start}" data-source-end="${parts.bodyOffset + block.end}">${renderBlock(block, parts)}</section>`).join("");
  return { html, blocks, parts };
}

function escapeLatexText(value: string): string {
  return value
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("%", "\\%")
    .replaceAll("&", "\\&")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_");
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeLatexText(node.textContent || "");
  if (!(node instanceof HTMLElement)) return "";
  const latex = node.dataset.latex;
  if (latex) return latex;
  const children = Array.from(node.childNodes).map(serializeInline).join("");
  if (node.tagName === "STRONG" || node.tagName === "B") return `\\textbf{${children}}`;
  if (node.tagName === "EM" || node.tagName === "I") return `\\emph{${children}}`;
  if (node.tagName === "U") return `\\underline{${children}}`;
  if (node.tagName === "BR") return "\n";
  if (node.tagName === "DIV") return `${children}\n`;
  return children;
}

function serializeEditable(element: HTMLElement, block: VisualBlock): string {
  if (block.type === "heading") return `\\${block.command}{${serializeInline(element)}}`;
  if (block.type === "list") {
    const items = Array.from(element.querySelectorAll(":scope > li")).map((item) => `\\item ${serializeInline(item).trim()}`);
    return `\\begin{${block.environment}}\n${items.join("\n")}\n\\end{${block.environment}}`;
  }
  if (block.type === "environment") return `\\begin{${block.command}}\n${serializeInline(element).trim()}\n\\end{${block.command}}`;
  return serializeInline(element).trim();
}

function currentEditable(): HTMLElement | null {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  return element?.closest<HTMLElement>(".visual-latex-editable") || null;
}

export function VisualLatexEditor({ source, onChange, onAddComment, scrollRef }: VisualLatexEditorProps) {
  const documentRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef(source);
  const lastEmittedRef = useRef(source);
  const blocksRef = useRef<VisualBlock[]>([]);
  const [preambleOpen, setPreambleOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const initial = useMemo(() => renderDocument(source), []); // The DOM stays uncontrolled while the user edits.

  const loadSource = (nextSource: string) => {
    const rendered = renderDocument(nextSource);
    sourceRef.current = nextSource;
    blocksRef.current = rendered.blocks;
    if (documentRef.current) documentRef.current.innerHTML = rendered.html;
  };

  useEffect(() => {
    blocksRef.current = initial.blocks;
  }, [initial.blocks]);

  useEffect(() => {
    if (source === lastEmittedRef.current) return;
    loadSource(source);
  }, [source]);

  const emit = (nextSource: string, rerender = false) => {
    sourceRef.current = nextSource;
    lastEmittedRef.current = nextSource;
    onChange(nextSource);
    if (rerender) window.requestAnimationFrame(() => loadSource(nextSource));
  };

  const commitBlock = (editable: HTMLElement) => {
    const wrapper = editable.closest<HTMLElement>("[data-block-id]");
    const id = Number(wrapper?.dataset.blockId);
    const block = blocksRef.current.find((item) => item.id === id);
    if (!block) return;
    const parts = splitSource(sourceRef.current);
    if (block.type === "maketitle") {
      const meta = editable.dataset.meta;
      if (!meta) return;
      const nextPreamble = replaceCommandContent(parts.preamble, meta, serializeInline(editable));
      emit(`${nextPreamble}${parts.body}${parts.suffix}`);
      return;
    }
    const replacement = serializeEditable(editable, block);
    const nextBody = `${parts.body.slice(0, block.start)}${replacement}${parts.body.slice(block.end)}`;
    const delta = replacement.length - (block.end - block.start);
    block.end = block.start + replacement.length;
    block.raw = replacement;
    for (const following of blocksRef.current) {
      if (following.id > block.id) { following.start += delta; following.end += delta; }
    }
    emit(`${parts.preamble}${nextBody}${parts.suffix}`);
  };

  const applyCommand = (command: "bold" | "italic" | "underline" | "undo" | "redo" | "insertUnorderedList" | "insertOrderedList", value?: string) => {
    document.execCommand(command, false, value);
    const editable = currentEditable();
    if (editable) commitBlock(editable);
  };

  const changeBlockStyle = (value: string) => {
    const editable = currentEditable();
    if (!editable) return;
    const wrapper = editable.closest<HTMLElement>("[data-block-id]");
    const block = blocksRef.current.find((item) => item.id === Number(wrapper?.dataset.blockId));
    if (!block || !["paragraph", "heading"].includes(block.type)) return;
    const content = serializeInline(editable);
    const commands: Record<string, string> = { h2: "section", h3: "subsection", h4: "subsubsection", h5: "paragraph" };
    const replacement = value === "p" ? content : `\\${commands[value]}{${content}}`;
    const parts = splitSource(sourceRef.current);
    const nextBody = `${parts.body.slice(0, block.start)}${replacement}${parts.body.slice(block.end)}`;
    emit(`${parts.preamble}${nextBody}${parts.suffix}`, true);
  };

  const insertInlineLatex = (latex: string, label = latex) => {
    const editable = currentEditable();
    if (!editable) return;
    const token = document.createElement("span");
    token.className = "visual-latex-token";
    token.contentEditable = "false";
    token.dataset.latex = latex;
    token.textContent = label;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(token);
    range.setStartAfter(token);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    commitBlock(editable);
  };

  const insertEnvironment = (latex: string) => {
    const editable = currentEditable();
    const wrapper = editable?.closest<HTMLElement>("[data-block-id]");
    const block = blocksRef.current.find((item) => item.id === Number(wrapper?.dataset.blockId));
    const parts = splitSource(sourceRef.current);
    const at = block?.end ?? parts.body.length;
    const nextBody = `${parts.body.slice(0, at)}\n\n${latex}\n${parts.body.slice(at)}`;
    emit(`${parts.preamble}${nextBody}${parts.suffix}`, true);
    setMoreOpen(false);
  };

  const insertPromptedInline = (kind: "link" | "citation" | "reference") => {
    const selectionText = window.getSelection()?.toString().trim() || "";
    if (kind === "link") {
      const url = window.prompt("链接地址", "https://");
      if (url) insertInlineLatex(`\\href{${url}}{${selectionText || url}}`, selectionText || url);
    } else if (kind === "citation") {
      const key = window.prompt("BibTeX 引用键");
      if (key) insertInlineLatex(`\\cite{${key}}`, `引用: ${key}`);
    } else {
      const label = window.prompt("LaTeX 标签");
      if (label) insertInlineLatex(`\\ref{${label}}`, `引用位置: ${label}`);
    }
    setMoreOpen(false);
  };

  const addComment = () => {
    const selection = window.getSelection();
    const quote = selection?.toString().trim() || "";
    const editable = currentEditable();
    const wrapper = editable?.closest<HTMLElement>("[data-block-id]");
    const block = blocksRef.current.find((item) => item.id === Number(wrapper?.dataset.blockId));
    if (!block) return;
    const parts = splitSource(sourceRef.current);
    const within = quote ? block.raw.indexOf(quote) : -1;
    const from = parts.bodyOffset + block.start + (within >= 0 ? within : 0);
    const selectedQuote = within >= 0 ? quote : block.raw;
    onAddComment({ from, to: from + selectedQuote.length, quote: selectedQuote });
    setMoreOpen(false);
  };

  const findNext = () => {
    if (!query.trim() || !documentRef.current) return;
    const walker = document.createTreeWalker(documentRef.current, NodeFilter.SHOW_TEXT);
    const active = window.getSelection()?.focusNode;
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const start = Math.max(0, nodes.findIndex((node) => node === active) + 1);
    const ordered = [...nodes.slice(start), ...nodes.slice(0, start)];
    for (const node of ordered) {
      const index = (node.textContent || "").toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + query.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
  };

  return (
    <div className="visual-latex-editor" ref={scrollRef}>
      <div className="visual-latex-toolbar" role="toolbar" aria-label="可视化编辑工具栏">
        <IconButton label="撤销" onClick={() => applyCommand("undo")}><Undo2 size={15} /></IconButton>
        <IconButton label="重做" onClick={() => applyCommand("redo")}><Redo2 size={15} /></IconButton>
        <span className="visual-toolbar-divider" />
        <label className="visual-style-select"><Pilcrow size={14} /><select aria-label="段落样式" defaultValue="p" onChange={(event) => changeBlockStyle(event.target.value)}><option value="p">正文</option><option value="h2">一级标题</option><option value="h3">二级标题</option><option value="h4">三级标题</option><option value="h5">段落标题</option></select><ChevronDown size={12} /></label>
        <IconButton label="粗体" onClick={() => applyCommand("bold")}><Bold size={15} /></IconButton>
        <IconButton label="斜体" onClick={() => applyCommand("italic")}><Italic size={15} /></IconButton>
        <IconButton label="下划线" onClick={() => applyCommand("underline")}><Underline size={15} /></IconButton>
        <div className="visual-toolbar-menu">
          <IconButton label="更多插入工具" active={moreOpen} onClick={() => { setMoreOpen((value) => !value); setSymbolsOpen(false); }}><MoreHorizontal size={16} /></IconButton>
          {moreOpen && <div className="visual-more-menu">
            <IconButton label="全屏编辑" onClick={() => void documentRef.current?.closest(".writer-editor-column")?.requestFullscreen()}><Maximize2 size={15} /></IconButton>
            <IconButton label="特殊符号" active={symbolsOpen} onClick={() => setSymbolsOpen((value) => !value)}><Sigma size={15} /></IconButton>
            <IconButton label="插入链接" onClick={() => insertPromptedInline("link")}><Link size={15} /></IconButton>
            <IconButton label="添加评论" onClick={addComment}><MessageSquarePlus size={15} /></IconButton>
            <IconButton label="插入引用" onClick={() => insertPromptedInline("citation")}><BookOpen size={15} /></IconButton>
            <IconButton label="插入交叉引用" onClick={() => insertPromptedInline("reference")}><Tag size={15} /></IconButton>
            <IconButton label="插入图片" onClick={() => { const path = window.prompt("图片路径", "figures/image.pdf"); if (path) insertEnvironment(`\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{${path}}\n\\caption{图片标题}\n\\label{fig:label}\n\\end{figure}`); }}><ImagePlus size={15} /></IconButton>
            <IconButton label="插入表格" onClick={() => insertEnvironment("\\begin{table}[htbp]\n\\centering\n\\caption{表格标题}\n\\begin{tabular}{ll}\n\\hline\n列一 & 列二 \\\\\n\\hline\n内容 & 内容 \\\\\n\\hline\n\\end{tabular}\n\\label{tab:label}\n\\end{table}")}><Table2 size={15} /></IconButton>
            <IconButton label="项目符号列表" onClick={() => insertEnvironment("\\begin{itemize}\n\\item 列表项\n\\end{itemize}")}><List size={15} /></IconButton>
            <IconButton label="编号列表" onClick={() => insertEnvironment("\\begin{enumerate}\n\\item 列表项\n\\end{enumerate}")}><ListOrdered size={15} /></IconButton>
            {symbolsOpen && <div className="visual-symbol-menu">{["α", "β", "γ", "δ", "ε", "θ", "λ", "μ", "π", "σ", "φ", "ω", "×", "±", "≤", "≥", "∞", "∑", "√", "∂"].map((symbol) => <button type="button" key={symbol} onClick={() => { document.execCommand("insertText", false, symbol); const editable = currentEditable(); if (editable) commitBlock(editable); }}>{symbol}</button>)}</div>}
          </div>}
        </div>
        <span className="visual-toolbar-spacer" />
        {searchOpen && <div className="visual-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") findNext(); }} placeholder="查找" /><button type="button" onClick={findNext}>下一个</button><IconButton label="关闭查找" onClick={() => setSearchOpen(false)}><X size={13} /></IconButton></div>}
        <IconButton label="在文档中查找" active={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search size={15} /></IconButton>
      </div>
      <button className={`visual-preamble-toggle ${preambleOpen ? "is-open" : ""}`} type="button" onClick={() => setPreambleOpen((value) => !value)}><Braces size={14} /><span>{preambleOpen ? "隐藏文档导言区" : "显示文档导言区"}</span><ChevronDown size={14} /></button>
      {preambleOpen && <textarea className="visual-preamble-editor" aria-label="LaTeX 文档导言区" value={splitSource(sourceRef.current).preamble.replace(/\\begin\{document\}\s*$/, "")} onChange={(event) => { const parts = splitSource(sourceRef.current); emit(`${event.target.value}\n\\begin{document}${parts.body}${parts.suffix}`); }} spellCheck={false} />}
      <article className="visual-latex-paper" ref={documentRef} dangerouslySetInnerHTML={{ __html: initial.html }} onInput={(event) => { const editable = (event.target as HTMLElement).closest<HTMLElement>(".visual-latex-editable"); if (editable) commitBlock(editable); }} />
    </div>
  );
}
