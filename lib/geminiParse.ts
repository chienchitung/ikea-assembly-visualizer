import { z } from "zod";
import { AssemblyGuide } from "./schema";
import { SYSTEM_PROMPT, buildUserText } from "./prompt";

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
 */

const MODEL = "gemini-3.5-flash";

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

  let res: Response;
  try {
    res = await callGemini(input.apiKey, body);
  } catch {
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

  const parsed = AssemblyGuide.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error("Gemini 回傳的指南格式不完整，請再試一次。");
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
