import type { AssemblyGuide } from "./schema";

/**
 * 瀏覽器本機的指南儲存（IndexedDB）。
 *
 * 解析完成的指南 JSON 與各頁面圖（JPEG Blob）都存在使用者自己的瀏覽器，
 * 伺服器完全不保存任何內容——部署環境不需要設定資料庫或物件儲存。
 * 代價是指南只存在解析它的那台裝置/瀏覽器上。
 */

export interface LocalGuideRecord {
  id: string;
  createdAt: string;
  fileName: string;
  guide: AssemblyGuide;
  /** 依頁碼排序的頁面圖（1-based 對應 index+1） */
  pages: Blob[];
  /** 上傳的原始檔（PDF / 圖片），供之後重新下載；舊紀錄可能沒有 */
  sourceFile?: Blob;
}

const DB_NAME = "ikea-assembly-guides";
const STORE = "guides";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("無法開啟本機儲存"));
  });
}

export async function saveLocalGuide(rec: LocalGuideRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("寫入本機儲存失敗"));
    });
  } finally {
    db.close();
  }
}

export async function getLocalGuide(id: string): Promise<LocalGuideRecord | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as LocalGuideRecord | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("讀取本機儲存失敗"));
    });
  } finally {
    db.close();
  }
}

/** 解析紀錄清單用的摘要資訊 */
export interface LocalGuideMeta {
  id: string;
  createdAt: string;
  fileName: string;
  productName: string;
  stepCount: number;
  pageCount: number;
  /** 說明書第一頁縮圖 */
  thumbnail: Blob | null;
  /** 是否留有原始檔可供下載（舊紀錄可能沒有） */
  hasSource: boolean;
  /** 此筆紀錄佔用的儲存空間（頁面圖 + 原始檔 + 指南 JSON，約略值） */
  bytes: number;
}

/** 位元組 → 人類可讀（KB / MB，1 位小數） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 列出此瀏覽器保存的所有解析紀錄（新到舊） */
export async function listLocalGuides(): Promise<LocalGuideMeta[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  try {
    const recs = await new Promise<LocalGuideRecord[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as LocalGuideRecord[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error("讀取本機儲存失敗"));
    });
    return recs
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        fileName: r.fileName,
        productName: r.guide.product.name,
        stepCount: r.guide.steps.length,
        pageCount: r.pages.length,
        thumbnail: r.pages[0] ?? null,
        hasSource: !!r.sourceFile,
        bytes:
          r.pages.reduce((sum, p) => sum + p.size, 0) +
          (r.sourceFile?.size ?? 0) +
          JSON.stringify(r.guide).length,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    db.close();
  }
}

/** 觸發瀏覽器下載某筆紀錄的原始檔；沒有留存時回傳 false。 */
export async function downloadLocalGuideSource(id: string): Promise<boolean> {
  const rec = await getLocalGuide(id);
  if (!rec?.sourceFile) return false;
  triggerDownload(rec.sourceFile, rec.fileName || "manual.pdf");
  return true;
}

/** 以隱形連結觸發下載（object URL 用完延遲釋放） */
export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function deleteLocalGuide(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("刪除本機儲存失敗"));
    });
  } finally {
    db.close();
  }
}
