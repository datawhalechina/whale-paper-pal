import { useState, type RefObject } from "react";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  Bold,
  BookOpen,
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

type CodeLatexToolbarProps = {
  editorRef: RefObject<EditorView | null>;
  disabled?: boolean;
  onAddComment: () => void;
};

type InsertEdit = {
  text: string;
  selectFrom?: number;
  selectTo?: number;
};

const SYMBOLS = [
  ["alpha", "α", "\\alpha"], ["beta", "β", "\\beta"], ["gamma", "γ", "\\gamma"], ["delta", "δ", "\\delta"],
  ["epsilon", "ε", "\\epsilon"], ["theta", "θ", "\\theta"], ["lambda", "λ", "\\lambda"], ["mu", "μ", "\\mu"],
  ["pi", "π", "\\pi"], ["sigma", "σ", "\\sigma"], ["phi", "φ", "\\phi"], ["omega", "ω", "\\omega"],
  ["times", "×", "\\times"], ["plus/minus", "±", "\\pm"], ["less/equal", "≤", "\\leq"], ["greater/equal", "≥", "\\geq"],
  ["infinity", "∞", "\\infty"], ["sum", "∑", "\\sum"], ["square root", "√", "\\sqrt{}"], ["partial", "∂", "\\partial"],
] as const;

