import fs from "fs";
import path from "path";
import { list, put } from "@vercel/blob";
import type { AssemblyGuide, GuideJob } from "./schema";
import { getDemoGuide, isDemoId } from "./demoGuides";

export { isDemoId };

/**
 * 儲存層，支援兩種後端：
 *
 * 1. **本機檔案系統**（預設，`npm run dev` / 自架伺服器）：維持原本行為，
 *    寫入 `.data/guides/<id>/`。
 * 2. **Vercel Blob**（設定 `BLOB_READ_WRITE_TOKEN` 後自動啟用）：寫入
 *    Vercel Blob 物件儲存。Vercel 的 serverless function 檔案系統唯讀
 *    （僅 /tmp 可寫，且不保證跨呼叫延續），本機檔案系統在正式站上完全不能用，
 *    必須改用外部物件儲存。
 *
 * 內建示範指南（kallax 等）不經過這層 —— 見 lib/demoGuides.ts。
 */

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

const DATA_DIR = path.join(process.cwd(), ".data", "guides");

function assertSafeId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("invalid id");
}

function jobDir(id: string): string {
  assertSafeId(id);
  return path.join(DATA_DIR, id);
}

function pad(page: number): string {
  return String(page).padStart(2, "0");
}

// ---------- Blob 輔助函式 ----------

/** 依 pathname 精確查找 blob 網址（list 以 prefix 比對，需再篩選完全相符者）。 */
async function findBlobUrl(pathname: string): Promise<string | null> {
  const { blobs } = await list({ prefix: pathname, limit: 10 });
  return blobs.find((b) => b.pathname === pathname)?.url ?? null;
}

async function readBlobJson<T>(pathname: string): Promise<T | null> {
  const url = await findBlobUrl(pathname);
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function writeBlobJson(pathname: string, data: unknown): Promise<void> {
  await put(pathname, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

// ---------- 工作（Job）----------

export async function createJob(job: GuideJob): Promise<void> {
  if (!USE_BLOB) fs.mkdirSync(path.join(jobDir(job.id), "pages"), { recursive: true });
  await writeJob(job);
}

export async function writeJob(job: GuideJob): Promise<void> {
  if (USE_BLOB) {
    await writeBlobJson(`guides/${job.id}/job.json`, job);
    return;
  }
  fs.writeFileSync(path.join(jobDir(job.id), "job.json"), JSON.stringify(job, null, 2));
}

export async function readJob(id: string): Promise<GuideJob | null> {
  assertSafeId(id);
  const demo = getDemoGuide(id);
  if (demo) {
    return {
      id,
      status: "ready",
      createdAt: new Date(0).toISOString(),
      fileName: `${id}.pdf`,
      fileType: demo.source.fileType,
      pageCount: demo.source.pageCount,
    };
  }
  if (USE_BLOB) return readBlobJson<GuideJob>(`guides/${id}/job.json`);
  const p = path.join(jobDir(id), "job.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as GuideJob;
}

// ---------- 指南（Guide）----------

export async function writeGuide(id: string, guide: AssemblyGuide): Promise<void> {
  if (USE_BLOB) {
    await writeBlobJson(`guides/${id}/guide.json`, guide);
    return;
  }
  fs.writeFileSync(path.join(jobDir(id), "guide.json"), JSON.stringify(guide, null, 2));
}

export async function readGuide(id: string): Promise<AssemblyGuide | null> {
  assertSafeId(id);
  const demo = getDemoGuide(id);
  if (demo) return demo;
  if (USE_BLOB) return readBlobJson<AssemblyGuide>(`guides/${id}/guide.json`);
  const p = path.join(jobDir(id), "guide.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as AssemblyGuide;
}

// ---------- 頁面圖片 ----------

/** 儲存一張已轉換的頁面圖（rasterize 產生的 JPEG bytes）。回傳 Blob 模式下的公開網址。 */
export async function savePageImage(
  id: string,
  page: number,
  bytes: Buffer
): Promise<string | null> {
  if (USE_BLOB) {
    const { url } = await put(`guides/${id}/pages/page-${pad(page)}.jpg`, bytes, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return url;
  }
  const dir = path.join(jobDir(id), "pages");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `page-${pad(page)}.jpg`), bytes);
  return null;
}

export type PageImageSource =
  | { kind: "file"; path: string }
  | { kind: "redirect"; url: string };

/** 提供給 API 路由使用：回傳本機檔案路徑（可讀 bytes）或應直接轉址的網址。 */
export async function getPageImageSource(
  id: string,
  page: number
): Promise<PageImageSource | null> {
  assertSafeId(id);
  if (isDemoId(id)) {
    // demo 頁面圖是 public/ 下的靜態檔案，交給 Next.js 的靜態資源服務處理，
    // 不透過本 function 讀取檔案系統（見 lib/demoGuides.ts 開頭說明）。
    return { kind: "redirect", url: `/demo/${id}/pages/page-${pad(page)}.jpg` };
  }
  if (USE_BLOB) {
    const job = await readJob(id);
    const url = job?.pageUrls?.[page - 1];
    return url ? { kind: "redirect", url } : null;
  }
  const p = path.join(jobDir(id), "pages", `page-${pad(page)}.jpg`);
  return fs.existsSync(p) ? { kind: "file", path: p } : null;
}
