import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Window management
  setPosition: (x: number, y: number) => ipcRenderer.invoke('window:setPosition', x, y),
  getPosition: () => ipcRenderer.invoke('window:getPosition'),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke('window:setClickThrough', enabled),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', enabled),
  
  // Window size management
  setAvatarSize: (width: number, height: number) => ipcRenderer.invoke('window:setAvatarSize', width, height),
  getAvatarSize: () => ipcRenderer.invoke('window:getAvatarSize'),
  setMainWindowSize: (width: number, height: number) => ipcRenderer.invoke('window:setMainWindowSize', width, height),
  getMainWindowSize: () => ipcRenderer.invoke('window:getMainWindowSize'),
  
  // Main window management
  showMainWindow: () => ipcRenderer.invoke('window:showMain'),
  hideMainWindow: () => ipcRenderer.invoke('window:hideMain'),
  
  // App control
  quitApp: () => ipcRenderer.invoke('app:quit'),

  // Config store
  getConfig: (key: string) => ipcRenderer.invoke('config:get', key),
  setConfig: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value),
  getAllConfig: () => ipcRenderer.invoke('config:getAll'),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: (json: string) => ipcRenderer.invoke('config:import', json),
  resetConfig: () => ipcRenderer.invoke('config:reset'),

  // Config change notifications
  onConfigChanged: (callback: (key: string, value: unknown) => void) => {
    const handler = (_event: any, data: { key: string; value: unknown }) => {
      callback(data.key, data.value);
    };
    ipcRenderer.on('config-changed', handler);
    
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('config-changed', handler);
    };
  },

  // API Key management (Requirement 9.1 - Secure storage)
  setApiKey: (provider: 'openai' | 'gemini', apiKey: string) => 
    ipcRenderer.invoke('config:setApiKey', provider, apiKey),
  getApiKey: (provider: 'openai' | 'gemini') => 
    ipcRenderer.invoke('config:getApiKey', provider),
  hasApiKey: (provider: 'openai' | 'gemini') => 
    ipcRenderer.invoke('config:hasApiKey', provider),
  removeApiKey: (provider: 'openai' | 'gemini') => 
    ipcRenderer.invoke('config:removeApiKey', provider),

  // Shell operations
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
});
