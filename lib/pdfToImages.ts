/**
 * 瀏覽器端的 PDF 轉頁面圖：用 pdfjs-dist 在使用者的瀏覽器裡把每一頁
 * 渲染成 JPEG Blob，供指南檢視器當底圖。完全不經過伺服器。
 */
export async function pdfToPageBlobs(
  pdfBytes: ArrayBuffer,
  onProgress?: (page: number, total: number) => void
): Promise<Blob[]> {
  // legacy 版含舊瀏覽器 polyfill（標準版用到 Map.getOrInsertComputed 等
  // 過新的 API，在較舊的瀏覽器會直接拋錯）
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  // getDocument 會把 buffer 轉移給 worker（detach），複製一份避免呼叫端的
  // bytes 被清空
  const data = new Uint8Array(pdfBytes.slice(0));
  const doc = await pdfjs.getDocument({ data }).promise;

  const blobs: Blob[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    // 頁寬渲染到約 1400px（上限 2.5 倍），兼顧細節與記憶體
    const scale = Math.min(2.5, 1400 / base.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("頁面轉圖失敗"))),
        "image/jpeg",
        0.85
      )
    );
    blobs.push(blob);
    onProgress?.(p, doc.numPages);
  }
  await doc.cleanup();
  return blobs;
}
