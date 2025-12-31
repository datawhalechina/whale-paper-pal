/**
 * Dashboard Panel Component
 * Glassmorphism dark theme panel for displaying today's selected papers and saved papers
 *
 * Requirements:
 * - 7.1: Expand with glassmorphism dark theme when avatar/bubble clicked
 * - 7.5: Collapse when clicking outside the panel
 * - 7.3: Saved papers management interface
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PaperCardComponent } from './PaperCard';
import { SavedPapersPanel } from './SavedPapersPanel';
import { PaperDetailModal } from './PaperDetailModal';
import type { DashboardPanelProps, PaperCard } from './types';

// Tab types
type TabType = 'daily' | 'saved';

// Animation variants for panel expand/collapse
const panelVariants = {
  hidden: {
    opacity: 0,
    scale: 0.9,
    y: 20,
    transition: {
      duration: 0.2,
      ease: 'easeIn',
    },
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 25,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: {
      duration: 0.15,
      ease: 'easeOut',
    },
  },
};

// Backdrop animation
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export function DashboardPanel({
  isOpen,
  onClose,
  papers,
  onSaveForLater,
  onOpenChat,
  onReadFullText,
  onPaperClick,
  onRemoveFromSaved,
}: DashboardPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabType>('daily');
  
  // 论文详情模态框状态
  const [selectedPaper, setSelectedPaper] = useState<PaperCard | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Handle paper card click to show detail modal
  const handlePaperClick = useCallback((paperId: string) => {
    const paper = papers.find(p => p.id === paperId);
    if (paper) {
      setSelectedPaper(paper);
      setIsDetailModalOpen(true);
    }
    // Also call the original callback if provided
    onPaperClick?.(paperId);
  }, [papers, onPaperClick]);

  // Handle detail modal close
  const handleDetailModalClose = useCallback(() => {
    setIsDetailModalOpen(false);
    setSelectedPaper(null);
  }, []);

  // Check if we're in main window mode
  const [isMainWindow, setIsMainWindow] = useState(false);
  
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    setIsMainWindow(mode === 'main');
  }, []);

  // Handle click outside to close panel (Requirement 7.5)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isMainWindow) {
        onClose();
      }
    },
    [onClose, isMainWindow]
  );

  // Handle escape key to close panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isMainWindow) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isMainWindow]);

  // Tab component
  const TabButton = ({ tab, label, icon }: { tab: TabType; label: string; icon: string }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
        activeTab === tab
          ? 'bg-purple-500/30 text-purple-200 border border-purple-500/50'
          : 'text-white/70 hover:text-white hover:bg-white/10'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );

  // Render tab content
  const renderTabContent = () => {
    if (activeTab === 'daily') {
      return (
        <div className="space-y-4">
          {papers.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-4xl mb-4 block">🔍</span>
              <p className="text-white/60">暂无精选论文</p>
              <p className="text-white/40 text-sm mt-2">
                等待 AI 为你筛选今日最佳论文...
              </p>
            </div>
          ) : isMainWindow ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {papers.map((paper, index) => (
                <motion.div
                  key={paper.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <PaperCardComponent
                    paper={paper}
                    onSaveForLater={onSaveForLater}
                    onOpenChat={onOpenChat}
                    onReadFullText={onReadFullText}
                    onPaperClick={handlePaperClick}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {papers.map((paper, index) => (
                <motion.div
                  key={paper.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <PaperCardComponent
                    paper={paper}
                    onSaveForLater={onSaveForLater}
                    onOpenChat={onOpenChat}
                    onReadFullText={onReadFullText}
                    onPaperClick={handlePaperClick}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      );
    } else {
      return (
        <SavedPapersPanel
          onOpenChat={onOpenChat || (() => {})}
          onReadFullText={onReadFullText || (() => {})}
          onRemoveFromSaved={(paperId) => {
            onRemoveFromSaved?.(paperId);
          }}
        />
      );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {isMainWindow ? (
            // Main window mode - full screen layout
            <div className="w-full h-full flex flex-col">
              {/* Header with tabs */}
              <div className="px-6 py-4 border-b border-white/10 bg-black/20 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">📚</span>
                    <h2 className="text-xl font-bold text-white">Paper Pal</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        // This will be handled by the parent component
                        const event = new CustomEvent('openWindowSettings');
                        window.dispatchEvent(event);
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                      aria-label="窗口设置"
                      title="窗口设置"
                    >
                      ⚙️
                    </button>
                    <button
                      onClick={onClose}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                      aria-label="关闭面板"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                
                {/* Tab navigation */}
                <div className="flex gap-2">
                  <TabButton tab="daily" label="今日精选" icon="🌟" />
                  <TabButton tab="saved" label="我的收藏" icon="📑" />
                </div>
              </div>

              {/* Tab content - full height */}
              <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                {renderTabContent()}
              </div>
            </div>
          ) : (
            // Modal mode - original overlay layout
            <motion.div
              className="fixed inset-0 z-40 flex items-center justify-center"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={handleBackdropClick}
            >
              {/* Semi-transparent backdrop */}
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

              {/* Panel container */}
              <motion.div
                ref={panelRef}
                className="relative z-50 w-full max-w-2xl max-h-[80vh] mx-4"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                {/* Glassmorphism panel (Requirement 7.1) */}
                <div className="glass-dark rounded-2xl shadow-2xl overflow-hidden">
                  {/* Header with tabs */}
                  <div className="px-6 py-4 border-b border-white/10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">📚</span>
                        <h2 className="text-xl font-bold text-white">Paper Pal</h2>
                      </div>
                      <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                        aria-label="关闭面板"
                      >
                        ✕
                      </button>
                    </div>
                    
                    {/* Tab navigation */}
                    <div className="flex gap-2">
                      <TabButton tab="daily" label="今日精选" icon="🌟" />
                      <TabButton tab="saved" label="我的收藏" icon="📑" />
                    </div>
                  </div>

                  {/* Tab content */}
                  <div className="p-4 overflow-y-auto max-h-[calc(80vh-120px)] custom-scrollbar">
                    {renderTabContent()}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </>
      )}
      
      {/* 论文详情模态框 */}
      <PaperDetailModal
        isOpen={isDetailModalOpen}
        paper={selectedPaper}
        onClose={handleDetailModalClose}
        onSaveForLater={onSaveForLater}
        onOpenChat={onOpenChat}
        onReadFullText={onReadFullText}
      />
    </AnimatePresence>
  );
}

export default DashboardPanel;
