'use client';

import React from 'react';

interface WindowSettingsProps {
  onClose: () => void;
}

export default function WindowSettingsSimple({ onClose }: WindowSettingsProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-800">设置</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">
            ×
          </button>
        </div>
        <div className="text-center text-gray-500 py-8">
          设置面板 (测试版本)
        </div>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}