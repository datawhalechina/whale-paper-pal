/**
 * Avatar Component
 * Supports custom skin replacement via drag-and-drop
 */

'use client';

import { useCallback, useMemo } from 'react';
import { useStateMachine } from '@/hooks/useStateMachine';
import { useWindowDrag } from '@/hooks/useWindowDrag';
import { useSkinManager } from '@/hooks/useSkinManager';
import { useAppStore } from '@/store/appStore';
import type { AvatarState } from '@/state/StateMachine';

const DEFAULT_EMOJIS: Record<AvatarState, string> = {
  idle: '😴',
  alert: '😲',
  active: '😊',
};

interface AvatarProps {
  baseSize?: number;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  enableSkinDrop?: boolean;
  onSkinError?: (error: string) => void;
}

export function Avatar({
  baseSize = 128,
  onClick,
  onContextMenu,
  enableSkinDrop = true,
  onSkinError,
}: AvatarProps) {
  const { currentState, handleClick, resetIdleTimer } = useStateMachine();
  const { isDragging, handleMouseDown } = useWindowDrag();
  const { skinScale } = useAppStore();

  const {
    skinConfig,
    getAssetUrl,
    getStateAssetUrl,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isDragOver,
    error: skinError,
  } = useSkinManager({
    onError: onSkinError,
    enablePersistence: true,
  });

  const actualSize = useMemo(() => baseSize * skinScale, [baseSize, skinScale]);
  
  // Get asset URL for current state (multi-state support)
  const skinUrl = useMemo(() => {
    const url = getStateAssetUrl ? getStateAssetUrl(currentState) : getAssetUrl();
    return url;
  }, [getStateAssetUrl, getAssetUrl, currentState, skinConfig]);
  
  const hasCustomSkin = (skinConfig.type === 'custom' || skinConfig.type === 'preset') && skinUrl;
  const isEmojiSkin = skinUrl && (skinUrl.length <= 4 && !skinUrl.startsWith('/') && !skinUrl.startsWith('http'));

  const handleAvatarClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      handleClick();
      resetIdleTimer();
      onClick?.();
    },
    [isDragging, handleClick, resetIdleTimer, onClick]
  );

  const handleAvatarMouseDown = useCallback(
    (e: React.MouseEvent) => handleMouseDown(e),
    [handleMouseDown]
  );

  const handleContextMenuClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onContextMenu?.(e);
    },
    [onContextMenu]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleDragOver(e);
    },
    [handleDragOver]
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleDragLeave(e);
    },
    [handleDragLeave]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      await handleDrop(e);
    },
    [handleDrop]
  );

  if (skinError && onSkinError) {
    onSkinError(skinError);
  }

  return (
    <div
      className="relative select-none"
      style={{
        width: actualSize,
        height: actualSize,
        transform: isDragOver ? 'scale(1.1)' : 'scale(1)',
        transition: 'transform 0.2s ease',
      }}
      onDragEnter={(e) => {
        e.preventDefault();
      }}
      onDragOver={enableSkinDrop ? onDragOver : undefined}
      onDragLeave={enableSkinDrop ? onDragLeave : undefined}
      onDrop={enableSkinDrop ? onDrop : undefined}
    >
      <div
        className="w-full h-full rounded-full flex items-center justify-center shadow-lg cursor-pointer overflow-hidden"
        style={{
          background: hasCustomSkin
            ? 'transparent'
            : 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
        }}
        onMouseDown={handleAvatarMouseDown}
        onClick={handleAvatarClick}
        onContextMenu={handleContextMenuClick}
        title={`Paper Pal Avatar (${currentState})\n• 点击激活\n• 右键菜单\n• 拖拽图片换肤\n• 拖拽移动窗口`}
      >
        {hasCustomSkin ? (
          isEmojiSkin ? (
            // 渲染表情符号
            <span
              className="select-none"
              style={{ fontSize: actualSize * 0.4 }}
            >
              {skinUrl}
            </span>
          ) : (
            // 渲染图片
            <img
              src={skinUrl}
              alt="Avatar"
              className="w-full h-full object-contain"
              draggable={false}
            />
          )
        ) : (
          <span
            className="text-white select-none"
            style={{ fontSize: actualSize * 0.4 }}
          >
            {DEFAULT_EMOJIS[currentState]}
          </span>
        )}
      </div>

      {isDragOver && (
        <div className="absolute inset-0 rounded-full bg-blue-500/30 border-2 border-dashed border-blue-400 flex items-center justify-center">
          <span className="text-white text-xs font-medium bg-blue-500/80 px-2 py-1 rounded">
            放开替换皮肤
          </span>
        </div>
      )}

      <div
        className={`absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-white ${
          currentState === 'idle'
            ? 'bg-gray-400'
            : currentState === 'alert'
              ? 'bg-yellow-400'
              : 'bg-green-400'
        }`}
      />
    </div>
  );
}

export default Avatar;
