import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = { title: 'WorkTrace · 工作轨迹' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
