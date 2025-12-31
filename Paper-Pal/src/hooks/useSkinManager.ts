/**
 * React hook for Skin Manager
 * Provides skin management functionality with drag-and-drop support
 * Uses a global SkinManager instance to ensure consistency across components
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  SkinConfig,
  DEFAULT_SKIN_CONFIG,
  clampScale,
} from '@/skin/SkinManager';
import { getGlobalSkinManager } from '@/skin/GlobalSkinManager';

interface UseSkinManagerOptions {
  initialConfig?: SkinConfig;
  onError?: (error: string) => void;
  onSkinChange?: (config: SkinConfig) => void;
  enablePersistence?: boolean;
}

interface UseSkinManagerReturn {
  skinConfig: SkinConfig;
  scale: number;
  isLoading: boolean;
  error: string | null;
  setScale: (scale: number) => void;
  resetToDefault: () => void;
  loadSkin: (config: SkinConfig) => Promise<void>;
  loadPresetSkin: (presetId: string) => Promise<void>;
  saveSkin: () => Promise<void>;
  getAssetUrl: () => string | undefined;
  getStateAssetUrl: (state: 'idle' | 'alert' | 'active') => string | undefined;
  setStateImage: (state: 'idle' | 'alert' | 'active', file: File) => Promise<void>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  isDragOver: boolean;
}

export function useSkinManager(options: UseSkinManagerOptions = {}): UseSkinManagerReturn {
  const { onError, onSkinChange } = options;

  const [skinConfig, setSkinConfig] = useState<SkinConfig>(DEFAULT_SKIN_CONFIG);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Get the global SkinManager instance
  const manager = getGlobalSkinManager();

  useEffect(() => {
    // Set initial config from manager
    const currentConfig = manager.getCurrentSkin();
    setSkinConfig(currentConfig);

    // Subscribe to skin changes
    const unsubscribe = manager.onSkinChange((config) => {
      setSkinConfig(config);
      onSkinChange?.(config);
    });

    return () => {
      unsubscribe();
    };
  }, [manager, onSkinChange]);

  const setScale = useCallback((scale: number) => {
    manager.setScale(scale);
  }, [manager]);

  const resetToDefault = useCallback(() => {
    manager.resetToDefault();
  }, [manager]);

  const loadPresetSkin = useCallback(async (presetId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await manager.loadPresetSkin(presetId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载预设皮肤失败';
      setError(msg);
      onError?.(msg);
    } finally {
      setIsLoading(false);
    }
  }, [manager, onError]);

  const loadSkin = useCallback(async (config: SkinConfig) => {
    setIsLoading(true);
    setError(null);
    try {
      await manager.loadSkin(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载皮肤失败';
      setError(msg);
      onError?.(msg);
    } finally {
      setIsLoading(false);
    }
  }, [manager, onError]);

  const saveSkin = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await manager.saveSkin();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存皮肤失败';
      setError(msg);
      onError?.(msg);
    } finally {
      setIsLoading(false);
    }
  }, [manager, onError]);

  const getAssetUrl = useCallback((): string | undefined => {
    return skinConfig.asset?.dataUrl || skinConfig.asset?.path;
  }, [skinConfig]);

  const getStateAssetUrl = useCallback((state: 'idle' | 'alert' | 'active'): string | undefined => {
    const asset = manager.getStateAsset(state);
    // For preset skins, prefer path over dataUrl since dataUrl might not be set
    const url = asset?.dataUrl || asset?.path;
    return url;
  }, [manager, skinConfig]); // Keep skinConfig dependency to trigger updates

  const setStateImage = useCallback(async (state: 'idle' | 'alert' | 'active', file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      await manager.setStateImage(state, file);
      
      // Force update the local state to ensure UI updates
      const newConfig = manager.getCurrentSkin();
      setSkinConfig(newConfig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '设置皮肤失败';
      setError(msg);
      onError?.(msg);
    } finally {
      setIsLoading(false);
    }
  }, [manager, onError]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setError(null);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) {
      const msg = '没有文件被拖入';
      setError(msg);
      onError?.(msg);
      return;
    }

    setIsLoading(true);
    try {
      await manager.handleFileDrop(files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载皮肤失败';
      setError(msg);
      onError?.(msg);
    } finally {
      setIsLoading(false);
    }
  }, [manager, onError]);

  return {
    skinConfig,
    scale: skinConfig.scale,
    isLoading,
    error,
    setScale,
    resetToDefault,
    loadSkin,
    loadPresetSkin,
    saveSkin,
    getAssetUrl,
    getStateAssetUrl,
    setStateImage,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isDragOver,
  };
}

export { clampScale };