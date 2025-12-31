/**
 * Bubble Notifier Types
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

export interface BubbleMessage {
  id: string;
  content: string;
  paperId: string;
  source: 'arxiv' | 'huggingface';
  title: string;
  score: number;
  timestamp: Date;
}

export interface BubbleNotifierProps {
  /** Current message to display */
  message: BubbleMessage | null;
  /** Callback when bubble is clicked */
  onBubbleClick?: (paperId: string) => void;
  /** Callback when bubble is dismissed */
  onDismiss?: () => void;
  /** Auto-dismiss timeout in milliseconds (default: 60000) */
  autoDismissTimeout?: number;
  /** Position relative to avatar */
  position?: 'top' | 'top-left' | 'top-right';
}

export interface BubbleNotifierState {
  /** Queue of messages to display */
  queue: BubbleMessage[];
  /** Currently displayed message */
  currentMessage: BubbleMessage | null;
  /** Whether the bubble is visible */
  isVisible: boolean;
}

/**
 * Generate bubble content from a scored paper
 * Property 8: Bubble Message Content Completeness
 * The message content SHALL contain: source, topic/title, and score
 */
export function generateBubbleContent(message: BubbleMessage): string {
  const sourceLabel = message.source === 'arxiv' ? '📚 ArXiv' : '🤗 HuggingFace';
  return `${sourceLabel} | ${message.title} | ⭐ ${message.score.toFixed(1)}`;
}

/**
 * Create a BubbleMessage from paper data
 */
export function createBubbleMessage(
  paperId: string,
  title: string,
  source: 'arxiv' | 'huggingface',
  score: number
): BubbleMessage {
  const message: BubbleMessage = {
    id: `bubble-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    paperId,
    title,
    source,
    score,
    content: '', // Will be generated
    timestamp: new Date(),
  };
  message.content = generateBubbleContent(message);
  return message;
}
