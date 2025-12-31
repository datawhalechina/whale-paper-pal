/**
 * Feature: paper-pal, Property 11: Quick Command Recognition
 * Validates: Requirements 8.3
 *
 * For any valid quick command string ("看公式", "看代码链接"),
 * the Chat_Interface SHALL recognize and execute the corresponding action.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  QUICK_COMMANDS,
  isQuickCommand,
  type QuickCommand,
} from '@/components/Chat/types';
import {
  QUICK_COMMAND_DEFINITIONS,
  getQuickCommandDefinition,
  executeQuickCommand,
  matchQuickCommand,
  getAvailableQuickCommands,
  isRecognizedCommand,
} from '@/components/Chat/quickCommands';
import { createChatContext } from '@/components/Chat/types';

// Generators for quick command testing
const validQuickCommandArb = fc.constantFrom(...QUICK_COMMANDS) as fc.Arbitrary<QuickCommand>;

const invalidCommandArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !QUICK_COMMANDS.includes(s as QuickCommand) && s.trim().length > 0);

const abstractArb = fc.string({ minLength: 10, maxLength: 2000 }).filter((s) => s.trim().length > 0);

const paperIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

const paperTitleArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

// Generator for abstract with math content
const abstractWithMathArb = fc.oneof(
  fc.constant('This paper presents equation A = B + C for optimization.'),
  fc.constant('We prove theorem 1 using the formula $x^2 + y^2 = z^2$.'),
  fc.constant('The loss function L = sum(errors) is minimized.'),
  abstractArb
);

// Generator for abstract with code links
const abstractWithCodeArb = fc.oneof(
  fc.constant('Code is available at https://github.com/user/repo'),
  fc.constant('Our implementation is open-source on github.com/example/project'),
  fc.constant('The code repository can be found at https://huggingface.co/model'),
  abstractArb
);

describe('Property 11: Quick Command Recognition', () => {
  describe('Valid quick commands SHALL be recognized', () => {
    it('should recognize all valid quick commands via isQuickCommand', () => {
      fc.assert(
        fc.property(validQuickCommandArb, (command) => {
          expect(isQuickCommand(command)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should recognize all valid quick commands via matchQuickCommand', () => {
      fc.assert(
        fc.property(validQuickCommandArb, (command) => {
          const matched = matchQuickCommand(command);
          expect(matched).toBe(command);
        }),
        { numRuns: 100 }
      );
    });

    it('should recognize all valid quick commands via isRecognizedCommand', () => {
      fc.assert(
        fc.property(validQuickCommandArb, (command) => {
          expect(isRecognizedCommand(command)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should have definition for all valid quick commands', () => {
      fc.assert(
        fc.property(validQuickCommandArb, (command) => {
          const definition = getQuickCommandDefinition(command);
          expect(definition).toBeDefined();
          expect(definition?.command).toBe(command);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Invalid commands SHALL NOT be recognized', () => {
    it('should not recognize invalid commands via isQuickCommand', () => {
      fc.assert(
        fc.property(invalidCommandArb, (command) => {
          expect(isQuickCommand(command)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should return null for invalid commands via matchQuickCommand', () => {
      fc.assert(
        fc.property(invalidCommandArb, (command) => {
          const matched = matchQuickCommand(command);
          expect(matched).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it('should not recognize invalid commands via isRecognizedCommand', () => {
      fc.assert(
        fc.property(invalidCommandArb, (command) => {
          expect(isRecognizedCommand(command)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Quick commands SHALL execute corresponding actions', () => {
    it('should execute "看公式" command and return non-empty result', () => {
      fc.assert(
        fc.property(
          paperIdArb,
          paperTitleArb,
          abstractWithMathArb,
          (paperId, paperTitle, abstract) => {
            const context = createChatContext(paperId, paperTitle, abstract);
            const result = executeQuickCommand('看公式', context);

            // Result should be non-empty
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);

            // Result should contain the formula icon
            expect(result).toContain('📐');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should execute "看代码链接" command and return non-empty result', () => {
      fc.assert(
        fc.property(
          paperIdArb,
          paperTitleArb,
          abstractWithCodeArb,
          (paperId, paperTitle, abstract) => {
            const context = createChatContext(paperId, paperTitle, abstract);
            const result = executeQuickCommand('看代码链接', context);

            // Result should be non-empty
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);

            // Result should contain the link icon
            expect(result).toContain('🔗');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should execute any valid command and return non-empty result', () => {
      fc.assert(
        fc.property(
          validQuickCommandArb,
          paperIdArb,
          paperTitleArb,
          abstractArb,
          (command, paperId, paperTitle, abstract) => {
            const context = createChatContext(paperId, paperTitle, abstract);
            const result = executeQuickCommand(command, context);

            // Result should always be non-empty
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Quick command definitions', () => {
    it('should have exactly 2 quick commands defined', () => {
      expect(QUICK_COMMANDS.length).toBe(2);
      expect(QUICK_COMMAND_DEFINITIONS.length).toBe(2);
    });

    it('should include "看公式" command', () => {
      expect(QUICK_COMMANDS).toContain('看公式');
      expect(getQuickCommandDefinition('看公式')).toBeDefined();
    });

    it('should include "看代码链接" command', () => {
      expect(QUICK_COMMANDS).toContain('看代码链接');
      expect(getQuickCommandDefinition('看代码链接')).toBeDefined();
    });

    it('should return all available commands via getAvailableQuickCommands', () => {
      const available = getAvailableQuickCommands();
      expect(available).toEqual(QUICK_COMMANDS);
    });

    it('should have description and icon for all commands', () => {
      fc.assert(
        fc.property(validQuickCommandArb, (command) => {
          const definition = getQuickCommandDefinition(command);
          
          expect(definition).toBeDefined();
          expect(definition?.description).toBeTruthy();
          expect(definition?.description.length).toBeGreaterThan(0);
          expect(definition?.icon).toBeTruthy();
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Command matching edge cases', () => {
    it('should not match commands with extra whitespace', () => {
      fc.assert(
        fc.property(validQuickCommandArb, (command) => {
          // Commands with leading/trailing whitespace should not match directly
          // (the matchQuickCommand trims, so this tests the trim behavior)
          const withSpaces = `  ${command}  `;
          const matched = matchQuickCommand(withSpaces);
          
          // After trimming, it should match
          expect(matched).toBe(command);
        }),
        { numRuns: 100 }
      );
    });

    it('should be case-sensitive for Chinese commands', () => {
      // Chinese characters don't have case, but we test that exact match is required
      fc.assert(
        fc.property(validQuickCommandArb, (command) => {
          // Slightly modified command should not match
          const modified = command + '!';
          expect(matchQuickCommand(modified)).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it('should handle empty string', () => {
      expect(matchQuickCommand('')).toBeNull();
      expect(isQuickCommand('')).toBe(false);
      expect(isRecognizedCommand('')).toBe(false);
    });

    it('should handle whitespace-only string', () => {
      expect(matchQuickCommand('   ')).toBeNull();
      expect(isRecognizedCommand('   ')).toBe(false);
    });
  });
});
