/**
 * Feature: paper-pal, Property 10: Chat Context Lifecycle
 * Validates: Requirements 8.1, 8.4, 8.5
 *
 * For any chat session:
 * - On open: context SHALL contain the paper's abstract
 * - During session: history SHALL contain all sent and received messages in order
 * - On close: context and history SHALL be cleared (empty)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createChatContext,
  createChatMessage,
  addMessageToHistory,
  clearChatContext,
  validateChatContextState,
  type ChatContext,
  type ChatMessage,
} from '@/components/Chat/types';

// Generators for chat context testing
const paperIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

const paperTitleArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

const abstractArb = fc.string({ minLength: 10, maxLength: 2000 }).filter((s) => s.trim().length > 0);

const messageContentArb = fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0);

const roleArb = fc.constantFrom('user', 'assistant') as fc.Arbitrary<'user' | 'assistant'>;

// Generator for a sequence of messages
const messageSequenceArb = fc.array(
  fc.tuple(roleArb, messageContentArb),
  { minLength: 0, maxLength: 20 }
);

describe('Property 10: Chat Context Lifecycle', () => {
  describe('On open: context SHALL contain the paper\'s abstract', () => {
    it('should create context with abstract for any valid paper data', () => {
      fc.assert(
        fc.property(paperIdArb, paperTitleArb, abstractArb, (paperId, paperTitle, abstract) => {
          const context = createChatContext(paperId, paperTitle, abstract);

          // Context should contain the abstract
          expect(context.abstract).toBe(abstract);
          expect(context.abstract.trim().length).toBeGreaterThan(0);

          // Context should have correct paper info
          expect(context.paperId).toBe(paperId);
          expect(context.paperTitle).toBe(paperTitle);

          // History should be empty initially
          expect(context.history).toEqual([]);
        }),
        { numRuns: 100 }
      );
    });

    it('should validate open state correctly', () => {
      fc.assert(
        fc.property(paperIdArb, paperTitleArb, abstractArb, (paperId, paperTitle, abstract) => {
          const context = createChatContext(paperId, paperTitle, abstract);
          const isOpen = true;

          const validation = validateChatContextState(context, isOpen);

          expect(validation.hasAbstract).toBe(true);
          expect(validation.historyInOrder).toBe(true);
          expect(validation.isCleared).toBe(false);
          expect(validation.isValid).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('During session: history SHALL contain all messages in order', () => {
    it('should maintain message order when adding messages', () => {
      fc.assert(
        fc.property(
          paperIdArb,
          paperTitleArb,
          abstractArb,
          messageSequenceArb,
          (paperId, paperTitle, abstract, messageSequence) => {
            let context = createChatContext(paperId, paperTitle, abstract);

            // Add messages one by one
            const addedMessages: ChatMessage[] = [];
            for (const [role, content] of messageSequence) {
              const message = createChatMessage(role, content);
              addedMessages.push(message);
              context = addMessageToHistory(context, message);
            }

            // History should contain all messages
            expect(context.history.length).toBe(messageSequence.length);

            // Messages should be in the same order they were added
            for (let i = 0; i < addedMessages.length; i++) {
              expect(context.history[i].id).toBe(addedMessages[i].id);
              expect(context.history[i].content).toBe(addedMessages[i].content);
              expect(context.history[i].role).toBe(addedMessages[i].role);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve chronological order of timestamps', () => {
      fc.assert(
        fc.property(
          paperIdArb,
          paperTitleArb,
          abstractArb,
          fc.array(fc.tuple(roleArb, messageContentArb), { minLength: 2, maxLength: 10 }),
          (paperId, paperTitle, abstract, messageSequence) => {
            let context = createChatContext(paperId, paperTitle, abstract);

            // Add messages with small delays to ensure different timestamps
            for (const [role, content] of messageSequence) {
              const message = createChatMessage(role, content);
              context = addMessageToHistory(context, message);
            }

            // Timestamps should be in non-decreasing order
            for (let i = 1; i < context.history.length; i++) {
              expect(context.history[i].timestamp.getTime()).toBeGreaterThanOrEqual(
                context.history[i - 1].timestamp.getTime()
              );
            }

            // Validation should confirm order
            const validation = validateChatContextState(context, true);
            expect(validation.historyInOrder).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not lose messages when adding new ones', () => {
      fc.assert(
        fc.property(
          paperIdArb,
          paperTitleArb,
          abstractArb,
          messageSequenceArb,
          (paperId, paperTitle, abstract, messageSequence) => {
            let context = createChatContext(paperId, paperTitle, abstract);
            let expectedCount = 0;

            for (const [role, content] of messageSequence) {
              const message = createChatMessage(role, content);
              context = addMessageToHistory(context, message);
              expectedCount++;

              // After each addition, count should match
              expect(context.history.length).toBe(expectedCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve abstract throughout session', () => {
      fc.assert(
        fc.property(
          paperIdArb,
          paperTitleArb,
          abstractArb,
          messageSequenceArb,
          (paperId, paperTitle, abstract, messageSequence) => {
            let context = createChatContext(paperId, paperTitle, abstract);
            const originalAbstract = context.abstract;

            // Add multiple messages
            for (const [role, content] of messageSequence) {
              const message = createChatMessage(role, content);
              context = addMessageToHistory(context, message);

              // Abstract should remain unchanged
              expect(context.abstract).toBe(originalAbstract);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('On close: context and history SHALL be cleared', () => {
    it('should return null when clearing context', () => {
      fc.assert(
        fc.property(
          paperIdArb,
          paperTitleArb,
          abstractArb,
          messageSequenceArb,
          (paperId, paperTitle, abstract, messageSequence) => {
            // Create context with messages
            let context: ChatContext | null = createChatContext(paperId, paperTitle, abstract);
            
            for (const [role, content] of messageSequence) {
              const message = createChatMessage(role, content);
              context = addMessageToHistory(context, message);
            }

            // Clear the context
            context = clearChatContext();

            // Context should be null
            expect(context).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate closed state correctly', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const context = clearChatContext();
          const isOpen = false;

          const validation = validateChatContextState(context, isOpen);

          expect(validation.isCleared).toBe(true);
          expect(validation.isValid).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should detect invalid state: open without context', () => {
      const validation = validateChatContextState(null, true);

      expect(validation.isValid).toBe(false);
    });

    it('should detect invalid state: closed with context', () => {
      fc.assert(
        fc.property(paperIdArb, paperTitleArb, abstractArb, (paperId, paperTitle, abstract) => {
          const context = createChatContext(paperId, paperTitle, abstract);
          const isOpen = false; // Closed but has context

          const validation = validateChatContextState(context, isOpen);

          expect(validation.isValid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Message creation', () => {
    it('should create messages with unique IDs', () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(roleArb, messageContentArb), { minLength: 2, maxLength: 50 }),
          (messageData) => {
            const messages = messageData.map(([role, content]) =>
              createChatMessage(role, content)
            );

            // All IDs should be unique
            const ids = messages.map((m) => m.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should create messages with correct role and content', () => {
      fc.assert(
        fc.property(roleArb, messageContentArb, (role, content) => {
          const message = createChatMessage(role, content);

          expect(message.role).toBe(role);
          expect(message.content).toBe(content);
          expect(message.timestamp).toBeInstanceOf(Date);
          expect(message.id).toBeTruthy();
          expect(message.id.startsWith('msg-')).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });
});
