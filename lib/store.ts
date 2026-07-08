import type { AssemblyGuide, GuideJob } from "./schema";
import { getDemoGuide, isDemoId } from "./demoGuides";

export { isDemoId };

/**
 * 伺服器端只服務「內建示範指南」（kallax 等）。
 *
 * 使用者上傳的說明書自 v2 起全部在瀏覽器內解析並存於 IndexedDB
 * （見 lib/localGuides.ts），伺服器不再保存任何使用者內容——
 * 部署環境因此不需要資料庫、Blob 或任何金鑰設定。
 */

function pad(page: number): string {
  return String(page).padStart(2, "0");
}

export async function readJob(id: string): Promise<GuideJob | null> {
  const demo = getDemoGuide(id);
  if (!demo) return null;
  return {
    id,
    status: "ready",
    createdAt: new Date(0).toISOString(),
    fileName: `${id}.pdf`,
    fileType: demo.source.fileType,
    pageCount: demo.source.pageCount,
  };
}

export async function readGuide(id: string): Promise<AssemblyGuide | null> {
  return getDemoGuide(id);
}

/**
 * 示範指南頁面圖的靜態網址（public/ 下由 CDN 直接提供，
 * 見 lib/demoGuides.ts 開頭說明）。非示範指南一律回 null。
 */
export function getDemoPageUrl(id: string, page: number): string | null {
  if (!isDemoId(id)) return null;
  return `/demo/${id}/pages/page-${pad(page)}.jpg`;
}
