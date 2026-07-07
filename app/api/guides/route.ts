import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createJob, jobDir, readJob, writeJob } from "@/lib/store";
import { copyImageAsPage, rasterizePdf } from "@/lib/rasterize";
import { parseManual } from "@/lib/parser";
import { writeGuide } from "@/lib/store";
import type { GuideJob } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 600;

const ACCEPTED: Record<string, "pdf" | "image"> = {
  "application/pdf": "pdf",
  "image/jpeg": "image",
  "image/png": "image",
};

/** 上傳說明書:建立解析工作,回傳工作 id,前端輪詢狀態。 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少檔案" }, { status: 400 });
  }
  const fileType = ACCEPTED[file.type];
  if (!fileType) {
    return NextResponse.json(
      { error: "僅支援 PDF、JPG、PNG 格式" },
      { status: 415 }
    );
  }
  if (file.size > 40 * 1024 * 1024) {
    return NextResponse.json({ error: "檔案不可超過 40MB" }, { status: 413 });
  }

  const id = crypto.randomBytes(8).toString("hex");
  const job: GuideJob = {
    id,
    status: "uploaded",
    createdAt: new Date().toISOString(),
    fileName: file.name,
    fileType,
    pageCount: 0,
  };
  createJob(job);

  const ext = fileType === "pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const sourcePath = path.join(jobDir(id), `source.${ext}`);
  fs.writeFileSync(sourcePath, Buffer.from(await file.arrayBuffer()));

  // 非同步執行:轉頁面圖 → Claude 解析 → 寫入 guide.json
  void runPipeline(id, sourcePath, fileType).catch((err) => {
    const j = readJob(id);
    if (j) {
      j.status = "error";
      j.error = err instanceof Error ? err.message : String(err);
      writeJob(j);
    }
  });

  return NextResponse.json({ id }, { status: 202 });
}

async function runPipeline(id: string, sourcePath: string, fileType: "pdf" | "image") {
  const job = readJob(id)!;
  const pagesDir = path.join(jobDir(id), "pages");

  job.status = "rendering";
  writeJob(job);
  job.pageCount =
    fileType === "pdf"
      ? await rasterizePdf(sourcePath, pagesDir)
      : copyImageAsPage(sourcePath, pagesDir);

  job.status = "parsing";
  writeJob(job);
  const guide = await parseManual({
    fileType,
    pdfPath: fileType === "pdf" ? sourcePath : undefined,
    pagesDir,
    pageCount: job.pageCount,
  });

  writeGuide(id, guide);
  job.status = "ready";
  writeJob(job);
}
