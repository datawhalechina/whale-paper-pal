/**
 * Chat Interface Types
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ChatContext {
  paperId: string;
  paperTitle: string;
  abstract: string;
  pdfUrl?: string;
  history: ChatMessage[];
  isPdfProcessed?: boolean;
  processingStatus?: PDFProcessingStatus;
}

export interface PDFProcessingStatus {
  isDownloading: boolean;
  isProcessing: boolean;
  isComplete: boolean;
  progress: number; // 0.0 to 1.0
  errorMessage?: string;
  totalChunks: number;
  processedChunks: number;
}

export type QuickCommand = '看公式' | '看代码链接';

export interface ChatInterfaceProps {
  /** Whether the chat is open */
  isOpen: boolean;
  /** Current chat context */
  context: ChatContext | null;
  /** Callback to close the chat */
  onClose: () => void;
  /** Callback to send a message */
  onSendMessage?: (content: string) => Promise<ChatMessage>;
  /** Callback for quick commands */
  onQuickCommand?: (command: QuickCommand) => Promise<ChatMessage>;
}

export interface ChatInterfaceState {
  /** Current context (null when closed) */
  context: ChatContext | null;
  /** Whether the chat is open */
  isOpen: boolean;
  /** Whether a message is being sent */
  isLoading: boolean;
}

/**
 * Valid quick commands that the chat interface recognizes
 * Property 11: Quick Command Recognition
 */
export const QUICK_COMMANDS: QuickCommand[] = ['看公式', '看代码链接'];

/**
 * Check if a string is a valid quick command
 * Property 11: Quick Command Recognition
 */
export function isQuickCommand(input: string): input is QuickCommand {
  return QUICK_COMMANDS.includes(input as QuickCommand);
}

/**
 * Create a new chat message
 */
export function createChatMessage(
  role: 'user' | 'assistant',
  content: string
): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role,
    content,
    timestamp: new Date(),
  };
}

/**
 * Create a new chat context for a paper
 * Property 10: Chat Context Lifecycle - On open: context SHALL contain the paper's abstract
 */
export function createChatContext(
  paperId: string,
  paperTitle: string,
  abstract: string,
  pdfUrl?: string
): ChatContext {
  return {
    paperId,
    paperTitle,
    abstract,
    pdfUrl,
    history: [],
    isPdfProcessed: false,
    processingStatus: {
      isDownloading: false,
      isProcessing: false,
      isComplete: false,
      progress: 0.0,
      totalChunks: 0,
      processedChunks: 0,
    },
  };
}

/**
 * Add a message to the chat history
 * Property 10: Chat Context Lifecycle - During session: history SHALL contain all messages in order
 */
export function addMessageToHistory(
  context: ChatContext,
  message: ChatMessage
): ChatContext {
  return {
    ...context,
    history: [...context.history, message],
  };
}

/**
 * Clear the chat context
 * Property 10: Chat Context Lifecycle - On close: context and history SHALL be cleared
 */
export function clearChatContext(): null {
  return null;
}

/**
 * Validate chat context state
 * Property 10: Chat Context Lifecycle
 */
export function validateChatContextState(
  context: ChatContext | null,
  isOpen: boolean
): {
  hasAbstract: boolean;
  historyInOrder: boolean;
  isCleared: boolean;
  isValid: boolean;
} {
  if (!isOpen && context === null) {
    // Closed state - should be cleared
    return {
      hasAbstract: false,
      historyInOrder: true,
      isCleared: true,
      isValid: true,
    };
  }

  if (isOpen && context !== null) {
    // Open state - should have abstract and ordered history
    const hasAbstract = context.abstract.trim().length > 0;
    
    // Check history is in chronological order
    let historyInOrder = true;
    for (let i = 1; i < context.history.length; i++) {
      if (context.history[i].timestamp < context.history[i - 1].timestamp) {
        historyInOrder = false;
        break;
      }
    }

    return {
      hasAbstract,
      historyInOrder,
      isCleared: false,
      isValid: hasAbstract && historyInOrder,
    };
  }

  // Invalid state: open without context or closed with context
  return {
    hasAbstract: false,
    historyInOrder: false,
    isCleared: false,
    isValid: false,
  };
}
