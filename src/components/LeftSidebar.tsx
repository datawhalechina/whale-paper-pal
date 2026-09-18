import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileSearch, ListTree, Search, X } from "lucide-react";
import { Page } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { LeftPanelTab, OutlineEntry, SearchHit } from "../types";
import { IconButton } from "./IconButton";
import { useResizablePanel } from "./useResizablePanel";

const LEFT_PANEL_STORAGE_KEY = "whale-paper:left-panel-width";

function leftPanelMaxWidth(panel: HTMLElement): number {
  return (panel.parentElement?.clientWidth || window.innerWidth) / 2;
}

type LeftSidebarProps = {
  pdf: PDFDocumentProxy;
  activeTab: LeftPanelTab;
  onTabChange: (tab: LeftPanelTab) => void;
  currentPage: number;
  pageCount: number;
  outline: OutlineEntry[];
  outlineLoading: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  searchHits: SearchHit[];
  indexProgress: number;
  indexError?: string;
  onNavigate: (page: number) => void;
  onClose: () => void;
};

function outlineBranchKeys(items: OutlineEntry[], parentKey = ""): string[] {
  return items.flatMap((item, index) => {
    const key = `${parentKey}${index}`;
    return item.items.length ? [key, ...outlineBranchKeys(item.items, `${key}.`)] : [];
  });
}

function activeOutlineKey(items: OutlineEntry[], currentPage: number): string | undefined {
  let active: { key: string; pageNumber: number; order: number } | undefined;
  let order = 0;
  const visit = (entries: OutlineEntry[], parentKey = "") => {
    entries.forEach((item, index) => {
      const key = `${parentKey}${index}`;
      order += 1;
      if (item.pageNumber && item.pageNumber <= currentPage) {
        if (!active || item.pageNumber > active.pageNumber || (item.pageNumber === active.pageNumber && order > active.order)) {
          active = { key, pageNumber: item.pageNumber, order };
        }
      }
      visit(item.items, `${key}.`);
    });
  };
  visit(items);
  return active?.key;
}

type OutlineListProps = {
  items: OutlineEntry[];
  parentKey?: string;
  expandedKeys: Set<string>;
  activeKey?: string;
  onToggle: (key: string) => void;
  onNavigate: (page: number) => void;
};

function OutlineList({ items, parentKey = "", expandedKeys, activeKey, onToggle, onNavigate }: OutlineListProps) {
  return (
    <ul className="outline-list">
      {items.map((item, index) => {
        const key = `${parentKey}${index}`;
        const hasChildren = item.items.length > 0;
        const expanded = hasChildren && expandedKeys.has(key);
        return (
          <li key={key}>
            <div className={`outline-row ${activeKey === key ? "is-current" : ""}`}>
              {hasChildren ? (
                <button
                  className="outline-toggle"
                  type="button"
                  aria-label={expanded ? `折叠 ${item.title}` : `展开 ${item.title}`}
                  aria-expanded={expanded}
                  onClick={() => onToggle(key)}
                >
                  <ChevronRight size={14} />
                </button>
              ) : <span className="outline-toggle-spacer" />}
              <button
                className="outline-link"
                type="button"
                disabled={!item.pageNumber}
                title={item.title}
                onClick={() => item.pageNumber && onNavigate(item.pageNumber)}
              >
                <span>{item.title}</span>
                {item.pageNumber && <small>{item.pageNumber}</small>}
              </button>
            </div>
            {expanded && (
              <OutlineList
                items={item.items}
                parentKey={`${key}.`}
                expandedKeys={expandedKeys}
                activeKey={activeKey}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LeftSidebar(props: LeftSidebarProps) {
  const branchKeys = useMemo(() => outlineBranchKeys(props.outline), [props.outline]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(branchKeys));
  const activeKey = useMemo(() => activeOutlineKey(props.outline, props.currentPage), [props.currentPage, props.outline]);

  useEffect(() => {
    setExpandedKeys(new Set(branchKeys));
  }, [branchKeys]);

  const toggleOutlineBranch = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllOutlineBranches = () => {
    setExpandedKeys((current) => current.size === branchKeys.length ? new Set() : new Set(branchKeys));
  };

  const leftPanelResize = useResizablePanel({
    storageKey: LEFT_PANEL_STORAGE_KEY,
    defaultWidth: 240,
    minWidth: 220,
    edge: "right",
    label: "调整左侧导航栏宽度",
    getMaxWidth: leftPanelMaxWidth,
  });

  return (
    <aside ref={leftPanelResize.panelRef} className="left-sidebar" style={leftPanelResize.panelStyle}>
      <div {...leftPanelResize.resizerProps}><span /></div>
      <div className="panel-header">
        <div className="panel-tabs" role="tablist">
          <IconButton label="缩略图" active={props.activeTab === "thumbnails"} onClick={() => props.onTabChange("thumbnails")}><FileSearch size={17} /></IconButton>
          <IconButton
            label="目录（双击展开/折叠全部）"
            active={props.activeTab === "outline"}
            onClick={() => props.onTabChange("outline")}
            onDoubleClick={toggleAllOutlineBranches}
          ><ListTree size={17} /></IconButton>
          <IconButton label="全文搜索" active={props.activeTab === "search"} onClick={() => props.onTabChange("search")}><Search size={17} /></IconButton>
        </div>
        <IconButton label="关闭左侧栏" onClick={props.onClose}><X size={17} /></IconButton>
      </div>

      {props.activeTab === "thumbnails" && (
        <div className="thumbnail-list">
          {Array.from({ length: props.pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <button
              className={`thumbnail-item ${pageNumber === props.currentPage ? "is-current" : ""}`}
              type="button"
              key={pageNumber}
              onClick={() => props.onNavigate(pageNumber)}
            >
              <Page
                pdf={props.pdf}
                pageNumber={pageNumber}
                width={112}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                devicePixelRatio={1}
              />
              <span>{pageNumber}</span>
            </button>
          ))}
        </div>
      )}

      {props.activeTab === "outline" && (
        <div className="outline-panel">
          <h2>文档目录</h2>
          {props.outline.length ? (
            <OutlineList
              items={props.outline}
              expandedKeys={expandedKeys}
              activeKey={activeKey}
              onToggle={toggleOutlineBranch}
              onNavigate={props.onNavigate}
            />
          ) : <p className="empty-copy">{props.outlineLoading ? "正在识别文档目录..." : "未识别到文档目录。"}</p>}
        </div>
      )}

      {props.activeTab === "search" && (
        <div className="search-panel">
          <label className="search-input">
            <Search size={16} />
            <input autoFocus value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索全文" />
            {props.query && <button type="button" aria-label="清空搜索" onClick={() => props.onQueryChange("")}><X size={14} /></button>}
          </label>
          {props.indexProgress < props.pageCount && <p className="index-progress">正在索引 {props.indexProgress}/{props.pageCount} 页</p>}
          {props.indexError && <p className="index-progress" role="status">部分页面文字读取失败：{props.indexError}</p>}
          {props.query && props.indexProgress === props.pageCount && (
            <p className="result-count">{props.searchHits.reduce((sum, hit) => sum + hit.count, 0)} 个结果，分布在 {props.searchHits.length} 页</p>
          )}
          <div className="search-results">
            {props.searchHits.map((hit) => (
              <button type="button" key={hit.pageNumber} onClick={() => props.onNavigate(hit.pageNumber)}>
                <span>第 {hit.pageNumber} 页 <b>{hit.count}</b></span>
                <p>{hit.excerpt}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
