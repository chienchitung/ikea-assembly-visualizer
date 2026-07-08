import { z } from "zod";
import { AssemblyGuide } from "./schema";
import { SYSTEM_PROMPT, buildUserText, type ParseInput } from "./parser";

/**
 * Google Gemini 解析引擎（REST，直接 fetch，不引入額外 SDK）。
 *
 * - PDF 以 inline_data（base64）整份送入 —— Gemini 原生支援 PDF 文件視覺理解，
 *   單一請求上限 20MB（base64 後），因此原始 PDF 限制在約 14MB。
 * - 結構化輸出：responseMimeType=application/json + responseJsonSchema
 *   （標準 JSON Schema，由 zod v4 的 z.toJSONSchema 直接產生，與 Claude 路徑
 *   共用同一份 zod schema，單一事實來源）。部分舊模型不認得
 *   responseJsonSchema 時自動降級為純 JSON 模式重試，最後仍以 zod 驗證把關。
 * - 金鑰以 x-goog-api-key header 傳遞（不放在 URL，避免進到日誌）。
 *
 * 模型固定使用 gemini-3.5-flash（最新一代 Flash 正式版，原生支援 PDF 視覺
 * 與結構化輸出）；僅伺服器可用 GEMINI_MODEL 環境變數覆寫。
 */

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const INLINE_PDF_LIMIT = 14 * 1024 * 1024;

interface GeminiOptions {
  apiKey: string;
}

export async function parseManualGemini(
  input: ParseInput,
  { apiKey }: GeminiOptions
): Promise<AssemblyGuide> {

  if (input.fileType === "pdf" && input.pdfBytes!.length > INLINE_PDF_LIMIT) {
    throw new Error(
      "使用 Gemini 解析時，PDF 上限約 14MB（單一請求限制）。請壓縮檔案，或改用伺服器端的 Claude 解析。"
    );
  }

  const parts: unknown[] = [];
  if (input.fileType === "pdf") {
    parts.push({
      inline_data: { mime_type: "application/pdf", data: input.pdfBytes!.toString("base64") },
    });
  } else {
    for (const img of input.pageImages) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: img.toString("base64") } });
    }
  }
  parts.push({ text: buildUserText(input) });

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

  let res = await callGemini(MODEL, apiKey, body);

  // 舊模型可能不支援 responseJsonSchema —— 降級為純 JSON 模式重試一次
  if (res.status === 400) {
    const errText = await res.text();
    if (/responseJsonSchema|response_json_schema|Unknown name/i.test(errText)) {
      const { responseJsonSchema: _drop, ...rest } = body.generationConfig;
      res = await callGemini(MODEL, apiKey, { ...body, generationConfig: rest });
    } else {
      throw new Error(geminiErrorMessage(res.status, errText));
    }
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
    throw new Error(`Gemini 拒絕處理這份文件（${data.promptFeedback.blockReason}），請確認上傳的是家具組裝說明書。`);
  }
  const cand = data.candidates?.[0];
  if (!cand) throw new Error("Gemini 未回傳內容。");
  if (cand.finishReason === "MAX_TOKENS") {
    throw new Error("說明書過長，Gemini 輸出被截斷。請嘗試拆分頁數後重新上傳。");
  }
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) throw new Error(`Gemini 未回傳內容（finishReason=${cand.finishReason ?? "?"}）。`);

  return AssemblyGuide.parse(JSON.parse(text));
}

async function callGemini(model: string, apiKey: string, body: unknown): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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

