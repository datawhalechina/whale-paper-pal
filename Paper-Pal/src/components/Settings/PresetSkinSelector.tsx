'use client';

import React, { useState, useMemo } from 'react';
import { getAllTags, getSkinsByTag, getPresetSkinsWithCorrectPaths, type PresetSkin } from '@/skin/presets';

interface PresetSkinSelectorProps {
  currentPresetId?: string;
  onSelectPreset: (presetId: string) => void;
  isLoading?: boolean;
}

export default function PresetSkinSelector({ 
  currentPresetId, 
  onSelectPreset, 
  isLoading = false 
}: PresetSkinSelectorProps) {
  const [selectedTag, setSelectedTag] = useState<string>('全部');
  
  const allTags = useMemo(() => ['全部', ...getAllTags()], []);
  
  const filteredSkins = useMemo(() => {
    if (selectedTag === '全部') {
      // 使用修正路径的函数，而不是原始的 PRESET_SKINS
      return getPresetSkinsWithCorrectPaths();
    }
    return getSkinsByTag(selectedTag);
  }, [selectedTag]);

  const handlePresetClick = (presetId: string) => {
    if (!isLoading && presetId !== currentPresetId) {
      onSelectPreset(presetId);
    }
  };

  return (
    <div className="space-y-4">
      {/* 标签筛选 */}
      <div>
        <h4 className="text-white/80 font-medium text-sm mb-3">皮肤分类</h4>
        <div className="flex flex-wrap gap-2">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag)}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                selectedTag === tag
                  ? 'bg-purple-500 text-white'
                  : 'bg-white/10 hover:bg-white/20 text-white/70 hover:text-white border border-white/20'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* 皮肤网格 */}
      <div>
        <h4 className="text-white/80 font-medium text-sm mb-3">
          选择皮肤 ({filteredSkins.length} 个可用)
        </h4>
        <div className="grid grid-cols-3 gap-3 max-h-80 overflow-y-auto custom-scrollbar">
          {filteredSkins.map((skin) => (
            <PresetSkinCard
              key={skin.id}
              skin={skin}
              isSelected={skin.id === currentPresetId}
              isLoading={isLoading}
              onClick={() => handlePresetClick(skin.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface PresetSkinCardProps {
  skin: PresetSkin;
  isSelected: boolean;
  isLoading: boolean;
  onClick: () => void;
}

function PresetSkinCard({ skin, isSelected, isLoading, onClick }: PresetSkinCardProps) {
  const [, setImageError] = useState(false);

  const handleImageError = () => {
    setImageError(true);
  };

  return (
    <div
      onClick={onClick}
      className={`relative p-3 rounded-xl border-2 cursor-pointer transition-all ${
        isSelected
          ? 'border-purple-400 bg-purple-500/20'
          : 'border-white/20 hover:border-white/30 bg-white/5 hover:bg-white/10'
      } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {/* 预览图 */}
      <div className="aspect-square mb-2 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center">
        {skin.assets.idle.length <= 4 && !skin.assets.idle.startsWith('/') && !skin.assets.idle.startsWith('http') ? (
          // 表情符号预览
          <span className="text-3xl">{skin.assets.idle}</span>
        ) : (
          // 图片预览 - 使用 idle 状态图片
          <img
            src={skin.assets.idle}
            alt={skin.name}
            className="w-full h-full object-cover"
            onError={handleImageError}
          />
        )}
      </div>

      {/* 皮肤信息 */}
      <div className="text-center">
        <h5 className="text-sm font-medium text-white truncate">
          {skin.name}
        </h5>
        <p className="text-xs text-white/60 mt-1 line-clamp-2">
          {skin.description}
        </p>
        {skin.author && (
          <p className="text-xs text-white/40 mt-1">
            by {skin.author}
          </p>
        )}
      </div>

      {/* 标签 */}
      <div className="flex flex-wrap gap-1 mt-3">
        {skin.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded-full"
          >
            {tag}
          </span>
        ))}
        {skin.tags.length > 2 && (
          <span className="px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded-full">
            +{skin.tags.length - 2}
          </span>
        )}
      </div>

      {/* 选中指示器 */}
      {isSelected && (
        <div className="absolute top-3 right-3 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
          <span className="text-white text-xs">✓</span>
        </div>
      )}

      {/* 加载指示器 */}
      {isLoading && isSelected && (
        <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
    </div>
  );
}