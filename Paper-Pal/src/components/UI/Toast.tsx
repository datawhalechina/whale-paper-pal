/**
 * Toast Notification Component
 * 
 * Provides user feedback for actions like save, delete, etc.
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  onClose: (id: string) => void;
}

const toastStyles = {
  success: {
    bg: 'bg-green-500/90',
    border: 'border-green-400',
    icon: '✅',
  },
  error: {
    bg: 'bg-red-500/90',
    border: 'border-red-400',
    icon: '❌',
  },
  info: {
    bg: 'bg-blue-500/90',
    border: 'border-blue-400',
    icon: 'ℹ️',
  },
  warning: {
    bg: 'bg-yellow-500/90',
    border: 'border-yellow-400',
    icon: '⚠️',
  },
};

export function Toast({ 
  id, 
  type, 
  title, 
  message, 
  duration = 3000, 
  onClose 
}: ToastProps) {
  const style = toastStyles[type];

  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, duration);

    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -50, scale: 0.9 }}
      transition={{ duration: 0.2 }}
      className={`
        ${style.bg} ${style.border}
        border rounded-lg p-4 shadow-lg backdrop-blur-sm
        max-w-sm w-full pointer-events-auto
      `}
    >
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-medium text-sm">{title}</h4>
          {message && (
            <p className="text-white/80 text-xs mt-1">{message}</p>
          )}
        </div>
        <button
          onClick={() => onClose(id)}
          className="text-white/60 hover:text-white text-lg leading-none flex-shrink-0"
        >
          ×
        </button>
      </div>
    </motion.div>
  );
}

export function ToastContainer({ 
  toasts, 
  onClose 
}: { 
  toasts: ToastProps[]; 
  onClose: (id: string) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onClose={onClose} />
        ))}
      </AnimatePresence>
    </div>
  );
}