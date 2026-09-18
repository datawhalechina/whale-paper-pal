import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  Info,
  LayoutGrid,
  Library,
  List,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { DocumentLibraryEntry } from "../types";
import whalePaperLockup from "../assets/whalepaper-lockup.png";
import { loadAnnotations } from "../lib/annotations";
import { HomeNavigation, type HomeMode } from "./HomeNavigation";

type WelcomeProps = {
  onOpen: () => void;
  onNavigate: (mode: HomeMode) => void;
  recentDocuments: DocumentLibraryEntry[];
  onOpenRecent: (entry: DocumentLibraryEntry) => void;
  onOpenAnnotations: (entry: DocumentLibraryEntry) => void;
  onRemoveRecent: (id: string) => void;
  onUpdateRecent: (id: string, patch: Partial<Pick<DocumentLibraryEntry, "favorite" | "rating" | "tags">>) => void;
  onDropFile: (file: File) => void;
  loading: boolean;
  error: string;
  onOpenSettings: () => void;
};

type ViewMode = "list" | "grid";
type SortMode = "added" | "rating";

const PAGE_SIZE = 10;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

export function Welcome({ onOpen, onNavigate, recentDocuments, onOpenRecent, onOpenAnnotations, onRemoveRecent, onUpdateRecent, onDropFile, loading, error, onOpenSettings }: WelcomeProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [taggedOnly, setTaggedOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("added");
  const [page, setPage] = useState(1);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => setPage(1), [favoritesOnly, query, sortMode, taggedOnly, viewMode]);

  const annotationCounts = useMemo(() => new Map(
    recentDocuments.map((entry) => [entry.id, loadAnnotations(entry.id).length]),
  ), [recentDocuments]);

  const existingTags = useMemo(() => Array.from(new Set(
    recentDocuments.flatMap((entry) => entry.tags || []),
  )).sort((left, right) => left.localeCompare(right, "zh-CN")), [recentDocuments]);

  const filteredDocuments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const next = recentDocuments.filter((entry) => {
      if (favoritesOnly && !entry.favorite) return false;
      if (taggedOnly && !entry.tags?.length) return false;
      if (!needle) return true;
      return `${entry.title} ${entry.author} ${entry.fileName} ${(entry.tags || []).join(" ")}`.toLocaleLowerCase().includes(needle);
    });
    next.sort((left, right) => {
      if (sortMode === "rating") return (right.rating || 0) - (left.rating || 0) || right.lastOpenedAt.localeCompare(left.lastOpenedAt);
      const leftDate = left.addedAt || left.lastOpenedAt;
      const rightDate = right.addedAt || right.lastOpenedAt;
      return rightDate.localeCompare(leftDate);
    });
    return next;
  }, [favoritesOnly, query, recentDocuments, sortMode, taggedOnly]);

  const pageCount = Math.max(1, Math.ceil(filteredDocuments.length / PAGE_SIZE));
  const visibleDocuments = filteredDocuments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file?.type === "application/pdf" || file?.name.toLowerCase().endsWith(".pdf")) onDropFile(file);
  };

  const addTag = (entry: DocumentLibraryEntry, value = tagDraft) => {
    const tag = value.trim();
    if (!tag) return;
    const tags = entry.tags || [];
    if (tags.includes(tag)) {
      setTagError("此标签已存在");
      return;
    }
    onUpdateRecent(entry.id, { tags: [...tags, tag] });
    setTagDraft("");
    setTagError("");
  };

  const removeTag = (entry: DocumentLibraryEntry, tag: string) => {
    onUpdateRecent(entry.id, { tags: (entry.tags || []).filter((item) => item !== tag) });
    setTagError("");
  };

  return (
    <main className={`library-home ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <aside className="library-home-sidebar">
        <header className="library-home-brand">
          <img className="brand-lockup" src={whalePaperLockup} alt="WhalePaper" />
          <button type="button" aria-label={sidebarCollapsed ? "展开导航栏" : "收起导航栏"} title={sidebarCollapsed ? "展开导航栏" : "收起导航栏"} onClick={() => setSidebarCollapsed((value) => !value)}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </header>

        <HomeNavigation active="reader" onNavigate={onNavigate} />

        <footer className="library-home-sidebar-footer">
          <button type="button" onClick={onOpenSettings}><Settings size={16} /><span>设置</span></button>
        </footer>
      </aside>

      <section className="library-home-content">
        <header className="library-home-toolbar">
          <div className="library-home-heading">
            <h1>论文库</h1>
            <Info size={15} aria-label="论文库信息" />
          </div>

          <div className="library-home-actions">
            <div className="library-view-switch" aria-label="视图模式">
              <button type="button" className={viewMode === "list" ? "is-active" : ""} aria-label="列表视图" title="列表视图" onClick={() => setViewMode("list")}><List size={17} /></button>
              <button type="button" className={viewMode === "grid" ? "is-active" : ""} aria-label="网格视图" title="网格视图" onClick={() => setViewMode("grid")}><LayoutGrid size={16} /></button>
            </div>

            <button type="button" className={`library-tool-button ${searchOpen ? "is-active" : ""}`} aria-label="搜索文献" title="搜索文献" onClick={() => setSearchOpen((value) => !value)}><Search size={18} /></button>
            <div className="library-action-anchor">
              <button type="button" className={`library-tool-button ${filtersOpen ? "is-active" : ""}`} aria-label="筛选文献" title="筛选文献" onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={18} /></button>
              {filtersOpen && (
                <div className="library-filter-menu">
                  <header><span>筛选与排序</span><button type="button" aria-label="关闭筛选" onClick={() => setFiltersOpen(false)}><X size={14} /></button></header>
                  <label><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />仅显示收藏</label>
                  <label><input type="checkbox" checked={taggedOnly} onChange={(event) => setTaggedOnly(event.target.checked)} />仅显示有标签</label>
                  <div className="library-filter-sort">
                    <span>排序</span>
                    <button type="button" className={sortMode === "added" ? "is-active" : ""} onClick={() => setSortMode("added")}>添加时间</button>
                    <button type="button" className={sortMode === "rating" ? "is-active" : ""} onClick={() => setSortMode("rating")}>评分</button>
                  </div>
                </div>
              )}
            </div>

            <button type="button" className="library-upload-button" onClick={onOpen} disabled={loading}><Upload size={15} />{loading ? "正在打开" : "上传论文"}</button>
          </div>
        </header>

        {searchOpen && (
          <div className="library-search-bar">
            <Search size={16} />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者或标签" />
            {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}><X size={15} /></button>}
          </div>
        )}

        {error && <div className="library-home-error">{error}</div>}

        {(query || favoritesOnly || taggedOnly) && (
          <div className="library-results-summary">
            <span>{filteredDocuments.length} 篇论文</span>
            {(favoritesOnly || taggedOnly) && <button type="button" onClick={() => { setFavoritesOnly(false); setTaggedOnly(false); }}><Filter size={13} />清除筛选</button>}
          </div>
        )}

        {viewMode === "list" ? (
          <div className="library-table" role="table" aria-label="论文列表">
            <div className="library-table-header" role="row">
              <span role="columnheader">标题</span>
              <button type="button" role="columnheader" onClick={() => setSortMode("rating")}>评分 <SlidersHorizontal size={12} /></button>
              <span role="columnheader">注释</span>
              <button type="button" role="columnheader" className={taggedOnly ? "is-active" : ""} onClick={() => setTaggedOnly((value) => !value)}>标签 <Filter size={12} /></button>
              <button type="button" role="columnheader" onClick={() => setSortMode("added")}>添加时间</button>
              <span aria-hidden="true" />
            </div>

            {visibleDocuments.map((entry) => (
              <div className={`library-table-row ${editingTags === entry.id ? "has-tag-editor" : ""}`} role="row" key={entry.id}>
                <button className="library-title-cell" type="button" disabled={!entry.sourcePath || loading} onClick={() => onOpenRecent(entry)}>
                  <strong>{entry.title}</strong>
                  {entry.author && <small>{entry.author}</small>}
                </button>
                <div className="library-rating" role="cell" aria-label={`${entry.rating || 0} 星`}>
                  {Array.from({ length: 5 }, (_, index) => index + 1).map((rating) => (
                    <button type="button" key={rating} aria-label={`${rating} 星`} title={`${rating} 星`} onClick={() => onUpdateRecent(entry.id, { rating: entry.rating === rating ? 0 : rating })}>
                      <Star size={15} fill={(entry.rating || 0) >= rating ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
                <button type="button" className="library-annotation-count" role="cell" aria-label={`打开 ${entry.title} 的 ${annotationCounts.get(entry.id) || 0} 条注释`} title="打开论文注释" onClick={() => onOpenAnnotations(entry)}>{annotationCounts.get(entry.id) || 0}</button>
                <div className="library-tags-cell" role="cell">
                  {editingTags === entry.id ? <div className="library-tag-editor" onMouseDown={(event) => event.stopPropagation()}>
                    <div className={`library-tag-input ${tagError ? "has-error" : ""}`} onClick={(event) => event.currentTarget.querySelector("input")?.focus()}>
                      {(entry.tags || []).map((tag) => <span className="library-tag-chip" key={tag} title={tag}>{tag}<button type="button" aria-label={`删除标签 ${tag}`} onClick={() => removeTag(entry, tag)}><X size={11} /></button></span>)}
                      <input autoFocus value={tagDraft} placeholder={(entry.tags || []).length ? "添加标签" : "按 Enter 添加标签"} onChange={(event) => { setTagDraft(event.target.value); setTagError(""); }} onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addTag(entry); }
                        if (event.key === "Backspace" && !tagDraft && entry.tags?.length) removeTag(entry, entry.tags[entry.tags.length - 1]);
                        if (event.key === "Escape") { setEditingTags(null); setTagDraft(""); setTagError(""); }
                      }} />
                    </div>
                    {tagError && <p>{tagError}</p>}
                    <div className="library-tag-dropdown">
                      <header><span>已有标签</span><small>标签管理可在论文库中进行</small></header>
                      <div>
                        {existingTags.filter((tag) => !(entry.tags || []).includes(tag) && tag.toLocaleLowerCase().includes(tagDraft.trim().toLocaleLowerCase())).map((tag) => (
                          <button type="button" key={tag} onMouseDown={(event) => event.preventDefault()} onClick={() => addTag(entry, tag)}><span>{tag}</span></button>
                        ))}
                        {!existingTags.some((tag) => !(entry.tags || []).includes(tag) && tag.toLocaleLowerCase().includes(tagDraft.trim().toLocaleLowerCase())) && <small>输入新标签后按 Enter 添加</small>}
                      </div>
                    </div>
                    <button type="button" className="library-tag-done" onClick={() => { setEditingTags(null); setTagDraft(""); setTagError(""); }}>完成</button>
                  </div> : <button type="button" className="library-tags-trigger" title="编辑标签" onClick={() => { setEditingTags(entry.id); setTagDraft(""); setTagError(""); }}>
                    {entry.tags?.length ? entry.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>) : <span className="is-empty">添加标签</span>}
                  </button>}
                </div>
                <span className="library-date-cell" role="cell">{formatDate(entry.addedAt || entry.lastOpenedAt)}</span>
                <div className="library-row-actions">
                  <button type="button" aria-label={`${entry.title} 的更多选项`} title="更多选项" onClick={() => setRowMenu((value) => value === entry.id ? null : entry.id)}><MoreHorizontal size={16} /></button>
                  {rowMenu === entry.id && (
                    <div className="library-row-menu">
                      <button type="button" onClick={() => { onUpdateRecent(entry.id, { favorite: !entry.favorite }); setRowMenu(null); }}><Star size={14} />{entry.favorite ? "取消收藏" : "收藏"}</button>
                      <button type="button" className="is-danger" onClick={() => { onRemoveRecent(entry.id); setRowMenu(null); }}><Trash2 size={14} />从论文库移除</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="library-grid" aria-label="论文网格">
            {visibleDocuments.map((entry) => (
              <article className="library-grid-card" key={entry.id}>
                <header><span><FileText size={20} /></span><button type="button" aria-label={`${entry.title} 的更多选项`} onClick={() => setRowMenu((value) => value === entry.id ? null : entry.id)}><MoreHorizontal size={17} /></button></header>
                <button type="button" className="library-grid-title" disabled={!entry.sourcePath || loading} onClick={() => onOpenRecent(entry)}>{entry.title}</button>
                <p>{entry.author || `${entry.pageCount} 页 PDF`}</p>
                <div className="library-grid-meta"><span><Star size={13} fill={entry.rating ? "currentColor" : "none"} />{entry.rating || 0}</span><span>{annotationCounts.get(entry.id) || 0} 条注释</span></div>
                <footer><span>{formatDate(entry.addedAt || entry.lastOpenedAt)}</span>{entry.tags?.[0] && <b>{entry.tags[0]}</b>}</footer>
                {rowMenu === entry.id && <div className="library-row-menu grid-menu"><button type="button" onClick={() => { onUpdateRecent(entry.id, { favorite: !entry.favorite }); setRowMenu(null); }}><Star size={14} />{entry.favorite ? "取消收藏" : "收藏"}</button><button type="button" className="is-danger" onClick={() => { onRemoveRecent(entry.id); setRowMenu(null); }}><Trash2 size={14} />从论文库移除</button></div>}
              </article>
            ))}
          </div>
        )}

        {!visibleDocuments.length && (
          <div className="library-empty">
            <Library size={30} />
            <strong>{query || favoritesOnly || taggedOnly ? "没有匹配的论文" : "论文库还是空的"}</strong>
            <button type="button" onClick={onOpen}><Upload size={15} />添加论文</button>
          </div>
        )}

        <footer className="library-pagination">
          <button type="button" aria-label="上一页" title="上一页" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button>
          <span>{page}</span>
          <button type="button" aria-label="下一页" title="下一页" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={16} /></button>
        </footer>
      </section>
    </main>
  );
}
