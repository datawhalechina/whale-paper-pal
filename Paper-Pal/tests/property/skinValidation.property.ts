import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateFile,
  SkinManager,
  DEFAULT_SKIN_CONFIG,
} from '@/skin/SkinManager';

/**
 * Feature: paper-pal, Property 3: Skin File Validation
 * Validates: Requirements 3.1, 3.2, 3.6
 *
 * For any file dropped onto the avatar:
 * - If the file is a valid GIF or PNG under 5MB, the Skin_Manager SHALL accept it
 * - If the file is invalid (wrong format or too large), the Skin_Manager SHALL reject it
 */

// Constants matching SkinManager
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const SUPPORTED_EXTENSIONS = ['.gif', '.png'];
const SUPPORTED_MIME_TYPES = ['image/gif', 'image/png'];

// Helper to create a mock File object
function createMockFile(
  name: string,
  size: number,
  type: string
): File {
  // Create a blob with the specified size
  const content = new Uint8Array(Math.min(size, 1024)); // Don't actually allocate huge arrays
  const blob = new Blob([content], { type });

  // Create a File-like object
  const file = new File([blob], name, { type });

  // Override size property for testing
  Object.defineProperty(file, 'size', { value: size });

  return file;
}

// Generators for valid files
const validExtensionArb = fc.constantFrom('.gif', '.png');
const validMimeTypeArb = fc.constantFrom('image/gif', 'image/png');
const validFileSizeArb = fc.integer({ min: 1, max: MAX_FILE_SIZE });

// Generators for invalid files
const invalidExtensionArb = fc.constantFrom('.jpg', '.jpeg', '.bmp', '.webp', '.svg', '.txt', '.exe');
const invalidMimeTypeArb = fc.constantFrom(
  'image/jpeg',
  'image/bmp',
  'image/webp',
  'image/svg+xml',
  'text/plain',
  'application/octet-stream'
);
const oversizedFileSizeArb = fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 3 });

// Generator for valid filenames
const validFilenameArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), { minLength: 1, maxLength: 20 }),
    validExtensionArb
  )
  .map(([name, ext]) => name + ext);

// Generator for state-specific filenames
const stateFilenameArb = fc.constantFrom(
  'idle.gif',
  'idle.png',
  'alert.gif',
  'alert.png',
  'active.gif',
  'active.png',
  'IDLE.GIF',
  'IDLE.PNG',
  'Alert.Gif',
  'Active.PNG'
);

describe('Property: Skin File Validation', () => {
  describe('Valid files should be accepted', () => {
    it('should accept any GIF file under 5MB', () => {
      fc.assert(
        fc.property(
          fc.tuple(validFilenameArb, validFileSizeArb),
          ([filename, size]) => {
            // Ensure filename ends with .gif
            const gifFilename = filename.replace(/\.(gif|png)$/i, '.gif');
            const file = createMockFile(gifFilename, size, 'image/gif');
            const result = validateFile(file);

            expect(result.valid).toBe(true);
            expect(result.fileType).toBe('gif');
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept any PNG file under 5MB', () => {
      fc.assert(
        fc.property(
          fc.tuple(validFilenameArb, validFileSizeArb),
          ([filename, size]) => {
            // Ensure filename ends with .png
            const pngFilename = filename.replace(/\.(gif|png)$/i, '.png');
            const file = createMockFile(pngFilename, size, 'image/png');
            const result = validateFile(file);

            expect(result.valid).toBe(true);
            expect(result.fileType).toBe('png');
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Invalid files should be rejected', () => {
    it('should reject files larger than 5MB', () => {
      fc.assert(
        fc.property(
          fc.tuple(validFilenameArb, oversizedFileSizeArb, validMimeTypeArb),
          ([filename, size, mimeType]) => {
            const file = createMockFile(filename, size, mimeType);
            const result = validateFile(file);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('5MB');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject files with invalid MIME types', () => {
      fc.assert(
        fc.property(
          fc.tuple(validFilenameArb, validFileSizeArb, invalidMimeTypeArb),
          ([filename, size, mimeType]) => {
            const file = createMockFile(filename, size, mimeType);
            const result = validateFile(file);

            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject files with invalid extensions', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 10 }),
            invalidExtensionArb,
            validFileSizeArb
          ),
          ([basename, ext, size]) => {
            const filename = basename + ext;
            // Use a valid MIME type but invalid extension
            const file = createMockFile(filename, size, 'image/gif');
            const result = validateFile(file);

            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('SkinManager validation integration', () => {
    it('should retain current skin when invalid file is dropped', () => {
      fc.assert(
        fc.property(
          fc.tuple(invalidExtensionArb, validFileSizeArb),
          ([ext, size]) => {
            const manager = new SkinManager(DEFAULT_SKIN_CONFIG);
            const initialSkin = manager.getCurrentSkin();

            const filename = 'test' + ext;
            const file = createMockFile(filename, size, 'image/gif');
            const result = manager.validateFile(file);

            // Validation should fail
            expect(result.valid).toBe(false);

            // Current skin should be unchanged
            const currentSkin = manager.getCurrentSkin();
            expect(currentSkin.type).toBe(initialSkin.type);
            expect(currentSkin.scale).toBe(initialSkin.scale);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
