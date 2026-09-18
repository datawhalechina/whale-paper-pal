import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  BookOpen,
  ChevronLeft,
  Moon,
  RefreshCw,
  Settings,
  Star,
  Sun,
} from "lucide-react";
import { discoveryLibraryId, loadRelatedPapers, type DiscoveryPaper } from "../lib/discovery";
import type { DocumentLibraryEntry, DocumentTheme, PdfDocumentState } from "../types";
import { IconButton } from "./IconButton";
import { useResizablePanel } from "./useResizablePanel";
import whalePaperLockup from "../assets/whalepaper-lockup.png";

const DISCOVERY_SIDEBAR_STORAGE_KEY = "whale-paper:discovery-sidebar-width";

function sidebarMaxWidth(panel: HTMLElement): number {
  return Math.min(360, (panel.parentElement?.clientWidth || window.innerWidth) / 2);
}

function paperHref(paper: DiscoveryPaper): string {
  return paper.pdfUrl || paper.url;
}

function paperYear(paper: DiscoveryPaper): string {
  return paper.publishedDate?.match(/(?:19|20)\d{2}/)?.[0] || "";
}

function paperMeta(paper: DiscoveryPaper): string {
  const citations = typeof paper.citationCount === "number"
    ? `被引 ${new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(paper.citationCount)}`
    : "";
  return [paperYear(paper), paper.venue, ...paper.categories.slice(0, 2), citations].filter(Boolean).join(" · ");
}

type DiscoverySidebarProps = {
  document: PdfDocumentState;
  entries: DocumentLibraryEntry[];
  semanticScholarApiKey: string;
  onToggleSavedPaper: (paper: DiscoveryPaper) => void;
  onToggleCurrentFavorite: () => void;
  onShowLibrary: () => void;
  onClose: () => void;
  theme: DocumentTheme;
  onThemeChange: (theme: DocumentTheme) => void;
  onOpenSettings: () => void;
};

type LoadingState = "loading" | "ready" | "error";

function DiscoverySkeleton() {
  return <div className="discovery-loading" aria-label="正在加载论文"><i /><i /><i /></div>;
}

export function DiscoverySidebar(props: DiscoverySidebarProps) {
  const sidebarResize = useResizablePanel({
    storageKey: DISCOVERY_SIDEBAR_STORAGE_KEY,
    defaultWidth: 232,
    minWidth: 216,
    edge: "right",
    label: "调整相关论文栏宽度",
    getMaxWidth: sidebarMaxWidth,
  });
  const [related, setRelated] = useState<DiscoveryPaper[]>([]);
  const [relatedState, setRelatedState] = useState<LoadingState>("loading");
  const [relatedError, setRelatedError] = useState("");
  const [relatedReload, setRelatedReload] = useState(0);

  const currentEntry = props.entries.find((entry) => entry.id === props.document.id);
  const savedIds = useMemo(() => new Set(props.entries.map((entry) => entry.id)), [props.entries]);
  const nightModeEnabled = props.theme === "night";

  useEffect(() => {
    let cancelled = false;
    setRelated([]);
    setRelatedError("");
    setRelatedState("loading");
    void loadRelatedPapers(props.document.title, props.semanticScholarApiKey).then((papers) => {
      if (cancelled) return;
      setRelated(papers);
      setRelatedState("ready");
    }).catch((error) => {
      if (cancelled) return;
      setRelatedError(error instanceof Error ? error.message : "论文推荐服务暂时不可用");
      setRelatedState("error");
    });
    return () => { cancelled = true; };
  }, [props.document.id, props.document.title, props.semanticScholarApiKey, relatedReload]);

  return (
    <aside ref={sidebarResize.panelRef} className="app-sidebar discovery-sidebar" style={sidebarResize.panelStyle}>
      <div {...sidebarResize.resizerProps}><span /></div>
      <header className="app-brand">
        <img className="brand-lockup" src={whalePaperLockup} alt="WhalePaper" />
        <IconButton label="收起相关论文栏" onClick={props.onClose}><ChevronLeft size={16} /></IconButton>
      </header>

      <nav className="app-navigation" aria-label="论文阅读导航">
        <button type="button" onClick={props.onShowLibrary}><BookOpen size={17} /><span>论文库</span></button>
        <button type="button" className={currentEntry?.favorite ? "is-active" : ""} onClick={props.onToggleCurrentFavorite}>
          <Star size={17} fill={currentEntry?.favorite ? "currentColor" : "none"} /><span>{currentEntry?.favorite ? "已收藏当前论文" : "收藏当前论文"}</span>
        </button>
      </nav>

      <section className="discovery-inline" aria-label="相关论文">
        <header className="discovery-inline-header"><h2>相关论文</h2><span>{related.length ? `${related.length} 篇` : "当前论文延伸阅读"}</span></header>
        <div className="discovery-results">
          {relatedState === "loading" && <DiscoverySkeleton />}
          {relatedState === "error" && <div className="discovery-empty discovery-empty-action"><span>{relatedError}</span><button type="button" onClick={() => setRelatedReload((value) => value + 1)}><RefreshCw size={13} />重新获取</button></div>}
          {relatedState === "ready" && !related.length && <div className="discovery-empty discovery-empty-action"><span>暂未找到与当前论文相关的内容。</span><button type="button" onClick={() => setRelatedReload((value) => value + 1)}><RefreshCw size={13} />重新获取</button></div>}
          {related.map((paper) => {
            const saved = savedIds.has(discoveryLibraryId(paper));
            return (
              <article className="discovery-result" key={paper.slug}>
                <a href={paperHref(paper)} target="_blank" rel="noreferrer">
                  <div>
                    <h3>{paper.title}</h3>
                    {paper.summary && <p>{paper.summary}</p>}
                    {paperMeta(paper) && <small>{paperMeta(paper)}</small>}
                  </div>
                </a>
                <button type="button" className={`discovery-bookmark ${saved ? "is-saved" : ""}`} aria-label={saved ? "从论文库移除" : "保存到论文库"} title={saved ? "从论文库移除" : "保存到论文库"} onClick={() => props.onToggleSavedPaper(paper)}>
                  <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="document-theme-control" aria-label="文档主题">
        <button type="button" aria-label={nightModeEnabled ? "切换到原色主题" : "切换到夜间主题"} title={nightModeEnabled ? "切换到原色主题" : "切换到夜间主题"} onClick={() => props.onThemeChange(nightModeEnabled ? "original" : "night")}>
          {nightModeEnabled ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button type="button" className={props.theme === "sepia" ? "is-active" : ""} aria-label="护眼主题" title="护眼主题" onClick={() => props.onThemeChange("sepia")}><BookOpen size={14} /></button>
        <button type="button" className="theme-settings-button" aria-label="打开设置" title="设置" onClick={props.onOpenSettings}><Settings size={15} /></button>
      </footer>

    </aside>
  );
}
