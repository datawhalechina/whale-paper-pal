import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { ConfigStore } from './ConfigStore';

/**
 * Window configuration interface
 * Requirements: 1.1, 1.2, 1.3
 */
export interface WindowConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  transparent: boolean;
  frame: boolean;
}

/**
 * Default window configuration for the avatar window
 */
export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  x: -1,  // -1 表示使用屏幕右下角计算
  y: -1,  
  width: 240,
  height: 340,
  alwaysOnTop: true,
  transparent: true,
  frame: false,
};

/**
 * Default configuration for the main application window (Dashboard/Chat)
 */
export const DEFAULT_MAIN_WINDOW_CONFIG = {
  width: 1200,
  height: 800,
  alwaysOnTop: false,
  transparent: false,
  frame: true,
  resizable: true,
  minimizable: true,
  maximizable: true,
};

/**
 * WindowManager class
 * Manages the transparent, frameless, always-on-top avatar window
 * 
 * Requirements:
 * - 1.1: Create frameless, transparent window at bottom-right corner
 * - 1.2: Always-on-top functionality
 * - 1.3: Click-through for transparent areas
 */
export class WindowManager {
  private window: BrowserWindow | null = null;
  private mainWindow: BrowserWindow | null = null;
  private isDev: boolean;
  private configStore: ConfigStore;

  constructor(isDev: boolean = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    // 更准确的开发环境检测
    // 在开发模式下，通常 NODE_ENV 未设置或为 'development'
    // 在打包后的应用中，resourcesPath 会指向应用内部资源
    const isPackaged = process.resourcesPath && !process.resourcesPath.includes('node_modules');
    this.isDev = isDev && !isPackaged;
    this.configStore = new ConfigStore();
    
    console.log('WindowManager initialized:', {
      NODE_ENV: process.env.NODE_ENV,
      resourcesPath: process.resourcesPath,
      isPackaged,
      isDev: this.isDev
    });
  }

  /**
   * Creates the avatar window with transparent, frameless configuration
   * Requirements: 1.1, 1.2
   */
  createAvatarWindow(config: Partial<WindowConfig> = {}): BrowserWindow {
    // Load window configuration from store
    const storedConfig = this.configStore.get('window');
    
    const finalConfig: WindowConfig = {
      x: config.x ?? storedConfig.x ?? DEFAULT_WINDOW_CONFIG.x,
      y: config.y ?? storedConfig.y ?? DEFAULT_WINDOW_CONFIG.y,
      width: config.width ?? storedConfig.width ?? DEFAULT_WINDOW_CONFIG.width,
      height: config.height ?? storedConfig.height ?? DEFAULT_WINDOW_CONFIG.height,
      alwaysOnTop: config.alwaysOnTop ?? true,
      transparent: config.transparent ?? true,
      frame: config.frame ?? false,
    };
    
    // 获取屏幕尺寸
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    // 如果位置为-1或超出屏幕范围，则计算屏幕右下角位置
    let x = finalConfig.x;
    let y = finalConfig.y;
    
    // 检查是否需要自动计算位置（-1表示自动）
    const needsAutoPosition = x === -1 || y === -1;
    
    if (needsAutoPosition) {
      x = screenWidth - finalConfig.width - 50; // 距离右边缘50px
      y = screenHeight - finalConfig.height - 100; // 距离底部100px
    } else if (x > screenWidth - finalConfig.width || y > screenHeight - finalConfig.height) {
      // 如果位置超出屏幕范围，也重新计算
      x = screenWidth - finalConfig.width - 50;
      y = screenHeight - finalConfig.height - 100;
    }
    
    // Ensure position is within screen bounds
    const clampedPos = this.clampToScreenBounds(x, y, finalConfig.width, finalConfig.height);

    this.window = new BrowserWindow({
      width: finalConfig.width,
      height: finalConfig.height,
      x: clampedPos.x,
      y: clampedPos.y,
      frame: finalConfig.frame,
      transparent: finalConfig.transparent,
      alwaysOnTop: finalConfig.alwaysOnTop,
      skipTaskbar: true,
      resizable: true, // 允许调整大小以支持程序化窗口大小变更
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true, // Enable web security
        allowRunningInsecureContent: false, // Disable insecure content
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Load the Next.js app
    console.log('Loading app, isDev:', this.isDev);
    
    if (this.isDev) {
      // Try different ports in case 3000 is occupied
      const devUrl = process.env.DEV_SERVER_URL || 'http://localhost:3000';
      console.log('Loading dev URL:', devUrl);
      
      // Add error handling for dev server connection with fallback
      this.window.loadURL(devUrl).catch(async (error) => {
        console.error('Failed to load dev server on port 3000:', error);
        
        // Try port 3001 as fallback
        const fallbackUrl = 'http://localhost:3001';
        console.log('Trying fallback URL:', fallbackUrl);
        
        try {
          await this.window!.loadURL(fallbackUrl);
          console.log('Successfully connected to dev server on port 3001');
        } catch (fallbackError) {
          console.error('Failed to load dev server on port 3001:', fallbackError);
          console.error('Make sure the Next.js dev server is running');
          console.error('Run: npm run dev');
        }
      });
    } else {
      // In production, load Next.js static export (full app with all features)
      const indexPath = path.join(__dirname, '../out/index.html');
      console.log('Loading production build from:', indexPath);
      
      if (require('fs').existsSync(indexPath)) {
        this.window.loadFile(indexPath);
      } else {
        // If Next.js build not available, show error
        console.error('Next.js build not found at:', indexPath);
        console.error('Please run "npm run build" first');
        throw new Error('Application build not found. Please run "npm run build" first.');
      }
    }

    // Enable dev tools shortcut in both dev and production
    this.window.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        this.window?.webContents.toggleDevTools();
      }
      if (input.key === 'F12') {
        this.window?.webContents.toggleDevTools();
      }
    });

