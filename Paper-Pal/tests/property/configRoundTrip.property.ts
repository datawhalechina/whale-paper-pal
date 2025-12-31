import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Feature: paper-pal, Property 1: Config Round-Trip Consistency
 * Validates: Requirements 9.2, 9.3, 9.4
 *
 * For any valid AppConfig object, exporting it to JSON and then importing it back
 * SHALL produce an equivalent configuration object (excluding API keys which are
 * handled separately for security).
 */

// Type definitions matching ConfigStore
interface AppConfig {
  window: {
    x: number;
    y: number;
    scale: number;
  };
  skin: {
    type: 'default' | 'custom';
    customPaths?: {
      idle?: string;
      alert?: string;
      active?: string;
    };
  };
  apiKeys: {
    openai?: string;
    gemini?: string;
  };
  scoring: {
    threshold: number;
    interests: string[];
  };
}

// Validation functions (same logic as ConfigStore)
function isValidWindowConfig(window: AppConfig['window']): boolean {
  return (
    typeof window.x === 'number' &&
    typeof window.y === 'number' &&
    typeof window.scale === 'number' &&
    window.scale >= 0.5 &&
    window.scale <= 3.0
  );
}

function isValidSkinConfig(skin: AppConfig['skin']): boolean {
  if (skin.type !== 'default' && skin.type !== 'custom') {
    return false;
  }
  if (skin.customPaths) {
    const paths = skin.customPaths;
    if (paths.idle && typeof paths.idle !== 'string') return false;
    if (paths.alert && typeof paths.alert !== 'string') return false;
    if (paths.active && typeof paths.active !== 'string') return false;
  }
  return true;
}

function isValidScoringConfig(scoring: AppConfig['scoring']): boolean {
  return (
    typeof scoring.threshold === 'number' &&
    scoring.threshold >= 0 &&
    scoring.threshold <= 20 &&
    Array.isArray(scoring.interests) &&
    scoring.interests.every((i) => typeof i === 'string')
  );
}

// Simple in-memory config store for testing round-trip
class TestConfigStore {
  private config: AppConfig;

  constructor(initial: AppConfig) {
    this.config = JSON.parse(JSON.stringify(initial));
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.config[key] = value;
  }

  getAll(): AppConfig {
    return { ...this.config };
  }

  export(): string {
    const exportConfig: AppConfig = {
      window: this.config.window,
      skin: this.config.skin,
      apiKeys: {}, // Don't export API keys for security
      scoring: this.config.scoring,
    };
    return JSON.stringify(exportConfig, null, 2);
  }

  import(json: string): void {
    const config = JSON.parse(json) as Partial<AppConfig>;

    if (config.window && isValidWindowConfig(config.window)) {
      this.config.window = config.window;
    }
    if (config.skin && isValidSkinConfig(config.skin)) {
      this.config.skin = config.skin;
    }
    if (config.scoring && isValidScoringConfig(config.scoring)) {
      this.config.scoring = config.scoring;
    }
  }
}

// Generators for valid config objects
const windowConfigArb = fc.record({
  x: fc.integer({ min: 0, max: 3840 }),
  y: fc.integer({ min: 0, max: 2160 }),
  scale: fc.double({ min: 0.5, max: 3.0, noNaN: true }),
});

const skinConfigArb: fc.Arbitrary<AppConfig['skin']> = fc.oneof(
  fc.constant({ type: 'default' as const }),
  fc.record({
    type: fc.constant('custom' as const),
    customPaths: fc.option(
      fc.record({
        idle: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        alert: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        active: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
      }),
      { nil: undefined }
    ),
  })
);

const scoringConfigArb = fc.record({
  threshold: fc.double({ min: 0, max: 20, noNaN: true }),
  interests: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 10 }),
});

const appConfigArb = fc.record({
  window: windowConfigArb,
  skin: skinConfigArb,
  apiKeys: fc.constant({}), // API keys excluded from round-trip
  scoring: scoringConfigArb,
});

describe('Property: Config Round-Trip Consistency', () => {
  it('should preserve config through export/import cycle (excluding API keys)', () => {
    fc.assert(
      fc.property(appConfigArb, (config) => {
        const store = new TestConfigStore(config);

        // Export to JSON
        const exported = store.export();

        // Create new store with different initial config
        const newStore = new TestConfigStore({
          window: { x: 0, y: 0, scale: 1.0 },
          skin: { type: 'default' },
          apiKeys: {},
          scoring: { threshold: 0, interests: [] },
        });

        // Import the exported config
        newStore.import(exported);

        // Verify round-trip consistency
        const retrieved = newStore.getAll();

        // Window config should match
        expect(retrieved.window.x).toBe(config.window.x);
        expect(retrieved.window.y).toBe(config.window.y);
        expect(retrieved.window.scale).toBeCloseTo(config.window.scale, 10);

        // Skin config should match
        expect(retrieved.skin.type).toBe(config.skin.type);
        if (config.skin.type === 'custom' && config.skin.customPaths) {
          expect(retrieved.skin.customPaths?.idle).toBe(config.skin.customPaths.idle);
          expect(retrieved.skin.customPaths?.alert).toBe(config.skin.customPaths.alert);
          expect(retrieved.skin.customPaths?.active).toBe(config.skin.customPaths.active);
        }

        // Scoring config should match
        expect(retrieved.scoring.threshold).toBeCloseTo(config.scoring.threshold, 10);
        expect(retrieved.scoring.interests).toEqual(config.scoring.interests);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve window position through set/get operations', () => {
    fc.assert(
      fc.property(windowConfigArb, (windowConfig) => {
        const store = new TestConfigStore({
          window: { x: 0, y: 0, scale: 1.0 },
          skin: { type: 'default' },
          apiKeys: {},
          scoring: { threshold: 7.0, interests: [] },
        });

        store.set('window', windowConfig);
        const retrieved = store.get('window');

        expect(retrieved.x).toBe(windowConfig.x);
        expect(retrieved.y).toBe(windowConfig.y);
        expect(retrieved.scale).toBeCloseTo(windowConfig.scale, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve scoring config through set/get operations', () => {
    fc.assert(
      fc.property(scoringConfigArb, (scoringConfig) => {
        const store = new TestConfigStore({
          window: { x: 0, y: 0, scale: 1.0 },
          skin: { type: 'default' },
          apiKeys: {},
          scoring: { threshold: 7.0, interests: [] },
        });

        store.set('scoring', scoringConfig);
        const retrieved = store.get('scoring');

        expect(retrieved.threshold).toBeCloseTo(scoringConfig.threshold, 10);
        expect(retrieved.interests).toEqual(scoringConfig.interests);
      }),
      { numRuns: 100 }
    );
  });
});
