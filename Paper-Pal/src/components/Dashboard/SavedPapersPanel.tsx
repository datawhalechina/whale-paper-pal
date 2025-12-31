/**
 * Saved Papers Panel Component
 * 
 * Displays and manages user's saved papers (稍后读)
 */

import React, { useEffect } from 'react';
import { PaperCardComponent } from './PaperCard';
import { useSavedPapers } from '@/hooks/useApi';
import type { PaperCard as PaperCardType } from './types';

interface SavedPapersPanelProps {
  onOpenChat: (paperId: string) => void;
  onReadFullText: (url: string) => void;
  onRemoveFromSaved?: (paperId: string) => void;
}

export function SavedPapersPanel({
  onOpenChat,
  onReadFullText,
  onRemoveFromSaved,
}: SavedPapersPanelProps) {
  const { savedPapers, isLoading, error, fetchSavedPapers, removeSavedPaper } = useSavedPapers();

  // 获取保存的论文
  useEffect(() => {
    fetchSavedPapers();
  }, [fetchSavedPapers]);

  // 转换API数据为组件需要的格式
  const convertedPapers: PaperCardType[] = savedPapers
    .filter(sp => sp.paper) // 只显示有论文数据的项目
    .sort((a, b) => {
      // 按收藏时间倒序排列（最新收藏的在前面）
      const timeA = new Date(a.saved_at).getTime();
      const timeB = new Date(b.saved_at).getTime();
      return timeB - timeA;
    })
    .map(sp => ({
      id: sp.paper!.id,
      title: sp.paper!.title,
      score: sp.paper!.total_score || 0,
      tags: sp.paper!.categories || [],
      oneLiner: sp.paper!.one_liner || sp.paper!.abstract.substring(0, 100) + '...',
      pros: sp.paper!.pros || [],
      cons: sp.paper!.cons || [],
      url: sp.paper!.url,
      abstract: sp.paper!.abstract,
      authors: sp.paper!.authors,
      published: sp.paper!.published,
      source: sp.paper!.source
    }));

  const handleRemoveFromSaved = async (paperId: string) => {
    const success = await removeSavedPaper(paperId);
    if (success && onRemoveFromSaved) {
      onRemoveFromSaved(paperId);
    }
    return success;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">我的收藏</h2>
            <p className="text-gray-400 text-sm">加载中...</p>
          </div>
        </div>
        
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
            <p className="text-purple-300">正在加载收藏的论文...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">我的收藏</h2>
            <p className="text-gray-400 text-sm">共 0 篇论文</p>
          </div>
        </div>
        
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-6xl mb-4">📚</div>
            <h3 className="text-xl font-semibold text-gray-300 mb-2">暂无收藏论文</h3>
            <p className="text-gray-400 mb-4">
              在今日精选中点击&ldquo;稍后读&rdquo;来收藏感兴趣的论文
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (convertedPapers.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">我的收藏</h2>
            <p className="text-gray-400 text-sm">共 0 篇论文</p>
          </div>
        </div>
        
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-6xl mb-4">📚</div>
            <h3 className="text-xl font-semibold text-gray-300 mb-2">暂无收藏论文</h3>
            <p className="text-gray-400 mb-4">
              在今日精选中点击&ldquo;稍后读&rdquo;来收藏感兴趣的论文
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">我的收藏</h2>
          <p className="text-gray-400 text-sm">共 {convertedPapers.length} 篇论文</p>
        </div>
      </div>
      
      <div className="space-y-4">
        {convertedPapers.map((paper) => (
          <PaperCardComponent
            key={paper.id}
            paper={paper}
            onSaveForLater={handleRemoveFromSaved} // 在收藏页面，这个按钮变成删除功能
            onOpenChat={onOpenChat}
            onReadFullText={onReadFullText}
            showSaveButton={true} // 显示按钮，但功能是删除
            isInSavedList={true} // 标识这是在收藏列表中
          />
        ))}
      </div>
    </div>
  );
}