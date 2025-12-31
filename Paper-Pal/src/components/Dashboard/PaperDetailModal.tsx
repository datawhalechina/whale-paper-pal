/**
 * Paper Detail Modal Component
 * 显示论文的完整大模型评论内容
 */

'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PaperCard } from './types';

interface PaperDetailModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 论文数据 */
  paper: PaperCard | null;
  /** 关闭模态框的回调 */
  onClose: () => void;
  /** 保存论文的回调 */
  onSaveForLater?: (paperId: string) => Promise<boolean> | boolean | void;
  /** 打开聊天的回调 */
  onOpenChat?: (paperId: string) => void;
  /** 阅读全文的回调 */
  onReadFullText?: (paperUrl: string) => void;
}

// 评分颜色
function getScoreColor(score: number): string {
  if (score >= 8) return 'bg-green-500/30 text-green-300 border-green-500/50';
  if (score >= 6) return 'bg-yellow-500/30 text-yellow-300 border-yellow-500/50';
  return 'bg-orange-500/30 text-orange-300 border-orange-500/50';
}

// 评分表情
function getScoreEmoji(score: number): string {
  if (score >= 9) return '🔥';
  if (score >= 8) return '⭐';
  if (score >= 7) return '✨';
  return '📄';
}

export function PaperDetailModal({
  isOpen,
  paper,
  onClose,
  onSaveForLater,
  onOpenChat,
  onReadFullText,
}: PaperDetailModalProps) {
  // ESC键关闭模态框
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // 防止背景滚动
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!paper) return null;

  const scoreColor = getScoreColor(paper.score);
  const scoreEmoji = getScoreEmoji(paper.score);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* 背景遮罩 */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* 模态框内容 */}
          <motion.div
            className="relative w-full max-w-4xl max-h-[90vh] bg-gradient-to-br from-gray-900/95 via-purple-900/95 to-gray-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            {/* 头部 */}
            <div className="flex items-start justify-between p-6 border-b border-white/10">
              <div className="flex items-start gap-4 flex-1 min-w-0">
                {/* 评分徽章 */}
                <div className={`flex-shrink-0 px-4 py-2 rounded-xl border ${scoreColor} font-bold text-xl`}>
                  {scoreEmoji} {paper.score.toFixed(1)}
                </div>

                {/* 标题和标签 */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-semibold text-xl leading-tight mb-3">
                    {paper.title}
                  </h2>
                  
                  {/* 标签 */}
                  {paper.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {paper.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="px-3 py-1 bg-purple-500/20 text-purple-300 text-sm rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 关闭按钮 */}
              <button
                onClick={onClose}
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors ml-4"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            {/* 内容区域 */}
            <div className="overflow-y-auto max-h-[calc(90vh-200px)] custom-scrollbar">
              <div className="p-6 space-y-6">
                {/* AI 评论摘要 */}
                <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                  <h3 className="text-white font-medium text-lg mb-3 flex items-center gap-2">
                    <span className="text-2xl">🤖</span>
                    AI 评论摘要
                  </h3>
                  <p className="text-white/90 text-base leading-relaxed italic">
                    &ldquo;{paper.oneLiner}&rdquo;
                  </p>
                </div>

                {/* 优点和缺点 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 优点 */}
                  <div className="bg-green-500/5 rounded-xl p-5 border border-green-500/20">
                    <h3 className="text-green-300 font-medium text-lg mb-4 flex items-center gap-2">
                      <span className="text-xl">✅</span>
                      优点亮点
                    </h3>
                    <div className="space-y-3">
                      {paper.pros.map((pro, index) => (
                        <div key={index} className="flex items-start gap-3">
                          <span className="flex-shrink-0 w-6 h-6 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center text-sm font-bold">
                            {index + 1}
                          </span>
                          <p className="text-green-100 text-sm leading-relaxed">
                            {pro}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 缺点 */}
                  <div className="bg-red-500/5 rounded-xl p-5 border border-red-500/20">
                    <h3 className="text-red-300 font-medium text-lg mb-4 flex items-center gap-2">
                      <span className="text-xl">⚠️</span>
                      不足之处
                    </h3>
                    <div className="space-y-3">
                      {paper.cons.map((con, index) => (
                        <div key={index} className="flex items-start gap-3">
                          <span className="flex-shrink-0 w-6 h-6 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center text-sm font-bold">
                            {index + 1}
                          </span>
                          <p className="text-red-100 text-sm leading-relaxed">
                            {con}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 评分详情 */}
                <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                  <h3 className="text-white font-medium text-lg mb-4 flex items-center gap-2">
                    <span className="text-xl">📊</span>
                    评分详情
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-white/5 rounded-lg">
                      <div className="text-2xl font-bold text-white mb-1">
                        {paper.score.toFixed(1)}
                      </div>
                      <div className="text-white/60 text-sm">总分</div>
                    </div>
                    <div className="text-center p-4 bg-white/5 rounded-lg">
                      <div className="text-2xl font-bold text-blue-300 mb-1">
                        {scoreEmoji}
                      </div>
                      <div className="text-white/60 text-sm">评级</div>
                    </div>
                    <div className="text-center p-4 bg-white/5 rounded-lg">
                      <div className="text-2xl font-bold text-purple-300 mb-1">
                        AI
                      </div>
                      <div className="text-white/60 text-sm">评审</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 底部操作按钮 */}
            <div className="p-6 border-t border-white/10 bg-white/5">
              <div className="flex gap-3">
                <button
                  onClick={() => onSaveForLater?.(paper.id)}
                  className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <span>📑</span>
                  <span>稍后读</span>
                </button>
                <button
                  onClick={() => onReadFullText?.(paper.url)}
                  className="flex-1 px-4 py-3 bg-blue-500/30 hover:bg-blue-500/50 text-blue-200 hover:text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <span>🔗</span>
                  <span>阅读全文</span>
                </button>
                <button
                  onClick={() => onOpenChat?.(paper.id)}
                  className="flex-1 px-4 py-3 bg-purple-500/30 hover:bg-purple-500/50 text-purple-200 hover:text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <span>💬</span>
                  <span>开始对话</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default PaperDetailModal;