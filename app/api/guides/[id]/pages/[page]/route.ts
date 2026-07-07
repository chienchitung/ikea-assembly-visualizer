import { NextResponse } from "next/server";
import fs from "fs";
import { getPageImageSource } from "@/lib/store";

export const runtime = "nodejs";

/**
 * 提供說明書某一頁的圖片。
 * - demo 與 Vercel Blob 模式:轉址到靜態網址 / Blob 公開網址。
 * - 本機檔案系統模式:直接讀取 bytes 回傳。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; page: string }> }
) {
  const { id, page } = await params;
  const pageNum = parseInt(page, 10);
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 999) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  let src;
  try {
    src = await getPageImageSource(id, pageNum);
  } catch {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (src.kind === "redirect") {
    return NextResponse.redirect(new URL(src.url, _req.url), { status: 307 });
  }

  return new NextResponse(new Uint8Array(fs.readFileSync(src.path)), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
