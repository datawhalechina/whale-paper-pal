/**
 * Global Skin Manager Singleton
 * Ensures all components share the same SkinManager instance
 */

import { SkinManager, SkinConfig, SkinPersistence } from './SkinManager';

let globalSkinManager: SkinManager | null = null;

function createElectronPersistence(): SkinPersistence | undefined {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return undefined;
  }

  return {
    save: async (config: SkinConfig) => {
      const skinData = {
        type: config.type,
        asset: config.asset,
        multiStateAssets: config.multiStateAssets,
        presetId: config.presetId, // Make sure to save presetId
      };
      await window.electronAPI.setConfig('skin', skinData);

      const windowConfig = await window.electronAPI.getConfig('window') as { x: number; y: number; scale: number } | null;
      if (windowConfig) {
        await window.electronAPI.setConfig('window', { ...windowConfig, scale: config.scale });
      }
    },
    load: async (): Promise<SkinConfig | null> => {
      try {
        const skinData = await window.electronAPI.getConfig('skin') as {
          type: 'default' | 'custom' | 'preset';
          asset?: { path: string; type: 'gif' | 'png' | 'jpg'; dataUrl?: string };
          multiStateAssets?: {
            idle?: { path: string; type: 'gif' | 'png' | 'jpg'; dataUrl?: string };
            alert?: { path: string; type: 'gif' | 'png' | 'jpg'; dataUrl?: string };
            active?: { path: string; type: 'gif' | 'png' | 'jpg'; dataUrl?: string };
          };
          presetId?: string; // Add presetId to the type
        } | null;

        const windowConfig = await window.electronAPI.getConfig('window') as { scale?: number } | null;

        if (!skinData) return null;

        return {
          type: skinData.type,
          asset: skinData.asset || null,
          multiStateAssets: skinData.multiStateAssets || {},
          presetId: skinData.presetId, // Make sure to load presetId
          scale: windowConfig?.scale || 1.0,
        };
      } catch (e) {
        console.error('Failed to load skin config:', e);
        return null;
      }
    },
  };
}

export function getGlobalSkinManager(): SkinManager {
  if (!globalSkinManager) {
    const persistence = createElectronPersistence();
    globalSkinManager = new SkinManager(undefined, persistence);
    
    // Load from persistence on first creation
    if (persistence) {
      globalSkinManager.loadFromPersistence();
    }

    // Listen for config changes from other windows
    if (typeof window !== 'undefined' && window.electronAPI?.onConfigChanged) {
      window.electronAPI.onConfigChanged((key: string, value: unknown) => {
        if (key === 'skin' && globalSkinManager) {
          // Reload skin configuration from the updated value
          const skinData = value as any;
          if (skinData) {
            const newConfig = {
              type: skinData.type || 'default',
              asset: skinData.asset || null,
              multiStateAssets: skinData.multiStateAssets || {},
              presetId: skinData.presetId,
              scale: globalSkinManager.getCurrentSkin().scale,
            };
            globalSkinManager.loadSkin(newConfig);
          }
        }
      });
    }
  }
  
  return globalSkinManager;
}

// Reset function for testing or cleanup
export function resetGlobalSkinManager(): void {
  globalSkinManager = null;
}