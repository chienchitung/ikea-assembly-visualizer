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
            <Link className="logo-link" href="/" aria-label="回首頁">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="logo-img" src="/ikea-logo.svg" alt="IKEA" />
            </Link>
            <span className="topbar-title">組裝說明書視覺化指南</span>
            <span className="topbar-right">
              <ApiKeySettings />
            </span>
          </div>
        </header>
        <div className="disclaimer-bar">
          <div className="container">
            本網站為非官方之第三方獨立開發工具，與 IKEA 官方網站或服務無任何關聯。
          </div>
        </div>
        {children}
        <footer className="site-footer">
          <div className="container">
            <span>開發者：Jackie Tung</span>
            <a
              href="https://github.com/chienchitung/ikea-assembly-visualizer"
              target="_blank"
              rel="noreferrer"
            >
              GitHub 開源專案
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
