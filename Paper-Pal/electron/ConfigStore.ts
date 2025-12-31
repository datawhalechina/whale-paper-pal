import Store from 'electron-store';
import { safeStorage } from 'electron';

/**
 * Application configuration interface
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */
export interface AppConfig {
  window: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  };
  mainWindow: {
    width: number;
    height: number;
  };
  skin: {
    type: 'default' | 'custom';
    customPaths?: {
      idle?: string;
      alert?: string;
      active?: string;
    };
  };
  apiKeys: {
    openai?: string;
    gemini?: string;
  };
  scoring: {
    threshold: number;
    interests: string[];
  };
}

/**
 * Internal storage schema with encrypted API keys
 */
interface InternalConfig {
  window: AppConfig['window'];
  mainWindow: AppConfig['mainWindow'];
  skin: AppConfig['skin'];
  encryptedApiKeys: {
    openai?: string;
    gemini?: string;
  };
  scoring: AppConfig['scoring'];
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: AppConfig = {
  window: {
    x: -1,  // -1 表示使用屏幕右下角计算
    y: -1,
    width: 200,
    height: 280,
    scale: 1.0,
  },
  mainWindow: {
    width: 1200,
    height: 800,
  },
  skin: {
    type: 'default',
  },
  apiKeys: {},
  scoring: {
    threshold: 7.0,
    interests: ['LLM', 'RAG', 'Agent', '多模态'],
  },
};

const DEFAULT_INTERNAL_CONFIG: InternalConfig = {
  window: DEFAULT_CONFIG.window,
  mainWindow: DEFAULT_CONFIG.mainWindow,
  skin: DEFAULT_CONFIG.skin,
  encryptedApiKeys: {},
  scoring: DEFAULT_CONFIG.scoring,
};

/**
 * ConfigStore class
 * Manages local configuration storage using electron-store
 * 
 * Requirements:
 * - 9.1: Store API Keys in Electron's secure storage (not uploaded to server)
 * - 9.2: Store skin paths, window position, preferences as local JSON
 * - 9.3: Load configurations on startup
 * - 9.4: Export/import functionality for backup
 */
export class ConfigStore {
  private store: Store<InternalConfig>;

  constructor() {
    this.store = new Store<InternalConfig>({
      name: 'paper-pal-config',
      defaults: DEFAULT_INTERNAL_CONFIG,
    });
    
    // 一次性配置迁移：检查并重置旧的窗口配置
    this.migrateWindowConfig();
  }
  
  /**
   * 迁移旧的窗口配置到新的默认值
   * 只在检测到旧配置时执行一次
   */
  private migrateWindowConfig(): void {
    const windowConfig = this.store.get('window');
    
    // 检查是否已经迁移过（通过检查是否有 migrated 标记）
    const migrated = (this.store as unknown as { get: (key: string) => boolean }).get('_migrated_v3');
    if (migrated) {
      return; // 已经迁移过，跳过
    }
    
    let needsReset = false;
    const resetConfig = { ...windowConfig };
    
    // 如果缺少 width/height 或超出合理范围，重置
    if (!windowConfig.width || !windowConfig.height || windowConfig.width > 250 || windowConfig.height > 350) {
      resetConfig.width = DEFAULT_CONFIG.window.width;
      resetConfig.height = DEFAULT_CONFIG.window.height;
      needsReset = true;
    }
    
    // 如果位置超出合理范围（旧的大屏幕位置），重置为-1
    if (windowConfig.x > 2000 || windowConfig.y > 1500) {
      resetConfig.x = -1;
      resetConfig.y = -1;
      needsReset = true;
    }
    
    if (needsReset) {
      this.store.set('window', resetConfig);
    }
    
    // 标记迁移完成
    (this.store as unknown as { set: (key: string, value: boolean) => void }).set('_migrated_v3', true);
  }

  /**
   * Encrypts a string using Electron's safeStorage
   * Requirement: 9.1 - Secure API key storage
   */
  private encryptString(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      return encrypted.toString('base64');
    }
    // Fallback: base64 encoding if encryption not available
    return Buffer.from(value).toString('base64');
  }

