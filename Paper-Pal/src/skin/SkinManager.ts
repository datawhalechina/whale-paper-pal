/**
 * Skin Manager
 * Handles skin loading, validation, and management for the Avatar system
 * Supports both single-image (drag-drop) and multi-state (settings) configurations
 * Now includes preset skin support
 *
 * Requirements:
 * - 3.1: Drag GIF/PNG onto avatar to replace skin (applies to all states)
 * - 3.3: Persist custom skin configuration
 * - 3.4: Load saved skin on startup
 * - 3.5: Scale avatar between 0.5x and 3.0x
 * - 3.6: Display error for invalid file format
 * - Multi-state skin support for settings panel
 * - Preset skin support for quick selection
 */

import { getSkinById } from './presets';

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.gif', '.png', '.jpg', '.jpeg'];
const SUPPORTED_MIME_TYPES = ['image/gif', 'image/png', 'image/jpeg', 'image/jpg'];

export interface SkinAsset {
  path: string;
  type: 'gif' | 'png' | 'jpg';
  dataUrl?: string;
}

// Multi-state skin configuration
export interface MultiStateSkinConfig {
  idle?: SkinAsset;
  alert?: SkinAsset;
  active?: SkinAsset;
}

export interface SkinConfig {
  type: 'default' | 'custom' | 'preset';
  // Legacy single asset (for drag-drop compatibility)
  asset: SkinAsset | null;
  // New multi-state assets (for settings panel)
  multiStateAssets?: MultiStateSkinConfig;
  // Preset skin ID (for preset skins)
  presetId?: string;
  scale: number;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  fileType?: 'gif' | 'png' | 'jpg';
}

export interface SkinLoadResult {
  success: boolean;
  config?: SkinConfig;
  error?: string;
}

export const DEFAULT_SKIN_CONFIG: SkinConfig = {
  type: 'default',
  asset: null,
  multiStateAssets: {},
  presetId: 'default',
  scale: 1.0,
};

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot);
}

export function validateFile(file: File): FileValidationResult {
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `文件大小超过限制 (最大 5MB)`,
    };
  }

  if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `不支持的文件格式。请使用 GIF、PNG 或 JPG`,
    };
  }

  const extension = getFileExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.includes(extension.toLowerCase())) {
    return {
      valid: false,
      error: `请使用 .gif、.png 或 .jpg 文件`,
    };
  }

  const ext = extension.toLowerCase();
  const fileType = ext === '.gif' ? 'gif' : ext === '.jpg' || ext === '.jpeg' ? 'jpg' : 'png';
  return { valid: true, fileType };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function clampScale(scale: number): number {
  return Math.max(0.5, Math.min(3.0, scale));
}

export interface SkinPersistence {
  save: (config: SkinConfig) => Promise<void>;
  load: () => Promise<SkinConfig | null>;
}

export class SkinManager {
  private currentSkin: SkinConfig = { ...DEFAULT_SKIN_CONFIG };
  private callbacks: ((skin: SkinConfig) => void)[] = [];
  private persistence?: SkinPersistence;

  constructor(initialConfig?: SkinConfig, persistence?: SkinPersistence) {
    if (initialConfig) {
      this.currentSkin = { ...initialConfig };
    }
    this.persistence = persistence;
  }

  getCurrentSkin(): SkinConfig {
    return { ...this.currentSkin };
  }

  validateFile(file: File): FileValidationResult {
    return validateFile(file);
  }

  async loadSkin(config: SkinConfig): Promise<void> {
    this.currentSkin = { ...config, scale: clampScale(config.scale) };
    this.notifyChange();
  }

  async loadFromPersistence(): Promise<boolean> {
    if (!this.persistence) return false;
    try {
      const saved = await this.persistence.load();
      if (saved) {
        await this.loadSkin(saved);
        return true;
      }
    } catch (e) {
      console.error('Failed to load skin:', e);
    }
    return false;
  }

  async saveSkin(config?: SkinConfig): Promise<void> {
    const toSave = config || this.currentSkin;
    if (this.persistence) {
      await this.persistence.save(toSave);
    }
    if (config) {
      this.currentSkin = { ...config, scale: clampScale(config.scale) };
      this.notifyChange();
    }
  }

