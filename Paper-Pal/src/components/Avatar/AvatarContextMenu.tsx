/**
 * Avatar Context Menu Component
 * Right-click menu for avatar scale adjustment and skin reset
 *
 * Requirements:
 * - 3.5: Scale avatar between 0.5x and 3.0x via right-click menu
 * - 3.1: Reset skin to default
 */

'use client';

import { useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { useSkinManager } from '@/hooks/useSkinManager';

interface AvatarContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
}

// Scale presets
const SCALE_PRESETS = [
  { label: '0.5x (小)', value: 0.5 },
  { label: '1.0x (默认)', value: 1.0 },
  { label: '1.5x', value: 1.5 },
  { label: '2.0x', value: 2.0 },
  { label: '2.5x', value: 2.5 },
  { label: '3.0x (大)', value: 3.0 },
];

export function AvatarContextMenu({ x, y, onClose }: AvatarContextMenuProps) {
  const { skinScale, setSkinScale } = useAppStore();
  const { resetToDefault, setScale } = useSkinManager();

  // Handle scale change
  const handleScaleChange = useCallback(
    (scale: number) => {
      setSkinScale(scale);
      setScale(scale);
      onClose();
    },
    [setSkinScale, setScale, onClose]
  );

  // Handle reset skin
  const handleResetSkin = useCallback(() => {
    resetToDefault();
    onClose();
  }, [resetToDefault, onClose]);

  // Handle scale increase
  const handleScaleIncrease = useCallback(() => {
    const newScale = Math.min(3.0, skinScale + 0.25);
    handleScaleChange(newScale);
  }, [skinScale, handleScaleChange]);

  // Handle scale decrease
  const handleScaleDecrease = useCallback(() => {
    const newScale = Math.max(0.5, skinScale - 0.25);
    handleScaleChange(newScale);
  }, [skinScale, handleScaleChange]);

  // Handle quit app
  const handleQuit = useCallback(() => {
    if (window.electronAPI?.quitApp) {
      window.electronAPI.quitApp();
    }
    onClose(); // 关闭菜单
  }, [onClose]);

  // Close on escape key or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // 检查点击是否在菜单外部
      const target = e.target as HTMLElement;
      if (!target.closest('.context-menu-container')) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onClose]);

  // Adjust position to keep menu in viewport - position above click point if near bottom
  const menuHeight = 450; // Approximate menu height
  const maxHeight = Math.min(400, window.innerHeight - 40); // 最大高度，留40px边距
  const adjustedPosition = {
    x: Math.min(x, window.innerWidth - 200),
    y: y + menuHeight > window.innerHeight ? Math.max(10, y - menuHeight) : y,
  };

  return (
    <AnimatePresence>
      <motion.div
        key="menu"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.15 }}
        className="context-menu-container fixed z-[70] glass-dark shadow-xl min-w-[180px] py-2 overflow-y-auto transparent-scrollbar"
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          maxHeight: `${maxHeight}px`,
        }}
      >
        {/* Close Menu Button */}
        <MenuItem
          label="✕ 关闭菜单"
          onClick={onClose}
        />

        {/* Divider */}
        <div className="my-2 border-t border-white/10" />

        {/* Scale Section */}
        <div className="px-3 py-1.5 text-xs text-gray-400 uppercase tracking-wider">
          缩放 ({skinScale.toFixed(2)}x)
        </div>

        {/* Scale Presets */}
        {SCALE_PRESETS.map((preset) => (
          <MenuItem
            key={preset.value}
            label={preset.label}
            onClick={() => handleScaleChange(preset.value)}
            isActive={Math.abs(skinScale - preset.value) < 0.01}
          />
        ))}

        {/* Divider */}
        <div className="my-2 border-t border-white/10" />

        {/* Quick Scale Buttons */}
        <div className="px-3 py-1.5 flex gap-2">
          <button
            onClick={handleScaleDecrease}
            disabled={skinScale <= 0.5}
            className="flex-1 px-2 py-1 text-sm bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
          >
            − 缩小
          </button>
          <button
            onClick={handleScaleIncrease}
            disabled={skinScale >= 3.0}
            className="flex-1 px-2 py-1 text-sm bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
          >
            + 放大
          </button>
        </div>

        {/* Divider */}
        <div className="my-2 border-t border-white/10" />

        {/* Skin Section */}
        <div className="px-3 py-1.5 text-xs text-gray-400 uppercase tracking-wider">
          皮肤
        </div>

        <MenuItem
          label="🔄 重置为默认皮肤"
          onClick={handleResetSkin}
        />

        {/* Divider */}
        <div className="my-2 border-t border-white/10" />

        <MenuItem
          label="🚪 退出"
          onClick={handleQuit}
        />
      </motion.div>
    </AnimatePresence>
  );
}

interface MenuItemProps {
  label: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  hint?: string;
}

function MenuItem({ label, onClick, isActive, disabled, hint }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
        disabled
          ? 'text-gray-500 cursor-default'
          : isActive
            ? 'bg-purple-500/30 text-purple-200'
            : 'text-white hover:bg-white/10'
      }`}
    >
      <span>{label}</span>
      {hint && (
        <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>
      )}
    </button>
  );
}

export default AvatarContextMenu;
