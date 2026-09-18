import { Copy, Languages, LoaderCircle, Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { PageTranslation, TranslationSegment } from "../types";
import { IconButton } from "./IconButton";
import { useResizablePanel } from "./useResizablePanel";
import { useEffect, useRef } from "react";

// A separate key prevents a width saved by the old three-panel reader from
// making the focused translation view start with an unusably wide pane.
const TRANSLATION_PANEL_STORAGE_KEY = "whale-paper:translation-panel-width-v2";
const LINK_PATTERN = /(https?:\/\/[^\s<>'"，。；！？）】]+|www\.[^\s<>'"，。；！？）】]+|(?:doi:\s*)?10\.\d{4,9}\/[\w.()/:;+-]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/gi;

function renderRichText(value: string) {
  return value.split(LINK_PATTERN).map((part, index) => {
    const isLink = /^(?:https?:\/\/|www\.|doi:\s*10\.\d{4,9}\/|10\.\d{4,9}\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i.test(part);
    if (!part || !isLink) return <span key={`${part}-${index}`}>{part}</span>;
    const href = part.includes("@") && !/^https?:/i.test(part)
      ? `mailto:${part}`
      : /^10\.\d{4,9}\//i.test(part) || /^doi:/i.test(part)
        ? `https://doi.org/${part.replace(/^doi:\s*/i, "")}`
        : /^www\./i.test(part) ? `https://${part}` : part;
    return <a key={`${part}-${index}`} href={href} target="_blank" rel="noreferrer">{part}</a>;
  });
}

function translationPanelMaxWidth(panel: HTMLElement): number {
  const parentWidth = panel.parentElement?.clientWidth || window.innerWidth;
  // Keep a usable reading canvas beside the translation pane. The old
  // persisted width could consume most of the window and make a two-column
  // PDF look like a narrow vertical page.
  return Math.max(300, Math.min(
    620,
    Math.floor(window.innerWidth * 0.44),
    parentWidth - 520,
  ));
}

type TranslationPaneProps = {
  currentPage: number;
  pageCount: number;
  translation?: PageTranslation;
  fontSize: number;
  autoTranslateEnabled: boolean;
  loading: boolean;
  error?: string;
  onFontSizeChange: (size: number) => void;
  onAutoTranslateChange: (enabled: boolean) => void;
  onRetranslate: () => void;
  onDelete: () => void;
  onClose: () => void;
  activeSegmentId?: string | null;
  onSegmentActivate: (segment: TranslationSegment, clicked: boolean) => void;
};

export function TranslationPane(props: TranslationPaneProps) {
  const segmentRefs = useRef(new Map<string, HTMLDivElement>());
  const translationPanelResize = useResizablePanel({
    storageKey: TRANSLATION_PANEL_STORAGE_KEY,
    defaultWidth: 440,
    minWidth: 300,
    edge: "left",
    label: "调整对照翻译栏宽度",
    getMaxWidth: translationPanelMaxWidth,
  });

  useEffect(() => {
    if (!props.activeSegmentId) return;
    segmentRefs.current.get(props.activeSegmentId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [props.activeSegmentId]);
  const segments = props.translation?.segments || [];
  const specialCount = segments.filter((segment) => segment.kind && segment.kind !== "text").length;
  const kindLabel: Record<NonNullable<TranslationSegment["kind"]>, string> = {
    text: "译文",
    "figure-caption": "图题",
    table: "表题",
    formula: "公式说明",
    footnote: "脚注",
  };

  return (
    <aside ref={translationPanelResize.panelRef} className="translation-pane" style={translationPanelResize.panelStyle}>
      <div {...translationPanelResize.resizerProps}><span /></div>
      <header>
        <div className="translation-header-main">
          <div className="translation-pane-title"><Languages size={16} /><strong>对照翻译</strong></div>
          <div className="auto-translate-control">
            <span>自动</span>
            <button
              type="button"
              role="switch"
              aria-checked={props.autoTranslateEnabled}
              aria-label={props.autoTranslateEnabled ? "关闭自动翻译" : "开启自动翻译"}
              className={props.autoTranslateEnabled ? "is-on" : ""}
              onClick={() => props.onAutoTranslateChange(!props.autoTranslateEnabled)}
            >
              {props.autoTranslateEnabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>
        <span className="translation-page-position">{props.currentPage} / {props.pageCount}</span>
        <IconButton label="关闭对照翻译" onClick={props.onClose}><X size={16} /></IconButton>
      </header>
      <div className="translation-toolbar">
        <div className="translation-font-stepper" aria-label="译文字号">
          <IconButton label="减小译文字号" disabled={props.fontSize <= 12} onClick={() => props.onFontSizeChange(Math.max(12, props.fontSize - 1))}><Minus size={14} /></IconButton>
          <span>{props.fontSize}px</span>
          <IconButton label="增大译文字号" disabled={props.fontSize >= 24} onClick={() => props.onFontSizeChange(Math.min(24, props.fontSize + 1))}><Plus size={14} /></IconButton>
        </div>
        <div>
          <IconButton label="重新翻译当前页" disabled={props.loading} onClick={props.onRetranslate}>
            {props.loading ? <LoaderCircle className="is-spinning" size={14} /> : <RotateCcw size={14} />}
          </IconButton>
          <IconButton label="复制当前页译文" disabled={!props.translation} onClick={() => props.translation && void navigator.clipboard.writeText(props.translation.content)}><Copy size={14} /></IconButton>
          <IconButton label="删除当前页译文" disabled={!props.translation} onClick={props.onDelete}><Trash2 size={14} /></IconButton>
        </div>
      </div>
      {props.error && (
        <div className="translation-error" role="alert">
          <span>{props.error}</span>
          <button type="button" disabled={props.loading} onClick={props.onRetranslate}>重试</button>
        </div>
      )}
      {props.translation ? (
        <article className="translation-content" style={{ fontSize: props.fontSize }}>
          <div className="translation-language-pair"><span>{props.translation.sourceLanguage}</span><b>→</b><span>{props.translation.targetLanguage}</span></div>
          <div className="translation-layout-hint">按阅读顺序整段翻译，保留标题、图表说明、公式和脚注；图片见左侧原文。</div>
          {specialCount > 0 && <div className="translation-layout-note"><span>图表与注释</span><small>{specialCount} 组译文</small></div>}
          <div className="translation-block-list">
            {segments.length ? segments.map((segment) => {
              const kind = segment.kind || "text";
              return (
                <section key={segment.id} className={`translation-block translation-block-${kind}`}>
                  {kind !== "text" && <div className="translation-block-heading">{kindLabel[kind]}</div>}
                  <div
                    ref={(element) => {
                      if (element) segmentRefs.current.set(segment.id, element);
                      else segmentRefs.current.delete(segment.id);
                    }}
                    className={`translation-block-target translation-segment ${props.activeSegmentId === segment.id ? "is-active" : ""}`}
                    onMouseEnter={() => props.onSegmentActivate(segment, false)}
                    onFocus={() => props.onSegmentActivate(segment, false)}
                    onClick={() => props.onSegmentActivate(segment, true)}
                    tabIndex={0}
                  >
                    {renderRichText(segment.targetText)}
                  </div>
                </section>
              );
            }) : (
              <section className="translation-block translation-block-text">
                <p className="translation-block-target">{renderRichText(props.translation.content)}</p>
              </section>
            )}
          </div>
          <time>{new Date(props.translation.updatedAt).toLocaleString()}</time>
        </article>
      ) : props.loading ? (
        <div className="translation-empty is-loading" aria-live="polite">
          <LoaderCircle className="is-spinning" size={25} />
          <strong>正在翻译第 {props.currentPage} 页</strong>
          <span>{props.autoTranslateEnabled ? "翻页后会继续自动翻译" : "正在生成对照译文"}</span>
        </div>
      ) : (
        <div className="translation-empty">
          <Languages size={25} />
          <strong>当前页还没有译文</strong>
          <button type="button" className="primary-button compact" disabled={props.loading} onClick={props.onRetranslate}>翻译第 {props.currentPage} 页</button>
        </div>
      )}
    </aside>
  );
}
