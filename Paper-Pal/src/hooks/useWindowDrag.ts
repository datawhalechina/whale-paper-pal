import { useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';

/**
 * Custom hook for handling window drag functionality
 * Requirements: 1.4 - Drag to move window and persist position
 */
export function useWindowDrag() {
  const { windowPosition, setWindowPosition, isDragging, setIsDragging } = useAppStore();
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; windowX: number; windowY: number } | null>(null);
  const isInitializingDrag = useRef(false);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    // Only start drag on left mouse button
    if (e.button !== 0) return;
    
    // 防止重复初始化
    if (isInitializingDrag.current) return;
    isInitializingDrag.current = true;
    
    e.preventDefault();
    
    // 先获取实际的窗口位置，再设置拖拽状态
    let actualWindowX = windowPosition.x;
    let actualWindowY = windowPosition.y;
    
    if (window.electronAPI) {
      try {
        const pos = await window.electronAPI.getPosition();
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
          actualWindowX = pos.x;
          actualWindowY = pos.y;
        }
      } catch (error) {
        console.error('Failed to get window position:', error);
      }
      window.electronAPI.setClickThrough(false);
    }
    
    // 设置拖拽起始位置
    dragStartRef.current = {
      mouseX: e.screenX,
      mouseY: e.screenY,
      windowX: actualWindowX,
      windowY: actualWindowY,
    };
    
    // 最后设置拖拽状态
    setIsDragging(true);
    isInitializingDrag.current = false;
  }, [windowPosition, setIsDragging]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    
    const deltaX = e.screenX - dragStartRef.current.mouseX;
    const deltaY = e.screenY - dragStartRef.current.mouseY;
    
    const newX = dragStartRef.current.windowX + deltaX;
    const newY = dragStartRef.current.windowY + deltaY;
    
    setWindowPosition(newX, newY);
  }, [isDragging, setWindowPosition]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;
    
    setIsDragging(false);
    dragStartRef.current = null;
  }, [isDragging, setIsDragging]);

  // Add global mouse event listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return {
    isDragging,
    handleMouseDown,
    windowPosition,
  };
}