  // Drag-drop: Apply single image to all states
  async loadSkinFromFiles(files: File[]): Promise<SkinLoadResult> {
    for (const file of files) {
      const validation = this.validateFile(file);
      if (validation.valid) {
        const dataUrl = await readFileAsDataUrl(file);
        const asset: SkinAsset = {
          path: file.name,
          type: validation.fileType!,
          dataUrl,
        };

        const newConfig: SkinConfig = {
          type: 'custom',
          asset, // Legacy single asset for compatibility
          multiStateAssets: {
            idle: asset,
            alert: asset,
            active: asset,
          },
          scale: this.currentSkin.scale,
        };

        this.currentSkin = newConfig;
        this.notifyChange();

        if (this.persistence) {
          await this.persistence.save(newConfig);
        }

        return { success: true, config: newConfig };
      }
    }
    return { success: false, error: '请使用 GIF、PNG 或 JPG 格式的图片' };
  }

  // Settings panel: Set individual state images
  async setStateImage(state: 'idle' | 'alert' | 'active', file: File): Promise<void> {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const dataUrl = await readFileAsDataUrl(file);
    const asset: SkinAsset = {
      path: file.name,
      type: validation.fileType!,
      dataUrl,
    };

    const newConfig: SkinConfig = {
      ...this.currentSkin,
      type: 'custom',
      multiStateAssets: {
        ...this.currentSkin.multiStateAssets,
        [state]: asset,
      },
    };

    this.currentSkin = newConfig;
    this.notifyChange();

    if (this.persistence) {
      await this.persistence.save(newConfig);
    }
  }

  // Get asset for specific state
  getStateAsset(state: 'idle' | 'alert' | 'active'): SkinAsset | null {
    // First check if using preset skin
    if (this.currentSkin.type === 'preset' && this.currentSkin.presetId) {
      return this.getPresetStateAsset(this.currentSkin.presetId, state);
    }
    
    // Then check multi-state assets
    if (this.currentSkin.multiStateAssets?.[state]) {
      return this.currentSkin.multiStateAssets[state]!;
    }
    
    // Fallback to legacy single asset
    return this.currentSkin.asset;
  }

  // Get preset skin asset for specific state
  private getPresetStateAsset(presetId: string, state: 'idle' | 'alert' | 'active'): SkinAsset | null {
    try {
      const presetSkin = getSkinById(presetId);
      if (!presetSkin) {
        console.error('Preset skin not found:', presetId);
        return null;
      }

      const assetPath = presetSkin.assets[state];
      if (!assetPath) {
        console.error('Asset not found for state:', state, 'in preset:', presetId);
        return null;
      }

      // For preset skins, the path IS the URL we want to use
      return {
        path: assetPath,
        type: this.getAssetTypeFromPath(assetPath),
        // Don't set dataUrl for preset skins - use path directly
      };
    } catch (error) {
      console.error('Failed to load preset skin:', error);
    }
    
    return null;
  }

  // Get asset type from file path
  private getAssetTypeFromPath(path: string): 'gif' | 'png' | 'jpg' {
    const ext = path.toLowerCase();
    if (ext.includes('.gif')) return 'gif';
    if (ext.includes('.jpg') || ext.includes('.jpeg')) return 'jpg';
    return 'png';
  }

  // Load preset skin
  async loadPresetSkin(presetId: string): Promise<void> {
    const newConfig: SkinConfig = {
      type: 'preset',
      asset: null,
      multiStateAssets: {},
      presetId,
      scale: this.currentSkin.scale,
    };

    this.currentSkin = newConfig;
    this.notifyChange();

    if (this.persistence) {
      await this.persistence.save(newConfig);
    }
  }

  setScale(scale: number): void {
    this.currentSkin = { ...this.currentSkin, scale: clampScale(scale) };
    this.notifyChange();
    if (this.persistence) {
      this.persistence.save(this.currentSkin).catch(console.error);
    }
  }

  getScale(): number {
    return this.currentSkin.scale;
  }

  resetToDefault(): void {
    this.currentSkin = { ...DEFAULT_SKIN_CONFIG };
    this.notifyChange();
    if (this.persistence) {
      this.persistence.save(this.currentSkin).catch(console.error);
    }
  }

  getAsset(): SkinAsset | null {
    return this.currentSkin.asset;
  }

  onSkinChange(callback: (skin: SkinConfig) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx > -1) {
        this.callbacks.splice(idx, 1);
      }
    };
  }

  private notifyChange(): void {
    const skin = this.getCurrentSkin();
    this.callbacks.forEach((cb) => {
      cb(skin);
    });
  }

  async handleFileDrop(files: FileList): Promise<SkinConfig> {
    if (files.length === 0) {
      throw new Error('没有文件被拖入');
    }
    const result = await this.loadSkinFromFiles(Array.from(files));
    if (!result.success) {
      throw new Error(result.error || '加载皮肤失败');
    }
    return result.config!;
  }
}
