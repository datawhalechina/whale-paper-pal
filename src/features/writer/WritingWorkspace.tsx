import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { cursorPageDown, cursorPageUp } from "@codemirror/commands";
import { latex } from "codemirror-lang-latex";
import { Document, Page } from "react-pdf";
import {
  AlertCircle,
  Bot,
  Check,
  ClipboardPaste,
  Copy,
  GitCompareArrows,
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  File,
  FileCode2,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
  Home,
  History,
  LoaderCircle,
  MapPin,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelBottom,
  Play,
  RefreshCw,
  Save,
  ScanText,
  Scissors,
  TerminalSquare,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { readBrandedStorage } from "../../lib/brand-storage";
import type { AiSettings } from "../../types";
import {
  compileWriterProject,
  applyWriterRevision,
  findWriterPdfPosition,
  findWriterSourcePosition,
  getLatexRuntimeStatus,
  installManagedLatexRuntime,
  openWriterProject,
  readWriterFile,
  readWriterPdf,
  writeWriterFile,
  createWriterVersion,
  restoreWriterVersion,
  saveWriterRevision,
} from "./services/local-writer";
import type { EditorBuffer, LatexEngine, LatexRuntimeStatus, RuntimeInstallProgress, WriterProject, WriterRevision } from "./types";
import { WriterReviewSidebar, type WriterSourceSelection } from "./WriterReviewSidebar";
import { CodeLatexToolbar } from "./CodeLatexToolbar";
import { VisualLatexEditor } from "./VisualLatexEditor";
import { WriterAgentPanel } from "./WriterAgentPanel";
import type { AgentFileChange } from "./services/agent";

type WritingWorkspaceProps = {
  rootPath: string;
  initialFile?: string;
  aiSettings: AiSettings;
  onClose: () => void;
  onOpenFile: () => void;
  onOpenProject: () => void;
  onOpenSettings: (section?: "models" | "runtime") => void;
};

type EditorScrollMetrics = {
  top: number;
  max: number;
  viewport: number;
  content: number;
};

type PdfSyncStatus = {
  page: number;
  filePath: string;
  line: number;
};

type WriterEditorContextMenu = {
  x: number;
  y: number;
  mode: "code" | "visual";
  sourceRange: { from: number; to: number } | null;
  selection: WriterSourceSelection | null;
  sourceLine: number;
};

type PendingAgentPrompt = {
  id: string;
  content: string;
};

type WriterColumnWidths = [number, number, number, number];
type WriterColumnRatios = [number, number, number, number];
type WriterColumnDivider = 0 | 1 | 2;

const EMPTY_RUNTIME: LatexRuntimeStatus = {
  available: false,
  engines: [],
  biberAvailable: false,
  managed: false,
};

const INITIAL_INSTALL_PROGRESS: RuntimeInstallProgress = {
  phase: "preparing",
  message: "正在准备安装",
  percent: 0,
  downloadedBytes: 0,
  totalBytes: 0,
};

const WRITER_COLUMN_LAYOUT_KEY = "whalepaper.writer.column-layout";

function readWriterColumnRatios(): WriterColumnRatios | null {
  try {
    const saved = readBrandedStorage(WRITER_COLUMN_LAYOUT_KEY);
    if (!saved) return null;
    const values = JSON.parse(saved);
    if (!Array.isArray(values) || values.length !== 4 || values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return null;
    return values.map((value) => value / total) as WriterColumnRatios;
  } catch {
    return null;
  }
}

function writerColumnMinimums(availableWidth: number, filePanelCollapsed: boolean): WriterColumnWidths {
  const preferred: WriterColumnWidths = filePanelCollapsed ? [52, 320, 300, 280] : [180, 320, 300, 280];
  const total = preferred.reduce((sum, value) => sum + value, 0);
  const scale = total > availableWidth && availableWidth > 0 ? availableWidth / total : 1;
  return preferred.map((value) => value * scale) as WriterColumnWidths;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function fileIcon(kind: string) {
  if (["png", "jpg", "jpeg", "pdf", "eps", "svg"].includes(kind)) return <FileImage size={14} />;
  if (["tex", "cls", "sty", "bst"].includes(kind)) return <FileCode2 size={14} />;
  if (kind === "bib") return <FileText size={14} />;
  return <File size={14} />;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(value: number): string {
  if (!value) return "";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function isAuxiliaryMainFile(path: string): boolean {
  const name = path.split("/").at(-1)?.replace(/[-_\s]/g, "").toLocaleLowerCase() || "";
  return ["checklist", "reproducibility", "supplement", "supplementary", "appendix", "rebuttal", "response", "coverletter", "instructions"]
    .some((keyword) => name.includes(keyword));
}

export function WritingWorkspace({ rootPath, initialFile, aiSettings, onClose, onOpenFile, onOpenProject, onOpenSettings }: WritingWorkspaceProps) {
  const [project, setProject] = useState<WriterProject | null>(null);
  const [runtime, setRuntime] = useState<LatexRuntimeStatus>(EMPTY_RUNTIME);
  const [buffers, setBuffers] = useState<Record<string, EditorBuffer>>({});
  const [tabs, setTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [mainFile, setMainFile] = useState("");
  const [engine, setEngine] = useState<LatexEngine>("pdflatex");
  const [loading, setLoading] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [compileStatus, setCompileStatus] = useState<"idle" | "success" | "failure" | "timedout">("idle");
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof compileWriterProject>>["diagnostics"]>([]);
  const [log, setLog] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfPageSizes, setPdfPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [pdfRenderWidth, setPdfRenderWidth] = useState(560);
  const [pdfSyncError, setPdfSyncError] = useState("");
  const [pdfSyncStatus, setPdfSyncStatus] = useState<PdfSyncStatus | null>(null);
  const [error, setError] = useState("");
  const [installingRuntime, setInstallingRuntime] = useState(false);
  const [installProgress, setInstallProgress] = useState<RuntimeInstallProgress>(INITIAL_INSTALL_PROGRESS);
  const [installError, setInstallError] = useState("");
  const [rightView, setRightView] = useState<"comments" | "versions" | "revisions" | "agent">("agent");
  const [filePanelCollapsed, setFilePanelCollapsed] = useState(() => {
    try { return readBrandedStorage("whalepaper.writer.filePanelCollapsed") === "true"; }
    catch { return false; }
  });
  const [columnRatios, setColumnRatios] = useState<WriterColumnRatios | null>(readWriterColumnRatios);
  const [resizingDivider, setResizingDivider] = useState<WriterColumnDivider | null>(null);
  const [dividerOffsets, setDividerOffsets] = useState<number[]>([]);
  const [sourceSelection, setSourceSelection] = useState<WriterSourceSelection | null>(null);
  const [trackChanges, setTrackChanges] = useState(false);
  const [reviewRefreshToken, setReviewRefreshToken] = useState(0);
  const [editorContextMenu, setEditorContextMenu] = useState<WriterEditorContextMenu | null>(null);
  const [agentPendingPrompt, setAgentPendingPrompt] = useState<PendingAgentPrompt | null>(null);
  const [editorMode, setEditorMode] = useState<"code" | "visual">(() => {
    try { return readBrandedStorage("whalepaper.writer.editorMode") === "visual" ? "visual" : "code"; }
    catch { return "code"; }
  });
  const [editorScroll, setEditorScroll] = useState<EditorScrollMetrics>({ top: 0, max: 0, viewport: 1, content: 1 });
  const editorViewRef = useRef<EditorView | null>(null);
  const editorScrollCleanupRef = useRef<(() => void) | null>(null);
  const editorScrollDragOffsetRef = useRef(0);
  const writerBodyRef = useRef<HTMLDivElement | null>(null);
  const writerColumnRefs = useRef<Array<HTMLElement | null>>([]);
  const columnResizeCleanupRef = useRef<(() => void) | null>(null);
  const pdfStageRef = useRef<HTMLDivElement | null>(null);
  const visualEditorScrollRef = useRef<HTMLDivElement | null>(null);
  const visualContextRangeRef = useRef<Range | null>(null);
  const pdfPageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const trackedSessionsRef = useRef<Record<string, { id: string; beforeContent: string; afterContent: string }>>({});
  const revisionTimersRef = useRef<Record<string, number>>({});

  const activeBuffer = activePath ? buffers[activePath] : undefined;
  const dirty = Object.values(buffers).some((buffer) => buffer.content !== buffer.savedContent);
  const pdfSource = useMemo(() => (pdfBytes ? { data: pdfBytes.slice() } : null), [pdfBytes]);
  const latexExtensions = useMemo(
    () => activePath?.endsWith(".tex")
      ? [latex({ fileName: activePath, autoCloseTags: true, autoCloseBrackets: true, enableAutocomplete: true, enableLinting: true, enableTooltips: true }), EditorView.lineWrapping]
      : [EditorView.lineWrapping],
    [activePath],
  );
  const visualModeAvailable = Boolean(activePath?.toLocaleLowerCase().endsWith(".tex"));
  const effectiveEditorMode = editorMode === "visual" && visualModeAvailable ? "visual" : "code";
  const writerBodyStyle = useMemo(() => {
    if (!columnRatios) return undefined;
    const [files, editor, preview, assistant] = columnRatios;
    return {
      gridTemplateColumns: `${filePanelCollapsed ? "52px" : `minmax(180px, ${files}fr)`} minmax(320px, ${editor}fr) minmax(300px, ${preview}fr) minmax(280px, ${assistant}fr)`,
    };
  }, [columnRatios, filePanelCollapsed]);

  const changeEditorMode = useCallback((mode: "code" | "visual") => {
    if (mode === "visual" && !activePath?.toLocaleLowerCase().endsWith(".tex")) return;
    setEditorMode(mode);
    try { localStorage.setItem("whalepaper.writer.editorMode", mode); } catch { /* local preference is optional */ }
  }, [activePath]);

  useEffect(() => {
    const stage = pdfStageRef.current;
    if (!stage) return;
    const update = () => {
      if (stage.clientWidth > 0) setPdfRenderWidth(Math.max(260, Math.min(560, stage.clientWidth - 52)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const toggleFilePanel = useCallback(() => {
    setFilePanelCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("whalepaper.writer.filePanelCollapsed", String(next)); }
      catch { /* local preference is optional */ }
      return next;
    });
  }, []);

  const getWriterColumnWidths = useCallback((): WriterColumnWidths | null => {
    const columns = writerColumnRefs.current;
    if (columns.length !== 4 || columns.some((column) => !column)) return null;
    return columns.map((column) => column?.getBoundingClientRect().width || 0) as WriterColumnWidths;
  }, []);

  const rememberWriterColumnWidths = useCallback((widths: WriterColumnWidths) => {
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (!total) return;
    const next = widths.map((width) => width / total) as WriterColumnRatios;
    setColumnRatios(next);
    try { localStorage.setItem(WRITER_COLUMN_LAYOUT_KEY, JSON.stringify(next)); }
    catch { /* local preference is optional */ }
  }, []);

  const resizeWriterColumns = useCallback((divider: WriterColumnDivider, delta: number, sourceWidths?: WriterColumnWidths) => {
    if (filePanelCollapsed && divider === 0) return;
    const body = writerBodyRef.current;
    const widths = sourceWidths || getWriterColumnWidths();
    if (!body || !widths) return;
    const minimums = writerColumnMinimums(body.clientWidth, filePanelCollapsed);
    const leftIndex = divider;
    const rightIndex = divider + 1;
    const pairWidth = widths[leftIndex] + widths[rightIndex];
    const nextLeft = clamp(widths[leftIndex] + delta, minimums[leftIndex], pairWidth - minimums[rightIndex]);
    const next = [...widths] as WriterColumnWidths;
    next[leftIndex] = nextLeft;
    next[rightIndex] = pairWidth - nextLeft;
    rememberWriterColumnWidths(next);
  }, [filePanelCollapsed, getWriterColumnWidths, rememberWriterColumnWidths]);

  const startColumnResize = useCallback((event: ReactPointerEvent<HTMLDivElement>, divider: WriterColumnDivider) => {
    if (event.button !== 0 || (filePanelCollapsed && divider === 0)) return;
    const widths = getWriterColumnWidths();
    if (!widths) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    setResizingDivider(divider);
    const finish = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      columnResizeCleanupRef.current = null;
      setResizingDivider(null);
    };
    const move = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      resizeWriterColumns(divider, nextEvent.clientX - startX, widths);
    };
    columnResizeCleanupRef.current?.();
    columnResizeCleanupRef.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [filePanelCollapsed, getWriterColumnWidths, resizeWriterColumns]);

  const resetWriterColumnLayout = useCallback(() => {
    setColumnRatios(null);
    try { localStorage.removeItem(WRITER_COLUMN_LAYOUT_KEY); }
    catch { /* local preference is optional */ }
  }, []);

  useEffect(() => () => columnResizeCleanupRef.current?.(), []);

  useLayoutEffect(() => {
    const body = writerBodyRef.current;
    if (!body) return;
    const updateOffsets = () => {
      const bodyBounds = body.getBoundingClientRect();
      const offsets = writerColumnRefs.current.slice(0, 3).map((column) => (
        column ? column.getBoundingClientRect().right - bodyBounds.left : 0
      ));
      if (offsets.some((offset) => offset <= 0)) return;
      setDividerOffsets((current) => (
        current.length === offsets.length && current.every((offset, index) => Math.abs(offset - offsets[index]) < 0.5)
          ? current
          : offsets
      ));
    };
    const frame = window.requestAnimationFrame(updateOffsets);
    const observer = new ResizeObserver(updateOffsets);
    observer.observe(body);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [columnRatios, filePanelCollapsed, loading]);

  const updateEditorScroll = useCallback((view = editorViewRef.current) => {
    if (!view) return;
    const { scrollTop, scrollHeight, clientHeight } = view.scrollDOM;
    setEditorScroll({
      top: scrollTop,
      max: Math.max(0, scrollHeight - clientHeight),
      viewport: Math.max(1, clientHeight),
      content: Math.max(1, scrollHeight),
    });
  }, []);

  const attachEditor = useCallback((view: EditorView) => {
    editorScrollCleanupRef.current?.();
    editorViewRef.current = view;
    const update = () => updateEditorScroll(view);
    view.scrollDOM.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(view.scrollDOM);
    resizeObserver.observe(view.contentDOM);
    const frame = window.requestAnimationFrame(update);
    editorScrollCleanupRef.current = () => {
      window.cancelAnimationFrame(frame);
      view.scrollDOM.removeEventListener("scroll", update);
      resizeObserver.disconnect();
      if (editorViewRef.current === view) editorViewRef.current = null;
    };
  }, [updateEditorScroll]);

  const refreshRuntime = useCallback(async () => {
    try {
      const next = await getLatexRuntimeStatus();
      setRuntime(next);
      const preferred = (["pdflatex", "xelatex", "lualatex"] as LatexEngine[]).find((item) => next.engines.includes(item));
      if (preferred) setEngine(preferred);
    } catch (nextError) {
      setRuntime(EMPTY_RUNTIME);
      setError(errorMessage(nextError));
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<RuntimeInstallProgress>("writer-runtime-progress", (event) => {
      if (!disposed) setInstallProgress(event.payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  const installRuntime = useCallback(async () => {
    if (installingRuntime) return;
    setInstallingRuntime(true);
    setInstallError("");
    setError("");
    setInstallProgress(INITIAL_INSTALL_PROGRESS);
    try {
      const next = await installManagedLatexRuntime();
      setRuntime(next);
      const preferred = (["pdflatex", "xelatex", "lualatex"] as LatexEngine[]).find((item) => next.engines.includes(item));
      if (preferred) setEngine(preferred);
      if (!next.available) throw new Error("TeX 环境安装完成，但没有检测到可用的编译引擎。");
    } catch (nextError) {
      setInstallError(errorMessage(nextError));
    } finally {
      setInstallingRuntime(false);
    }
  }, [installingRuntime]);

  const openFile = useCallback(async (path: string) => {
    const file = project?.files.find((entry) => entry.path === path);
    if (!file?.editable) return;
    setActivePath(path);
    setTabs((current) => current.includes(path) ? current : [...current, path]);
    if (buffers[path]) return;
    try {
      const content = await readWriterFile(rootPath, path);
      setBuffers((current) => ({ ...current, [path]: { content, savedContent: content, saving: false } }));
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }, [buffers, project?.files, rootPath]);

  const refreshProject = useCallback(async () => {
    try {
      setProject(await openWriterProject(rootPath, mainFile || activePath || undefined));
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }, [activePath, mainFile, rootPath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([openWriterProject(rootPath, initialFile), getLatexRuntimeStatus()])
      .then(([nextProject, nextRuntime]) => {
        if (cancelled) return;
        setProject(nextProject);
        setRuntime(nextRuntime);
        const selectedTex = initialFile && nextProject.files.some((file) => file.path === initialFile && file.kind === "tex")
          ? initialFile
          : undefined;
        const nextMain = nextProject.mainFile || selectedTex || nextProject.files.find((file) => file.kind === "tex")?.path || "";
        setMainFile(nextMain);
        const preferred = (["pdflatex", "xelatex", "lualatex"] as LatexEngine[]).find((item) => nextRuntime.engines.includes(item));
        if (preferred) setEngine(preferred);
        const selectedWasRepaired = Boolean(selectedTex && nextMain && selectedTex !== nextMain && isAuxiliaryMainFile(selectedTex));
        const initial = selectedWasRepaired ? nextMain : selectedTex || nextMain || nextProject.files.find((file) => file.editable)?.path;
        if (initial) {
          setActivePath(initial);
          setTabs([initial]);
          return Promise.all(nextProject.files.filter((file) => file.editable).map(async (file) => [file.path, await readWriterFile(rootPath, file.path)] as const)).then((entries) => {
            if (!cancelled) setBuffers(Object.fromEntries(entries.map(([path, content]) => [path, { content, savedContent: content, saving: false }])));
          });
        }
      })
      .catch((nextError) => !cancelled && setError(errorMessage(nextError)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [initialFile, rootPath]);

  const saveAll = useCallback(async () => {
    const pending = Object.entries(buffers).filter(([, buffer]) => buffer.content !== buffer.savedContent && !buffer.saving);
    if (!pending.length) return;
    setBuffers((current) => {
      const next = { ...current };
      for (const [path] of pending) next[path] = { ...next[path], saving: true };
      return next;
    });
    try {
      await Promise.all(pending.map(([path, buffer]) => writeWriterFile(rootPath, path, buffer.content)));
      setBuffers((current) => {
        const next = { ...current };
        for (const [path, buffer] of pending) next[path] = { ...next[path], savedContent: buffer.content, saving: false };
        return next;
      });
    } catch (nextError) {
      setBuffers((current) => {
        const next = { ...current };
        for (const [path] of pending) next[path] = { ...next[path], saving: false };
        return next;
      });
      setError(errorMessage(nextError));
      throw nextError;
    }
  }, [buffers, rootPath]);

  const persistTrackedRevision = useCallback(async (filePath: string, session: { id: string; beforeContent: string; afterContent: string }) => {
    if (!project || session.beforeContent === session.afterContent) return;
    await saveWriterRevision({
      id: session.id,
      projectId: project.id,
      filePath,
      beforeContent: session.beforeContent,
      afterContent: session.afterContent,
    });
    setReviewRefreshToken((value) => value + 1);
  }, [project]);

  const flushTrackedRevisions = useCallback(async () => {
    const sessions = Object.entries(trackedSessionsRef.current);
    Object.values(revisionTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    revisionTimersRef.current = {};
    await Promise.all(sessions.map(async ([filePath, session]) => {
      await persistTrackedRevision(filePath, session);
      // Keep a newer edit that arrived while persistence was in flight.
      if (trackedSessionsRef.current[filePath]?.id === session.id) {
        delete trackedSessionsRef.current[filePath];
      }
    }));
  }, [persistTrackedRevision]);

  const toggleTrackChanges = useCallback(() => {
    if (trackChanges) {
      void flushTrackedRevisions().catch((nextError) => setError(errorMessage(nextError)));
      setTrackChanges(false);
    } else {
      setTrackChanges(true);
    }
  }, [flushTrackedRevisions, trackChanges]);

  const handleEditorChange = useCallback((content: string) => {
    if (!activePath || !activeBuffer) return;
    if (trackChanges && project) {
      const session = trackedSessionsRef.current[activePath] || {
        id: crypto.randomUUID(),
        beforeContent: activeBuffer.content,
        afterContent: content,
      };
      session.afterContent = content;
      trackedSessionsRef.current[activePath] = session;
      window.clearTimeout(revisionTimersRef.current[activePath]);
      revisionTimersRef.current[activePath] = window.setTimeout(() => {
        delete revisionTimersRef.current[activePath];
        if (trackedSessionsRef.current[activePath]?.id === session.id) delete trackedSessionsRef.current[activePath];
        void persistTrackedRevision(activePath, session).catch((nextError) => setError(errorMessage(nextError)));
      }, 650);
    }
    setBuffers((current) => ({ ...current, [activePath]: { ...current[activePath], content } }));
  }, [activeBuffer, activePath, persistTrackedRevision, project, trackChanges]);

  useEffect(() => () => {
    void flushTrackedRevisions().catch(() => undefined);
    editorScrollCleanupRef.current?.();
  }, [flushTrackedRevisions]);

  const captureSourceSelection = useCallback(() => {
    const view = editorViewRef.current;
    if (!view || !activePath) return;
    const range = view.state.selection.main;
    if (range.empty) {
      setError("请先在源码编辑器中选中需要评论的文本。");
      return;
    }
    setSourceSelection({ from: range.from, to: range.to, quote: view.state.sliceDoc(range.from, range.to) });
    setRightView("comments");
  }, [activePath]);

  const captureVisualSelection = useCallback((selection: WriterSourceSelection) => {
    if (!activePath) return;
    setSourceSelection(selection);
    setRightView("comments");
  }, [activePath]);

  const writeClipboardText = useCallback(async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.setAttribute("readonly", "");
    temporary.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    if (!copied) throw new Error("系统没有授权访问剪贴板。");
  }, []);

  const readClipboardText = useCallback(async () => {
    if (!navigator.clipboard?.readText) throw new Error("系统没有授权读取剪贴板。");
    return (await navigator.clipboard.readText()).replace(/\r\n?/g, "\n");
  }, []);

  const getVisualContext = useCallback(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      visualContextRangeRef.current = null;
      return { sourceRange: null, selection: null, sourceLine: 1 };
    }
    const range = selection.getRangeAt(0).cloneRange();
    const anchor = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
    const block = anchor?.closest<HTMLElement>("[data-source-start]");
    if (!anchor?.closest(".visual-latex-paper")) {
      visualContextRangeRef.current = null;
      return { sourceRange: null, selection: null, sourceLine: 1 };
    }
    visualContextRangeRef.current = range;
    const quote = selection.toString();
    const source = activeBuffer?.content || "";
    const blockStart = Number(block?.dataset.sourceStart);
    const from = quote
      ? source.indexOf(quote, Number.isFinite(blockStart) ? blockStart : 0)
      : (Number.isFinite(blockStart) ? blockStart : 0);
    const sourceLine = source.slice(0, Math.max(0, from)).split("\n").length;
    return {
      sourceRange: from >= 0 ? { from, to: from + quote.length } : null,
      selection: quote && from >= 0 ? { from, to: from + quote.length, quote } : null,
      sourceLine,
    };
  }, [activeBuffer?.content]);

  const openEditorContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!activePath || !activeBuffer) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceContext = effectiveEditorMode === "code"
      ? (() => {
        const view = editorViewRef.current;
        if (!view) return { sourceRange: null, selection: null, sourceLine: 1 };
        const range = view.state.selection.main;
        return {
          sourceRange: { from: range.from, to: range.to },
          selection: range.empty ? null : { from: range.from, to: range.to, quote: view.state.sliceDoc(range.from, range.to) },
          sourceLine: view.state.doc.lineAt(range.from).number,
        };
      })()
      : getVisualContext();
    setEditorContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 244)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 332)),
      mode: effectiveEditorMode,
      ...sourceContext,
    });
  }, [activeBuffer, activePath, effectiveEditorMode, getVisualContext]);

  useEffect(() => {
    if (!editorContextMenu) return;
    const close = () => setEditorContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [editorContextMenu]);

  const replaceCodeRange = useCallback((range: { from: number; to: number }, insert: string, deleteForward = false) => {
    const view = editorViewRef.current;
    if (!view) throw new Error("源码编辑器尚未就绪。");
    const from = Math.max(0, Math.min(range.from, view.state.doc.length));
    const to = range.from === range.to && deleteForward
      ? Math.min(view.state.doc.length, from + 1)
      : Math.max(from, Math.min(range.to, view.state.doc.length));
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
    view.focus();
  }, []);

  const visualRangeForContext = useCallback(() => {
    const range = visualContextRangeRef.current;
    if (!range) return null;
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    const editable = start?.closest<HTMLElement>(".visual-latex-editable");
    if (!editable || editable !== end?.closest<HTMLElement>(".visual-latex-editable")) return null;
    return { range, editable };
  }, []);

  const replaceVisualRange = useCallback((insert: string, deleteForward = false) => {
    const target = visualRangeForContext();
    if (!target) throw new Error("请在同一段可视化文本中放置光标或选中内容后再操作。");
    const { range, editable } = target;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (range.collapsed && deleteForward) {
      document.execCommand("forwardDelete");
    } else {
      range.deleteContents();
      if (insert) {
        const text = document.createTextNode(insert);
        range.insertNode(text);
        range.setStartAfter(text);
      }
      range.collapse(true);
    }
    selection?.removeAllRanges();
    selection?.addRange(range);
    visualContextRangeRef.current = range.cloneRange();
    editable.dispatchEvent(new Event("input", { bubbles: true }));
  }, [visualRangeForContext]);

  const copyEditorSelection = useCallback(async () => {
    const selection = editorContextMenu?.selection;
    if (!selection?.quote) throw new Error("请先选中需要复制的文本。");
    await writeClipboardText(selection.quote);
  }, [editorContextMenu?.selection, writeClipboardText]);

  const cutEditorSelection = useCallback(async () => {
    const context = editorContextMenu;
    if (!context?.selection || !context.sourceRange) throw new Error("请先选中需要剪切的文本。");
    await writeClipboardText(context.selection.quote);
    if (context.mode === "code") replaceCodeRange(context.sourceRange, "");
    else replaceVisualRange("");
  }, [editorContextMenu, replaceCodeRange, replaceVisualRange, writeClipboardText]);

  const pasteIntoEditor = useCallback(async () => {
    const context = editorContextMenu;
    if (!context) return;
    const text = await readClipboardText();
    if (context.mode === "code") {
      if (!context.sourceRange) throw new Error("源码编辑器尚未就绪。");
      replaceCodeRange(context.sourceRange, text);
    } else {
      replaceVisualRange(text);
    }
  }, [editorContextMenu, readClipboardText, replaceCodeRange, replaceVisualRange]);

  const deleteEditorSelection = useCallback(() => {
    const context = editorContextMenu;
    if (!context?.sourceRange) throw new Error("编辑器尚未就绪。");
    if (context.mode === "code") replaceCodeRange(context.sourceRange, "", true);
    else replaceVisualRange("", true);
  }, [editorContextMenu, replaceCodeRange, replaceVisualRange]);

  const selectAllEditorText = useCallback(() => {
    if (effectiveEditorMode === "code") {
      const view = editorViewRef.current;
      if (!view) return;
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      view.focus();
      return;
    }
    const paper = document.querySelector<HTMLElement>(".writer-editor.is-visual .visual-latex-paper");
    if (!paper) return;
    const range = document.createRange();
    range.selectNodeContents(paper);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    visualContextRangeRef.current = range.cloneRange();
  }, [effectiveEditorMode]);

  const jumpToPdfFromContext = useCallback(async () => {
    const context = editorContextMenu;
    if (!project || !activePath || !context) return;
    setPdfSyncError("");
    try {
      const position = await findWriterPdfPosition(project.rootPath, activePath, context.sourceLine);
      const stage = pdfStageRef.current;
      const pageNode = pdfPageRefs.current[position.page];
      const canvas = pageNode?.querySelector("canvas");
      const pageSize = pdfPageSizes[position.page];
      if (!stage || !pageNode) throw new Error("PDF 预览尚未就绪，请稍候重试。");
      const renderedY = canvas && pageSize ? (position.y / pageSize.height) * canvas.clientHeight : 0;
      stage.scrollTo({ top: Math.max(0, pageNode.offsetTop + renderedY - stage.clientHeight * 0.32), behavior: "smooth" });
      setPdfPage(position.page);
      setPdfSyncStatus({ page: position.page, filePath: activePath, line: context.sourceLine });
    } catch (nextError) {
      setPdfSyncError(errorMessage(nextError));
    }
  }, [activePath, editorContextMenu, pdfPageSizes, project]);

  const addCommentFromContext = useCallback(() => {
    const selection = editorContextMenu?.selection;
    if (!selection?.quote) throw new Error("请先选中需要评论的文本。");
    setSourceSelection(selection);
    setRightView("comments");
  }, [editorContextMenu?.selection]);

  const suggestEditsFromContext = useCallback(() => {
    const selection = editorContextMenu?.selection;
    if (!selection?.quote || !activePath) throw new Error("请先选中需要审阅的文本。");
    const excerpt = selection.quote.length > 4_000 ? `${selection.quote.slice(0, 4_000)}\n…（选区已截断）` : selection.quote;
    setAgentPendingPrompt({
      id: crypto.randomUUID(),
      content: `请审阅并提出可执行的修改建议。若需要改写，请给出可直接替换的 LaTeX 文本。\n\n当前文件：${activePath}\n\n选中内容：\n${excerpt}`,
    });
    setRightView("agent");
  }, [activePath, editorContextMenu?.selection]);

  const runEditorContextAction = useCallback(async (action: () => void | Promise<void>) => {
    try {
      await action();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setEditorContextMenu(null);
    }
  }, []);

  const openSourceRange = useCallback((filePath: string, from: number, to: number, quote: string) => {
    changeEditorMode("code");
    void openFile(filePath).then(() => {
      window.setTimeout(() => {
        const view = editorViewRef.current;
        if (!view) return;
        let end = Math.min(to, view.state.doc.length);
        let start = Math.min(from, end);
        if (view.state.sliceDoc(start, end) !== quote) {
          const content = view.state.doc.toString();
          const candidates: number[] = [];
          let cursor = content.indexOf(quote);
          while (cursor >= 0) { candidates.push(cursor); cursor = content.indexOf(quote, cursor + 1); }
          const nearest = candidates.sort((left, right) => Math.abs(left - from) - Math.abs(right - from))[0];
          if (nearest !== undefined) { start = nearest; end = nearest + quote.length; }
        }
        view.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true });
        view.focus();
      }, 140);
    });
  }, [changeEditorMode, openFile]);

  const openSourceLine = useCallback(async (filePath: string, line: number) => {
    changeEditorMode("code");
    await openFile(filePath);
    window.setTimeout(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const targetLine = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
      view.dispatch({
        selection: { anchor: targetLine.from },
        effects: EditorView.scrollIntoView(targetLine.from, { y: "center" }),
      });
      view.focus();
    }, 140);
  }, [changeEditorMode, openFile]);

  const locatePdfSource = useCallback(async (page: number, event: ReactMouseEvent<HTMLDivElement>) => {
    if (!project) return;
    const canvas = event.currentTarget.querySelector("canvas");
    const pageSize = pdfPageSizes[page];
    if (!canvas || !pageSize) return;
    const bounds = canvas.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    if (localX < 0 || localY < 0 || localX > bounds.width || localY > bounds.height) return;
    setPdfSyncError("");
    try {
      const pdfX = (localX / bounds.width) * pageSize.width;
      const pdfY = (localY / bounds.height) * pageSize.height;
      const position = await findWriterSourcePosition(
        project.rootPath,
        page,
        pdfX,
        pdfY,
      );
      setPdfSyncStatus({ page, filePath: position.filePath, line: position.line });
      await openSourceLine(position.filePath, position.line);
    } catch (nextError) {
      setPdfSyncError(errorMessage(nextError));
    }
  }, [openSourceLine, pdfPageSizes, project]);

  const updateCurrentPdfPage = useCallback(() => {
    const stage = pdfStageRef.current;
    if (!stage || pdfPageCount <= 0) return;
    const stageBounds = stage.getBoundingClientRect();
    const targetY = stageBounds.top + Math.min(180, stageBounds.height * 0.28);
    let nearestPage = 1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let page = 1; page <= pdfPageCount; page += 1) {
      const pageNode = pdfPageRefs.current[page];
      if (!pageNode) continue;
      const distance = Math.abs(pageNode.getBoundingClientRect().top - targetY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = page;
      }
    }
    setPdfPage(nearestPage);
  }, [pdfPageCount]);

  const scrollPdfToPage = useCallback((page: number) => {
    const stage = pdfStageRef.current;
    const pageNode = pdfPageRefs.current[page];
    if (!stage || !pageNode) return;
    stage.scrollTo({ top: Math.max(0, pageNode.offsetTop - 14), behavior: "smooth" });
    setPdfPage(page);
  }, []);

  const restoreVersion = useCallback(async (versionId: string) => {
    if (!project || !mainFile) return;
    await flushTrackedRevisions();
    await saveAll();
    await createWriterVersion(rootPath, mainFile, "恢复前自动备份", "恢复历史版本前的项目状态");
    await restoreWriterVersion(versionId);
    const nextProject = await openWriterProject(rootPath, mainFile);
    const nextPath = activePath && nextProject.files.some((file) => file.path === activePath) ? activePath : nextProject.mainFile || mainFile;
    const entries = await Promise.all(nextProject.files.filter((file) => file.editable).map(async (file) => [file.path, await readWriterFile(rootPath, file.path)] as const));
    setProject(nextProject);
    setActivePath(nextPath);
    setTabs((current) => {
      const retained = current.filter((path) => entries.some(([entryPath]) => entryPath === path));
      return retained.includes(nextPath) ? retained : [...retained, nextPath];
    });
    setBuffers(Object.fromEntries(entries.map(([path, content]) => [path, { content, savedContent: content, saving: false }])));
    trackedSessionsRef.current = {};
    setReviewRefreshToken((value) => value + 1);
  }, [activePath, flushTrackedRevisions, mainFile, project, rootPath, saveAll]);

  const applyRevision = useCallback(async (revision: WriterRevision, status: "accepted" | "rejected") => {
    const content = status === "accepted" ? revision.afterContent : revision.beforeContent;
    window.clearTimeout(revisionTimersRef.current[revision.filePath]);
    delete revisionTimersRef.current[revision.filePath];
    await flushTrackedRevisions();
    // Flush the editor buffer before the backend compares the on-disk file
    // with the revision's after-content. Otherwise a just-typed local change
    // can be mistaken for an external conflict.
    await saveAll();
    await applyWriterRevision(revision.id, status);
    if (trackedSessionsRef.current[revision.filePath]?.id === revision.id) {
      delete trackedSessionsRef.current[revision.filePath];
    }
    setBuffers((current) => ({ ...current, [revision.filePath]: { content, savedContent: content, saving: false } }));
    setTabs((current) => current.includes(revision.filePath) ? current : [...current, revision.filePath]);
    setActivePath(revision.filePath);
    setReviewRefreshToken((value) => value + 1);
  }, [flushTrackedRevisions, saveAll]);

  const applyAgentChanges = useCallback(async (changes: AgentFileChange[]) => {
    if (!project) return;
    await saveAll();
    const allowed = new Set(project.files.filter((file) => file.editable).map((file) => file.path));
    const safeChanges = changes
      .map((change) => ({ ...change, path: change.path.replaceAll("\\", "/").replace(/^\.\//, "") }))
      .filter((change) => allowed.has(change.path) && !change.path.split("/").includes("..") && !change.path.startsWith("/"));
    if (!safeChanges.length) throw new Error("Agent 返回的文件不在当前项目中，未应用修改。");
    for (const change of safeChanges) {
      const before = buffers[change.path]?.content ?? await readWriterFile(rootPath, change.path);
      if (before === change.content) continue;
      await writeWriterFile(rootPath, change.path, change.content);
      await saveWriterRevision({ id: crypto.randomUUID(), projectId: project.id, filePath: change.path, beforeContent: before, afterContent: change.content });
    }
    const refreshed = await Promise.all(safeChanges.map(async (change) => [change.path, await readWriterFile(rootPath, change.path)] as const));
    setBuffers((current) => {
      const next = { ...current };
      for (const [path, content] of refreshed) next[path] = { content, savedContent: content, saving: false };
      return next;
    });
    setTabs((current) => Array.from(new Set([...current, ...safeChanges.map((change) => change.path)])));
    setActivePath(safeChanges[0].path);
    setReviewRefreshToken((value) => value + 1);
  }, [buffers, project, rootPath, saveAll]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void saveAll().catch(() => undefined), 700);
    return () => window.clearTimeout(timer);
  }, [dirty, saveAll]);

  const compile = useCallback(async () => {
    if (!project || !mainFile || compiling) return;
    setCompiling(true);
    setError("");
    setCompileStatus("idle");
    try {
      await saveAll();
      const result = await compileWriterProject(project.rootPath, mainFile, engine);
      setCompileStatus(result.status);
      setDiagnostics(result.diagnostics);
      setLog(result.log);
      setLogOpen(result.status !== "success" || result.diagnostics.length > 0);
      if (result.pdfAvailable) {
        setPdfBytes(await readWriterPdf(project.rootPath));
        setPdfPage(1);
        setPdfPageSizes({});
        setPdfSyncError("");
        setPdfSyncStatus(null);
        window.setTimeout(() => pdfStageRef.current?.scrollTo({ top: 0 }), 0);
      }
    } catch (nextError) {
      setCompileStatus("failure");
      setError(errorMessage(nextError));
      setLogOpen(true);
    } finally {
      setCompiling(false);
    }
  }, [compiling, engine, mainFile, project, saveAll]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveAll().catch(() => undefined);
      } else if (event.key === "Enter") {
        event.preventDefault();
        void compile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compile, saveAll]);

  const closeTab = (path: string) => {
    setTabs((current) => {
      const next = current.filter((item) => item !== path);
      if (activePath === path) setActivePath(next.at(-1) || null);
      return next;
    });
  };

  const scrollEditorPage = (direction: -1 | 1) => {
    if (effectiveEditorMode === "visual") {
      visualEditorScrollRef.current?.scrollBy({
        top: direction * Math.max(180, (visualEditorScrollRef.current?.clientHeight || 400) * 0.82),
        behavior: "smooth",
      });
      return;
    }
    const view = editorViewRef.current;
    if (!view) return;
    view.focus();
    (direction < 0 ? cursorPageUp : cursorPageDown)(view);
  };

  const setEditorScrollTop = (top: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    view.scrollDOM.scrollTop = Math.max(0, Math.min(editorScroll.max, top));
    updateEditorScroll(view);
  };

  const moveEditorScrollbar = (clientY: number, track: HTMLDivElement) => {
    if (editorScroll.max <= 0) return;
    const bounds = track.getBoundingClientRect();
    const thumbRatio = Math.max(0.06, Math.min(1, editorScroll.viewport / editorScroll.content));
    const thumbHeight = bounds.height * thumbRatio;
    const travel = Math.max(1, bounds.height - thumbHeight);
    const thumbTop = Math.max(0, Math.min(travel, clientY - bounds.top - editorScrollDragOffsetRef.current));
    setEditorScrollTop((thumbTop / travel) * editorScroll.max);
  };

  const editorThumbRatio = Math.max(0.06, Math.min(1, editorScroll.viewport / editorScroll.content));
  const editorThumbTop = editorScroll.max > 0
    ? (editorScroll.top / editorScroll.max) * (1 - editorThumbRatio)
    : 0;

  if (loading) {
    return <main className="writer-loading"><LoaderCircle className="is-spinning" size={22} /><span>正在打开写作项目</span></main>;
  }

  return (
    <main className="writer-shell">
      <header className="writer-toolbar">
        <div className="writer-project-title">
          <IconButton label="返回写作项目库" onClick={() => void saveAll().then(onClose).catch(() => undefined)}><Home size={17} /></IconButton>
          <span><FileCode2 size={17} /></span>
          <div><strong>{project?.name || "LaTeX 项目"}</strong><small>{activePath || rootPath}</small></div>
        </div>
        <div className="writer-compile-settings">
          <select aria-label="主文档" value={mainFile} onChange={(event) => setMainFile(event.target.value)}>
            {project?.files.filter((file) => file.kind === "tex").map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
          </select>
          <select aria-label="LaTeX 引擎" value={engine} onChange={(event) => setEngine(event.target.value as LatexEngine)}>
            {(["pdflatex", "xelatex", "lualatex"] as LatexEngine[]).map((item) => <option key={item} value={item} disabled={runtime.available && !runtime.engines.includes(item)}>{item}</option>)}
          </select>
        </div>
        <div className="writer-toolbar-actions">
          {runtime.available ? (
            <span className="writer-runtime-status is-ready" title={runtime.version || runtime.latexmkPath}>
              <Check size={13} />{runtime.distribution || "TeX Ready"}
            </span>
          ) : (
            <button className="writer-runtime-status is-missing" type="button" disabled={installingRuntime} onClick={() => void installRuntime()}>
              {installingRuntime ? <LoaderCircle className="is-spinning" size={13} /> : <AlertCircle size={13} />}
              {installingRuntime ? `安装中 ${installProgress.percent}%` : "安装 TeX 环境"}
            </button>
          )}
          <button className={`writer-track-toggle ${trackChanges ? "is-active" : ""}`} type="button" aria-pressed={trackChanges} onClick={toggleTrackChanges} title="修订模式">
            <ScanText size={14} />{trackChanges ? "修订中" : "修订"}
          </button>
          <IconButton label={effectiveEditorMode === "visual" ? "在可视化工具栏中添加评论" : "为源码选区添加评论"} disabled={effectiveEditorMode === "visual"} onClick={captureSourceSelection}><MessageSquare size={16} /></IconButton>
          <IconButton label="保存" disabled={!dirty || Object.values(buffers).some((buffer) => buffer.saving)} onClick={() => void saveAll().catch(() => undefined)}>{Object.values(buffers).some((buffer) => buffer.saving) ? <LoaderCircle className="is-spinning" size={16} /> : <Save size={16} />}</IconButton>
          <button className="writer-compile-button" type="button" disabled={!runtime.available || !mainFile || compiling} onClick={() => void compile()}>
            {compiling ? <><LoaderCircle className="is-spinning" size={15} />编译中</> : <><Play size={15} fill="currentColor" />编译</>}
          </button>
          <IconButton label="打开 LaTeX 文件" onClick={() => void saveAll().then(onOpenFile).catch(() => undefined)}><FilePlus2 size={17} /></IconButton>
          <IconButton label="打开其他写作项目" onClick={() => void saveAll().then(onOpenProject).catch(() => undefined)}><FolderOpen size={17} /></IconButton>
        </div>
      </header>

      <div ref={writerBodyRef} className={`writer-body ${filePanelCollapsed ? "is-file-panel-collapsed" : ""} ${resizingDivider !== null ? "is-resizing" : ""}`} style={writerBodyStyle}>
        <aside ref={(element) => { writerColumnRefs.current[0] = element; }} className={`writer-file-panel ${filePanelCollapsed ? "is-collapsed" : ""}`}>
          <header>
            <strong>项目文件</strong>
            {!filePanelCollapsed && <IconButton label="刷新项目" onClick={() => void refreshProject()}><RefreshCw size={14} /></IconButton>}
            <IconButton label={filePanelCollapsed ? "展开项目文件" : "收起项目文件"} onClick={toggleFilePanel}>
              {filePanelCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </IconButton>
          </header>
          <div className="writer-file-list">
            {project?.files.map((file) => (
              <button
                type="button"
                key={file.path}
                className={activePath === file.path ? "is-active" : ""}
                disabled={!file.editable}
                title={file.path}
                onClick={() => void openFile(file.path)}
              >
                {fileIcon(file.kind)}<span>{file.path}</span>{buffers[file.path]?.content !== buffers[file.path]?.savedContent && <b />}
              </button>
            ))}
          </div>
          <footer>
            <span>{project?.files.length || 0} 个文件</span>
            <button type="button" onClick={() => void refreshRuntime()}><RefreshCw size={12} />检测环境</button>
          </footer>
        </aside>

        <section ref={(element) => { writerColumnRefs.current[1] = element; }} className="writer-editor-column">
          <div className="writer-editor-header">
            <div className="writer-tabs">
              {tabs.map((path) => (
                <button type="button" key={path} className={activePath === path ? "is-active" : ""} onClick={() => setActivePath(path)}>
                  <Code2 size={13} /><span>{path.split("/").at(-1)}</span>{buffers[path]?.content !== buffers[path]?.savedContent && <b />}
                  <i role="button" tabIndex={0} aria-label={`关闭 ${path}`} onClick={(event) => { event.stopPropagation(); closeTab(path); }}><X size={12} /></i>
                </button>
              ))}
            </div>
            <div className="writer-editor-mode-switch" role="group" aria-label="编辑模式">
              <button type="button" className={effectiveEditorMode === "code" ? "is-active" : ""} aria-pressed={effectiveEditorMode === "code"} onClick={() => changeEditorMode("code")}>Code</button>
              <button type="button" className={effectiveEditorMode === "visual" ? "is-active" : ""} aria-pressed={effectiveEditorMode === "visual"} disabled={!visualModeAvailable} title={visualModeAvailable ? "可视化编辑" : "Visual 仅支持 .tex 文件"} onClick={() => changeEditorMode("visual")}>Visual</button>
            </div>
            <div className="writer-editor-scroll-actions" aria-label={effectiveEditorMode === "visual" ? "文档翻页" : "源码翻页"}>
              <IconButton label="向上翻页" disabled={!activeBuffer} onClick={() => scrollEditorPage(-1)}><ChevronUp size={15} /></IconButton>
              <IconButton label="向下翻页" disabled={!activeBuffer} onClick={() => scrollEditorPage(1)}><ChevronDown size={15} /></IconButton>
            </div>
          </div>
          <div
            className={`writer-editor ${effectiveEditorMode === "visual" ? "is-visual" : "is-code"}`}
            onContextMenu={openEditorContextMenu}
            onWheel={(event) => {
              if (effectiveEditorMode === "visual") return;
              const view = editorViewRef.current;
              if (!view || event.deltaY === 0) return;
              const previous = view.scrollDOM.scrollTop;
              view.scrollDOM.scrollTop += event.deltaY;
              if (view.scrollDOM.scrollTop !== previous) {
                event.preventDefault();
                event.stopPropagation();
                updateEditorScroll(view);
              }
            }}
          >
            {activePath && activeBuffer && effectiveEditorMode === "visual" ? (
              <VisualLatexEditor
                key={activePath}
                source={activeBuffer.content}
                onChange={handleEditorChange}
                onAddComment={captureVisualSelection}
                scrollRef={visualEditorScrollRef}
              />
            ) : activePath && activeBuffer ? (
              <div className="code-latex-editor">
                <CodeLatexToolbar editorRef={editorViewRef} onAddComment={captureSourceSelection} />
                <CodeMirror
                  key={activePath}
                  value={activeBuffer.content}
                  height="100%"
                  extensions={latexExtensions}
                  basicSetup={{ foldGutter: true, highlightActiveLine: true, highlightActiveLineGutter: true }}
                  onCreateEditor={attachEditor}
                  onChange={handleEditorChange}
                />
              </div>
            ) : (
              <div className="writer-editor-empty"><FileCode2 size={28} /><span>从项目文件中打开 LaTeX 文档</span></div>
            )}
            {effectiveEditorMode === "code" && activePath && activeBuffer && (
              <div
                className={`writer-editor-scrollbar ${editorScroll.max <= 0 ? "is-disabled" : ""}`}
                role="scrollbar"
                aria-label="源码纵向滚动条"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={Math.round(editorScroll.max)}
                aria-valuenow={Math.round(editorScroll.top)}
                tabIndex={editorScroll.max > 0 ? 0 : -1}
                onPointerDown={(event) => {
                  const thumb = event.currentTarget.querySelector<HTMLElement>(".writer-editor-scroll-thumb");
                  const thumbBounds = thumb?.getBoundingClientRect();
                  editorScrollDragOffsetRef.current = thumbBounds && event.clientY >= thumbBounds.top && event.clientY <= thumbBounds.bottom
                    ? event.clientY - thumbBounds.top
                    : (event.currentTarget.clientHeight * editorThumbRatio) / 2;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  moveEditorScrollbar(event.clientY, event.currentTarget);
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) moveEditorScrollbar(event.clientY, event.currentTarget);
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onKeyDown={(event) => {
                  const page = Math.max(160, editorScroll.viewport * 0.82);
                  const next = event.key === "ArrowUp" ? editorScroll.top - 48
                    : event.key === "ArrowDown" ? editorScroll.top + 48
                      : event.key === "PageUp" ? editorScroll.top - page
                        : event.key === "PageDown" ? editorScroll.top + page
                          : event.key === "Home" ? 0
                            : event.key === "End" ? editorScroll.max
                              : null;
                  if (next === null) return;
                  event.preventDefault();
                  setEditorScrollTop(next);
                }}
              >
                <span
                  className="writer-editor-scroll-thumb"
                  style={{ height: `${editorThumbRatio * 100}%`, top: `${editorThumbTop * 100}%` }}
                />
              </div>
            )}
          </div>
          {editorContextMenu && (
            <div
              className="writer-editor-context-menu"
              role="menu"
              aria-label="编辑菜单"
              style={{ left: editorContextMenu.x, top: editorContextMenu.y }}
              onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button type="button" role="menuitem" disabled={!editorContextMenu.selection?.quote} onClick={() => void runEditorContextAction(cutEditorSelection)}><Scissors size={15} /><span>剪切</span><kbd>⌘X</kbd></button>
              <button type="button" role="menuitem" disabled={!editorContextMenu.selection?.quote} onClick={() => void runEditorContextAction(copyEditorSelection)}><Copy size={15} /><span>复制</span><kbd>⌘C</kbd></button>
              <button type="button" role="menuitem" onClick={() => void runEditorContextAction(pasteIntoEditor)}><ClipboardPaste size={15} /><span>粘贴</span><kbd>⌘V</kbd></button>
              <button type="button" role="menuitem" onClick={() => void runEditorContextAction(pasteIntoEditor)}><ClipboardPaste size={15} /><span>保留格式粘贴</span><kbd>⌥⇧⌘V</kbd></button>
              <div className="writer-editor-context-divider" role="separator" />
              <button type="button" role="menuitem" onClick={() => void runEditorContextAction(selectAllEditorText)}><Check size={15} /><span>全选</span><kbd>⌘A</kbd></button>
              <button type="button" role="menuitem" onClick={() => void runEditorContextAction(deleteEditorSelection)}><Trash2 size={15} /><span>删除</span><kbd>⌫</kbd></button>
              <div className="writer-editor-context-divider" role="separator" />
              <button type="button" role="menuitem" onClick={() => void runEditorContextAction(jumpToPdfFromContext)}><MapPin size={15} /><span>跳转至 PDF 对应位置</span></button>
              <button type="button" role="menuitem" disabled={!editorContextMenu.selection?.quote} onClick={() => void runEditorContextAction(suggestEditsFromContext)}><WandSparkles size={15} /><span>建议修改</span></button>
              <button type="button" role="menuitem" disabled={!editorContextMenu.selection?.quote} onClick={() => void runEditorContextAction(addCommentFromContext)}><MessageSquare size={15} /><span>添加评论</span></button>
            </div>
          )}
          <div className={`writer-log-panel ${logOpen ? "is-open" : ""}`}>
            <button type="button" className="writer-log-handle" onClick={() => setLogOpen((value) => !value)}>
              <span><PanelBottom size={14} />问题与日志</span>
              <b>{diagnostics.length}</b>
              {compileStatus !== "idle" && <em className={`is-${compileStatus}`}>{compileStatus === "success" ? "成功" : compileStatus === "timedout" ? "超时" : "失败"}</em>}
            </button>
            {logOpen && (
              <div className="writer-log-content">
                {error && <div className="writer-error"><AlertCircle size={14} />{error}</div>}
                {diagnostics.length > 0 && <div className="writer-diagnostics">{diagnostics.map((item, index) => <button type="button" key={`${item.file}:${item.line}:${index}`} onClick={() => item.file && void openFile(item.file)}><AlertCircle size={13} /><span>{item.message}</span><small>{item.file}{item.line ? `:${item.line}` : ""}</small></button>)}</div>}
                <pre>{log || "尚未运行编译。"}</pre>
              </div>
            )}
          </div>
        </section>

        <section ref={(element) => { writerColumnRefs.current[2] = element; }} className="writer-preview" aria-label="PDF 预览">
          <header>
            <span><FileText size={14} />PDF 预览</span>
            {pdfPageCount > 0 && <div><IconButton label="上一页" disabled={pdfPage <= 1} onClick={() => scrollPdfToPage(pdfPage - 1)}><ChevronUp size={15} /></IconButton><span>{pdfPage} / {pdfPageCount}</span><IconButton label="下一页" disabled={pdfPage >= pdfPageCount} onClick={() => scrollPdfToPage(pdfPage + 1)}><ChevronDown size={15} /></IconButton></div>}
          </header>
          <div ref={pdfStageRef} className="writer-preview-stage" onScroll={updateCurrentPdfPage}>
            {pdfSyncError && <div className="writer-pdf-sync-error"><AlertCircle size={13} /><span>{pdfSyncError}</span><button type="button" aria-label="关闭 PDF 定位错误" onClick={() => setPdfSyncError("")}><X size={12} /></button></div>}
            {pdfSource ? (
              <Document file={pdfSource} onLoadSuccess={(pdf) => { setPdfPageCount(pdf.numPages); setPdfPage(1); }} loading={<LoaderCircle className="is-spinning" size={22} />}>
                <div className="writer-preview-pages">
                  {Array.from({ length: pdfPageCount }, (_, index) => index + 1).map((page) => (
                    <div
                      key={page}
                      ref={(node) => { pdfPageRefs.current[page] = node; }}
                      className={`writer-preview-page ${pdfPage === page ? "is-current" : ""}`}
                      aria-label={`PDF 第 ${page} 页`}
                      title="定位到 LaTeX 源码"
                      onClick={(event) => void locatePdfSource(page, event)}
                    >
                      <Page
                        pageNumber={page}
                        width={pdfRenderWidth}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        onLoadSuccess={(pdfPageProxy) => {
                          const [left, top, right, bottom] = pdfPageProxy.view;
                          setPdfPageSizes((current) => ({
                            ...current,
                            [page]: { width: Math.abs(right - left), height: Math.abs(bottom - top) },
                          }));
                        }}
                        loading={<LoaderCircle className="is-spinning" size={18} />}
                      />
                    </div>
                  ))}
                </div>
              </Document>
            ) : runtime.available ? (
              <div className="writer-preview-empty"><FileText size={34} /><strong>尚未生成 PDF</strong></div>
            ) : (
              <div className="writer-runtime-empty">
                <TerminalSquare size={34} />
                <strong>{installingRuntime ? "正在配置本地 TeX 环境" : "需要本地 TeX 环境"}</strong>
                {installingRuntime ? (
                  <>
                    <p>{installProgress.message}</p>
                    <div className="writer-runtime-progress" role="progressbar" aria-label="TeX 环境安装进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={installProgress.percent}>
                      <span style={{ width: `${installProgress.percent}%` }} />
                    </div>
                    <small>
                      {installProgress.phase === "downloading" && installProgress.totalBytes > 0
                        ? `${formatBytes(installProgress.downloadedBytes)} / ${formatBytes(installProgress.totalBytes)}`
                        : `${installProgress.percent}%`}
                    </small>
                  </>
                ) : (
                  <>
                    <p>安装由 WhalePaper 管理的 TinyTeX，约 70 MB，无需管理员权限，也不会修改系统环境。</p>
                    {installError && <div className="writer-runtime-install-error"><AlertCircle size={13} />{installError}</div>}
                    <div className="writer-runtime-actions">
                      <button className="is-primary" type="button" onClick={() => void installRuntime()}><Download size={14} />{installError ? "重试安装" : "安装本地 TeX 环境"}</button>
                      <button type="button" onClick={() => void refreshRuntime()}><RefreshCw size={14} />重新检测</button>
                    </div>
                  </>
                )}
              </div>
            )}
            {pdfSyncStatus && (
              <span className="writer-visually-hidden" role="status" aria-live="polite">
                {`PDF 第 ${pdfSyncStatus.page} 页已定位到 ${pdfSyncStatus.filePath}:${pdfSyncStatus.line}`}
              </span>
            )}
          </div>
        </section>

        <section ref={(element) => { writerColumnRefs.current[3] = element; }} className="writer-side-panel" aria-label="写作辅助">
          <header>
            <div className="writer-right-tabs">
              <button type="button" className={rightView === "agent" ? "is-active" : ""} onClick={() => setRightView("agent")}><Bot size={13} />Agent</button>
              <button type="button" className={rightView === "comments" ? "is-active" : ""} onClick={() => setRightView("comments")}><MessageSquare size={13} />评论</button>
              <button type="button" className={rightView === "versions" ? "is-active" : ""} onClick={() => setRightView("versions")}><History size={13} />历史</button>
              <button type="button" className={rightView === "revisions" ? "is-active" : ""} onClick={() => setRightView("revisions")}><GitCompareArrows size={13} />修订</button>
            </div>
          </header>
          {rightView === "agent" && project ? <WriterAgentPanel
            project={project}
            rootPath={rootPath}
            activePath={activePath}
            defaultRuntime={aiSettings.agentRuntime}
            agentAccess={aiSettings.agentAccess}
            agentPaths={aiSettings.agentPaths}
            agentThirdParty={aiSettings.agentThirdParty}
            configuredModels={aiSettings.availableModels}
            files={Object.fromEntries(Object.entries(buffers).map(([path, buffer]) => [path, buffer.content]))}
            onSaveAll={saveAll}
            onApplyChanges={applyAgentChanges}
            onOpenSettings={() => onOpenSettings("runtime")}
            pendingPrompt={agentPendingPrompt || undefined}
            onPendingPromptHandled={() => setAgentPendingPrompt(null)}
          /> : project && rightView !== "agent" && <WriterReviewSidebar
            mode={rightView}
            project={project}
            rootPath={rootPath}
            mainFile={mainFile}
            activePath={activePath}
            activeContent={activeBuffer?.content || ""}
            selectedRange={sourceSelection}
            refreshToken={reviewRefreshToken}
            onCaptureSelection={captureSourceSelection}
            onOpenRange={openSourceRange}
            onRestoreVersion={restoreVersion}
            onApplyRevision={applyRevision}
            onSaveAll={saveAll}
          />}
        </section>
        {dividerOffsets.map((offset, index) => {
          const divider = index as WriterColumnDivider;
          const disabled = filePanelCollapsed && divider === 0;
          const labels = ["调整项目文件与编辑器宽度", "调整编辑器与 PDF 预览宽度", "调整 PDF 预览与写作辅助宽度"];
          return <div
            key={divider}
            className={`writer-column-resizer ${resizingDivider === divider ? "is-active" : ""} ${disabled ? "is-disabled" : ""}`}
            role="separator"
            aria-label={labels[divider]}
            aria-orientation="vertical"
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : 0}
            title={disabled ? "展开项目文件后可调整宽度" : "拖动调整宽度，双击恢复默认布局"}
            style={{ left: offset }}
            onPointerDown={(event) => startColumnResize(event, divider)}
            onDoubleClick={() => { if (!disabled) resetWriterColumnLayout(); }}
            onKeyDown={(event) => {
              if (disabled || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
              event.preventDefault();
              resizeWriterColumns(divider, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 56 : 24));
            }}
          />;
        })}
      </div>
    </main>
  );
}
