import type { RightPanelTab } from "../types";
import { BadgeCheck, PanelRightClose, PanelRightOpen } from "lucide-react";
import { IconButton } from "./IconButton";
import withAiIcon from "../assets/reader-icons/main-icon-feature-with-ai.svg";
import quizIcon from "../assets/reader-icons/main-icon-feature-quiz.svg";
import highlightSidebarIcon from "../assets/reader-icons/main-icon-feature-highlight-sidebar.svg";
import explanationIcon from "../assets/reader-icons/main-icon-feature-explanation.svg";
import translationIcon from "../assets/reader-icons/main-icon-feature-translation.svg";
import citationIcon from "../assets/reader-icons/main-icon-feature-citation.svg";
import commentIcon from "../assets/reader-icons/main-icon-feature-comment.svg";
import noteIcon from "../assets/reader-icons/main-icon-feature-note.svg";

type ReaderToolRailProps = {
  activeTab: RightPanelTab;
  panelOpen: boolean;
  onSelect: (tab: RightPanelTab) => void;
  onToggle: () => void;
};

const TOOLS: Array<{ id: RightPanelTab; label: string; asset: string }> = [
  { id: "assistant", label: "与AI一起", asset: withAiIcon },
  { id: "quiz", label: "问答游戏", asset: quizIcon },
  { id: "highlights", label: "高亮", asset: highlightSidebarIcon },
  { id: "explain", label: "解释", asset: explanationIcon },
  { id: "translation", label: "划句翻译", asset: translationIcon },
  { id: "citations", label: "引用卡片", asset: citationIcon },
  { id: "peer-reviews", label: "公开评审", asset: "" },
  { id: "comments", label: "评论", asset: commentIcon },
  { id: "notes", label: "笔记", asset: noteIcon },
];

export function ReaderToolRail({ activeTab, panelOpen, onSelect, onToggle }: ReaderToolRailProps) {
  return (
    <nav className="reader-tool-rail" aria-label="论文工具">
      <IconButton className="reader-tool-toggle" label={panelOpen ? "关闭右侧栏" : "打开右侧栏"} onClick={onToggle}>
        {panelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
      </IconButton>
      <span className="reader-tool-divider" aria-hidden="true" />
      {TOOLS.map((tool) => (
        <span className="reader-tool-item" key={tool.id}>
          <IconButton label={tool.label} active={panelOpen && activeTab === tool.id} onClick={() => onSelect(tool.id)}>
            {tool.asset ? <img src={tool.asset} alt="" /> : <BadgeCheck className="reader-tool-peer-review-icon" size={18} strokeWidth={1.8} />}
          </IconButton>
        </span>
      ))}
    </nav>
  );
}
