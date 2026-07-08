import { NextResponse } from "next/server";
import { getDemoPageUrl } from "@/lib/store";

export const runtime = "nodejs";

/** 提供示範指南某一頁的圖片：轉址到 public/ 下的靜態網址。 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; page: string }> }
) {
  const { id, page } = await params;
  const pageNum = parseInt(page, 10);
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 999) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  const url = getDemoPageUrl(id, pageNum);
  if (!url) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(new URL(url, req.url), { status: 307 });
}
