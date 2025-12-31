'use client';

import React, { useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { useSkinManager } from '@/hooks/useSkinManager';

interface WindowSettingsProps {
  onClose: () => void;
}

const SCALE_PRESETS = [
  { label: '小 (0.5x)', value: 0.5 },
  { label: '默认 (1.0x)', value: 1.0 },
  { label: '大 (1.5x)', value: 1.5 },
  { label: '超大 (2.0x)', value: 2.0 },
];

export default function WindowSettingsFixed({ onClose }: WindowSettingsProps) {
  const { skinScale, setSkinScale } = useAppStore();
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
  
  const [activeTab, setActiveTab] = useState<'avatar' | 'presets' | 'window'>('avatar');
  const [error, setError] = useState<string | null>(null);

  const handleScaleChange = useCallback((scale: number) => {
    setSkinScale(scale);
    setScale(scale);
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">设置</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('avatar')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'avatar'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            头像设置
          </button>
          <button
            onClick={() => setActiveTab('presets')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'presets'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            预设皮肤
          </button>
          <button
            onClick={() => setActiveTab('window')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'window'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            窗口设置
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {activeTab === 'avatar' && (
            <div className="space-y-6">
              {/* Error Display */}
              {currentError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-red-600 text-sm">{currentError}</p>
                </div>
              )}

              {/* Avatar Scale */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  头像大小 ({skinScale.toFixed(1)}x)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {SCALE_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => handleScaleChange(preset.value)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                        Math.abs(skinScale - preset.value) < 0.01
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Skin Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  自定义皮肤
                </label>
                <div className="space-y-4">
                  {(['idle', 'alert', 'active'] as const).map((state) => {
                    const stateNames = {
                      idle: '空闲状态',
                      alert: '提醒状态', 
                      active: '活跃状态'
                    };
                    
                    const currentAsset = getStateAssetUrl(state);
                    
                    return (
                      <div key={state} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                        <div className="w-12 h-12 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center overflow-hidden">
                          {currentAsset ? (
                            currentAsset.startsWith('😊') || currentAsset.length <= 4 ? (
                              <span className="text-lg">{currentAsset}</span>
                            ) : (
                              <img 
                                src={currentAsset} 
                                alt={stateNames[state]}
                                className="w-full h-full object-cover"
                              />
                            )
                          ) : (
                            <span className="text-lg">😊</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700">{stateNames[state]}</p>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/gif"
                            onChange={(e) => handleFileUpload(state, e)}
                            className="mt-1 text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reset Button */}
              <div className="pt-4 border-t border-gray-200">
                <button
                  onClick={handleResetSkin}
                  className="w-full px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                >
                  🔄 重置为默认皮肤
                </button>
              </div>
            </div>
          )}

          {activeTab === 'presets' && (
            <div className="space-y-4">
              {/* Error Display */}
              {currentError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-red-600 text-sm">{currentError}</p>
                </div>
              )}

              {/* Simple Preset Selection */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-3">选择预设皮肤</h4>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'default', name: '默认表情', preview: '😊' },
                    { id: 'cat-spirit', name: '猫咪精灵', preview: '🐱' },
                    { id: 'robot-assistant', name: '机器人助手', preview: '🤖' },
                    { id: 'magic-crystal', name: '魔法水晶', preview: '💎' },
                    { id: 'paper-scholar', name: '学者精灵', preview: '📚' },
                    { id: 'pixel-buddy', name: '像素伙伴', preview: '🎮' },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => handlePresetSelect(preset.id)}
                      disabled={isLoading}
                      className={`p-3 rounded-lg border-2 transition-colors ${
                        skinConfig.presetId === preset.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="text-2xl mb-2">{preset.preview}</div>
                      <div className="text-sm font-medium text-gray-800">{preset.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'window' && (
            <div className="space-y-6">
              <div className="text-center text-gray-500 py-8">
                <p className="mb-2">窗口设置</p>
                <p className="text-sm">
                  • 拖拽头像可移动窗口位置<br/>
                  • 拖拽窗口边缘可调整大小
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}