import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  CalendarDays,
  ExternalLink,
  FileText,
  Flame,
  Github,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  ThumbsUp,
  Users,
  X,
} from "lucide-react";
import type { DocumentLibraryEntry } from "../types";
import whalePaperLockup from "../assets/whalepaper-lockup.png";
import { openExternalUrl } from "../lib/external";
import {
  buildPersonalRecommendations,
  discoveryLibraryId,
  loadDiscoveryFeed,
  type DiscoveryFeed,
  type DiscoveryPaper,
  searchPapers,
} from "../lib/discovery";
import { HomeNavigation, type HomeMode } from "./HomeNavigation";

type DiscoveryLibraryProps = {
  entries: DocumentLibraryEntry[];
  onNavigate: (mode: HomeMode) => void;
  onToggleSavedPaper: (paper: DiscoveryPaper) => void;
  onOpenPaper: (paper: DiscoveryPaper) => Promise<void>;
  onOpenSettings: () => void;
};

type DiscoveryMode = "latest" | "popular" | "personal";

const EMPTY_FEED: DiscoveryFeed = { latest: [], popular: [] };

function formatDate(value?: string): string {
  if (!value) return "日期未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function paperMatches(paper: DiscoveryPaper, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${paper.title} ${paper.authors.join(" ")} ${paper.summary || ""}`.toLocaleLowerCase().includes(needle);
}

