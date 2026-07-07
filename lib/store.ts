import fs from "fs";
import path from "path";
import type { AssemblyGuide, GuideJob } from "./schema";

/**
 * 檔案系統儲存層。每個解析工作一個資料夾:
 *   .data/guides/<id>/
 *     job.json        工作狀態
 *     source.<ext>    原始上傳檔
 *     pages/page-01.jpg ...  轉出的頁面圖
 *     guide.json      解析完成的結構化指南
 *
 * 內建示範資料放在 public/demo/<id>/,以唯讀方式對外提供。
 */

const DATA_DIR = path.join(process.cwd(), ".data", "guides");
const DEMO_DIR = path.join(process.cwd(), "public", "demo");

export function jobDir(id: string): string {
  assertSafeId(id);
  return path.join(DATA_DIR, id);
}

function assertSafeId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("invalid id");
}

export function isDemoId(id: string): boolean {
  assertSafeId(id);
  return fs.existsSync(path.join(DEMO_DIR, id, "guide.json"));
}

export function createJob(job: GuideJob): void {
  fs.mkdirSync(path.join(jobDir(job.id), "pages"), { recursive: true });
  writeJob(job);
}

export function writeJob(job: GuideJob): void {
  fs.writeFileSync(path.join(jobDir(job.id), "job.json"), JSON.stringify(job, null, 2));
}

export function readJob(id: string): GuideJob | null {
  if (isDemoId(id)) {
    const guide = readGuide(id)!;
    return {
      id,
      status: "ready",
      createdAt: new Date(0).toISOString(),
      fileName: `${id}.pdf`,
      fileType: guide.source.fileType,
      pageCount: guide.source.pageCount,
    };
  }
  const p = path.join(jobDir(id), "job.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as GuideJob;
}

export function writeGuide(id: string, guide: AssemblyGuide): void {
  fs.writeFileSync(path.join(jobDir(id), "guide.json"), JSON.stringify(guide, null, 2));
}

export function readGuide(id: string): AssemblyGuide | null {
  assertSafeId(id);
  const demoPath = path.join(DEMO_DIR, id, "guide.json");
  const p = fs.existsSync(demoPath) ? demoPath : path.join(jobDir(id), "guide.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as AssemblyGuide;
}

/** 取得某頁圖片的實體路徑(demo 或上傳工作) */
export function pageImagePath(id: string, page: number): string | null {
  assertSafeId(id);
  const name = `page-${String(page).padStart(2, "0")}.jpg`;
  const demoPath = path.join(DEMO_DIR, id, "pages", name);
  if (fs.existsSync(demoPath)) return demoPath;
  const p = path.join(jobDir(id), "pages", name);
  return fs.existsSync(p) ? p : null;
}

export function sourceFilePath(id: string): string | null {
  const dir = jobDir(id);
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find((n) => n.startsWith("source."));
  return f ? path.join(dir, f) : null;
}
