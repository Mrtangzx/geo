import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "品牌资料 · GEO 品牌工作台",
  description: "建立可追溯的品牌与企业事实资料，支持 AI 品牌诊断与内容优化。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
