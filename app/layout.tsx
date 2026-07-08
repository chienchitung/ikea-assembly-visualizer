import type { Metadata } from "next";
import Link from "next/link";
import ApiKeySettings from "@/components/ApiKeySettings";
// IKEA 品牌字體 Noto IKEA 以 Noto 家族為基底；中文以自行託管的 Noto Sans TC 對應
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "IKEA 組裝說明書視覺化指南",
  description: "上傳 IKEA 組裝說明書，自動生成互動式視覺化組裝指南",
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
            <span className="topbar-right">
              <ApiKeySettings />
              <Link className="home-link" href="/">
                回首頁
              </Link>
            </span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
