'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { Avatar } from '@/components/Avatar/Avatar';
import { AvatarContextMenu } from '@/components/Avatar/AvatarContextMenu';
import { BubbleNotifier } from '@/components/Bubble';
import { DashboardPanel } from '@/components/Dashboard/DashboardPanel';
import { ChatInterface } from '@/components/Chat/ChatInterface';
import { ToastContainer } from '@/components/UI/Toast';
import MainWindowSettings from '@/components/Settings/MainWindowSettings';
import { useBubbleNotifier } from '@/components/Bubble/useBubbleNotifier';
import { useChatInterface } from '@/components/Chat/useChatInterface';
import { useToast } from '@/hooks/useToast';
import { usePapers, useNotifications, useApiHealth, useSavedPapers } from '@/hooks/useApi';
import { getApiClient } from '@/api/client';
import { createBubbleMessage } from '@/components/Bubble/types';
import type { PaperCard } from '@/components/Dashboard';

export default function Home() {
  const { 
    initializeFromConfig, 
    currentPaperId,
    setCurrentPaperId,
    isChatOpen,
    setChatOpen,
    setAvatarState,
    skinScale,
  } = useAppStore();
  
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  
  // Use separate state for main window detection to avoid hydration mismatch
  const [isMainWindow, setIsMainWindow] = useState(false);
  const [isMainWindowReady, setIsMainWindowReady] = useState(false);
  const [isWindowModeDetected, setIsWindowModeDetected] = useState(false);
  
  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Toast notifications hook
  const { toasts, showSuccess, showError, showInfo, removeToast } = useToast();

  // Detect main window mode after hydration to avoid SSR mismatch
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isMain = urlParams.get('mode') === 'main';
    setIsMainWindow(isMain);
    setIsWindowModeDetected(true);
    
    if (isMain) {
      // Set ready state after a longer delay to ensure backend connection check completes
      const timer = setTimeout(() => {
        setIsMainWindowReady(true);
      }, 500); // Longer delay to let backend connection check complete
      
      return () => clearTimeout(timer);
    } else {
      setIsMainWindowReady(true); // Avatar window is always ready
    }
  }, []);

  // API hooks for backend integration (Requirements 6.1, 7.2, 8.2)
  const { isConnected, isChecking } = useApiHealth();
  const { papers: apiPapers, fetchPapers, savePaper } = usePapers();
  const { savedPapers, fetchSavedPapers } = useSavedPapers();
  const { notifications } = useNotifications();

  // Bubble notifier hook
  const {
    currentMessage,
    enqueue,
    clearAll,
  } = useBubbleNotifier();

  // Convert API papers to PaperCard format for dashboard
  const papers: PaperCard[] = useMemo(() => {
    return apiPapers.map((p) => ({
      id: p.id,
      title: p.title,
      score: p.total_score || 0,
      tags: p.categories || [],
      oneLiner: p.one_liner || '',
      pros: p.pros || [],
      cons: p.cons || [],
      url: p.url,
    }));
  }, [apiPapers]);

  // Get current paper for chat context
  const currentPaper = useMemo(() => {
    if (!currentPaperId) return null;
    const apiPaper = apiPapers.find((p) => p.id === currentPaperId);
    if (apiPaper) {
      return {
        id: apiPaper.id,
        title: apiPaper.title,
        abstract: apiPaper.abstract,
      };
    }
    return null;
  }, [currentPaperId, apiPapers]);
  
  // Chat interface hook with API integration (Requirement 8.2)
  const chatInterface = useChatInterface({
    onLLMRequest: async (message, context) => {
      if (!isConnected) {
        return '后端服务未连接，请稍后重试。';
      }
      try {
        const client = getApiClient();
        
        // Use PDF-based chat if PDF is processed, otherwise use regular chat
        if (context.isPdfProcessed && context.pdfUrl) {
          try {
            const response = await client.chatWithPDF({
              paper_id: context.paperId,
              message,
              history: context.history.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              max_context_tokens: 3000,
            });
            return response.content;
          } catch (pdfChatError) {
            console.warn('PDF chat failed, falling back to regular chat:', pdfChatError);
            
            // Fallback to regular chat
            const response = await client.sendChatMessage({
              paper_id: context.paperId,
              message,
              history: context.history.map((m) => ({
                role: m.role,
                content: m.content,
              })),
            });
            return response.content + '\n\n⚠️ 注意：PDF内容暂时不可用，回答基于论文摘要。';
          }
        } else {
          const response = await client.sendChatMessage({
            paper_id: context.paperId,
            message,
            history: context.history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          });
          return response.content;
        }
      } catch (error) {
        console.error('Chat request failed:', error);
        return `请求失败：${error instanceof Error ? error.message : String(error)}。请稍后重试。`;
      }
    },
    onQuickCommandRequest: async (command, context) => {
      if (!isConnected) {
        return '后端服务未连接，请稍后重试。';
      }
      try {
        const client = getApiClient();
        const response = await client.executeQuickCommand({
          paper_id: context.paperId,
          command,
        });
        return response.content;
      } catch (error) {
        console.error('Quick command failed:', error);
        return '快捷指令执行失败，请稍后重试。';
      }
    },
    onStartPDFProcessing: async (paperId, pdfUrl) => {
      if (!isConnected) {
        throw new Error('后端服务未连接');
      }
      try {
        const client = getApiClient();
        const response = await client.processPDF({
          paper_id: paperId,
          pdf_url: pdfUrl,
        });
        
        // Even if PDF processing fails, we can still use abstract-based chat
        if (!response.success) {
          console.warn(`PDF processing failed: ${response.message}`);
          // Don't throw error - let user know they can still chat with abstract
        }
      } catch (error) {
        console.error('PDF processing request failed:', error);
        // Don't throw error - abstract-based chat is still available
        console.warn(`PDF处理失败：${error instanceof Error ? error.message : String(error)}。您仍可以基于论文摘要进行对话。`);
      }
    },
    onGetProcessingStatus: async (paperId) => {
      if (!isConnected) {
        return null;
      }
      try {
        const client = getApiClient();
        return await client.getPDFStatus(paperId);
      } catch (error) {
        console.error('Failed to get PDF status:', error);
        return null;
      }
    },
  });

  // Initialize from config on mount (Requirement 1.5)
  useEffect(() => {
    initializeFromConfig();
  }, [initializeFromConfig]);

  // Listen for config changes from other windows (cross-window sync)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.onConfigChanged) {
      const cleanup = window.electronAPI.onConfigChanged((key: string, value: unknown) => {
        // Handle window config changes (includes scale and windowSizeScale)
        if (key === 'window' && value && typeof value === 'object') {
          const windowConfig = value as { x: number; y: number; scale: number; windowSizeScale?: number };
          if (windowConfig.scale !== undefined) {
            useAppStore.getState().setSkinScale(windowConfig.scale);
          }
          if (windowConfig.windowSizeScale !== undefined) {
            useAppStore.getState().setWindowSizeScale(windowConfig.windowSizeScale);
          }
        }
      });
      
      return cleanup;
    }
  }, []);

  // Fetch papers from backend when connected (Requirement 7.2)
  useEffect(() => {
    if (isConnected) {
      // First try to get papers without score filter
      fetchPapers({}).then((papers) => {
        // If no papers found, or all papers have scores, try with score filter
        if (papers.length === 0 || papers.some(p => p.total_score && p.total_score > 0)) {
          fetchPapers({ min_score: 7.0 });
        }
        
        // If this is main window, mark as ready once papers are loaded
        if (isMainWindow && !isMainWindowReady) {
          setIsMainWindowReady(true);
        }
      }).catch(error => {
        console.error('Failed to fetch papers:', error);
        // Even if papers fail to load, mark main window as ready to avoid infinite loading
        if (isMainWindow && !isMainWindowReady) {
          setIsMainWindowReady(true);
        }
      });

      // Also fetch saved papers to check for duplicates
      fetchSavedPapers().catch(error => {
        console.error('Failed to fetch saved papers:', error);
      });
    } else if (isMainWindow && !isMainWindowReady && !isChecking) {
      // If not connected and not checking, mark as ready (offline mode)
      setIsMainWindowReady(true);
    }
  }, [isConnected, isChecking, fetchPapers, fetchSavedPapers, isMainWindow, isMainWindowReady]);

  // Track processed notification IDs to prevent duplicates
  const [processedNotificationIds, setProcessedNotificationIds] = useState<Set<string>>(new Set());

  // Process notifications from backend and show ONE bubble with count (Requirement 6.1)
  useEffect(() => {
    if (notifications.length > 0) {
      // Filter out already processed notifications
      const newNotifications = notifications.filter(n => !processedNotificationIds.has(n.id));
      
      if (newNotifications.length === 0) {
        return; // All notifications already processed
      }
      
      // Mark these notifications as processed
      const newIds = new Set(processedNotificationIds);
      newNotifications.forEach(n => newIds.add(n.id));
      setProcessedNotificationIds(newIds);
      
      // Find the highest scoring paper
      const bestPaper = newNotifications.reduce((best, n) => 
        n.score > best.score ? n : best
      , newNotifications[0]);
      
      // Clear any existing bubbles and show ONE new bubble with count
      clearAll();
      const bubbleMessage = createBubbleMessage(
        bestPaper.paper_id,
        `发现 ${newNotifications.length} 篇值得阅读的论文`,
        bestPaper.source as 'arxiv' | 'huggingface',
        bestPaper.score
      );
      enqueue(bubbleMessage);
      
      // Transition avatar to alert state when new papers arrive
      setAvatarState('alert');
      
      // Clear all notifications from backend after processing (batch clear)
      getApiClient().clearNotifications().catch(console.error);
    }
  }, [notifications, enqueue, setAvatarState, clearAll, processedNotificationIds, isConnected]);

  // Handle context menu open
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Handle context menu close
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Handle skin error
  const handleSkinError = useCallback((error: string) => {
    console.error('Skin error:', error);
  }, []);

  // Handle avatar click - open main window (Requirement 7.1)
  const handleAvatarClick = useCallback(async () => {
    if (window.electronAPI) {
      try {
        await window.electronAPI.showMainWindow();
      } catch (error) {
        console.error('Error calling showMainWindow:', error);
      }
    }
  }, []);

  // Handle bubble click - open main window (Requirement 6.3)
  const handleBubbleClick = useCallback(async (paperId: string) => {
    clearAll(); // Clear all bubbles when clicked
    setCurrentPaperId(paperId);
    
    if (window.electronAPI) {
      await window.electronAPI.showMainWindow();
    }
  }, [clearAll, setCurrentPaperId]);

  // Handle save for later (Requirement 7.3)
  const handleSaveForLater = useCallback(async (paperId: string): Promise<boolean> => {
    if (isConnected) {
      try {
        // Check if paper is already saved
        const isAlreadySaved = savedPapers.some(sp => sp.paper_id === paperId);
        
        if (isAlreadySaved) {
          showInfo('已收藏', '该论文已在您的收藏夹中');
          return true;
        }

        const success = await savePaper(paperId);
        if (success) {
          showSuccess('保存成功', '论文已添加到收藏夹');
          fetchSavedPapers().catch(console.error);
          return true;
        } else {
          showError('保存失败', '请稍后重试');
          return false;
        }
      } catch (error) {
        console.error('Error saving paper:', error);
        showError('保存失败', '网络错误，请稍后重试');
        return false;
      }
    } else {
      showError('保存失败', '后端服务未连接');
      return false;
    }
  }, [isConnected, savePaper, savedPapers, fetchSavedPapers, showSuccess, showError, showInfo]);

  // Handle remove from saved (for state synchronization)
  const handleRemoveFromSaved = useCallback(async (_paperId: string) => {
    await fetchSavedPapers();
  }, [fetchSavedPapers]);

  // Handle open chat (Requirement 7.4, 8.1)
  const handleOpenChat = useCallback((paperId: string) => {
    setCurrentPaperId(paperId);
    
    // Find paper and open chat with context
    const paper = apiPapers.find((p) => p.id === paperId);
    if (paper) {
      // Construct PDF URL from ArXiv URL
      let pdfUrl: string | undefined;
      if (paper.url && paper.url.includes('arxiv.org/abs/')) {
        pdfUrl = paper.url.replace('/abs/', '/pdf/') + '.pdf';
      }
      
      chatInterface.open(paper.id, paper.title, paper.abstract, pdfUrl);
      setChatOpen(true);
    }
  }, [apiPapers, chatInterface, setCurrentPaperId, setChatOpen]);

  // Handle read full text - open paper URL in browser
  const handleReadFullText = useCallback((paperUrl: string) => {
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(paperUrl).catch((error) => {
        console.error('Failed to open external URL via Electron:', error);
        window.open(paperUrl, '_blank', 'noopener,noreferrer');
      });
    } else {
      if (window.electronAPI) {
        // In Electron, try to force external browser
        try {
          const link = document.createElement('a');
          link.href = paperUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (error) {
          console.error('Failed to open with link click:', error);
          window.open(paperUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        // Browser environment
        window.open(paperUrl, '_blank', 'noopener,noreferrer');
      }
    }
  }, []);

  // Handle chat close (Requirement 8.5)
  const handleChatClose = useCallback(() => {
    chatInterface.close();
    setChatOpen(false);
    setCurrentPaperId(null);
  }, [chatInterface, setChatOpen, setCurrentPaperId]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu) {
        setContextMenu(null);
      }
    };

    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [contextMenu]);

  // Handle settings modal
  useEffect(() => {
    const handleOpenSettings = () => {
      setIsSettingsOpen(true);
    };

    window.addEventListener('openWindowSettings', handleOpenSettings);
    return () => window.removeEventListener('openWindowSettings', handleOpenSettings);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-transparent">
      {!isWindowModeDetected ? (
        // Show loading state until window mode is detected (avoid hydration mismatch)
        <div className="w-full h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
            <p className="text-purple-300">初始化中...</p>
          </div>
        </div>
      ) : isMainWindow ? (
        // Main window mode - show loading until ready, then full dashboard and chat interface
        !isMainWindowReady ? (
          // Loading state for main window
          <div className="w-full h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
              <p className="text-purple-300">加载中...</p>
            </div>
          </div>
        ) : (
          <div className="w-full h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
            {/* Main window content */}
            <div className="w-full h-full p-6">
              <DashboardPanel
                isOpen={true}
                onClose={() => {
                  if (window.electronAPI) {
                    window.electronAPI.hideMainWindow();
                  }
                }}
                papers={papers}
                onSaveForLater={handleSaveForLater}
                onOpenChat={handleOpenChat}
                onReadFullText={handleReadFullText}
                onRemoveFromSaved={handleRemoveFromSaved}
              />
            </div>

            {/* Chat Interface overlay in main window */}
            {isChatOpen && currentPaper && (
              <div className="fixed inset-0 z-50">
                <ChatInterface
                  isOpen={isChatOpen}
                  context={chatInterface.context}
                  onClose={handleChatClose}
                  onSendMessage={async (content) => {
                    const msg = await chatInterface.sendMessage(content);
                    return msg || { id: '', role: 'assistant', content: '', timestamp: new Date() };
                  }}
                  onQuickCommand={async (command) => {
                    const msg = await chatInterface.handleQuickCommand(command);
                    return msg || { id: '', role: 'assistant', content: '', timestamp: new Date() };
                  }}
                />
              </div>
            )}

            {/* Connection status indicator */}
            <div className="fixed bottom-4 left-4 z-50">
              <div
                className={`px-3 py-1 rounded-full text-xs ${
                  isConnected
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-yellow-500/20 text-yellow-400'
                }`}
              >
                {isConnected ? '🟢 已连接后端' : '🟡 离线模式'}
              </div>
            </div>

            {/* Toast notifications */}
            <ToastContainer toasts={toasts} onClose={removeToast} />
            
            {/* Main Window Settings Modal */}
            <MainWindowSettings
              isOpen={isSettingsOpen}
              onClose={handleCloseSettings}
            />
          </div>
        )
      ) : (
        // Avatar window mode - show only avatar
        <div 
          className="relative w-full h-screen bg-transparent"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
          }}
        >
          {/* Avatar container - positioned at bottom center */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            {/* Bubble - positioned above avatar with dynamic spacing */}
            {currentMessage && (
              <div 
                className="absolute left-1/2 -translate-x-1/2 z-10"
                style={{
                  bottom: `${128 * skinScale - 2}px`, // Avatar height - 2px (tail almost touches avatar)
                }}
              >
                <BubbleNotifier
                  currentMessage={currentMessage}
                  onBubbleClick={handleBubbleClick}
                  onDismiss={clearAll}
                />
              </div>
            )}

            {/* Avatar */}
            <Avatar
              baseSize={128}
              onClick={handleAvatarClick}
              onContextMenu={handleContextMenu}
              onSkinError={handleSkinError}
              enableSkinDrop={true}
            />
          </div>

          {/* Context Menu */}
          {contextMenu && (
            <AvatarContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={handleCloseContextMenu}
            />
          )}
        </div>
      )}
    </main>
  );
}