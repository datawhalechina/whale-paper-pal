import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/store/appStore';

describe('AppStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      avatarState: 'idle',
      windowPosition: { x: 1720, y: 880 },
      skinScale: 1.0,
      isDashboardOpen: false,
      isChatOpen: false,
      currentPaperId: null,
    });
  });

  describe('avatarState', () => {
    it('should initialize with idle state', () => {
      const state = useAppStore.getState();
      expect(state.avatarState).toBe('idle');
    });

    it('should update avatar state', () => {
      const { setAvatarState } = useAppStore.getState();
      setAvatarState('alert');
      expect(useAppStore.getState().avatarState).toBe('alert');
    });
  });

  describe('windowPosition', () => {
    it('should initialize with default position', () => {
      const state = useAppStore.getState();
      expect(state.windowPosition).toEqual({ x: 1720, y: 880 });
    });

    it('should update window position', () => {
      const { setWindowPosition } = useAppStore.getState();
      setWindowPosition(100, 200);
      expect(useAppStore.getState().windowPosition).toEqual({ x: 100, y: 200 });
    });
  });

  describe('skinScale', () => {
    it('should initialize with scale 1.0', () => {
      const state = useAppStore.getState();
      expect(state.skinScale).toBe(1.0);
    });

    it('should clamp scale to minimum 0.5', () => {
      const { setSkinScale } = useAppStore.getState();
      setSkinScale(0.1);
      expect(useAppStore.getState().skinScale).toBe(0.5);
    });

    it('should clamp scale to maximum 3.0', () => {
      const { setSkinScale } = useAppStore.getState();
      setSkinScale(5.0);
      expect(useAppStore.getState().skinScale).toBe(3.0);
    });
  });
});
