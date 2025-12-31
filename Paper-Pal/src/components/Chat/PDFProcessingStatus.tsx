/**
 * PDF Processing Status Component
 * Shows download and processing progress for PDF documents
 *
 * Requirements: 8.1 - PDF processing status display
 */

'use client';

import { motion } from 'framer-motion';
import { type PDFProcessingStatus } from './types';

interface PDFProcessingStatusProps {
  status: PDFProcessingStatus;
  paperTitle: string;
}

export function PDFProcessingStatusComponent({
  status,
  paperTitle: _paperTitle,
}: PDFProcessingStatusProps) {
  const getStatusText = () => {
    if (status.errorMessage) {
      return `处理失败: ${status.errorMessage}`;
    }
    
    if (status.isComplete) {
      return `PDF处理完成 (${status.totalChunks} 个文档块)`;
    }
    
    if (status.isDownloading) {
      return '正在下载PDF...';
    }
    
    if (status.isProcessing) {
      if (status.totalChunks > 0) {
        return `正在处理文档 (${status.processedChunks}/${status.totalChunks} 块)`;
      }
      return '正在处理PDF...';
    }
    
    return '准备处理PDF';
  };

  const getStatusIcon = () => {
    if (status.errorMessage) {
      return '❌';
    }
    
    if (status.isComplete) {
      return '✅';
    }
    
    if (status.isDownloading || status.isProcessing) {
      return '⏳';
    }
    
    return '📄';
  };

  const progressPercentage = Math.round(status.progress * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="mx-4 mb-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg"
    >
      <div className="flex items-center gap-3">
        <span className="text-lg">{getStatusIcon()}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <p className="text-white/80 text-sm font-medium truncate">
              {getStatusText()}
            </p>
            {(status.isDownloading || status.isProcessing) && (
              <span className="text-white/60 text-xs ml-2">
                {progressPercentage}%
              </span>
            )}
          </div>
          
          {/* Progress bar */}
          {(status.isDownloading || status.isProcessing) && (
            <div className="w-full bg-white/10 rounded-full h-1.5">
              <motion.div
                className="bg-blue-400 h-1.5 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercentage}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
          
          {/* Error message */}
          {status.errorMessage && (
            <p className="text-red-300 text-xs mt-1">
              将使用摘要模式进行对话
            </p>
          )}
          
          {/* Success message */}
          {status.isComplete && (
            <p className="text-green-300 text-xs mt-1">
              现在可以基于完整PDF内容对话
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default PDFProcessingStatusComponent;