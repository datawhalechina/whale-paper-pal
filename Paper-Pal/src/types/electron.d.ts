export interface ElectronAPI {
  // Window management
  setPosition: (x: number, y: number) => Promise<void>;
  getPosition: () => Promise<{ x: number; y: number } | null>;
  setClickThrough: (enabled: boolean) => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<void>;
  
  // Window size management
  setAvatarSize: (width: number, height: number) => Promise<void>;
  getAvatarSize: () => Promise<{ width: number; height: number } | null>;
  setMainWindowSize: (width: number, height: number) => Promise<void>;
  getMainWindowSize: () => Promise<{ width: number; height: number } | null>;
  
  // Main window management
  showMainWindow: () => Promise<void>;
  hideMainWindow: () => Promise<void>;
  
  // App control
  quitApp: () => Promise<void>;

  // Config store
  getConfig: (key: string) => Promise<unknown>;
  setConfig: (key: string, value: unknown) => Promise<void>;
  getAllConfig: () => Promise<AppConfig | null>;
  exportConfig: () => Promise<string>;
  importConfig: (json: string) => Promise<void>;
  resetConfig: () => Promise<void>;

  // Config change notifications
  onConfigChanged: (callback: (key: string, value: unknown) => void) => () => void;

  // API Key management (Requirement 9.1 - Secure storage)
  setApiKey: (provider: 'openai' | 'gemini', apiKey: string) => Promise<void>;
  getApiKey: (provider: 'openai' | 'gemini') => Promise<string | undefined>;
  hasApiKey: (provider: 'openai' | 'gemini') => Promise<boolean>;
  removeApiKey: (provider: 'openai' | 'gemini') => Promise<void>;

  // Shell operations
  openExternal: (url: string) => Promise<void>;
}

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

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
