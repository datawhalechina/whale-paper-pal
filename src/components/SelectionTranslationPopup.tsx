import { useEffect, useRef, useState } from "react";
import { Check, Copy, GripHorizontal, Languages, X } from "lucide-react";
import { IconButton } from "./IconButton";
import { MarkdownContent } from "./MarkdownContent";

export type SelectionTranslationPopupState = {
  id: string;
  x: number;
  y: number;
  source: string;
  status: "loading" | "ready" | "error";
  response: string;
};

type SelectionTranslationPopupProps = {
  value: SelectionTranslationPopupState;
  onClose: () => void;
};

export function SelectionTranslationPopup({ value, onClose }: SelectionTranslationPopupProps) {
  const [position, setPosition] = useState({ x: value.x, y: value.y });
  const [copied, setCopied] = useState(false);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    setPosition({ x: value.x, y: value.y });
    setCopied(false);
  }, [value.id, value.x, value.y]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: Math.min(window.innerWidth - 110, Math.max(110, event.clientX - dragRef.current.offsetX)),
        y: Math.min(window.innerHeight - 30, Math.max(30, event.clientY - dragRef.current.offsetY)),
      });
    };
    const stop = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  const copyTranslation = async () => {
    if (!value.response) return;
    await navigator.clipboard.writeText(value.response);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section
      className={`selection-translation-popup ${position.y < 230 ? "is-below" : ""}`}
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="划句翻译"
    >
      <header
        onPointerDown={(event) => {
          const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!bounds) return;
          event.preventDefault();
          dragRef.current = { offsetX: event.clientX - bounds.left - bounds.width / 2, offsetY: event.clientY - position.y };
        }}
      >
        <Languages size={15} />
        <strong>翻译</strong>
        <GripHorizontal className="selection-translation-grip" size={14} />
        <div>
          <IconButton label="复制翻译" disabled={!value.response} onClick={() => void copyTranslation()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </IconButton>
          <IconButton label="关闭翻译" onClick={onClose}><X size={14} /></IconButton>
        </div>
      </header>
      <blockquote>{value.source}</blockquote>
      {value.status === "loading"
        ? <div className="selection-translation-loading" role="status" aria-live="polite"><i /><i /><i /><span>正在翻译，请稍等…</span></div>
        : <MarkdownContent className={value.status === "error" ? "selection-translation-error" : "selection-translation-content"} content={value.response} />}
    </section>
  );
}
