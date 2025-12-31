/**
 * Chat Message Component
 * Renders individual chat messages with user/assistant styling
 *
 * Requirements: 8.2
 */

'use client';

import { motion } from 'framer-motion';
import type { ChatMessage } from './types';

interface ChatMessageProps {
  message: ChatMessage;
}

// Simple function to render basic markdown formatting
function renderMessageContent(content: string) {
  // Split content by lines to handle the source indicators
  const lines = content.split('\n');
  
  return lines.map((line, index) => {
    // Handle source indicators with special styling
    if (line.includes('📄 **本回复基于PDF全文内容**')) {
      return (
        <div key={index} className="mt-3 pt-2 border-t border-white/20">
          <span className="inline-flex items-center gap-1 text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded-full">
            📄 <strong>本回复基于PDF全文内容</strong>
          </span>
        </div>
      );
    }
    
    if (line.includes('📝 **本回复仅基于论文摘要，可能存在幻觉**')) {
      return (
        <div key={index} className="mt-3 pt-2 border-t border-white/20">
          <span className="inline-flex items-center gap-1 text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded-full">
            📝 <strong>本回复仅基于论文摘要，可能存在幻觉</strong>
          </span>
        </div>
      );
    }
    
    // Handle bold text with **text**
    if (line.includes('**')) {
      const parts = line.split(/(\*\*.*?\*\*)/);
      return (
        <span key={index}>
          {parts.map((part, partIndex) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              // Remove ** and make bold
              const boldText = part.slice(2, -2);
              return (
                <strong key={partIndex} className="font-semibold">
                  {boldText}
                </strong>
              );
            }
            return part;
          })}
          {index < lines.length - 1 && <br />}
        </span>
      );
    }
    
    // Skip empty lines that are just source indicators
    if (line.trim() === '') {
      return null;
    }
    
    // Regular line
    return (
      <span key={index}>
        {line}
        {index < lines.length - 1 && <br />}
      </span>
    );
  });
}

interface ChatMessageProps {
  message: ChatMessage;
}

export function ChatMessageComponent({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? 'bg-purple-500/80 text-white rounded-br-sm'
            : 'bg-white/10 text-white/90 rounded-bl-sm'
        }`}
      >
        {/* Message content */}
        <div className="text-sm break-words">
          {renderMessageContent(message.content)}
        </div>
        
        {/* Timestamp */}
        <p
          className={`text-xs mt-1 ${
            isUser ? 'text-white/60' : 'text-white/40'
          }`}
        >
          {message.timestamp.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </motion.div>
  );
}

export default ChatMessageComponent;
