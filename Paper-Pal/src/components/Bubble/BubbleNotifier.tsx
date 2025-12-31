/**
 * Bubble Notifier Component
 * Manages notification queue and auto-dismiss functionality
 *
 * Requirements:
 * - 6.1: Display comic-style speech bubble above avatar when high-score papers found
 * - 6.2: Show paper source, topic, and score in bubble
 * - 6.3: Click bubble to expand Dashboard
 * - 6.4: Auto-dismiss after 60 seconds
 * - 6.5: Queue multiple notifications (FIFO order)
 */

'use client';

import { useEffect, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Bubble } from './Bubble';
import type { BubbleMessage } from './types';

interface BubbleNotifierProps {
  /** Current message to display */
  currentMessage: BubbleMessage | null;
  /** Callback when bubble is clicked */
  onBubbleClick?: (paperId: string) => void;
  /** Callback when bubble is dismissed (manual or auto) */
  onDismiss?: () => void;
  /** Auto-dismiss timeout in milliseconds (default: 60000 = 60 seconds) */
  autoDismissTimeout?: number;
}

const DEFAULT_AUTO_DISMISS_TIMEOUT = 60000; // 60 seconds per Requirement 6.4

export function BubbleNotifier({
  currentMessage,
  onBubbleClick,
  onDismiss,
  autoDismissTimeout = DEFAULT_AUTO_DISMISS_TIMEOUT,
}: BubbleNotifierProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timer on unmount or when message changes
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Handle auto-dismiss (Requirement 6.4)
  useEffect(() => {
    clearTimer();

    if (currentMessage && autoDismissTimeout > 0) {
      timerRef.current = setTimeout(() => {
        onDismiss?.();
      }, autoDismissTimeout);
    }

    return clearTimer;
  }, [currentMessage, autoDismissTimeout, onDismiss, clearTimer]);

  // Handle bubble click (Requirement 6.3)
  const handleBubbleClick = useCallback(() => {
    if (currentMessage) {
      clearTimer();
      onBubbleClick?.(currentMessage.paperId);
    }
  }, [currentMessage, onBubbleClick, clearTimer]);

  // Handle manual dismiss
  const handleDismiss = useCallback(() => {
    clearTimer();
    onDismiss?.();
  }, [onDismiss, clearTimer]);

  return (
    <div className="w-full max-w-[280px]">
      <AnimatePresence mode="wait">
        {currentMessage && (
          <Bubble
            key={currentMessage.id}
            message={currentMessage}
            onClick={handleBubbleClick}
            onDismiss={handleDismiss}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default BubbleNotifier;
