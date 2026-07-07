import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * 將上傳的 PDF 轉成逐頁 JPEG(需系統安裝 poppler-utils 的 pdftoppm)。
 * 圖片同時用於:1) 前端底圖 2) 送給 Claude 的視覺輸入(image 上傳時)。
 * 回傳頁數。
 */
export async function rasterizePdf(pdfPath: string, outDir: string): Promise<number> {
  fs.mkdirSync(outDir, { recursive: true });
  await execFileAsync("pdftoppm", [
    "-jpeg",
    "-jpegopt", "quality=82",
    "-r", "110",
    pdfPath,
    path.join(outDir, "page"),
  ]);
  // pdftoppm 依總頁數輸出 page-1.jpg 或 page-01.jpg;統一改名為兩位數
  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^page-\d+\.jpg$/.test(f))
    .sort((a, b) => pageNo(a) - pageNo(b));
  files.forEach((f) => {
    const target = `page-${String(pageNo(f)).padStart(2, "0")}.jpg`;
    if (f !== target) fs.renameSync(path.join(outDir, f), path.join(outDir, target));
  });
  return files.length;
}

function pageNo(f: string): number {
  return parseInt(f.match(/page-(\d+)\.jpg$/)![1], 10);
}

/** 圖片上傳:直接複製為第 1 頁 */
export function copyImageAsPage(imagePath: string, outDir: string): number {
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(imagePath, path.join(outDir, "page-01.jpg"));
  return 1;
}
