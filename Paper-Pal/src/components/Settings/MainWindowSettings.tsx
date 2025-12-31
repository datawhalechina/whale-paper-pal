/**
 * 主界面设置组件
 * 包含精灵图像窗口大小设置和预设皮肤设置
 */

'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { useSkinManager } from '@/hooks/useSkinManager';
import { default as PresetSkinSelector } from './PresetSkinSelector';

interface MainWindowSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const WINDOW_SIZE_PRESETS = [
  { label: '迷你', value: 0.5, description: '最小空间，适合小屏幕', windowSize: { width: 150, height: 200 } },
  { label: '小', value: 0.75, description: '紧凑空间', windowSize: { width: 180, height: 240 } },
  { label: '默认', value: 1.0, description: '标准空间，推荐使用', windowSize: { width: 200, height: 280 } },
  { label: '大', value: 1.25, description: '稍大空间', windowSize: { width: 240, height: 340 } },
  { label: '超大', value: 1.5, description: '大空间，适合大屏幕', windowSize: { width: 280, height: 400 } },
  { label: '巨大', value: 2.0, description: '最大空间', windowSize: { width: 360, height: 500 } },
];

// 精灵本身大小缩放预设（与右键菜单保持一致）
const AVATAR_SCALE_PRESETS = [
  { label: '0.5x (小)', value: 0.5, description: '最小精灵' },
  { label: '1.0x (默认)', value: 1.0, description: '标准精灵' },
  { label: '1.5x', value: 1.5, description: '稍大精灵' },
  { label: '2.0x', value: 2.0, description: '大精灵' },
  { label: '2.5x', value: 2.5, description: '很大精灵' },
  { label: '3.0x (大)', value: 3.0, description: '最大精灵' },
];

