import { z } from "zod";
import { AssemblyGuide, GuideFrontMatter, StepsBatch } from "./schema";
import {
  SYSTEM_PROMPT,
  buildUserText,
  buildFrontMatterText,
  buildStepsBatchText,
  splitIntoPageBatches,
  CHUNK_THRESHOLD_PAGES,
  STEPS_BATCH_SIZE,
} from "./prompt";
import { repairGuide, repairFrontMatter, repairStepsBatch } from "./guideRepair";

/**
 * 瀏覽器端的 Google Gemini 解析引擎。
 *
 * 直接從使用者的瀏覽器呼叫 Gemini API（金鑰存於 localStorage、隨請求以
 * x-goog-api-key header 送出），完全不經過本站伺服器——部署環境不需要
 * 任何金鑰或儲存空間設定。
 *
 * - PDF 以 inline_data（base64）整份送入——Gemini 原生支援 PDF 文件視覺理解，
 *   單一請求上限 20MB（base64 後），因此原始檔限制在約 14MB。
 * - 結構化輸出：responseMimeType=application/json + responseJsonSchema
 *   （標準 JSON Schema，由 zod 的 z.toJSONSchema 產生），最後仍以 zod 驗證把關。
 * - 模型固定使用 gemini-3.5-flash（最新一代 Flash 正式版，原生支援 PDF 視覺
 *   與結構化輸出）。
 *
 * 頁數超過 CHUNK_THRESHOLD_PAGES（見 lib/prompt.ts）的說明書改走「分批解析」：
 * 單次呼叫模型的輸出 token 有上限，頁數與步驟數愈多、逐步視覺化標註累加起來
 * 的 JSON 就愈長，模型為了在上限內產出語法合法的 JSON，可能會自行大幅減少
 * 步驟數而非中途截斷報錯——這正是大份說明書「只解析出兩三個步驟」的成因。
 * 分批解析先單次呼叫取得不含 steps 的產品/零件/工具/警告，再依頁碼切成多批
 * 依序呼叫（避免同時多個請求打爆使用者個人金鑰的每分鐘配額）只取該範圍內的
 * steps，最後合併驗證。
 */

const MODEL = "gemini-3.5-flash";

/** Gemini 單一請求上限 20MB（base64 後），原始檔約 14MB */
export const MAX_INLINE_BYTES = 14 * 1024 * 1024;

export interface GeminiParseInput {
  apiKey: string;
  fileType: "pdf" | "image";
  /** base64 編碼的整份 PDF（fileType=pdf 時必填，分批解析的前段資料階段固定送整份） */
  pdfBase64?: string;
  /**
   * fileType=image 時是唯一一張圖；fileType=pdf 且頁數超過分批門檻時，
   * 依頁碼排序的逐頁圖片（分批解析每批只送對應頁碼範圍需要逐頁圖片）。
   */
  images?: { base64: string; mimeType: string }[];
  pageCount: number;
  /** 分批解析時，每完成一批步驟呼叫一次，供 UI 顯示進度。 */
  onBatchProgress?: (done: number, total: number) => void;
}

export async function parseManualWithGemini(input: GeminiParseInput): Promise<AssemblyGuide> {
  const canChunk =
    input.fileType === "pdf" &&
    input.pageCount > CHUNK_THRESHOLD_PAGES &&
    (input.images?.length ?? 0) >= input.pageCount;
  if (canChunk) return parseManualWithGeminiChunked(input);
  return parseManualWithGeminiSingleShot(input);
}

async function parseManualWithGeminiSingleShot(input: GeminiParseInput): Promise<AssemblyGuide> {
  const parts: unknown[] = [];
  if (input.fileType === "pdf") {
    parts.push({ inline_data: { mime_type: "application/pdf", data: input.pdfBase64! } });
  } else {
    for (const img of input.images ?? []) {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
    }
  }
  parts.push({ text: buildUserText(input.fileType, input.pageCount) });

  const json = await callGeminiStructured(
    input.apiKey,
    parts,
    z.toJSONSchema(AssemblyGuide, { target: "draft-7" }),
    65536
  );
  const guide = validateOrRepair(
    json,
    AssemblyGuide,
    () => repairGuide(json, input.fileType, input.pageCount),
    "指南"
  );
  if (guide.steps.length === 0) {
    throw new Error("未能從這份文件解析出任何組裝步驟，請確認上傳的是完整的組裝說明書。");
  }
  return guide;
}