export function CodeLatexToolbar({ editorRef, disabled = false, onAddComment }: CodeLatexToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const applyEdit = (createEdit: (selected: string) => InsertEdit) => {
    const view = editorRef.current;
    if (!view) return;
    const range = view.state.selection.main;
    const edit = createEdit(view.state.sliceDoc(range.from, range.to));
    const from = range.from;
    const anchor = from + (edit.selectFrom ?? edit.text.length);
    const head = from + (edit.selectTo ?? edit.selectFrom ?? edit.text.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: edit.text },
      selection: { anchor, head },
      scrollIntoView: true,
    });
    view.focus();
  };

  const wrapSelection = (command: string, placeholder: string) => {
    applyEdit((selected) => {
      const content = selected || placeholder;
      const prefix = `\\${command}{`;
      return {
        text: `${prefix}${content}}`,
        selectFrom: selected ? prefix.length + content.length + 1 : prefix.length,
        selectTo: selected ? prefix.length + content.length + 1 : prefix.length + content.length,
      };
    });
  };

  const changeBlockStyle = (style: string) => {
    const view = editorRef.current;
    if (!view) return;
    const range = view.state.selection.main;
    const startLine = view.state.doc.lineAt(range.from);
    const from = range.empty ? startLine.from : range.from;
    const to = range.empty ? startLine.to : range.to;
    const selected = view.state.sliceDoc(from, to);
    const heading = /^\s*\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\{([\s\S]*)\}\s*$/;
    const plain = selected.match(heading)?.[1] ?? selected;
    const commands: Record<string, string> = { h2: "section", h3: "subsection", h4: "subsubsection", h5: "paragraph" };
    const text = style === "p" ? plain : `\\${commands[style]}{${plain || "标题"}}`;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
    });
    view.focus();
  };

  const insertBlock = (latex: string) => {
    applyEdit((selected) => {
      const body = selected ? latex.replace("列表项", selected) : latex;
      return { text: `\n${body}\n` };
    });
    setMoreOpen(false);
  };

  const insertPromptedInline = (kind: "link" | "citation" | "reference") => {
    const view = editorRef.current;
    const range = view?.state.selection.main;
    const selected = view && range ? view.state.sliceDoc(range.from, range.to).trim() : "";
    if (kind === "link") {
      const url = window.prompt("链接地址", "https://");
      if (url) applyEdit(() => ({ text: `\\href{${url}}{${selected || "链接文字"}}` }));
    } else if (kind === "citation") {
      const key = window.prompt("BibTeX 引用键");
      if (key) applyEdit(() => ({ text: `\\cite{${key}}` }));
    } else {
      const label = window.prompt("LaTeX 标签");
      if (label) applyEdit(() => ({ text: `\\ref{${label}}` }));
    }
    setMoreOpen(false);
  };

  const insertList = (environment: "itemize" | "enumerate") => {
    applyEdit((selected) => {
      const items = (selected || "列表项").split("\n").map((line) => `\\item ${line.replace(/^\s*\\item\s*/, "")}`).join("\n");
      return { text: `\n\\begin{${environment}}\n${items}\n\\end{${environment}}\n` };
    });
    setMoreOpen(false);
  };

  const findNext = () => {
    const view = editorRef.current;
    const needle = query.trim();
    if (!view || !needle) return;
    const source = view.state.doc.toString();
    const start = view.state.selection.main.to;
    let index = source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase(), start);
    if (index < 0) index = source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
    if (index < 0) return;
    view.dispatch({ selection: { anchor: index, head: index + needle.length }, scrollIntoView: true });
    view.focus();
  };

  const runHistoryCommand = (command: typeof undo) => {
    const view = editorRef.current;
    if (!view) return;
    command(view);
    view.focus();
  };

  return (
    <div className="visual-latex-toolbar code-latex-toolbar" role="toolbar" aria-label="源码编辑工具栏">
      <IconButton label="撤销" disabled={disabled} onClick={() => runHistoryCommand(undo)}><Undo2 size={15} /></IconButton>
      <IconButton label="重做" disabled={disabled} onClick={() => runHistoryCommand(redo)}><Redo2 size={15} /></IconButton>
      <span className="visual-toolbar-divider" />
      <label className="visual-style-select"><Pilcrow size={14} /><select aria-label="段落样式" defaultValue="p" disabled={disabled} onChange={(event) => changeBlockStyle(event.target.value)}><option value="p">正文</option><option value="h2">一级标题</option><option value="h3">二级标题</option><option value="h4">三级标题</option><option value="h5">段落标题</option></select><ChevronDown size={12} /></label>
      <IconButton label="粗体" disabled={disabled} onClick={() => wrapSelection("textbf", "粗体文字")}><Bold size={15} /></IconButton>
      <IconButton label="斜体" disabled={disabled} onClick={() => wrapSelection("textit", "斜体文字")}><Italic size={15} /></IconButton>
      <IconButton label="下划线" disabled={disabled} onClick={() => wrapSelection("underline", "下划线文字")}><Underline size={15} /></IconButton>
      <div className="visual-toolbar-menu">
        <IconButton label="更多插入工具" disabled={disabled} active={moreOpen} onClick={() => { setMoreOpen((value) => !value); setSymbolsOpen(false); }}><MoreHorizontal size={16} /></IconButton>
        {moreOpen && <div className="visual-more-menu">
          <IconButton label="全屏编辑" onClick={() => void editorRef.current?.dom.closest(".writer-editor-column")?.requestFullscreen()}><Maximize2 size={15} /></IconButton>
          <IconButton label="特殊符号" active={symbolsOpen} onClick={() => setSymbolsOpen((value) => !value)}><Sigma size={15} /></IconButton>
          <IconButton label="插入链接" onClick={() => insertPromptedInline("link")}><Link size={15} /></IconButton>
          <IconButton label="添加评论" onClick={() => { onAddComment(); setMoreOpen(false); }}><MessageSquarePlus size={15} /></IconButton>
          <IconButton label="插入引用" onClick={() => insertPromptedInline("citation")}><BookOpen size={15} /></IconButton>
          <IconButton label="插入交叉引用" onClick={() => insertPromptedInline("reference")}><Tag size={15} /></IconButton>
          <IconButton label="插入图片" onClick={() => { const path = window.prompt("图片路径", "figures/image.pdf"); if (path) insertBlock(`\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{${path}}\n\\caption{图片标题}\n\\label{fig:label}\n\\end{figure}`); }}><ImagePlus size={15} /></IconButton>
          <IconButton label="插入表格" onClick={() => insertBlock("\\begin{table}[htbp]\n\\centering\n\\caption{表格标题}\n\\begin{tabular}{ll}\n\\hline\n列一 & 列二 \\\\\n\\hline\n内容 & 内容 \\\\\n\\hline\n\\end{tabular}\n\\label{tab:label}\n\\end{table}")}><Table2 size={15} /></IconButton>
          <IconButton label="项目符号列表" onClick={() => insertList("itemize")}><List size={15} /></IconButton>
          <IconButton label="编号列表" onClick={() => insertList("enumerate")}><ListOrdered size={15} /></IconButton>
          {symbolsOpen && <div className="visual-symbol-menu">{SYMBOLS.map(([label, symbol, latex]) => <button type="button" key={latex} title={label} onClick={() => applyEdit(() => ({ text: latex }))}>{symbol}</button>)}</div>}
        </div>}
      </div>
      <span className="visual-toolbar-spacer" />
      {searchOpen && <div className="visual-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") findNext(); }} placeholder="查找" /><button type="button" onClick={findNext}>下一个</button><IconButton label="关闭查找" onClick={() => setSearchOpen(false)}><X size={13} /></IconButton></div>}
      <IconButton label="在文档中查找" disabled={disabled} active={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search size={15} /></IconButton>
    </div>
  );
}
