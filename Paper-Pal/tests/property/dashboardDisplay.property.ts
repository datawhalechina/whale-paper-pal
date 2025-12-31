/**
 * Feature: paper-pal, Property 12: Dashboard Paper Display Completeness
 * Validates: Requirements 7.2
 *
 * For any list of PaperCard objects passed to Dashboard_Panel,
 * all papers SHALL be rendered as cards with visible title, score, tags, and one-liner.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  renderPaperCardContent,
  validatePaperCardDisplay,
  type PaperCard,
} from '@/components/Dashboard/types';

// Generators for PaperCard testing
const titleArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

const scoreArb = fc.float({ min: 0, max: 20, noNaN: true });

const tagArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

const tagsArb = fc.array(tagArb, { minLength: 0, maxLength: 5 });

const oneLinerArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

const proArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

const conArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

const paperIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

// Generator for complete PaperCard
const paperCardArb: fc.Arbitrary<PaperCard> = fc
  .tuple(
    paperIdArb,
    titleArb,
    scoreArb,
    tagsArb,
    oneLinerArb,
    fc.array(proArb, { minLength: 2, maxLength: 2 }),
    fc.array(conArb, { minLength: 1, maxLength: 1 }),
    fc.webUrl() // Add URL generator
  )
  .map(([id, title, score, tags, oneLiner, pros, cons, url]) => ({
    id,
    title,
    score,
    tags,
    oneLiner,
    pros,
    cons,
    url,
  }));

// Generator for list of PaperCards
const paperCardsArb = fc.array(paperCardArb, { minLength: 0, maxLength: 20 });

describe('Property 12: Dashboard Paper Display Completeness', () => {
  it('should validate that all paper cards have required display fields', () => {
    fc.assert(
      fc.property(paperCardArb, (paper) => {
        const validation = validatePaperCardDisplay(paper);

        // All required fields should be present
        expect(validation.hasTitle).toBe(true);
        expect(validation.hasScore).toBe(true);
        expect(validation.hasTags).toBe(true);
        expect(validation.hasOneLiner).toBe(true);
        expect(validation.isComplete).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should render paper card content containing title', () => {
    fc.assert(
      fc.property(paperCardArb, (paper) => {
        const content = renderPaperCardContent(paper);

        // Content should contain the title
        expect(content).toContain(paper.title);
      }),
      { numRuns: 100 }
    );
  });

  it('should render paper card content containing score', () => {
    fc.assert(
      fc.property(paperCardArb, (paper) => {
        const content = renderPaperCardContent(paper);

        // Content should contain the score (formatted to 1 decimal place)
        const formattedScore = paper.score.toFixed(1);
        expect(content).toContain(formattedScore);
      }),
      { numRuns: 100 }
    );
  });

  it('should render paper card content containing tags', () => {
    fc.assert(
      fc.property(paperCardArb, (paper) => {
        const content = renderPaperCardContent(paper);

        // Content should contain all tags
        for (const tag of paper.tags) {
          expect(content).toContain(tag);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should render paper card content containing one-liner', () => {
    fc.assert(
      fc.property(paperCardArb, (paper) => {
        const content = renderPaperCardContent(paper);

        // Content should contain the one-liner
        expect(content).toContain(paper.oneLiner);
      }),
      { numRuns: 100 }
    );
  });

  it('should render all required elements (title, score, tags, one-liner) for any paper', () => {
    fc.assert(
      fc.property(paperCardArb, (paper) => {
        const content = renderPaperCardContent(paper);

        // Check title
        const hasTitle = content.includes(paper.title);

        // Check score
        const hasScore = content.includes(paper.score.toFixed(1));

        // Check tags (all tags should be present)
        const hasTags = paper.tags.every((tag) => content.includes(tag));

        // Check one-liner
        const hasOneLiner = content.includes(paper.oneLiner);

        expect(hasTitle).toBe(true);
        expect(hasScore).toBe(true);
        expect(hasTags).toBe(true);
        expect(hasOneLiner).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should validate all papers in a list have complete display fields', () => {
    fc.assert(
      fc.property(paperCardsArb, (papers) => {
        // Every paper in the list should have complete display fields
        for (const paper of papers) {
          const validation = validatePaperCardDisplay(paper);
          expect(validation.isComplete).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should render non-empty content for any valid paper card', () => {
    fc.assert(
      fc.property(paperCardArb, (paper) => {
        const content = renderPaperCardContent(paper);

        expect(content).toBeTruthy();
        expect(content.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should detect incomplete papers with missing title', () => {
    fc.assert(
      fc.property(
        fc.tuple(paperIdArb, scoreArb, tagsArb, oneLinerArb),
        ([id, score, tags, oneLiner]) => {
          const incompletePaper: PaperCard = {
            id,
            title: '', // Empty title
            score,
            tags,
            oneLiner,
            pros: ['pro1', 'pro2'],
            cons: ['con1'],
            url: 'https://example.com/paper', // Add required url field
          };

          const validation = validatePaperCardDisplay(incompletePaper);
          expect(validation.hasTitle).toBe(false);
          expect(validation.isComplete).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should detect incomplete papers with missing one-liner', () => {
    fc.assert(
      fc.property(
        fc.tuple(paperIdArb, titleArb, scoreArb, tagsArb),
        ([id, title, score, tags]) => {
          const incompletePaper: PaperCard = {
            id,
            title,
            score,
            tags,
            oneLiner: '', // Empty one-liner
            pros: ['pro1', 'pro2'],
            cons: ['con1'],
            url: 'https://example.com/paper', // Add required url field
          };

          const validation = validatePaperCardDisplay(incompletePaper);
          expect(validation.hasOneLiner).toBe(false);
          expect(validation.isComplete).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