/** 分批解析：見檔案開頭說明。 */
async function parseManualWithGeminiChunked(input: GeminiParseInput): Promise<AssemblyGuide> {
  const frontMatterParts = [
    { inline_data: { mime_type: "application/pdf", data: input.pdfBase64! } },
    { text: buildFrontMatterText(input.pageCount) },
  ];
  const frontMatterJson = await callGeminiStructured(
    input.apiKey,
    frontMatterParts,
    z.toJSONSchema(GuideFrontMatter, { target: "draft-7" }),
    16384
  );
  const frontMatter = validateOrRepair(
    frontMatterJson,
    GuideFrontMatter,
    () => repairFrontMatter(frontMatterJson, input.fileType, input.pageCount),
    "說明書基本資料"
  );

  const images = input.images!;
  const batches = splitIntoPageBatches(input.pageCount, STEPS_BATCH_SIZE);
  const allSteps: AssemblyGuide["steps"] = [];

  // 依序（非平行）處理每一批，避免同時多個請求打爆使用者個人金鑰的每分鐘配額
  for (let i = 0; i < batches.length; i++) {
    const pageNumbers = batches[i];
    const batchParts = [
      ...pageNumbers.map((n) => ({
        inline_data: { mime_type: images[n - 1].mimeType, data: images[n - 1].base64 },
      })),
      { text: buildStepsBatchText(pageNumbers, input.pageCount, frontMatter.parts, frontMatter.tools) },
    ];
    const batchJson = await callGeminiStructured(
      input.apiKey,
      batchParts,
      z.toJSONSchema(StepsBatch, { target: "draft-7" }),
      65536
    );
    const batch = validateOrRepair(
      batchJson,
      StepsBatch,
      () => repairStepsBatch(batchJson, input.pageCount),
      `步驟（第 ${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]} 頁）`
    );
    allSteps.push(...batch.steps);
    input.onBatchProgress?.(i + 1, batches.length);
  }

  const steps = allSteps.sort((a, b) => a.index - b.index);
  if (steps.length === 0) {
    throw new Error("未能從這份文件解析出任何組裝步驟，請確認上傳的是完整的組裝說明書。");
  }
  return AssemblyGuide.parse({ ...frontMatter, schemaVersion: "1.0", steps });
}

/** 結構化輸出偶爾會漏欄位或超出枚舉——先嚴格驗證，失敗就修復後再驗一次，不因單一小欄位讓整批資料作廢。 */
function validateOrRepair<T>(json: unknown, schema: z.ZodType<T>, repair: () => unknown, label: string): T {
  let parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      `[geminiParse] ${label}格式不完整，嘗試自動修復：`,
      parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`)
    );
    parsed = schema.safeParse(repair());
  }
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}：${i.message}`)
      .join("；");
    throw new Error(`Gemini 回傳的${label}格式不完整（${detail}），請再試一次。`);
  }
  return parsed.data;
}

/** 呼叫 Gemini generateContent，要求依 schema 輸出結構化 JSON，回傳原始（未驗證的）解析結果。 */
async function callGeminiStructured(
  apiKey: string,
  parts: unknown[],
  jsonSchema: unknown,
  maxOutputTokens: number
): Promise<unknown> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
      maxOutputTokens,
      temperature: 0.2,
    },
  };

  // 暫時性錯誤（連線失敗、429 限流、5xx）自動重試一次再放棄
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await callGemini(apiKey, body);
    } catch {
      res = null;
    }
    if (res && res.status !== 429 && res.status < 500) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 2500));
  }
  if (!res) {
    throw new Error("無法連線到 Gemini API，請確認網路後再試。");
  }

  if (!res.ok) {
    throw new Error(geminiErrorMessage(res.status, await res.text()));
  }

  const data = (await res.json()) as {
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string }[] };
    }[];
    promptFeedback?: { blockReason?: string };
  };

  if (data.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini 拒絕處理這份文件（${data.promptFeedback.blockReason}），請確認上傳的是家具組裝說明書。`
    );
  }
  const cand = data.candidates?.[0];
  if (!cand) throw new Error("Gemini 未回傳內容。");
  if (cand.finishReason === "MAX_TOKENS") {
    throw new Error("說明書過長，Gemini 輸出被截斷。請嘗試拆分頁數後重新上傳。");
  }
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) {
    throw new Error(`Gemini 未回傳內容（finishReason=${cand.finishReason ?? "?"}）。`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Gemini 回傳的內容不是有效 JSON，請再試一次。");
  }
}

async function callGemini(apiKey: string, body: unknown): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    }
  );
}

function geminiErrorMessage(status: number, raw: string): string {
  let detail = raw.slice(0, 300);
  try {
    detail = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? detail;
  } catch {
    /* 保留原文 */
  }
  if (status === 400 && /API key not valid/i.test(detail)) {
    return "Gemini API 金鑰無效，請確認右上角輸入的金鑰。";
  }
  if (status === 429) return "Gemini API 額度已用盡或觸發流量限制，請稍後再試。";
  if (status === 404) return `找不到 Gemini 模型，可能是金鑰所屬帳號尚未開放此模型。（${detail}）`;
  return `Gemini API 錯誤（${status}）：${detail}`;
}
