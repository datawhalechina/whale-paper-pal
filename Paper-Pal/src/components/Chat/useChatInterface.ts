/**
 * Chat Interface Hook
 * Manages RAG conversation state and logic
 *
 * Requirements:
 * - 8.1: Inject paper's Abstract into conversation context (open)
 * - 8.4: Maintain conversation history within session
 * - 8.5: Clear conversation context on close
 */

import { useState, useCallback } from 'react';
import {
  type ChatContext,
  type ChatMessage,
  type QuickCommand,
  createChatContext,
  createChatMessage,
  addMessageToHistory,
  clearChatContext,
} from './types';

interface UseChatInterfaceOptions {
  /** Callback to send message to LLM backend */
  onLLMRequest?: (
    message: string,
    context: ChatContext
  ) => Promise<string>;
  /** Callback for quick command processing */
  onQuickCommandRequest?: (
    command: QuickCommand,
    context: ChatContext
  ) => Promise<string>;
  /** Callback to start PDF processing */
  onStartPDFProcessing?: (
    paperId: string,
    pdfUrl: string
  ) => Promise<void>;
  /** Callback to get PDF processing status */
  onGetProcessingStatus?: (
    paperId: string
  ) => Promise<any>;
}

interface UseChatInterfaceReturn {
  /** Current chat context */
  context: ChatContext | null;
  /** Whether the chat is open */
  isOpen: boolean;
  /** Whether a request is in progress */
  isLoading: boolean;
  /** Open chat with paper context (Requirement 8.1) */
  open: (paperId: string, paperTitle: string, abstract: string, pdfUrl?: string) => void;
  /** Close chat and clear context (Requirement 8.5) */
  close: () => void;
  /** Send a message (Requirement 8.4) */
  sendMessage: (content: string) => Promise<ChatMessage | null>;
  /** Handle quick command (Requirement 8.3) */
  handleQuickCommand: (command: QuickCommand) => Promise<ChatMessage | null>;
  /** Clear conversation history */
  clearHistory: () => void;
  /** Start PDF processing */
  startPDFProcessing: () => Promise<void>;
  /** Update processing status */
  updateProcessingStatus: (status: any) => void;
}

/**
 * Hook for managing chat interface state and logic
 * Property 10: Chat Context Lifecycle
 */
export function useChatInterface(
  options: UseChatInterfaceOptions = {}
): UseChatInterfaceReturn {
  const { onLLMRequest, onQuickCommandRequest, onStartPDFProcessing } = options;

  const [context, setContext] = useState<ChatContext | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Open chat with paper context
   * Property 10: On open - context SHALL contain the paper's abstract
   */
  const open = useCallback(
    (paperId: string, paperTitle: string, abstract: string, pdfUrl?: string) => {
      const newContext = createChatContext(paperId, paperTitle, abstract, pdfUrl);
      setContext(newContext);
      setIsOpen(true);
      
      // Start PDF processing if URL is provided
      if (pdfUrl && onStartPDFProcessing) {
        onStartPDFProcessing(paperId, pdfUrl).catch(error => {
          console.error('Failed to start PDF processing:', error);
        });
      }
    },
    [onStartPDFProcessing]
  );

  /**
   * Close chat and clear context
   * Property 10: On close - context and history SHALL be cleared
   */
  const close = useCallback(() => {
    setIsOpen(false);
    setContext(clearChatContext());
  }, []);

  /**
   * Send a message and get response
   * Property 10: During session - history SHALL contain all messages in order
   */
  const sendMessage = useCallback(
    async (content: string): Promise<ChatMessage | null> => {
      if (!context || !content.trim()) return null;

      setIsLoading(true);

      try {
        // Create user message
        const userMessage = createChatMessage('user', content);
        
        // Add user message to history
        const contextWithUserMsg = addMessageToHistory(context, userMessage);
        setContext(contextWithUserMsg);

        // Get LLM response
        let responseContent = '抱歉，暂时无法连接到 AI 服务。';
        
        if (onLLMRequest) {
          try {
            responseContent = await onLLMRequest(content, contextWithUserMsg);
          } catch (error) {
            console.error('LLM request failed:', error);
            responseContent = '请求失败，请稍后重试。';
          }
        } else {
          responseContent = '聊天功能需要连接后端服务。';
        }

        // Create assistant message
        const assistantMessage = createChatMessage('assistant', responseContent);
        
        // Add assistant message to history
        const finalContext = addMessageToHistory(contextWithUserMsg, assistantMessage);
        setContext(finalContext);

        return assistantMessage;
      } finally {
        setIsLoading(false);
      }
    },
    [context, onLLMRequest]
  );

  /**
   * Handle quick command
   * Requirement 8.3: Support quick commands
   */
  const handleQuickCommand = useCallback(
    async (command: QuickCommand): Promise<ChatMessage | null> => {
      if (!context) return null;

      setIsLoading(true);

      try {
        // Create user message for the command
        const userMessage = createChatMessage('user', command);
        
        // Add user message to history
        const contextWithUserMsg = addMessageToHistory(context, userMessage);
        setContext(contextWithUserMsg);

        // Get response for quick command
        let responseContent = '';
        
        if (onQuickCommandRequest) {
          try {
            responseContent = await onQuickCommandRequest(command, contextWithUserMsg);
          } catch (error) {
            console.error('Quick command request failed:', error);
            responseContent = '快捷指令执行失败，请稍后重试。';
          }
        } else {
          responseContent = '快捷指令功能需要连接后端服务。';
        }

        // Create assistant message
        const assistantMessage = createChatMessage('assistant', responseContent);
        
        // Add assistant message to history
        const finalContext = addMessageToHistory(contextWithUserMsg, assistantMessage);
        setContext(finalContext);

        return assistantMessage;
      } finally {
        setIsLoading(false);
      }
    },
    [context, onQuickCommandRequest]
  );

  /**
   * Clear conversation history while keeping context
   */
  const clearHistory = useCallback(() => {
    if (context) {
      setContext({
        ...context,
        history: [],
      });
    }
  }, [context]);

  /**
   * Start PDF processing
   */
  const startPDFProcessing = useCallback(async () => {
    if (!context?.pdfUrl || !onStartPDFProcessing) return;
    
    try {
      await onStartPDFProcessing(context.paperId, context.pdfUrl);
    } catch (error) {
      console.error('Failed to start PDF processing:', error);
    }
  }, [context, onStartPDFProcessing]);

  /**
   * Update processing status
   */
  const updateProcessingStatus = useCallback((status: any) => {
    if (context) {
      setContext({
        ...context,
        processingStatus: status,
        isPdfProcessed: status.isComplete,
      });
    }
  }, [context]);

  return {
    context,
    isOpen,
    isLoading,
    open,
    close,
    sendMessage,
    handleQuickCommand,
    clearHistory,
    startPDFProcessing,
    updateProcessingStatus,
  };
}

export default useChatInterface;
