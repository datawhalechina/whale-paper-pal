/**
 * Chat Interface Component
 * RAG-based conversation interface for paper Q&A
 *
 * Requirements:
 * - 8.1: Inject paper's Abstract into conversation context
 * - 8.2: Support free-form Q&A about paper content
 * - 8.3: Support quick commands ("看公式", "看代码链接")
 * - 8.4: Maintain conversation history within session
 * - 8.5: Clear conversation context on close
 */

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatMessageComponent } from './ChatMessage';
import { PDFProcessingStatusComponent } from './PDFProcessingStatus';
import {
  type ChatInterfaceProps,
  type QuickCommand,
  QUICK_COMMANDS,
  isQuickCommand,
} from './types';

// Animation variants
const panelVariants = {
  hidden: {
    opacity: 0,
    x: 20,
    transition: { duration: 0.2 },
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 300, damping: 25 },
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: { duration: 0.15 },
  },
};

export function ChatInterface({
  isOpen,
  context,
  onClose,
  onSendMessage,
  onQuickCommand,
}: ChatInterfaceProps) {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMainWindow, setIsMainWindow] = useState(false);
  const [processingStatus, setProcessingStatus] = useState(context?.processingStatus || null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Check if we're in main window mode
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    setIsMainWindow(mode === 'main');
  }, []);

  // Poll PDF processing status
  useEffect(() => {
    if (!context || !isOpen) {
      // Clear polling when chat is closed
      if (statusPollingRef.current) {
        clearInterval(statusPollingRef.current);
        statusPollingRef.current = null;
      }
      return;
    }

    // Start polling if PDF processing is in progress
    const shouldPoll = context.pdfUrl && 
      (!processingStatus || 
       processingStatus.isDownloading || 
       processingStatus.isProcessing || 
       (!processingStatus.isComplete && !processingStatus.errorMessage));

    if (shouldPoll) {
      // Poll every 2 seconds
      statusPollingRef.current = setInterval(async () => {
        try {
          // Use API client for consistent error handling
          const { getApiClient } = await import('../../api/client');
          const apiClient = getApiClient();
          const apiStatus = await apiClient.getPDFStatus(context.paperId);
          
          // Map API response to PDFProcessingStatus format
          const status = {
            isDownloading: apiStatus.is_downloading,
            isProcessing: apiStatus.is_processing,
            isComplete: apiStatus.is_complete,
            progress: apiStatus.progress,
            errorMessage: apiStatus.error_message,
            totalChunks: apiStatus.total_chunks,
            processedChunks: apiStatus.processed_chunks,
          };
          
          setProcessingStatus(status);
          
          // Stop polling if processing is complete or failed
          if (status.isComplete || status.errorMessage) {
            if (statusPollingRef.current) {
              clearInterval(statusPollingRef.current);
              statusPollingRef.current = null;
            }
          }
        } catch (error) {
          console.error('Failed to poll PDF status:', error);
        }
      }, 2000);
    }

    // Cleanup on unmount or context change
    return () => {
      if (statusPollingRef.current) {
        clearInterval(statusPollingRef.current);
        statusPollingRef.current = null;
      }
    };
  }, [context, isOpen, processingStatus]);

  // Update processing status when context changes
  useEffect(() => {
    if (context?.processingStatus) {
      setProcessingStatus(context.processingStatus);
    }
  }, [context?.processingStatus]);

  // Scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [context?.history, scrollToBottom]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle sending a message
  const handleSend = async () => {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isLoading || !onSendMessage) return;

    setInputValue('');
    setIsLoading(true);

    try {
      // Check if it's a quick command
      if (isQuickCommand(trimmedInput) && onQuickCommand) {
        await onQuickCommand(trimmedInput);
      } else {
        await onSendMessage(trimmedInput);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle key press (Enter to send)
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle quick command click
  const handleQuickCommandClick = async (command: QuickCommand) => {
    if (isLoading || !onQuickCommand) return;

    setIsLoading(true);
    try {
      await onQuickCommand(command);
    } catch (error) {
      console.error('Failed to execute quick command:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && context && (
        <>
          {isMainWindow ? (
            // Main window mode - full overlay
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <div className="w-full max-w-4xl h-[90vh] mx-6">
                <div className="glass-dark rounded-2xl shadow-2xl h-full flex flex-col overflow-hidden">
                  {/* Header */}
                  <div className="px-6 py-4 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl">💬</span>
                        <div className="min-w-0">
                          <h3 className="text-white font-semibold truncate text-lg">
                            {context.paperTitle}
                          </h3>
                          <p className="text-white/50 text-sm">论文对话</p>
                        </div>
                      </div>
                      <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors flex-shrink-0"
                        aria-label="关闭对话"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Context info (abstract preview) */}
                  <div className="px-6 py-3 bg-white/5 border-b border-white/10 flex-shrink-0">
                    <p className="text-white/60 text-sm line-clamp-3">
                      📄 {context.abstract}
                    </p>
                  </div>

                  {/* PDF Processing Status */}
                  {processingStatus && 
                   (processingStatus.isDownloading || 
                    processingStatus.isProcessing || 
                    processingStatus.errorMessage ||
                    !processingStatus.isComplete) && (
                    <PDFProcessingStatusComponent
                      status={processingStatus}
                      paperTitle={context.paperTitle}
                    />
                  )}

                  {/* Messages area - larger in main window */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    {context.history.length === 0 ? (
                      <div className="text-center py-12">
                        <span className="text-4xl mb-4 block">🤖</span>
                        <p className="text-white/60 text-lg">
                          有什么想了解的？问我吧！
                        </p>
                      </div>
                    ) : (
                      context.history.map((message) => (
                        <ChatMessageComponent key={message.id} message={message} />
                      ))
                    )}
                    
                    {/* Loading indicator */}
                    {isLoading && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex justify-start"
                      >
                        <div className="bg-white/10 rounded-2xl rounded-bl-sm px-6 py-3">
                          <div className="flex gap-2">
                            <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </motion.div>
                    )}
                    
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Quick commands */}
                  <div className="px-6 py-3 border-t border-white/10 flex-shrink-0">
                    <div className="flex gap-3">
                      {QUICK_COMMANDS.map((command) => (
                        <button
                          key={command}
                          onClick={() => handleQuickCommandClick(command)}
                          disabled={isLoading}
                          className="px-4 py-2 text-sm bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {command}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Input area - larger in main window */}
                  <div className="px-6 py-4 border-t border-white/10 flex-shrink-0">
                    <div className="flex gap-3">
                      <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="输入问题..."
                        disabled={isLoading}
                        className="flex-1 bg-white/10 text-white placeholder-white/40 rounded-full px-6 py-3 text-base focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50"
                      />
                      <button
                        onClick={handleSend}
                        disabled={!inputValue.trim() || isLoading}
                        className="w-12 h-12 flex items-center justify-center bg-purple-500 hover:bg-purple-600 text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="发送"
                      >
                        ➤
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // Modal mode - original overlay layout
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Backdrop */}
              <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
              />

              {/* Chat panel */}
              <motion.div
                className="relative z-10 w-full max-w-xl h-[70vh] mx-4"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="glass-dark rounded-2xl shadow-2xl h-full flex flex-col overflow-hidden">
                  {/* Header */}
                  <div className="px-4 py-3 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl">💬</span>
                        <div className="min-w-0">
                          <h3 className="text-white font-semibold truncate text-sm">
                            {context.paperTitle}
                          </h3>
                          <p className="text-white/50 text-xs">论文对话</p>
                        </div>
                      </div>
                      <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors flex-shrink-0"
                        aria-label="关闭对话"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Context info (abstract preview) */}
                  <div className="px-4 py-2 bg-white/5 border-b border-white/10 flex-shrink-0">
                    <p className="text-white/60 text-xs line-clamp-2">
                      📄 {context.abstract.slice(0, 150)}...
                    </p>
                  </div>

                  {/* PDF Processing Status */}
                  {processingStatus && 
                   (processingStatus.isDownloading || 
                    processingStatus.isProcessing || 
                    processingStatus.errorMessage ||
                    !processingStatus.isComplete) && (
                    <PDFProcessingStatusComponent
                      status={processingStatus}
                      paperTitle={context.paperTitle}
                    />
                  )}

                  {/* Messages area */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {context.history.length === 0 ? (
                      <div className="text-center py-8">
                        <span className="text-3xl mb-2 block">🤖</span>
                        <p className="text-white/60 text-sm">
                          有什么想了解的？问我吧！
                        </p>
                      </div>
                    ) : (
                      context.history.map((message) => (
                        <ChatMessageComponent key={message.id} message={message} />
                      ))
                    )}
                    
                    {/* Loading indicator */}
                    {isLoading && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex justify-start"
                      >
                        <div className="bg-white/10 rounded-2xl rounded-bl-sm px-4 py-2">
                          <div className="flex gap-1">
                            <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </motion.div>
                    )}
                    
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Quick commands (Requirement 8.3) */}
                  <div className="px-4 py-2 border-t border-white/10 flex-shrink-0">
                    <div className="flex gap-2">
                      {QUICK_COMMANDS.map((command) => (
                        <button
                          key={command}
                          onClick={() => handleQuickCommandClick(command)}
                          disabled={isLoading}
                          className="px-3 py-1 text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {command}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Input area */}
                  <div className="px-4 py-3 border-t border-white/10 flex-shrink-0">
                    <div className="flex gap-2">
                      <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="输入问题..."
                        disabled={isLoading}
                        className="flex-1 bg-white/10 text-white placeholder-white/40 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50"
                      />
                      <button
                        onClick={handleSend}
                        disabled={!inputValue.trim() || isLoading}
                        className="w-10 h-10 flex items-center justify-center bg-purple-500 hover:bg-purple-600 text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="发送"
                      >
                        ➤
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

export default ChatInterface;
