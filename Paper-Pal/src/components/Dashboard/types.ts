/**
 * Dashboard Panel Types
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

export interface PaperCard {
  id: string;
  title: string;
  score: number;
  tags: string[];
  oneLiner: string;
  pros: string[];
  cons: string[];
  url: string;
  // 扩展字段用于详情展示
  abstract?: string;
  authors?: string[];
  published?: string;
  source?: 'arxiv' | 'huggingface';
  relevance_score?: number;
  novelty_score?: number;
}

export interface DashboardPanelProps {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback to close the panel */
  onClose: () => void;
  /** List of papers to display */
  papers: PaperCard[];
  /** Callback when "稍后读" is clicked */
  onSaveForLater?: (paperId: string) => Promise<boolean> | boolean | void;
  /** Callback when "Chat" is clicked */
  onOpenChat?: (paperId: string) => void;
  /** Callback when "阅读全文" is clicked */
  onReadFullText?: (paperUrl: string) => void;
  /** Callback when paper card is clicked to show details */
  onPaperClick?: (paperId: string) => void;
  /** Callback when a paper is removed from saved (for state sync) */
  onRemoveFromSaved?: (paperId: string) => void;
}

export interface PaperCardProps {
  paper: PaperCard;
  /** Callback when "稍后读" is clicked - returns Promise<boolean> for success/failure */
  onSaveForLater?: (paperId: string) => Promise<boolean> | boolean | void;
  /** Callback when "Chat" is clicked */
  onOpenChat?: (paperId: string) => void;
  /** Callback when "阅读全文" is clicked */
  onReadFullText?: (paperUrl: string) => void;
  /** Callback when paper card is clicked to show details */
  onPaperClick?: (paperId: string) => void;
  /** Whether to show the save button (default: true) */
  showSaveButton?: boolean;
  /** Whether this card is displayed in the saved papers list (changes button behavior) */
  isInSavedList?: boolean;
}

/**
 * Render a PaperCard to a display string containing all required fields
 * Property 12: Dashboard Paper Display Completeness
 * All papers SHALL be rendered with visible title, score, tags, and one-liner
 */
export function renderPaperCardContent(paper: PaperCard): string {
  const tagsStr = paper.tags.join(', ');
  return `${paper.title} | ⭐ ${paper.score.toFixed(1)} | [${tagsStr}] | ${paper.oneLiner}`;
}

/**
 * Validate that a PaperCard has all required display fields
 */
export function validatePaperCardDisplay(paper: PaperCard): {
  hasTitle: boolean;
  hasScore: boolean;
  hasTags: boolean;
  hasOneLiner: boolean;
  isComplete: boolean;
} {
  const hasTitle = paper.title.trim().length > 0;
  const hasScore = typeof paper.score === 'number' && !isNaN(paper.score);
  const hasTags = Array.isArray(paper.tags);
  const hasOneLiner = paper.oneLiner.trim().length > 0;

  return {
    hasTitle,
    hasScore,
    hasTags,
    hasOneLiner,
    isComplete: hasTitle && hasScore && hasTags && hasOneLiner,
  };
}
