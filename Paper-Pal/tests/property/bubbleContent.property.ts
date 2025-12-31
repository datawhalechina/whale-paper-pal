/**
 * Feature: paper-pal, Property 8: Bubble Message Content Completeness
 * Validates: Requirements 6.2
 *
 * For any BubbleMessage generated from a ScoredPaper, the message content SHALL contain:
 * - The paper source (arxiv or huggingface)
 * - The paper topic/title
 * - The total score
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  generateBubbleContent,
  createBubbleMessage,
  type BubbleMessage,
} from '@/components/Bubble/types';

// Generators for bubble message testing
const sourceArb = fc.constantFrom('arxiv', 'huggingface') as fc.Arbitrary<'arxiv' | 'huggingface'>;

const titleArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

const scoreArb = fc.float({ min: 0, max: 20, noNaN: true });

const paperIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

// Generator for complete BubbleMessage
const bubbleMessageArb: fc.Arbitrary<BubbleMessage> = fc
  .tuple(paperIdArb, titleArb, sourceArb, scoreArb)
  .map(([paperId, title, source, score]) => createBubbleMessage(paperId, title, source, score));

describe('Property 8: Bubble Message Content Completeness', () => {
  it('should contain paper source in generated content', () => {
    fc.assert(
      fc.property(bubbleMessageArb, (message) => {
        const content = generateBubbleContent(message);

        // Content should contain source indicator
        if (message.source === 'arxiv') {
          expect(content).toContain('ArXiv');
        } else {
          expect(content).toContain('HuggingFace');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should contain paper title in generated content', () => {
    fc.assert(
      fc.property(bubbleMessageArb, (message) => {
        const content = generateBubbleContent(message);

        // Content should contain the title
        expect(content).toContain(message.title);
      }),
      { numRuns: 100 }
    );
  });

  it('should contain score in generated content', () => {
    fc.assert(
      fc.property(bubbleMessageArb, (message) => {
        const content = generateBubbleContent(message);

        // Content should contain the score (formatted to 1 decimal place)
        const formattedScore = message.score.toFixed(1);
        expect(content).toContain(formattedScore);
      }),
      { numRuns: 100 }
    );
  });

  it('should contain all three required elements (source, title, score) in any order', () => {
    fc.assert(
      fc.property(bubbleMessageArb, (message) => {
        const content = generateBubbleContent(message);

        // Check source
        const hasSource =
          (message.source === 'arxiv' && content.includes('ArXiv')) ||
          (message.source === 'huggingface' && content.includes('HuggingFace'));

        // Check title
        const hasTitle = content.includes(message.title);

        // Check score
        const hasScore = content.includes(message.score.toFixed(1));

        expect(hasSource).toBe(true);
        expect(hasTitle).toBe(true);
        expect(hasScore).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('createBubbleMessage should produce valid messages with all required fields', () => {
    fc.assert(
      fc.property(
        paperIdArb,
        titleArb,
        sourceArb,
        scoreArb,
        (paperId, title, source, score) => {
          const message = createBubbleMessage(paperId, title, source, score);

          // All fields should be set correctly
          expect(message.paperId).toBe(paperId);
          expect(message.title).toBe(title);
          expect(message.source).toBe(source);
          expect(message.score).toBe(score);

          // ID should be generated
          expect(message.id).toBeTruthy();
          expect(message.id.startsWith('bubble-')).toBe(true);

          // Timestamp should be set
          expect(message.timestamp).toBeInstanceOf(Date);

          // Content should be generated and non-empty
          expect(message.content).toBeTruthy();
          expect(message.content.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generated content should be non-empty for any valid input', () => {
    fc.assert(
      fc.property(bubbleMessageArb, (message) => {
        const content = generateBubbleContent(message);

        expect(content).toBeTruthy();
        expect(content.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
