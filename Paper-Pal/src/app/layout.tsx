import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Paper Pal',
  description: '桌面伴侣式 AI 论文阅读工具',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-transparent">{children}</body>
    </html>
  );
}
