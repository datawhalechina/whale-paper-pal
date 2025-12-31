/**
 * Feature: paper-pal, Property 9: Notification Queue FIFO Order
 * Validates: Requirements 6.5
 *
 * For any sequence of BubbleMessages queued to Bubble_Notifier,
 * they SHALL be displayed in FIFO (First-In-First-Out) order.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { NotificationQueue } from '@/components/Bubble/useBubbleNotifier';
import { createBubbleMessage, type BubbleMessage } from '@/components/Bubble/types';

// Generators
const sourceArb = fc.constantFrom('arxiv', 'huggingface') as fc.Arbitrary<'arxiv' | 'huggingface'>;
const titleArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);
const scoreArb = fc.float({ min: 0, max: 20, noNaN: true });
const paperIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

// Generator for BubbleMessage with unique ID based on index
const bubbleMessageWithIndexArb = (index: number): fc.Arbitrary<BubbleMessage> =>
  fc.tuple(titleArb, sourceArb, scoreArb).map(([title, source, score]) => {
    const msg = createBubbleMessage(`paper-${index}`, title, source, score);
    msg.id = `msg-${index}`; // Override ID for deterministic ordering checks
    return msg;
  });

// Generator for array of BubbleMessages with sequential IDs
const bubbleMessageArrayArb = (minLen: number, maxLen: number): fc.Arbitrary<BubbleMessage[]> =>
  fc.integer({ min: minLen, max: maxLen }).chain((len) =>
    fc.tuple(...Array.from({ length: len }, (_, i) => bubbleMessageWithIndexArb(i)))
  );

describe('Property 9: Notification Queue FIFO Order', () => {
  it('enqueued messages should be retrieved in FIFO order', () => {
    fc.assert(
      fc.property(bubbleMessageArrayArb(1, 20), (messages) => {
        const queue = new NotificationQueue();

        // Enqueue all messages
        for (const msg of messages) {
          queue.enqueue(msg);
        }

        // Retrieve all messages by dismissing
        const retrieved: BubbleMessage[] = [];
        if (queue.current) {
          retrieved.push(queue.current);
        }
        while (queue.length > 0) {
          const next = queue.dismiss();
          if (next) retrieved.push(next);
        }

        // Verify FIFO order: retrieved order should match input order
        expect(retrieved.length).toBe(messages.length);
        for (let i = 0; i < messages.length; i++) {
          expect(retrieved[i].id).toBe(messages[i].id);
        }
      }),
      { numRuns: 100 }
    );
  });


  it('enqueueAll should preserve input order (FIFO)', () => {
    fc.assert(
      fc.property(bubbleMessageArrayArb(1, 20), (messages) => {
        const queue = new NotificationQueue();

        // Enqueue all at once
        queue.enqueueAll(messages);

        // getAllInOrder should return messages in original order
        const allInOrder = queue.getAllInOrder();
        expect(allInOrder.length).toBe(messages.length);
        for (let i = 0; i < messages.length; i++) {
          expect(allInOrder[i].id).toBe(messages[i].id);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('first enqueued message becomes current immediately', () => {
    fc.assert(
      fc.property(bubbleMessageWithIndexArb(0), (message) => {
        const queue = new NotificationQueue();

        expect(queue.current).toBeNull();
        queue.enqueue(message);
        expect(queue.current).not.toBeNull();
        expect(queue.current!.id).toBe(message.id);
        expect(queue.length).toBe(0); // Queue should be empty, message is current
      }),
      { numRuns: 100 }
    );
  });

  it('subsequent messages go to queue, not current', () => {
    fc.assert(
      fc.property(bubbleMessageArrayArb(2, 10), (messages) => {
        const queue = new NotificationQueue();

        // Enqueue all
        for (const msg of messages) {
          queue.enqueue(msg);
        }

        // First message should be current
        expect(queue.current!.id).toBe(messages[0].id);
        // Rest should be in queue
        expect(queue.length).toBe(messages.length - 1);
      }),
      { numRuns: 100 }
    );
  });

  it('dismiss should advance to next message in FIFO order', () => {
    fc.assert(
      fc.property(bubbleMessageArrayArb(2, 10), (messages) => {
        const queue = new NotificationQueue();
        queue.enqueueAll(messages);

        // Dismiss and check each subsequent message
        for (let i = 1; i < messages.length; i++) {
          const next = queue.dismiss();
          expect(next).not.toBeNull();
          expect(next!.id).toBe(messages[i].id);
        }

        // After all dismissed, should be null
        const final = queue.dismiss();
        expect(final).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('clear should remove all messages', () => {
    fc.assert(
      fc.property(bubbleMessageArrayArb(1, 20), (messages) => {
        const queue = new NotificationQueue();
        queue.enqueueAll(messages);

        queue.clear();

        expect(queue.current).toBeNull();
        expect(queue.length).toBe(0);
        expect(queue.getAllInOrder()).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it('interleaved enqueue and dismiss should maintain FIFO', () => {
    fc.assert(
      fc.property(
        bubbleMessageArrayArb(3, 10),
        bubbleMessageArrayArb(1, 5),
        (firstBatch, secondBatch) => {
          const queue = new NotificationQueue();

          // Enqueue first batch
          queue.enqueueAll(firstBatch);

          // Dismiss one
          queue.dismiss();

          // Enqueue second batch
          queue.enqueueAll(secondBatch);

          // Expected order: firstBatch[1:] + secondBatch
          const expected = [...firstBatch.slice(1), ...secondBatch];
          const actual = queue.getAllInOrder();

          expect(actual.length).toBe(expected.length);
          for (let i = 0; i < expected.length; i++) {
            expect(actual[i].id).toBe(expected[i].id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty queue operations should be safe', () => {
    const queue = new NotificationQueue();

    // Dismiss on empty should return null
    expect(queue.dismiss()).toBeNull();
    expect(queue.current).toBeNull();
    expect(queue.length).toBe(0);
    expect(queue.getAllInOrder()).toEqual([]);

    // Clear on empty should be safe
    queue.clear();
    expect(queue.current).toBeNull();
  });
});