  /**
   * Decrypts a string using Electron's safeStorage
   * Requirement: 9.1 - Secure API key storage
   */
  private decryptString(encrypted: string): string {
    try {
      const buffer = Buffer.from(encrypted, 'base64');
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(buffer);
      }
      // Fallback: base64 decoding if encryption not available
      return buffer.toString('utf-8');
    } catch {
      return '';
    }
  }

  /**
   * Gets a configuration value by key
   * Requirement: 9.3 - Load configurations on startup
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    if (key === 'apiKeys') {
      const encrypted = this.store.get('encryptedApiKeys');
      const decrypted: AppConfig['apiKeys'] = {};
      if (encrypted.openai) {
        decrypted.openai = this.decryptString(encrypted.openai);
      }
      if (encrypted.gemini) {
        decrypted.gemini = this.decryptString(encrypted.gemini);
      }
      return decrypted as AppConfig[K];
    }
    
    // 验证窗口配置，确保使用合理的默认值
    if (key === 'window') {
      return this.store.get('window') as AppConfig[K];
    }
    
    return this.store.get(key) as AppConfig[K];
  }

  /**
   * Sets a configuration value by key
   * Requirement: 9.2 - Store configurations as local JSON
   * Requirement: 9.1 - API Keys stored securely
   */
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    if (key === 'apiKeys') {
      const apiKeys = value as AppConfig['apiKeys'];
      const encrypted: InternalConfig['encryptedApiKeys'] = {};
      if (apiKeys.openai) {
        encrypted.openai = this.encryptString(apiKeys.openai);
      }
      if (apiKeys.gemini) {
        encrypted.gemini = this.encryptString(apiKeys.gemini);
      }
      this.store.set('encryptedApiKeys', encrypted);
    } else {
      this.store.set(key, value as InternalConfig[Exclude<K, 'apiKeys'>]);
    }
  }

  /**
   * Sets a specific API key securely
   * Requirement: 9.1 - Secure API key storage
   */
  setApiKey(provider: 'openai' | 'gemini', apiKey: string): void {
    const encrypted = this.store.get('encryptedApiKeys');
    encrypted[provider] = this.encryptString(apiKey);
    this.store.set('encryptedApiKeys', encrypted);
  }

  /**
   * Gets a specific API key
   * Requirement: 9.1 - Secure API key storage
   */
  getApiKey(provider: 'openai' | 'gemini'): string | undefined {
    const encrypted = this.store.get('encryptedApiKeys');
    const encryptedKey = encrypted[provider];
    if (encryptedKey) {
      return this.decryptString(encryptedKey);
    }
    return undefined;
  }

  /**
   * Checks if an API key exists
   */
  hasApiKey(provider: 'openai' | 'gemini'): boolean {
    const encrypted = this.store.get('encryptedApiKeys');
    return !!encrypted[provider];
  }

  /**
   * Removes an API key
   */
  removeApiKey(provider: 'openai' | 'gemini'): void {
    const encrypted = this.store.get('encryptedApiKeys');
    delete encrypted[provider];
    this.store.set('encryptedApiKeys', encrypted);
  }

  /**
   * Gets the entire configuration object
   * Requirement: 9.3 - Load all configurations
   */
  getAll(): AppConfig {
    return {
      window: this.store.get('window'),
      mainWindow: this.store.get('mainWindow'),
      skin: this.store.get('skin'),
      apiKeys: this.get('apiKeys'),
      scoring: this.store.get('scoring'),
    };
  }

  /**
   * Exports configuration as JSON string (excluding API keys for security)
   * Requirement: 9.4 - Export functionality for backup
   */
  export(): string {
    const config: AppConfig = {
      window: this.store.get('window'),
      mainWindow: this.store.get('mainWindow'),
      skin: this.store.get('skin'),
      apiKeys: {}, // Don't export API keys for security
      scoring: this.store.get('scoring'),
    };
    return JSON.stringify(config, null, 2);
  }

  /**
   * Exports configuration including API keys (for full backup)
   * Requirement: 9.4 - Export functionality for backup
   * Warning: Use with caution, API keys will be in plain text
   */
  exportWithApiKeys(): string {
    const config = this.getAll();
    return JSON.stringify(config, null, 2);
  }

  /**
   * Imports configuration from JSON string
   * Requirement: 9.4 - Import functionality for backup
   */
  import(json: string): void {
    try {
      const config = JSON.parse(json) as Partial<AppConfig>;
      this.validateAndImport(config);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Invalid')) {
        throw error;
      }
      throw new Error('Invalid configuration JSON format');
    }
  }

  /**
   * Validates and imports configuration
   */
  private validateAndImport(config: Partial<AppConfig>): void {
    // Validate and import window config
    if (config.window) {
      if (!this.isValidWindowConfig(config.window)) {
        throw new Error('Invalid window configuration');
      }
      this.store.set('window', config.window);
    }

    // Validate and import main window config
    if (config.mainWindow) {
      if (!this.isValidMainWindowConfig(config.mainWindow)) {
        throw new Error('Invalid main window configuration');
      }
      this.store.set('mainWindow', config.mainWindow);
    }

    // Validate and import skin config
    if (config.skin) {
      if (!this.isValidSkinConfig(config.skin)) {
        throw new Error('Invalid skin configuration');
      }
      this.store.set('skin', config.skin);
    }

    // Validate and import scoring config
    if (config.scoring) {
      if (!this.isValidScoringConfig(config.scoring)) {
        throw new Error('Invalid scoring configuration');
      }
      this.store.set('scoring', config.scoring);
    }

    // Import API keys if provided (securely)
    if (config.apiKeys) {
      if (config.apiKeys.openai) {
        this.setApiKey('openai', config.apiKeys.openai);
      }
      if (config.apiKeys.gemini) {
        this.setApiKey('gemini', config.apiKeys.gemini);
      }
    }
  }

  /**
   * Validates window configuration
   */
  private isValidWindowConfig(window: AppConfig['window']): boolean {
    return (
      typeof window.x === 'number' &&
      typeof window.y === 'number' &&
      typeof window.width === 'number' &&
      typeof window.height === 'number' &&
      typeof window.scale === 'number' &&
      window.width >= 200 &&
      window.width <= 2000 &&
      window.height >= 200 &&
      window.height <= 2000 &&
      window.scale >= 0.5 &&
      window.scale <= 3.0
    );
  }

  /**
   * Validates main window configuration
   */
  private isValidMainWindowConfig(mainWindow: AppConfig['mainWindow']): boolean {
    return (
      typeof mainWindow.width === 'number' &&
      typeof mainWindow.height === 'number' &&
      mainWindow.width >= 800 &&
      mainWindow.width <= 3000 &&
      mainWindow.height >= 600 &&
      mainWindow.height <= 2000
    );
  }

  /**
   * Validates skin configuration
   */
  private isValidSkinConfig(skin: AppConfig['skin']): boolean {
    if (skin.type !== 'default' && skin.type !== 'custom') {
      return false;
    }
    if (skin.customPaths) {
      const paths = skin.customPaths;
      if (paths.idle && typeof paths.idle !== 'string') return false;
      if (paths.alert && typeof paths.alert !== 'string') return false;
      if (paths.active && typeof paths.active !== 'string') return false;
    }
    return true;
  }

  /**
   * Validates scoring configuration
   */
  private isValidScoringConfig(scoring: AppConfig['scoring']): boolean {
    return (
      typeof scoring.threshold === 'number' &&
      scoring.threshold >= 0 &&
      scoring.threshold <= 20 &&
      Array.isArray(scoring.interests) &&
      scoring.interests.every((i) => typeof i === 'string')
    );
  }

  /**
   * Resets configuration to defaults
   */
  reset(): void {
    this.store.clear();
  }

  /**
   * Gets the path to the config file
   */
  getPath(): string {
    return this.store.path;
  }
}
