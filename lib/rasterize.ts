import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * 純 JS 的 PDF 轉頁面圖（不倚賴系統安裝的 poppler-utils / pdftoppm）。
 *
 * 先前版本用 child_process 呼叫系統的 pdftoppm 二進位檔，在本機或自架伺服器
 * 沒問題，但 Vercel 的 Node.js serverless function 環境沒有這個執行檔，會直接
 * 噴 ENOENT。改用 pdfjs-dist（純 JS 解析 PDF）+ @napi-rs/canvas（有預編譯原生
 * 綁定、Vercel 的 Linux x64 執行環境可直接載入）在記憶體中渲染每一頁，
 * 完全不需要外部二進位檔或系統套件。
 *
 * 回傳每頁的 JPEG bytes（不落地到檔案系統），呼叫端（pipeline）自行決定
 * 要寫入本機 .data/ 或上傳到 Vercel Blob。
 */
export async function rasterizePdf(pdfBytes: Uint8Array): Promise<Buffer[]> {
  // pdfjs-dist 嚴格檢查輸入必須是「真正的」Uint8Array（建構子檢查），Node.js
  // 的 Buffer 雖然繼承自 Uint8Array，仍會被拒絕並丟出
  // "Please provide binary data as `Uint8Array`, rather than `Buffer`."
  // 這裡明確轉型一次，確保無論呼叫端傳的是 Buffer 還是 Uint8Array 都能用。
  const data = new Uint8Array(pdfBytes);
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
  const scale = 110 / 72; // 約等同原本 pdftoppm -r 110 的解析度
  const buffers: Buffer[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    // napi-rs 的 canvas 不是真的 DOM HTMLCanvasElement，依 pdfjs 文件：
    // 若要直接用 2D context 渲染，canvas 需傳 null。
    await page.render({
      canvas: null,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    buffers.push(canvas.toBuffer("image/jpeg", 82));
  }
  return buffers;
}

/** 圖片上傳：視為單頁，直接回傳原始 bytes。 */
export function imageAsSinglePage(imageBytes: Buffer): Buffer[] {
  return [imageBytes];
}
