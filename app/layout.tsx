import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "IKEA 組裝說明書視覺化指南",
  description: "上傳 IKEA 組裝說明書,自動生成互動式視覺化組裝指南",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <header className="topbar">
          <div className="container">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo-img" src="/ikea-logo.svg" alt="IKEA" />
            <span className="topbar-title">組裝說明書視覺化指南</span>
            <Link className="home-link" href="/">
              ↩ 回首頁
            </Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
