import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { useAppStore } from '@/store/appStore';
import { SkinManager, clampScale, DEFAULT_SKIN_CONFIG } from '@/skin/SkinManager';

/**
 * Feature: paper-pal, Property 4: Scale Bounds Enforcement
 * Validates: Requirements 3.5
 *
 * For any scale value input by the user, the Avatar_System SHALL clamp
 * the result to the range [0.5, 3.0].
 */
describe('Property: Scale Bounds Enforcement', () => {
  describe('AppStore scale clamping', () => {
    beforeEach(() => {
      useAppStore.setState({ skinScale: 1.0 });
    });

    it('should clamp any scale value to [0.5, 3.0] range', () => {
      fc.assert(
        fc.property(fc.double({ min: -100, max: 100, noNaN: true }), (inputScale) => {
          const { setSkinScale } = useAppStore.getState();
          setSkinScale(inputScale);
          const resultScale = useAppStore.getState().skinScale;

          // Property: result should always be within bounds
          expect(resultScale).toBeGreaterThanOrEqual(0.5);
          expect(resultScale).toBeLessThanOrEqual(3.0);

          // Property: if input is within bounds, result equals input
          if (inputScale >= 0.5 && inputScale <= 3.0) {
            expect(resultScale).toBe(inputScale);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('SkinManager scale clamping', () => {
    it('should clamp any scale value to [0.5, 3.0] range via clampScale utility', () => {
      fc.assert(
        fc.property(fc.double({ min: -100, max: 100, noNaN: true }), (inputScale) => {
          const result = clampScale(inputScale);

          // Property: result should always be within bounds
          expect(result).toBeGreaterThanOrEqual(0.5);
          expect(result).toBeLessThanOrEqual(3.0);

          // Property: if input is within bounds, result equals input
          if (inputScale >= 0.5 && inputScale <= 3.0) {
            expect(result).toBe(inputScale);
          }

          // Property: values below 0.5 should be clamped to 0.5
          if (inputScale < 0.5) {
            expect(result).toBe(0.5);
          }

          // Property: values above 3.0 should be clamped to 3.0
          if (inputScale > 3.0) {
            expect(result).toBe(3.0);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should clamp scale when set via SkinManager.setScale()', () => {
      fc.assert(
        fc.property(fc.double({ min: -100, max: 100, noNaN: true }), (inputScale) => {
          const manager = new SkinManager(DEFAULT_SKIN_CONFIG);
          manager.setScale(inputScale);
          const resultScale = manager.getScale();

          // Property: result should always be within bounds
          expect(resultScale).toBeGreaterThanOrEqual(0.5);
          expect(resultScale).toBeLessThanOrEqual(3.0);

          // Property: if input is within bounds, result equals input
          if (inputScale >= 0.5 && inputScale <= 3.0) {
            expect(resultScale).toBe(inputScale);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should clamp scale when loading skin config', async () => {
      await fc.assert(
        fc.asyncProperty(fc.double({ min: -100, max: 100, noNaN: true }), async (inputScale) => {
          const manager = new SkinManager();
          await manager.loadSkin({
            type: 'default',
            asset: null,
            scale: inputScale,
          });
          const resultScale = manager.getScale();

          // Property: result should always be within bounds
          expect(resultScale).toBeGreaterThanOrEqual(0.5);
          expect(resultScale).toBeLessThanOrEqual(3.0);

          // Property: if input is within bounds, result equals input
          if (inputScale >= 0.5 && inputScale <= 3.0) {
            expect(resultScale).toBe(inputScale);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve scale through multiple set operations', () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: 1, maxLength: 10 }),
          (scales) => {
            const manager = new SkinManager(DEFAULT_SKIN_CONFIG);

            for (const scale of scales) {
              manager.setScale(scale);
              const result = manager.getScale();

              // Property: result should always be within bounds after each operation
              expect(result).toBeGreaterThanOrEqual(0.5);
              expect(result).toBeLessThanOrEqual(3.0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
