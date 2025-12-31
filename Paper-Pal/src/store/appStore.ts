import { create } from 'zustand';

export type AvatarState = 'idle' | 'alert' | 'active';

interface AppState {
  // Avatar state
  avatarState: AvatarState;
  setAvatarState: (state: AvatarState) => void;

  // Window position
  windowPosition: { x: number; y: number };
  setWindowPosition: (x: number, y: number) => void;
  
  // Window dragging state
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;

  // Skin configuration
  skinScale: number;
  setSkinScale: (scale: number) => void;

  // Window size configuration (separate from skin scale)
  windowSizeScale: number;
  setWindowSizeScale: (scale: number) => void;

  // Dashboard state
  isDashboardOpen: boolean;
  setDashboardOpen: (open: boolean) => void;

  // Chat state
  isChatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  currentPaperId: string | null;
  setCurrentPaperId: (id: string | null) => void;
  
  // Initialization
  initializeFromConfig: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  // Avatar state
  avatarState: 'idle',
  setAvatarState: (state) => set({ avatarState: state }),

  // Window position
  windowPosition: { x: -1, y: -1 },  // -1 表示使用屏幕右下角计算
  setWindowPosition: (x, y) => {
    // Validate parameters to prevent type conversion errors
    if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
      console.error('Invalid position parameters:', { x, y });
      return;
    }
    
    set({ windowPosition: { x, y } });
    // Persist to Electron config store
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.setPosition(x, y).catch((error) => {
        console.error('Failed to set window position:', error, { x, y });
      });
    }
  },
  
  // Window dragging state
  isDragging: false,
  setIsDragging: (dragging) => set({ isDragging: dragging }),

  // Skin configuration
  skinScale: 1.0,
  setSkinScale: (scale) => set({ skinScale: Math.max(0.5, Math.min(3.0, scale)) }),

  // Window size configuration (separate from skin scale)
  windowSizeScale: 1.0,
  setWindowSizeScale: (scale) => set({ windowSizeScale: Math.max(0.5, Math.min(2.0, scale)) }),

  // Dashboard state
  isDashboardOpen: false,
  setDashboardOpen: (open) => set({ isDashboardOpen: open }),

  // Chat state
  isChatOpen: false,
  setChatOpen: (open) => set({ isChatOpen: open }),
  currentPaperId: null,
  setCurrentPaperId: (id) => set({ currentPaperId: id }),
  
  // Initialize state from Electron config store on startup
  initializeFromConfig: async () => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        // 获取实际的窗口位置（Electron 窗口的真实位置）
        const position = await window.electronAPI.getPosition();
        if (position && typeof position.x === 'number' && typeof position.y === 'number') {
          set({ windowPosition: position });
        }
        
        // 获取配置中的其他设置（scale, windowSizeScale），但不覆盖位置
        const windowConfig = await window.electronAPI.getConfig('window') as { x: number; y: number; scale: number; windowSizeScale?: number } | null;
        if (windowConfig) {
          const scale = typeof windowConfig.scale === 'number' && !isNaN(windowConfig.scale) ? windowConfig.scale : 1.0;
          const windowSizeScale = typeof windowConfig.windowSizeScale === 'number' && !isNaN(windowConfig.windowSizeScale) ? windowConfig.windowSizeScale : 1.0;
          
          // 只更新 scale 设置，不覆盖位置（位置已经从 getPosition 获取）
          set({ 
            skinScale: Math.max(0.5, Math.min(3.0, scale)),
            windowSizeScale: Math.max(0.5, Math.min(2.0, windowSizeScale))
          });
        }
      } catch (error) {
        console.error('Failed to initialize from config:', error);
      }
    }
  },
}));