    // Save position changes to config
    this.window.on('moved', () => {
      if (this.window) {
        const [x, y] = this.window.getPosition();
        const currentConfig = this.configStore.get('window');
        this.configStore.set('window', { ...currentConfig, x, y });
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });

    return this.window;
  }

  /**
   * Creates the main application window for Dashboard and Chat
   */
  createMainWindow(): BrowserWindow {
    // Load main window configuration from store
    const storedMainConfig = this.configStore.get('mainWindow');
    
    // Center the window on screen
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const x = Math.round((screenWidth - storedMainConfig.width) / 2);
    const y = Math.round((screenHeight - storedMainConfig.height) / 2);

    this.mainWindow = new BrowserWindow({
      width: storedMainConfig.width,
      height: storedMainConfig.height,
      x,
      y,
      frame: DEFAULT_MAIN_WINDOW_CONFIG.frame,
      transparent: DEFAULT_MAIN_WINDOW_CONFIG.transparent,
      alwaysOnTop: DEFAULT_MAIN_WINDOW_CONFIG.alwaysOnTop,
      resizable: DEFAULT_MAIN_WINDOW_CONFIG.resizable,
      minimizable: DEFAULT_MAIN_WINDOW_CONFIG.minimizable,
      maximizable: DEFAULT_MAIN_WINDOW_CONFIG.maximizable,
      skipTaskbar: false,
      show: false, // Don't show immediately
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true, // Enable web security
        allowRunningInsecureContent: false, // Disable insecure content
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Load the Next.js app with a route parameter to show main interface
    if (this.isDev) {
      const devUrl = process.env.DEV_SERVER_URL || 'http://localhost:3000';
      this.mainWindow.loadURL(`${devUrl}?mode=main`);
    } else {
      // In production, load from the out directory (Next.js static export)
      this.mainWindow.loadFile(path.join(__dirname, '../out/index.html'))
        .then(() => {
          // After loading, navigate to add the mode parameter
          if (this.mainWindow) {
            this.mainWindow.webContents.executeJavaScript(`
              if (!window.location.search.includes('mode=main')) {
                window.history.replaceState({}, '', '?mode=main');
                window.dispatchEvent(new Event('popstate'));
              }
            `);
          }
        });
    }

    // Enable dev tools shortcut for main window
    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        this.mainWindow?.webContents.toggleDevTools();
      }
      if (input.key === 'F12') {
        this.mainWindow?.webContents.toggleDevTools();
      }
    });

