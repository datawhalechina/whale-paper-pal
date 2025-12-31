import { app, ipcMain, IpcMainInvokeEvent, shell, protocol } from 'electron';
import { WindowManager } from './WindowManager';
import { ConfigStore, AppConfig } from './ConfigStore';
import * as path from 'path';
import * as fs from 'fs';

let windowManager: WindowManager | null = null;
let configStore: ConfigStore | null = null;

function createWindow(): void {
  configStore = new ConfigStore();
  windowManager = new WindowManager();

  // 不传递任何配置，让 WindowManager 自己从 ConfigStore 读取
  // WindowManager 内部会处理默认值
  windowManager.createAvatarWindow();
}

// Register protocol for serving static files in production
app.whenReady().then(() => {
  // Register custom protocol to serve static files
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = request.url.substr(6); // Remove 'app://' prefix
    const filePath = path.join(__dirname, '../out', url);
    
    // Check if file exists
    if (fs.existsSync(filePath)) {
      callback({ path: filePath });
    } else {
      // Fallback to index.html for SPA routing
      callback({ path: path.join(__dirname, '../out/index.html') });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (windowManager?.getWindow() === null) {
    createWindow();
  }
});

// IPC handlers for window management
ipcMain.handle('window:setPosition', (_event: IpcMainInvokeEvent, x: number, y: number) => {
  // Validate parameters
  if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
    console.error('Invalid setPosition parameters:', { x, y, xType: typeof x, yType: typeof y });
    return;
  }
  
  if (windowManager) {
    windowManager.setPosition(x, y);
    // Persist position to config store
    if (configStore) {
      const currentConfig = configStore.get('window') || { x: 1720, y: 880, scale: 1.0 };
      configStore.set('window', { ...currentConfig, x, y });
    }
  }
});

ipcMain.handle('window:getPosition', () => {
  if (windowManager) {
    return windowManager.getPosition();
  }
  return null;
});

ipcMain.handle('window:setClickThrough', (_event: IpcMainInvokeEvent, enabled: boolean) => {
  if (windowManager) {
    windowManager.setClickThrough(enabled);
  }
});

ipcMain.handle('window:setAlwaysOnTop', (_event: IpcMainInvokeEvent, enabled: boolean) => {
  if (windowManager) {
    windowManager.setAlwaysOnTop(enabled);
  }
});

// Window size management
ipcMain.handle('window:setAvatarSize', (_event: IpcMainInvokeEvent, width: number, height: number) => {
  if (windowManager) {
    windowManager.setAvatarSize(width, height);
  }
});

ipcMain.handle('window:getAvatarSize', () => {
  if (windowManager) {
    return windowManager.getAvatarSize();
  }
  return null;
});

ipcMain.handle('window:setMainWindowSize', (_event: IpcMainInvokeEvent, width: number, height: number) => {
  if (windowManager) {
    windowManager.setMainWindowSize(width, height);
  }
});

ipcMain.handle('window:getMainWindowSize', () => {
  if (windowManager) {
    return windowManager.getMainWindowSize();
  }
  return null;
});

// Main window management
ipcMain.handle('window:showMain', () => {
  if (windowManager) {
    windowManager.showMainWindow();
  }
});

ipcMain.handle('window:hideMain', () => {
  if (windowManager) {
    windowManager.hideMainWindow();
  }
});

// App control
ipcMain.handle('app:quit', () => {
  app.quit();
});

// IPC handlers for config store
ipcMain.handle('config:get', (_event: IpcMainInvokeEvent, key: string) => {
  if (configStore) {
    return configStore.get(key as keyof AppConfig);
  }
  return null;
});

ipcMain.handle('config:set', (_event: IpcMainInvokeEvent, key: string, value: unknown) => {
  if (configStore) {
    configStore.set(key as keyof AppConfig, value as AppConfig[keyof AppConfig]);
    
    // Notify all windows about config change
    if (windowManager) {
      windowManager.broadcastConfigChange(key, value);
    }
  }
});

ipcMain.handle('config:export', () => {
  if (configStore) {
    return configStore.export();
  }
  return '{}';
});

ipcMain.handle('config:import', (_event: IpcMainInvokeEvent, json: string) => {
  if (configStore) {
    configStore.import(json);
  }
});

// API Key management handlers (Requirement 9.1)
ipcMain.handle('config:setApiKey', (_event: IpcMainInvokeEvent, provider: 'openai' | 'gemini', apiKey: string) => {
  if (configStore) {
    configStore.setApiKey(provider, apiKey);
  }
});

ipcMain.handle('config:getApiKey', (_event: IpcMainInvokeEvent, provider: 'openai' | 'gemini') => {
  if (configStore) {
    return configStore.getApiKey(provider);
  }
  return undefined;
});

ipcMain.handle('config:hasApiKey', (_event: IpcMainInvokeEvent, provider: 'openai' | 'gemini') => {
  if (configStore) {
    return configStore.hasApiKey(provider);
  }
  return false;
});

ipcMain.handle('config:removeApiKey', (_event: IpcMainInvokeEvent, provider: 'openai' | 'gemini') => {
  if (configStore) {
    configStore.removeApiKey(provider);
  }
});

ipcMain.handle('config:getAll', () => {
  if (configStore) {
    return configStore.getAll();
  }
  return null;
});

ipcMain.handle('config:reset', () => {
  if (configStore) {
    configStore.reset();
  }
});

// Shell operations
ipcMain.handle('shell:openExternal', (_event: IpcMainInvokeEvent, url: string) => {
  return shell.openExternal(url);
});
