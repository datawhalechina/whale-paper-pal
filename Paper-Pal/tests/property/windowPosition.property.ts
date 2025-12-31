import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { useAppStore } from '@/store/appStore';

/**
 * Feature: paper-pal, Property 1: Config Round-Trip Consistency (窗口位置部分)
 * Validates: Requirements 1.4, 1.5
 */
describe('Property: Window Position Round-Trip Consistency', () => {
  beforeEach(() => {
    useAppStore.setState({ windowPosition: { x: 1720, y: 880 }, isDragging: false });
  });

  it('should preserve window position through set/get operations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3840 }),
        fc.integer({ min: 0, max: 2160 }),
        (x, y) => {
          useAppStore.setState({ windowPosition: { x, y } });
          const retrieved = useAppStore.getState().windowPosition;
          expect(retrieved.x).toBe(x);
          expect(retrieved.y).toBe(y);
        }
      ),
      { numRuns: 20 }
    );
  });
});
