/**
 * Bubble Component
 * Clean speech bubble with CSS-only styling
 */

'use client';

import { motion } from 'framer-motion';
import type { BubbleMessage } from './types';

interface BubbleProps {
  message: BubbleMessage;
  onClick?: () => void;
  onDismiss?: () => void;
}

// Floating animation
const floatAnimation = {
  y: [0, -4, 0],
  transition: {
    duration: 2,
    repeat: Infinity,
    ease: "easeInOut"
  }
};

// Bubble appearance animation
const bubbleVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 400, damping: 25 },
  },
  exit: { opacity: 0, scale: 0.9, y: -10, transition: { duration: 0.2 } },
};

// Notification messages based on count
const getNotificationMessage = (title: string) => {
  // Check if title contains count pattern like "发现 X 篇"
  const match = title.match(/发现 (\d+) 篇/);
  if (match) {
    const count = parseInt(match[1]);
    if (count >= 10) return '🎉 大丰收！';
    if (count >= 5) return '✨ 收获满满~';
    if (count >= 3) return '📚 有新发现！';
    return '💡 论文推荐~';
  }
  return '📚 发现新论文！';
};

export function Bubble({ message, onClick, onDismiss }: BubbleProps) {
  const notificationMsg = getNotificationMessage(message.title);

  return (
    <motion.div
      className="cursor-pointer select-none"
      variants={bubbleVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <motion.div animate={floatAnimation}>
        <div className="relative">
          {/* Bubble body */}
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-3 w-56">
            {/* Close button */}
            <button
              className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 text-[10px]"
              onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
            >
              ✕
            </button>

            {/* Message */}
            <div className="text-gray-700 font-medium text-xs mb-1.5 pr-4">
              {notificationMsg}
            </div>

            {/* Title - shows paper count */}
            <p className="text-gray-600 text-[11px] leading-snug mb-2">
              {message.title}
            </p>

            {/* Best Score + Button */}
            <div className="flex items-center justify-between">
              <span className="text-amber-500 text-[11px] font-medium">
                最高分 ⭐ {message.score.toFixed(1)}
              </span>
              <button
                className="px-2 py-0.5 bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-medium rounded-full"
                onClick={(e) => { e.stopPropagation(); onClick?.(); }}
              >
                查看
              </button>
            </div>
          </div>

          {/* Tail */}
          <div className="absolute -bottom-1.5 left-5">
            <div style={{
              width: 0, height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '8px solid #e5e7eb',
            }} />
            <div style={{
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '7px solid white',
              position: 'absolute',
              top: '-1px',
              left: '1px',
            }} />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default Bubble;