export default function MainWindowSettings({ isOpen, onClose }: MainWindowSettingsProps) {
  const { skinScale, setSkinScale, windowSizeScale, setWindowSizeScale } = useAppStore();
  const { 
    skinConfig, 
    setScale, 
    resetToDefault, 
    setStateImage, 
    getStateAssetUrl,
    loadPresetSkin,
    isLoading,
    error: skinError 
  } = useSkinManager();
  
  const [activeTab, setActiveTab] = useState<'avatar' | 'presets' | 'advanced'>('avatar');
  const [error, setError] = useState<string | null>(null);

  const handleScaleChange = useCallback((scale: number) => {
    setWindowSizeScale(scale);
    
    // 直接设置对应的固定窗口大小
    if (window.electronAPI) {
      const preset = WINDOW_SIZE_PRESETS.find(p => p.value === scale);
      if (preset) {
        window.electronAPI.setAvatarSize(preset.windowSize.width, preset.windowSize.height).catch(() => {});
        
        // 保存窗口大小配置到Electron配置
        window.electronAPI.getConfig('window').then((currentWindowConfig: any) => {
          const newWindowConfig = {
            x: currentWindowConfig?.x || 1720,
            y: currentWindowConfig?.y || 880,
            scale: currentWindowConfig?.scale || 1.0,
            windowSizeScale: scale
          };
          window.electronAPI.setConfig('window', newWindowConfig);
        }).catch(() => {});
      }
    }
  }, [setWindowSizeScale]);

  // 处理精灵本身大小缩放（与右键菜单功能一致）
  const handleAvatarScaleChange = useCallback(async (scale: number) => {
    setSkinScale(scale);
    setScale(scale);
    
    // 确保跨窗口同步 - 保存到Electron配置，保持完整的window配置
    if (window.electronAPI) {
      try {
        const currentWindowConfig = await window.electronAPI.getConfig('window') as { x: number; y: number; scale: number } | null;
        const newWindowConfig = {
          x: currentWindowConfig?.x || 1720,
          y: currentWindowConfig?.y || 880,
          scale: scale
        };
        await window.electronAPI.setConfig('window', newWindowConfig);
      } catch {
        // Ignore config update errors
      }
    }
  }, [setSkinScale, setScale]);

  const handleFileUpload = useCallback(async (
    state: 'idle' | 'alert' | 'active',
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      await setStateImage(state, file);
    } catch (err) {
      const message = err instanceof Error ? err.message : '上传失败';
      setError(message);
    }
  }, [setStateImage]);

  const handleResetSkin = useCallback(() => {
    resetToDefault();
    setError(null);
  }, [resetToDefault]);

  const handlePresetSelect = useCallback(async (presetId: string) => {
    try {
      setError(null);
      await loadPresetSkin(presetId);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载预设皮肤失败';
      setError(message);
    }
  }, [loadPresetSkin]);

  const currentError = error || skinError;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="bg-gradient-to-br from-gray-900/95 via-purple-900/95 to-gray-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl min-w-[600px] max-w-[90vw] min-h-[500px] max-h-[90vh] w-[700px] h-[600px] resize overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚙️</span>
                <h2 className="text-xl font-semibold text-white">精灵设置</h2>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                aria-label="关闭设置"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/10 bg-white/5">
              <button
                onClick={() => setActiveTab('avatar')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'avatar'
                    ? 'text-purple-300 border-b-2 border-purple-400 bg-purple-500/20'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <span className="mr-2">🎭</span>
                精灵外观
              </button>
              <button
                onClick={() => setActiveTab('presets')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'presets'
                    ? 'text-purple-300 border-b-2 border-purple-400 bg-purple-500/20'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <span className="mr-2">✨</span>
                预设皮肤
              </button>
              <button
                onClick={() => setActiveTab('advanced')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'advanced'
                    ? 'text-purple-300 border-b-2 border-purple-400 bg-purple-500/20'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <span className="mr-2">🔧</span>
                高级设置
              </button>
            </div>

            {/* Content */}
            <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
              {activeTab === 'avatar' && (
                <div className="space-y-6">
                  {/* Error Display */}
                  {currentError && (
                    <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4">
                      <p className="text-red-300 text-sm">{currentError}</p>
                    </div>
                  )}

                  {/* Avatar Scale Settings */}
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <h3 className="text-white font-medium text-lg mb-4 flex items-center gap-2">
                      <span className="text-xl">🔍</span>
                      精灵大小
                    </h3>
                    <p className="text-white/60 text-sm mb-4">
                      调整精灵本身的显示大小，当前大小：{skinScale.toFixed(1)}x
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {AVATAR_SCALE_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleAvatarScaleChange(preset.value)}
                          className={`p-3 text-left rounded-lg border transition-all ${
                            Math.abs(skinScale - preset.value) < 0.01
                              ? 'bg-purple-500/30 border-purple-400 text-purple-200'
                              : 'bg-white/5 border-white/20 text-white/80 hover:bg-white/10 hover:border-white/30'
                          }`}
                        >
                          <div className="font-medium text-sm">{preset.label}</div>
                          <div className="text-xs opacity-70 mt-1">{preset.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Avatar Space Size Settings */}
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <h3 className="text-white font-medium text-lg mb-4 flex items-center gap-2">
                      <span className="text-xl">📏</span>
                      精灵空间大小
                    </h3>
                    <p className="text-white/60 text-sm mb-4">
                      调整精灵窗口的整体显示大小（包括精灵和气泡），当前大小：{windowSizeScale.toFixed(1)}x
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {WINDOW_SIZE_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleScaleChange(preset.value)}
                          className={`p-3 text-left rounded-lg border transition-all ${
                            Math.abs(windowSizeScale - preset.value) < 0.01
                              ? 'bg-purple-500/30 border-purple-400 text-purple-200'
                              : 'bg-white/5 border-white/20 text-white/80 hover:bg-white/10 hover:border-white/30'
                          }`}
                        >
                          <div className="font-medium text-sm">{preset.label}</div>
                          <div className="text-xs opacity-70 mt-1">{preset.description}</div>
                          <div className="text-xs opacity-50 mt-1">
                            {preset.windowSize.width}×{preset.windowSize.height}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Current Skin Preview */}
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <h3 className="text-white font-medium text-lg mb-4 flex items-center gap-2">
                      <span className="text-xl">👁️</span>
                      当前皮肤预览
                    </h3>
                    <div className="flex items-center gap-4">
                      {(['idle', 'alert', 'active'] as const).map((state) => {
                        const stateNames = {
                          idle: '空闲',
                          alert: '提醒', 
                          active: '活跃'
                        };
                        
                        const currentAsset = getStateAssetUrl(state);
                        
                        return (
                          <div key={state} className="text-center">
                            <div className="w-16 h-16 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center overflow-hidden mb-2">
                              {currentAsset ? (
                                currentAsset.length <= 4 && !currentAsset.startsWith('/') && !currentAsset.startsWith('http') ? (
                                  <span className="text-2xl">{currentAsset}</span>
                                ) : (
                                  <img 
                                    src={currentAsset} 
                                    alt={stateNames[state]}
                                    className="w-full h-full object-cover"
                                  />
                                )
                              ) : (
                                <span className="text-2xl">😊</span>
                              )}
                            </div>
                            <p className="text-white/60 text-xs">{stateNames[state]}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'presets' && (
                <div className="space-y-4">
                  {/* Error Display */}
                  {currentError && (
                    <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4">
                      <p className="text-red-300 text-sm">{currentError}</p>
                    </div>
                  )}

                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <h3 className="text-white font-medium text-lg mb-4 flex items-center gap-2">
                      <span className="text-xl">🎨</span>
                      选择预设皮肤
                    </h3>
                    <p className="text-white/60 text-sm mb-4">
                      从精美的预设皮肤中选择一个，或者在高级设置中自定义皮肤
                    </p>
                    
                    <PresetSkinSelector
                      currentPresetId={skinConfig.presetId}
                      onSelectPreset={handlePresetSelect}
                      isLoading={isLoading}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'advanced' && (
                <div className="space-y-6">
                  {/* Error Display */}
                  {currentError && (
                    <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4">
                      <p className="text-red-300 text-sm">{currentError}</p>
                    </div>
                  )}

                  {/* Custom Skin Upload */}
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <h3 className="text-white font-medium text-lg mb-4 flex items-center gap-2">
                      <span className="text-xl">🖼️</span>
                      自定义皮肤
                    </h3>
                    <p className="text-white/60 text-sm mb-4">
                      为每个状态单独上传图片，支持 PNG、JPG、GIF 格式
                    </p>
                    <div className="space-y-4">
                      {(['idle', 'alert', 'active'] as const).map((state) => {
                        const stateNames = {
                          idle: '空闲状态',
                          alert: '提醒状态', 
                          active: '活跃状态'
                        };
                        
                        const stateDescriptions = {
                          idle: '平时显示的状态',
                          alert: '有新消息时显示',
                          active: '用户交互时显示'
                        };
                        
                        const currentAsset = getStateAssetUrl(state);
                        
                        return (
                          <div key={state} className="flex items-center gap-4 p-4 bg-white/5 rounded-lg border border-white/10">
                            <div className="w-16 h-16 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center overflow-hidden">
                              {currentAsset ? (
                                currentAsset.length <= 4 && !currentAsset.startsWith('/') && !currentAsset.startsWith('http') ? (
                                  <span className="text-2xl">{currentAsset}</span>
                                ) : (
                                  <img 
                                    src={currentAsset} 
                                    alt={stateNames[state]}
                                    className="w-full h-full object-cover"
                                  />
                                )
                              ) : (
                                <span className="text-2xl">😊</span>
                              )}
                            </div>
                            <div className="flex-1">
                              <h4 className="text-white font-medium text-sm">{stateNames[state]}</h4>
                              <p className="text-white/60 text-xs mb-2">{stateDescriptions[state]}</p>
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/jpg,image/gif"
                                onChange={(e) => handleFileUpload(state, e)}
                                className="text-xs text-white/70 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-purple-500/30 file:text-purple-200 hover:file:bg-purple-500/40 file:transition-colors"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Reset Section */}
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <h3 className="text-white font-medium text-lg mb-4 flex items-center gap-2">
                      <span className="text-xl">🔄</span>
                      重置设置
                    </h3>
                    <p className="text-white/60 text-sm mb-4">
                      将所有皮肤设置恢复为默认状态
                    </p>
                    <button
                      onClick={handleResetSkin}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-lg transition-colors text-sm"
                    >
                      🔄 重置为默认皮肤
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center p-6 border-t border-white/10 bg-white/5">
              <div className="text-white/60 text-sm">
                💡 提示：设置会自动保存并同步到精灵窗口
              </div>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors font-medium"
              >
                完成
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}