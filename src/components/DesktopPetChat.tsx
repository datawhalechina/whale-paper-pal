import { useRef, useState, type ReactNode } from "react";
import { SendHorizontal, Square } from "lucide-react";
import type { ChatMessage } from "../types";
import type { DesktopPetContext } from "../lib/desktop-pet";

type DesktopPetChatProps = {
  avatar: ReactNode;
  messages: ChatMessage[];
  context: DesktopPetContext | null;
  loading: boolean;
  error: string;
  notice?: string;
  onSend: (value: string) => void;
  onStop: () => void;
};

export function DesktopPetChat({
  avatar,
  messages,
  context,
  loading,
  error,
  notice,
  onSend,
  onStop,
}: DesktopPetChatProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const value = draft.trim();
    if (!value || loading) return;
    setDraft("");
    onSend(value);
  };

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const dialogText = error
    || latestAssistant?.content
    || notice
    || (context?.title ? "我已经读到当前论文和页码。想从哪里开始？" : "我在。可以和我聊论文、研究思路或学术写作。");

  return (
    <section className="desktop-pet-chat" aria-label="WhalePaper 对话">
      <div className="desktop-pet-character-stage">
        {avatar}

        <section className={`desktop-pet-dialog ${error ? "is-error" : ""}`} aria-live="polite" aria-busy={loading}>
          <div className="desktop-pet-dialog-caption">
            <strong>Whale</strong>
            {loading && <span>正在思考</span>}
          </div>
          {loading ? (
            <div className="desktop-pet-thinking" role="status"><span /><span /><span /><small>正在思考</small></div>
          ) : (
            <p>{dialogText}</p>
          )}
        </section>
      </div>

      <form className="desktop-pet-chat-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          maxLength={2000}
          placeholder={context?.title ? "问问当前论文…" : "问一个科研问题…"}
          aria-label="对话内容"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />
        {loading ? (
          <button type="button" className="is-stop" onClick={onStop} aria-label="停止生成" title="停止生成"><Square size={13} fill="currentColor" /></button>
        ) : (
          <button type="submit" disabled={!draft.trim()} aria-label="发送" title="发送"><SendHorizontal size={16} /></button>
        )}
      </form>
    </section>
  );
}
