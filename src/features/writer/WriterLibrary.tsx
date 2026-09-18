import { useEffect, useMemo, useState } from "react";
import {
  Clock3,
  FileCode2,
  FilePlus2,
  FolderOpen,
  History,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { HomeNavigation, type HomeMode } from "../../components/HomeNavigation";
import whalePaperLockup from "../../assets/whalepaper-lockup.png";
import { listWriterLibrary, removeWriterLibraryProject } from "./services/local-writer";
import type { WriterLibraryProject } from "./types";
type WriterLibraryProps = {
  onNavigate: (mode: HomeMode) => void;
  onOpenProject: (project: WriterLibraryProject) => void;
  onAddProject: () => void;
  onAddFile: () => void;
  onOpenSettings: () => void;
};

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function WriterLibrary({ onNavigate, onOpenProject, onAddProject, onAddFile, onOpenSettings }: WriterLibraryProps) {
  const [projects, setProjects] = useState<WriterLibraryProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      setProjects(await listWriterLibrary());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects.filter((project) => !needle || `${project.name} ${project.rootPath} ${project.mainFile || ""}`.toLocaleLowerCase().includes(needle));
  }, [projects, query]);

  return (
    <main className={`library-home writer-library ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <aside className="library-home-sidebar">
        <header className="library-home-brand">
          <img className="brand-lockup" src={whalePaperLockup} alt="WhalePaper" />
          <button type="button" aria-label={sidebarCollapsed ? "展开导航栏" : "收起导航栏"} onClick={() => setSidebarCollapsed((value) => !value)}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </header>
        <HomeNavigation active="writer" onNavigate={onNavigate} />
        <div className="writer-library-quick-actions">
          <button type="button" onClick={onAddProject}><FolderOpen size={16} /><span>打开项目文件夹</span></button>
          <button type="button" onClick={onAddFile}><FilePlus2 size={16} /><span>打开 LaTeX 文件</span></button>
        </div>
        <footer className="library-home-sidebar-footer"><button type="button" onClick={onOpenSettings}><Settings size={16} /><span>设置</span></button></footer>
      </aside>

      <section className="writer-library-content">
        <header className="writer-library-toolbar">
          <div><h1>论文写作</h1><span>项目库</span></div>
          <div className="writer-library-toolbar-actions">
            <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" /></label>
            <button type="button" aria-label="刷新项目库" title="刷新项目库" onClick={() => void refresh()}><RefreshCw size={16} /></button>
            <button type="button" className="is-primary" onClick={onAddProject}><FolderOpen size={15} />打开项目</button>
          </div>
        </header>

        {error && <div className="writer-library-error">{error}</div>}
        <div className="writer-library-table" role="table" aria-label="写作项目列表">
          <div className="writer-library-table-header" role="row">
            <span>项目</span><span>主文档</span><span>审阅状态</span><span>最近打开</span><span />
          </div>
          {visible.map((project) => (
            <div className="writer-library-row" role="row" key={project.id}>
              <button type="button" className="writer-project-cell" disabled={!project.pathAvailable} onClick={() => onOpenProject(project)}>
                <span><FileCode2 size={17} /></span>
                <span><strong>{project.name}</strong><small>{project.pathAvailable ? project.rootPath : "项目目录已移动或不可用"}</small></span>
              </button>
              <span className="writer-project-main">{project.mainFile || "未检测到"}</span>
              <div className="writer-project-stats">
                <span title="版本"><History size={13} />{project.versionCount}</span>
                <span title="未解决评论"><MessageSquare size={13} />{project.openThreadCount}</span>
                <span title="待处理修订"><PenLine size={13} />{project.pendingRevisionCount}</span>
              </div>
              <span className="writer-project-date"><Clock3 size={12} />{formatDate(project.lastOpenedAt)}</span>
              <div className="writer-project-menu">
                <button type="button" aria-label={`${project.name} 的更多选项`} onClick={() => setRowMenu((value) => value === project.id ? null : project.id)}><MoreHorizontal size={16} /></button>
                {rowMenu === project.id && <div><button type="button" onClick={() => void removeWriterLibraryProject(project.id).then(() => { setProjects((current) => current.filter((item) => item.id !== project.id)); setRowMenu(null); })}><Trash2 size={14} />从项目库移除</button></div>}
              </div>
            </div>
          ))}
          {!loading && !visible.length && (
            <div className="writer-library-empty"><FileCode2 size={34} /><strong>{query ? "没有匹配的写作项目" : "写作项目库还是空的"}</strong>{!query && <button type="button" onClick={onAddProject}><FolderOpen size={15} />打开本地项目</button>}</div>
          )}
          {loading && <div className="writer-library-empty"><RefreshCw className="is-spinning" size={24} /><strong>正在读取项目库</strong></div>}
        </div>
      </section>
    </main>
  );
}
