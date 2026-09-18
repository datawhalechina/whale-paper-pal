import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Hand,
  Highlighter,
  Image,
  Languages,
  Menu,
  Minus,
  PanelRight,
  PanelLeft,
  PenLine,
  Plus,
  Search,
  MousePointer2,
  Moon,
  RotateCw,
  Sun,
} from "lucide-react";
import type { DocumentTheme, ReaderMode } from "../types";
import { IconButton } from "./IconButton";

type TopToolbarProps = {
  filename: string;
  currentPage: number;
  pageCount: number;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  theme: DocumentTheme;
  mode: ReaderMode;
  leftOpen: boolean;
  rightOpen: boolean;
  discoveryOpen: boolean;
  onToggleDiscovery: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpen: () => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onRotate: () => void;
  onThemeChange: (theme: DocumentTheme) => void;
  onModeChange: (mode: ReaderMode) => void;
  onTranslatePage: () => void;
  onAutoHighlight: () => void;
  onCaptureImage: () => void;
  onExport: () => void;
  onSearch: () => void;
};

export function TopToolbar(props: TopToolbarProps) {
  const clampPage = (value: number) => Math.min(props.pageCount, Math.max(1, value || 1));
  const nextTheme: DocumentTheme = props.theme === "original" ? "sepia" : props.theme === "sepia" ? "night" : "original";
  return (
    <header className="top-toolbar" data-tauri-drag-region>
      <div className="toolbar-group toolbar-document">
        {!props.discoveryOpen && <IconButton label="展开相关论文" onClick={props.onToggleDiscovery}><PanelLeft size={18} /></IconButton>}
        <IconButton label="切换左侧栏" onClick={props.onToggleLeft} active={props.leftOpen}><Menu size={18} /></IconButton>
        <IconButton label="打开 PDF" onClick={props.onOpen}><FolderOpen size={18} /></IconButton>
        <span className="document-name" title={props.filename}>{props.filename}</span>
      </div>

      <div className="toolbar-group toolbar-navigation">
        <IconButton label="上一页" disabled={props.currentPage <= 1} onClick={() => props.onPageChange(props.currentPage - 1)}>
          <ChevronLeft size={17} />
        </IconButton>
        <label className="page-control">
          <input
            key={props.currentPage}
            defaultValue={props.currentPage}
            aria-label="当前页"
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onPageChange(clampPage(Number(event.currentTarget.value)));
            }}
            onBlur={(event) => props.onPageChange(clampPage(Number(event.currentTarget.value)))}
          />
          <span>/ {props.pageCount}</span>
        </label>
        <IconButton label="下一页" disabled={props.currentPage >= props.pageCount} onClick={() => props.onPageChange(props.currentPage + 1)}>
          <ChevronRight size={17} />
        </IconButton>
      </div>

      <div className="toolbar-group toolbar-view">
        <IconButton label="选择文本" active={props.mode === "select"} onClick={() => props.onModeChange("select")}><MousePointer2 size={17} /></IconButton>
        <IconButton label="拖动页面" active={props.mode === "pan"} onClick={() => props.onModeChange("pan")}><Hand size={17} /></IconButton>
        <IconButton label="手写画笔" active={props.mode === "draw" || props.mode === "erase"} onClick={() => props.onModeChange(props.mode === "draw" || props.mode === "erase" ? "select" : "draw")}><PenLine size={17} /></IconButton>
        <span className="toolbar-divider" />
        <IconButton label="缩小" disabled={props.zoom <= 0.65} onClick={() => props.onZoomChange(Math.max(0.65, props.zoom - 0.1))}>
          <Minus size={17} />
        </IconButton>
        <button className="zoom-value" type="button" title="重置为适应宽度" onClick={() => props.onZoomChange(1)}>
          {props.zoom === 1 ? "适应宽度" : `${Math.round(props.zoom * 100)}%`}
        </button>
        <IconButton label="放大" disabled={props.zoom >= 2.5} onClick={() => props.onZoomChange(Math.min(2.5, props.zoom + 0.1))}>
          <Plus size={17} />
        </IconButton>
        <IconButton label={`顺时针旋转（当前 ${props.rotation}°）`} onClick={props.onRotate}><RotateCw size={17} /></IconButton>
        <IconButton label={`切换文档主题（当前${props.theme === "original" ? "原色" : props.theme === "sepia" ? "护眼" : "夜间"}）`} onClick={() => props.onThemeChange(nextTheme)}>
          {props.theme === "night" ? <Sun size={17} /> : <Moon size={17} />}
        </IconButton>
        <span className="toolbar-divider" />
        <IconButton label="搜索" onClick={props.onSearch}><Search size={17} /></IconButton>
        <IconButton label="翻译当前页" onClick={props.onTranslatePage}><Languages size={17} /></IconButton>
        <IconButton label="自动高亮当前页" onClick={props.onAutoHighlight}><Highlighter size={17} /></IconButton>
        <IconButton label="框选图片并解释" active={props.mode === "image"} onClick={props.onCaptureImage}><Image size={17} /></IconButton>
        <IconButton label="导出" onClick={props.onExport}><Download size={17} /></IconButton>
        <IconButton label="切换右侧栏" onClick={props.onToggleRight} active={props.rightOpen}><PanelRight size={18} /></IconButton>
      </div>
    </header>
  );
}
