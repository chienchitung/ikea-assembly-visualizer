import type { AssemblyGuide } from "./schema";
import kallaxGuide from "@/public/demo/kallax/guide.json";

/**
 * 內建示範指南註冊表。
 *
 * 重要：這裡用「靜態 import」而非在 API 路由裡對 public/ 做 fs.readFileSync。
 * Next.js 部署到 Vercel 時，public/ 資料夾只會被打包成靜態資源、由 CDN 直接
 * 提供服務，並不會被包進 serverless function 的檔案系統 —— 在 function 內用
 * fs 讀取 public/ 下的檔案在 Vercel 上一律會讀不到（本機 next dev / next start
 * 才會剛好找得到，因為那是同一份檔案系統）。靜態 import 則是在建置時就把 JSON
 * 內容打進程式碼，不受這個限制。
 *
 * 頁面圖片（JPEG）無法用 import 內嵌，改為直接連到 public 底下的靜態網址
 * （見 lib/store.ts 的 getPageImageSource），讓 Vercel 的靜態資源服務直接處理，
 * 同樣不經過 function 的檔案系統。
 */
export const DEMO_GUIDES: Record<string, AssemblyGuide> = {
  kallax: kallaxGuide as AssemblyGuide,
};

export function isDemoId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEMO_GUIDES, id);
}

export function getDemoGuide(id: string): AssemblyGuide | null {
  return DEMO_GUIDES[id] ?? null;
}
