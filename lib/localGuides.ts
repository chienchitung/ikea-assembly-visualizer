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