export function DiscoveryLibrary({ entries, onNavigate, onToggleSavedPaper, onOpenPaper, onOpenSettings }: DiscoveryLibraryProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [feed, setFeed] = useState<DiscoveryFeed>(EMPTY_FEED);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<DiscoveryMode>("popular");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [openingPaperSlug, setOpeningPaperSlug] = useState("");
  const [searchResults, setSearchResults] = useState<DiscoveryPaper[] | null>(null);
  const [searching, setSearching] = useState(false);

  const openExternalResource = async (url: string) => {
    setActionError("");
    try {
      await openExternalUrl(url);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "无法打开外部资源。");
    }
  };

  const openPaper = async (paper: DiscoveryPaper) => {
    setActionError("");
    setOpeningPaperSlug(paper.slug);
    try {
      await onOpenPaper(paper);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "无法在 WhalePaper 中打开 PDF。");
      setOpeningPaperSlug("");
    }
  };

  const refresh = async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      const next = await loadDiscoveryFeed(forceRefresh);
      setFeed(next);
      const allPapers = [...next.latest, ...next.popular];
      setSelectedSlug((current) => current && allPapers.some((paper) => paper.slug === current) ? current : "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "暂时无法读取每日论文推荐。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const value = query.trim();
    if (!value) { setSearchResults(null); return; }
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchPapers(value).then(setSearchResults).catch(() => setSearchResults([])).finally(() => setSearching(false));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [query]);

  const savedIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);
  const personalPapers = useMemo(() => buildPersonalRecommendations(feed.popular, entries), [feed.popular, entries]);
  const activePapers = searchResults !== null ? searchResults : mode === "latest" ? feed.latest : mode === "popular" ? feed.popular : personalPapers;
  const visiblePapers = useMemo(() => activePapers.filter((paper) => paperMatches(paper, query)), [activePapers, query]);
  const selectedPaper = visiblePapers.find((paper) => paper.slug === selectedSlug) || visiblePapers[0];
  const modeTitle = mode === "latest" ? "最新论文" : mode === "popular" ? "趋势热门" : "为你推荐";
  const modeDescription = mode === "latest" ? "按发布时间排序" : mode === "popular" ? "综合双源趋势与热度" : "根据论文库中的长期兴趣生成";

  return (
    <main className={`library-home discovery-library ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <aside className="library-home-sidebar">
        <header className="library-home-brand">
          <img className="brand-lockup" src={whalePaperLockup} alt="WhalePaper" />
          <button type="button" aria-label={sidebarCollapsed ? "展开导航栏" : "收起导航栏"} title={sidebarCollapsed ? "展开导航栏" : "收起导航栏"} onClick={() => setSidebarCollapsed((value) => !value)}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </header>
        <HomeNavigation active="discovery" onNavigate={onNavigate} />
        <footer className="library-home-sidebar-footer">
          <button type="button" onClick={onOpenSettings}><Settings size={16} /><span>设置</span></button>
        </footer>
      </aside>

      <section className="discovery-library-content">
        <header className="discovery-library-toolbar">
          <div className="discovery-library-heading"><h1>论文发现</h1><span>Research Feed</span></div>
          <div className="discovery-library-actions">
            <label className="discovery-library-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者或摘要" />{query && <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}><X size={14} /></button>}</label>
            <div className="discovery-sort" aria-label="论文排序">
              <button type="button" className={mode === "latest" ? "is-active" : ""} onClick={() => { setMode("latest"); setSelectedSlug(""); }}><CalendarDays size={14} />最新</button>
              <button type="button" className={mode === "popular" ? "is-active" : ""} onClick={() => { setMode("popular"); setSelectedSlug(""); }}><Flame size={14} />热门</button>
              <button type="button" className={mode === "personal" ? "is-active" : ""} onClick={() => { setMode("personal"); setSelectedSlug(""); }}><Sparkles size={14} />为你推荐</button>
            </div>
            <button type="button" className="discovery-refresh" aria-label="刷新推荐" title="刷新推荐" disabled={loading} onClick={() => void refresh(true)}><RefreshCw className={loading ? "is-spinning" : ""} size={17} /></button>
          </div>
        </header>

        {error && <div className="discovery-library-error"><span>{error}</span><button type="button" onClick={() => void refresh(true)}>重试</button></div>}
        {actionError && <div className="discovery-library-error"><span>{actionError}</span><button type="button" onClick={() => setActionError("")}>关闭</button></div>}

        <div className="discovery-library-body">
          <section className="discovery-paper-list" aria-label="推荐论文列表">
            <header><span>{query ? `${visiblePapers.length} 个搜索结果` : modeTitle}</span><small>{modeDescription}</small></header>
            <div className="discovery-paper-scroll">
              {loading && !feed.latest.length && !feed.popular.length && Array.from({ length: 7 }, (_, index) => <div className="discovery-paper-skeleton" key={index}><i /><i /><i /></div>)}
              {(searching || (!loading && !visiblePapers.length)) && <div className="discovery-library-empty"><Sparkles size={28} /><strong>{searching ? "正在搜索 arXiv、Semantic Scholar 和 OpenAlex…" : query ? "没有匹配的论文" : mode === "personal" ? "论文库中还没有足够的兴趣记录" : "暂时没有论文"}</strong></div>}
              {visiblePapers.map((paper, index) => {
                const saved = savedIds.has(discoveryLibraryId(paper));
                return (
                  <article className={`discovery-paper-row ${selectedPaper?.slug === paper.slug ? "is-selected" : ""}`} key={paper.slug}>
                    <button type="button" className="discovery-paper-select" onClick={() => setSelectedSlug(paper.slug)}>
                      <span className="discovery-paper-rank">{String(index + 1).padStart(2, "0")}</span>
                      <span className="discovery-paper-copy">
                        <strong>{paper.title}</strong>
                        <small>{paper.authors.slice(0, 3).join(", ") || "作者信息暂缺"}{paper.authors.length > 3 ? ` 等 ${paper.authors.length} 位作者` : ""}</small>
                        <span>
                          {mode === "popular" && <b><Flame size={11} />热度 {paper.popularityScore || 0}</b>}
                          {mode === "personal" && <b><Sparkles size={11} />{paper.recommendationReason}</b>}
                          {mode === "latest" && typeof paper.upvotes === "number" && <b><ThumbsUp size={11} />{paper.upvotes}</b>}
                          <b>{formatDate(paper.publishedDate)}</b>
                        </span>
                      </span>
                    </button>
                    <button type="button" className={`discovery-row-save ${saved ? "is-saved" : ""}`} aria-label={saved ? "从论文库移除" : "加入论文库"} title={saved ? "从论文库移除" : "加入论文库"} onClick={() => onToggleSavedPaper(paper)}><Bookmark size={15} fill={saved ? "currentColor" : "none"} /></button>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="discovery-paper-detail" aria-label="论文详情">
            {selectedPaper ? (
              <>
                <header>
                  <div className="discovery-detail-kicker">
                    <span>{(selectedPaper.sources || [selectedPaper.source]).map((source) => source === "huggingface" ? "Hugging Face" : source === "moonlight" ? "Moonlight" : source).join(" + ")}</span>
                    <b>{mode === "popular" ? <><Flame size={12} />热度 {selectedPaper.popularityScore || 0}</> : mode === "personal" ? <><Sparkles size={12} />兴趣匹配</> : <><CalendarDays size={12} />最新收录</>}</b>
                  </div>
                  <h2>{selectedPaper.title}</h2>
                  <div className="discovery-detail-authors"><Users size={14} /><span>{selectedPaper.authors.join(", ") || "作者信息暂缺"}</span></div>
                  <div className="discovery-detail-meta"><span><CalendarDays size={13} />{formatDate(selectedPaper.publishedDate)}</span>{mode === "personal" && selectedPaper.recommendationReason && <span>{selectedPaper.recommendationReason}</span>}</div>
                </header>
                <section className="discovery-detail-section"><h3>摘要</h3><p>{selectedPaper.summary || "该条目暂未提供摘要。"}</p></section>
                <section className="discovery-detail-section discovery-detail-links">
                  <h3>论文与资源</h3>
                  <div>
                    <a href={selectedPaper.url} target="_blank" rel="noreferrer" title={selectedPaper.url} onClick={(event) => { event.preventDefault(); void openExternalResource(selectedPaper.url); }}><ExternalLink size={15} />查看论文页面</a>
                    {selectedPaper.huggingFaceUrl && <a href={selectedPaper.huggingFaceUrl} target="_blank" rel="noreferrer" title={selectedPaper.huggingFaceUrl} onClick={(event) => { event.preventDefault(); void openExternalResource(selectedPaper.huggingFaceUrl!); }}><Sparkles size={15} />Hugging Face</a>}
                    {selectedPaper.githubUrlVerified && selectedPaper.githubUrl && <a href={selectedPaper.githubUrl} target="_blank" rel="noreferrer" title={`论文摘要中确认的代码链接：${selectedPaper.githubUrl}`} onClick={(event) => { event.preventDefault(); void openExternalResource(selectedPaper.githubUrl!); }}><Github size={15} />论文代码</a>}
                    {selectedPaper.projectUrl && <a href={selectedPaper.projectUrl} target="_blank" rel="noreferrer" title={selectedPaper.projectUrl} onClick={(event) => { event.preventDefault(); void openExternalResource(selectedPaper.projectUrl!); }}><ArrowUpRight size={15} />项目主页</a>}
                  </div>
                </section>
                <footer>
                  <button type="button" className={savedIds.has(discoveryLibraryId(selectedPaper)) ? "is-saved" : ""} onClick={() => onToggleSavedPaper(selectedPaper)}><Bookmark size={15} fill={savedIds.has(discoveryLibraryId(selectedPaper)) ? "currentColor" : "none"} />{savedIds.has(discoveryLibraryId(selectedPaper)) ? "已加入论文库" : "加入论文库"}</button>
                  <button type="button" className="discovery-open-pdf" disabled={!selectedPaper.pdfUrl || openingPaperSlug === selectedPaper.slug} onClick={() => void openPaper(selectedPaper)}><FileText size={14} />{openingPaperSlug === selectedPaper.slug ? "正在打开…" : selectedPaper.pdfUrl ? "在 WhalePaper 中打开" : "暂无 PDF"}</button>
                </footer>
              </>
            ) : <div className="discovery-library-empty"><Sparkles size={28} /><strong>选择一篇论文查看详情</strong></div>}
          </aside>
        </div>
      </section>
    </main>
  );
}
