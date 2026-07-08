import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { waitUntil } from "@vercel/functions";
import { createJob, readJob, savePageImage, writeGuide, writeJob } from "@/lib/store";
import { imageAsSinglePage, rasterizePdf } from "@/lib/rasterize";
import { parseManual, type ParseInput } from "@/lib/parser";
import { parseManualGemini, sanitizeModel } from "@/lib/parserGemini";
import type { GuideJob } from "@/lib/schema";

/**
 * 解析引擎選擇:
 * 1. 請求帶有 x-gemini-api-key(使用者在右上角輸入、僅存於其瀏覽器)→ Gemini
 * 2. 伺服器設定 GEMINI_API_KEY → Gemini
 * 3. 伺服器設定 ANTHROPIC_API_KEY → Claude
 * 瀏覽器金鑰只在該次請求的記憶體中使用,不寫入任何儲存。
 */
interface EngineChoice {
  engine: "gemini" | "claude";
  geminiKey?: string;
  geminiModel?: string;
}

function chooseEngine(req: NextRequest): EngineChoice | null {
  const browserKey = req.headers.get("x-gemini-api-key")?.trim();
  const model = sanitizeModel(req.headers.get("x-gemini-model")) ?? undefined;
  if (browserKey) return { engine: "gemini", geminiKey: browserKey, geminiModel: model };
  if (process.env.GEMINI_API_KEY) {
    return { engine: "gemini", geminiKey: process.env.GEMINI_API_KEY, geminiModel: model };
  }
  if (process.env.ANTHROPIC_API_KEY) return { engine: "claude" };
  return null;
}

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const choice = chooseEngine(req);
  if (!choice) {
    return NextResponse.json(
      { error: "尚未設定解析金鑰:請點右上角「API 金鑰」輸入 Google Gemini 金鑰(僅存於你的瀏覽器),或由伺服器設定 GEMINI_API_KEY / ANTHROPIC_API_KEY。" },
      { status: 400 }
    );
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
  await createJob(job);

  const bytes = Buffer.from(await file.arrayBuffer());

  // 背景執行:轉頁面圖 → Claude 解析 → 寫入 guide.json。
  // 用 waitUntil 讓這段工作在回傳 202 之後仍能繼續執行 —— 一般的
  // 「fire-and-forget」promise 在 Vercel serverless function 上,回應送出後
  // function 執行環境隨時可能被凍結/回收,背景工作不保證跑得完;waitUntil
  // 明確告知平台「回應送出後請保持這個 promise 執行到結束」。本機開發環境下
  // 這個呼叫等同直接執行 promise,行為不受影響。
  waitUntil(
    runPipeline(id, bytes, fileType, choice).catch(async (err) => {
      const j = await readJob(id);
      if (j) {
        j.status = "error";
        j.error = err instanceof Error ? err.message : String(err);
        await writeJob(j);
      }
    })
  );

  return NextResponse.json({ id }, { status: 202 });
}

async function runPipeline(
  id: string,
  sourceBytes: Buffer,
  fileType: "pdf" | "image",
  choice: EngineChoice
) {
  const job = (await readJob(id))!;

  job.status = "rendering";
  await writeJob(job);

  const pages =
    fileType === "pdf" ? await rasterizePdf(sourceBytes) : imageAsSinglePage(sourceBytes);
  job.pageCount = pages.length;

  const pageUrls: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const url = await savePageImage(id, i + 1, pages[i]);
    if (url) pageUrls.push(url);
  }
  if (pageUrls.length) job.pageUrls = pageUrls;
  await writeJob(job);

  job.status = "parsing";
  await writeJob(job);

  const input: ParseInput = {
    fileType,
    pdfBytes: fileType === "pdf" ? sourceBytes : undefined,
    pageImages: fileType === "image" ? pages : [],
    pageCount: job.pageCount,
  };
  const guide =
    choice.engine === "gemini"
      ? await parseManualGemini(input, { apiKey: choice.geminiKey!, model: choice.geminiModel })
      : await parseManual(input);

  await writeGuide(id, guide);
  job.status = "ready";
  await writeJob(job);
}
