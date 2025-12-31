/**
 * Paper Card Component
 * Displays a single paper with score, title, tags, and one-liner summary
 *
 * Requirements:
 * - 7.2: Display score, title, tags, and one-liner summary
 * - 7.3: "稍后读" button to save paper
 * - 7.4: "Chat" button to open chat interface
 */

'use client';

import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import type { PaperCardProps } from './types';

// Score color based on value
function getScoreColor(score: number): string {
  if (score >= 8) return 'bg-green-500/30 text-green-300 border-green-500/50';
  if (score >= 6) return 'bg-yellow-500/30 text-yellow-300 border-yellow-500/50';
  return 'bg-orange-500/30 text-orange-300 border-orange-500/50';
}

// Score emoji based on value
function getScoreEmoji(score: number): string {
  if (score >= 9) return '🔥';
  if (score >= 8) return '⭐';
  if (score >= 7) return '✨';
  return '📄';
}

export function PaperCardComponent({
  paper,
  onSaveForLater,
  onOpenChat,
  onReadFullText,
  onPaperClick,
  showSaveButton = true,
  isInSavedList = false, // 新增属性，标识是否在收藏列表中
}: PaperCardProps) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'already_saved'>('idle');
  
  const handleSaveForLater = useCallback(async () => {
    if (saveState === 'saving' || saveState === 'saved') return;
    
    setSaveState('saving');
    
    try {
      const success = await onSaveForLater?.(paper.id);
      
      if (success === true) {
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 2000);
      } else if (success === false) {
        // 重复保存的情况
        setSaveState('already_saved');
        setTimeout(() => setSaveState('idle'), 3000);
      } else {
        setSaveState('error');
        setTimeout(() => setSaveState('idle'), 2000);
      }
    } catch (error) {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 2000);
    }
  }, [paper.id, onSaveForLater, saveState]);

  const handleOpenChat = useCallback(() => {
    onOpenChat?.(paper.id);
  }, [paper.id, onOpenChat]);

  const handleReadFullText = useCallback(() => {
    onReadFullText?.(paper.url);
  }, [paper.url, onReadFullText]);

  const handlePaperClick = useCallback(() => {
    onPaperClick?.(paper.id);
  }, [paper.id, onPaperClick]);

  const scoreColor = getScoreColor(paper.score);
  const scoreEmoji = getScoreEmoji(paper.score);

  // 保存按钮的样式和文本
  const getSaveButtonContent = () => {
    if (isInSavedList) {
      // 在收藏列表中，显示删除按钮
      switch (saveState) {
        case 'saving':
          return {
            icon: '⏳',
            text: '删除中...',
            className: 'bg-yellow-500/30 text-yellow-200 cursor-not-allowed',
          };
        case 'saved':
          return {
            icon: '✅',
            text: '已删除',
            className: 'bg-green-500/30 text-green-200',
          };
        case 'already_saved':
          return {
            icon: '⚠️',
            text: '未找到',
            className: 'bg-orange-500/30 text-orange-200',
          };
        case 'error':
          return {
            icon: '❌',
            text: '删除失败',
            className: 'bg-red-500/30 text-red-200',
          };
        default:
          return {
            icon: '🗑️',
            text: '删除',
            className: 'bg-red-500/30 hover:bg-red-500/50 text-red-200 hover:text-white',
          };
      }
    } else {
      // 在今日精选中，显示稍后读按钮
      switch (saveState) {
        case 'saving':
          return {
            icon: '⏳',
            text: '保存中...',
            className: 'bg-yellow-500/30 text-yellow-200 cursor-not-allowed',
          };
        case 'saved':
          return {
            icon: '✅',
            text: '已保存',
            className: 'bg-green-500/30 text-green-200',
          };
        case 'already_saved':
          return {
            icon: '⚠️',
            text: '已收藏',
            className: 'bg-orange-500/30 text-orange-200',
          };
        case 'error':
          return {
            icon: '❌',
            text: '保存失败',
            className: 'bg-red-500/30 text-red-200',
          };
        default:
          return {
            icon: '📑',
            text: '稍后读',
            className: 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white',
          };
      }
    }
  };

  const saveButtonContent = getSaveButtonContent();

  return (
    <motion.div
      className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 transition-colors cursor-pointer"
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.2 }}
      onClick={handlePaperClick}
    >
      {/* Header: Score and Title */}
      <div className="flex items-start gap-3 mb-3">
        {/* Score badge */}
        <div
          className={`flex-shrink-0 px-3 py-1.5 rounded-lg border ${scoreColor} font-bold text-lg`}
        >
          {scoreEmoji} {paper.score.toFixed(1)}
        </div>

        {/* Title */}
        <h3 className="text-white font-medium leading-snug line-clamp-2 flex-1">
          {paper.title}
        </h3>
      </div>

      {/* Tags */}
      {paper.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {paper.tags.map((tag, index) => (
            <span
              key={index}
              className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* One-liner summary */}
      <p className="text-white/70 text-sm mb-3 italic">
        &ldquo;{paper.oneLiner}&rdquo;
      </p>

      {/* Pros and Cons */}
      <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
        {/* Pros */}
        <div className="space-y-1">
          {paper.pros.map((pro, index) => (
            <div key={index} className="flex items-start gap-1.5 text-green-400/80">
              <span className="flex-shrink-0">✓</span>
              <span className="line-clamp-1">{pro}</span>
            </div>
          ))}
        </div>

        {/* Cons */}
        <div className="space-y-1">
          {paper.cons.map((con, index) => (
            <div key={index} className="flex items-start gap-1.5 text-red-400/80">
              <span className="flex-shrink-0">✗</span>
              <span className="line-clamp-1">{con}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons (Requirements 7.3, 7.4) */}
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        {showSaveButton && (
          <button
            onClick={handleSaveForLater}
            disabled={saveState === 'saving'}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1 ${saveButtonContent.className}`}
          >
            <span>{saveButtonContent.icon}</span>
            <span>{saveButtonContent.text}</span>
          </button>
        )}
        <button
          onClick={handleReadFullText}
          className="flex-1 px-3 py-2 bg-blue-500/30 hover:bg-blue-500/50 text-blue-200 hover:text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1"
        >
          <span>🔗</span>
          <span>阅读全文</span>
        </button>
        <button
          onClick={handleOpenChat}
          className="flex-1 px-3 py-2 bg-purple-500/30 hover:bg-purple-500/50 text-purple-200 hover:text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1"
        >
          <span>💬</span>
          <span>Chat</span>
        </button>
      </div>
    </motion.div>
  );
}

export default PaperCardComponent;
