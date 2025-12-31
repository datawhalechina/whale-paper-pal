/**
 * Skin module exports
 */

export {
  SkinManager,
  validateFile,
  readFileAsDataUrl,
  clampScale,
  DEFAULT_SKIN_CONFIG,
} from './SkinManager';

export type {
  SkinAsset,
  SkinConfig,
  FileValidationResult,
  SkinLoadResult,
  SkinPersistence,
} from './SkinManager';
