import { NextResponse } from "next/server";
import fs from "fs";
import { pageImagePath } from "@/lib/store";

export const runtime = "nodejs";

/** 提供說明書某一頁的圖片(demo 與上傳工作共用)。 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; page: string }> }
) {
  const { id, page } = await params;
  const pageNum = parseInt(page, 10);
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 999) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  let imgPath: string | null;
  try {
    imgPath = pageImagePath(id, pageNum);
  } catch {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!imgPath) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(fs.readFileSync(imgPath)), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