    // Save size changes to config
    this.mainWindow.on('resized', () => {
      if (this.mainWindow) {
        const [width, height] = this.mainWindow.getSize();
        this.configStore.set('mainWindow', { width, height });
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    return this.mainWindow;
  }

  /**
   * Shows the main window (creates if doesn't exist)
   */
  showMainWindow(): void {
    if (!this.mainWindow) {
      this.createMainWindow();
    }
    
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * Hides the main window
   */
  hideMainWindow(): void {
    if (this.mainWindow) {
      this.mainWindow.hide();
    }
  }

  /**
   * Gets the main window instance
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /**
   * Gets the avatar window instance
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Sets the window position
   * Requirement: 1.4
   */
  setPosition(x: number, y: number): void {
    if (this.window) {
      const { x: clampedX, y: clampedY } = this.clampToScreenBounds(
        x, y, 
        this.window.getBounds().width, 
        this.window.getBounds().height
      );
      this.window.setPosition(clampedX, clampedY);
      
      // Save to config
      const currentConfig = this.configStore.get('window');
      this.configStore.set('window', { ...currentConfig, x: clampedX, y: clampedY });
    }
  }

  /**
   * Sets the avatar window size
   */
  setAvatarSize(width: number, height: number): void {
    if (this.window) {
      // 临时启用resizable以允许大小调整
      this.window.setResizable(true);
      
      // Validate size constraints - 调整最小尺寸以支持更小的精灵空间
      const minWidth = 150;  // 降低最小宽度限制
      const maxWidth = 800;
      const minHeight = 180; // 降低最小高度限制
      const maxHeight = 1000;
      
      const clampedWidth = Math.max(minWidth, Math.min(width, maxWidth));
      const clampedHeight = Math.max(minHeight, Math.min(height, maxHeight));
      
      // 强制设置窗口大小
      this.window.setSize(clampedWidth, clampedHeight, true); // animate = true
      
      // 重新禁用resizable
      setTimeout(() => {
        if (this.window) {
          this.window.setResizable(false);
        }
      }, 100);
      
      // Save to config
      const currentConfig = this.configStore.get('window');
      this.configStore.set('window', { 
        ...currentConfig, 
        width: clampedWidth, 
        height: clampedHeight 
      });
    }
  }

  /**
   * Sets the main window size
   */
  setMainWindowSize(width: number, height: number): void {
    if (this.mainWindow) {
      // Validate size constraints
      const minWidth = 800;
      const maxWidth = 3000;
      const minHeight = 600;
      const maxHeight = 2000;
      
      const clampedWidth = Math.max(minWidth, Math.min(width, maxWidth));
      const clampedHeight = Math.max(minHeight, Math.min(height, maxHeight));
      
      this.mainWindow.setSize(clampedWidth, clampedHeight);
      
      // Save to config
      this.configStore.set('mainWindow', { 
        width: clampedWidth, 
        height: clampedHeight 
      });
    }
  }

  /**
   * Gets the avatar window size
   */
  getAvatarSize(): { width: number; height: number } | null {
    if (this.window) {
      const [width, height] = this.window.getSize();
      return { width, height };
    }
    return null;
  }

  /**
   * Gets the main window size
   */
  getMainWindowSize(): { width: number; height: number } | null {
    if (this.mainWindow) {
      const [width, height] = this.mainWindow.getSize();
      return { width, height };
    }
    return null;
  }

  /**
   * Gets the current window position
   * Requirement: 1.5
   */
  getPosition(): { x: number; y: number } | null {
    if (this.window) {
      const [x, y] = this.window.getPosition();
      return { x, y };
    }
    return null;
  }

  /**
   * Enables or disables click-through for transparent areas
   * Requirement: 1.3
   * 
   * When enabled, clicks on transparent areas pass through to underlying windows.
   * The forward option allows the window to still receive mouse events for
   * non-transparent areas.
   */
  setClickThrough(enabled: boolean): void {
    if (this.window) {
      // 点击穿透功能暂时禁用
      // this.window.setIgnoreMouseEvents(enabled, { forward: true });
    }
  }

  /**
   * Sets the always-on-top state
   * Requirement: 1.2
   */
  setAlwaysOnTop(enabled: boolean): void {
    if (this.window) {
      this.window.setAlwaysOnTop(enabled);
    }
  }

  /**
   * Clamps position to screen bounds to prevent window from going off-screen
   */
  private clampToScreenBounds(
    x: number, 
    y: number, 
    width: number, 
    height: number
  ): { x: number; y: number } {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const clampedX = Math.max(0, Math.min(x, screenWidth - width));
    const clampedY = Math.max(0, Math.min(y, screenHeight - height));

    return { x: clampedX, y: clampedY };
  }

  /**
   * Broadcasts config changes to all windows
   */
  broadcastConfigChange(key: string, value: unknown): void {
    const windows = [this.window, this.mainWindow].filter(w => w !== null);
    
    windows.forEach(window => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('config-changed', { key, value });
      }
    });
  }

  /**
   * Destroys all windows
   */
  destroy(): void {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
    if (this.mainWindow) {
      this.mainWindow.close();
      this.mainWindow = null;
    }
  }
}
