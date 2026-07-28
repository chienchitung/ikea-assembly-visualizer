import { z } from "zod";
import { AssemblyGuide } from "./schema";
import { SYSTEM_PROMPT, buildUserText } from "./prompt";
import { repairGuide } from "./guideRepair";

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
 * - 模型固定使用 gemini-3.6-flash（最新一代 Flash 正式版，1M context，
 *   原生支援 PDF 視覺與結構化輸出）。
 */

const MODEL = "gemini-3.6-flash";

/** Gemini 單一請求上限 20MB（base64 後），原始檔約 14MB */
export const MAX_INLINE_BYTES = 14 * 1024 * 1024;

export interface GeminiParseInput {
  apiKey: string;
  fileType: "pdf" | "image";
  /** base64 編碼的整份 PDF（fileType=pdf 時必填） */
  pdfBase64?: string;
  /** base64 編碼的頁面圖片（fileType=image 時必填） */
  images?: { base64: string; mimeType: string }[];
  pageCount: number;
}

export async function parseManualWithGemini(input: GeminiParseInput): Promise<AssemblyGuide> {
  const parts: unknown[] = [];
  if (input.fileType === "pdf") {
    parts.push({ inline_data: { mime_type: "application/pdf", data: input.pdfBase64! } });
  } else {
    for (const img of input.images ?? []) {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
    }
  }
  parts.push({ text: buildUserText(input.fileType, input.pageCount) });

  const jsonSchema = z.toJSONSchema(AssemblyGuide, { target: "draft-7" });

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
      maxOutputTokens: 65536,
      temperature: 0.2,
    },
  };

  // 暫時性錯誤（連線失敗、429 限流、5xx）自動重試一次再放棄
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await callGemini(input.apiKey, body);
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

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Gemini 回傳的內容不是有效 JSON，請再試一次。");
  }

  // 結構化輸出偶爾會漏欄位或超出枚舉——先嚴格驗證，失敗就修復後再驗一次，
  // 不因單一小欄位讓整份指南作廢
  let parsed = AssemblyGuide.safeParse(json);
  if (!parsed.success) {
    console.warn(
      "[geminiParse] 指南格式不完整，嘗試自動修復：",
      parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`)
    );
    parsed = AssemblyGuide.safeParse(repairGuide(json, input.fileType, input.pageCount));
  }
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}：${i.message}`)
      .join("；");
    throw new Error(`Gemini 回傳的指南格式不完整（${detail}），請再試一次。`);
  }
  if (parsed.data.steps.length === 0) {
    throw new Error("未能從這份文件解析出任何組裝步驟，請確認上傳的是完整的組裝說明書。");
  }
  return parsed.data;
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
