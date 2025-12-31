'use client';

import React from 'react';

interface SimpleAvatarProps {
  size?: number;
  onClick?: () => void;
}

export function SimpleAvatar({ size = 128, onClick }: SimpleAvatarProps) {
  return (
    <div
      className="rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg cursor-pointer hover:scale-105 transition-transform"
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      <span style={{ fontSize: size * 0.4 }}>😊</span>
    </div>
  );
}

export default SimpleAvatar;