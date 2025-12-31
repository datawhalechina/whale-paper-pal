/**
 * useBubbleNotifier Hook
 * Manages notification queue with FIFO order and auto-dismiss
 *
 * Requirements:
 * - 6.3: Click bubble to expand Dashboard
 * - 6.4: Auto-dismiss after 60 seconds
 * - 6.5: Queue multiple notifications (FIFO order)
 * 
 * Property 9: Notification Queue FIFO Order
 * For any sequence of BubbleMessages queued, they SHALL be displayed in FIFO order.
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { BubbleMessage } from './types';

interface UseBubbleNotifierOptions {
  /** Auto-dismiss timeout in milliseconds (default: 60000) */
  autoDismissTimeout?: number;
  /** Callback when bubble is clicked */
  onBubbleClick?: (paperId: string) => void;
}

interface UseBubbleNotifierReturn {
  /** Current message being displayed */
  currentMessage: BubbleMessage | null;
  /** Queue of pending messages */
  queue: BubbleMessage[];
  /** Add a message to the queue */
  enqueue: (message: BubbleMessage) => void;
  /** Add multiple messages to the queue (FIFO order preserved) */
  enqueueAll: (messages: BubbleMessage[]) => void;
  /** Dismiss current message and show next in queue */
  dismiss: () => void;
  /** Clear all messages including current */
  clearAll: () => void;
  /** Handle bubble click */
  handleBubbleClick: (paperId: string) => void;
  /** Auto-dismiss timeout value */
  autoDismissTimeout: number;
}

const DEFAULT_AUTO_DISMISS_TIMEOUT = 60000; // 60 seconds

/**
 * Hook for managing bubble notification queue
 * Implements FIFO (First-In-First-Out) ordering per Property 9
 */
export function useBubbleNotifier(
  options: UseBubbleNotifierOptions = {}
): UseBubbleNotifierReturn {
  const {
    autoDismissTimeout = DEFAULT_AUTO_DISMISS_TIMEOUT,
    onBubbleClick,
  } = options;

  // Queue state - messages waiting to be displayed
  const [queue, setQueue] = useState<BubbleMessage[]>([]);
  // Current message being displayed
  const [currentMessage, setCurrentMessage] = useState<BubbleMessage | null>(null);
  
  // Timer ref for auto-dismiss
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the auto-dismiss timer
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Show next message from queue
  const showNext = useCallback(() => {
    setQueue((prevQueue) => {
      if (prevQueue.length === 0) {
        setCurrentMessage(null);
        return prevQueue;
      }
      // FIFO: take first message from queue
      const [next, ...rest] = prevQueue;
      setCurrentMessage(next);
      return rest;
    });
  }, []);

  // Dismiss current message and show next (Requirement 6.4)
  const dismiss = useCallback(() => {
    clearTimer();
    showNext();
  }, [clearTimer, showNext]);

  // Enqueue a single message (Requirement 6.5)
  const enqueue = useCallback((message: BubbleMessage) => {
    setQueue((prevQueue) => {
      // If no current message, show immediately
      if (!currentMessage && prevQueue.length === 0) {
        setCurrentMessage(message);
        return prevQueue;
      }
      // Otherwise add to end of queue (FIFO)
      return [...prevQueue, message];
    });
  }, [currentMessage]);

  // Enqueue multiple messages preserving order (Property 9: FIFO)
  const enqueueAll = useCallback((messages: BubbleMessage[]) => {
    if (messages.length === 0) return;

    setQueue((prevQueue) => {
      // If no current message and queue is empty, show first immediately
      if (!currentMessage && prevQueue.length === 0) {
        const [first, ...rest] = messages;
        setCurrentMessage(first);
        return rest;
      }
      // Otherwise add all to end of queue (FIFO order preserved)
      return [...prevQueue, ...messages];
    });
  }, [currentMessage]);

  // Clear all messages
  const clearAll = useCallback(() => {
    clearTimer();
    setQueue([]);
    setCurrentMessage(null);
  }, [clearTimer]);

  // Handle bubble click (Requirement 6.3)
  const handleBubbleClick = useCallback((paperId: string) => {
    clearTimer();
    onBubbleClick?.(paperId);
    // Dismiss current and show next
    showNext();
  }, [clearTimer, onBubbleClick, showNext]);

  // Auto-dismiss timer effect (Requirement 6.4)
  useEffect(() => {
    clearTimer();

    if (currentMessage && autoDismissTimeout > 0) {
      timerRef.current = setTimeout(() => {
        dismiss();
      }, autoDismissTimeout);
    }

    return clearTimer;
  }, [currentMessage, autoDismissTimeout, dismiss, clearTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return {
    currentMessage,
    queue,
    enqueue,
    enqueueAll,
    dismiss,
    clearAll,
    handleBubbleClick,
    autoDismissTimeout,
  };
}

/**
 * Pure function for queue operations (useful for testing)
 * Property 9: Notification Queue FIFO Order
 */
export class NotificationQueue {
  private _queue: BubbleMessage[] = [];
  private _current: BubbleMessage | null = null;

  get queue(): BubbleMessage[] {
    return [...this._queue];
  }

  get current(): BubbleMessage | null {
    return this._current;
  }

  get length(): number {
    return this._queue.length;
  }

  /**
   * Add message to queue (FIFO)
   * If no current message, it becomes current immediately
   */
  enqueue(message: BubbleMessage): void {
    if (this._current === null) {
      this._current = message;
    } else {
      this._queue.push(message);
    }
  }

  /**
   * Add multiple messages preserving order (FIFO)
   */
  enqueueAll(messages: BubbleMessage[]): void {
    for (const message of messages) {
      this.enqueue(message);
    }
  }

  /**
   * Dismiss current and get next from queue
   * Returns the new current message (or null if queue empty)
   */
  dismiss(): BubbleMessage | null {
    if (this._queue.length > 0) {
      this._current = this._queue.shift()!;
    } else {
      this._current = null;
    }
    return this._current;
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this._queue = [];
    this._current = null;
  }

  /**
   * Get all messages in order (current first, then queue)
   * Useful for testing FIFO property
   */
  getAllInOrder(): BubbleMessage[] {
    if (this._current === null) {
      return [];
    }
    return [this._current, ...this._queue];
  }
}

export default useBubbleNotifier;
