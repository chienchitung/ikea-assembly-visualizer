import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AssemblyGuide } from "./schema";

const MODEL = process.env.PARSER_MODEL ?? "claude-opus-4-8";

/** 解析提示詞(Claude / Gemini 兩個引擎共用) */
export const SYSTEM_PROMPT = `你是「IKEA 組裝說明書視覺化系統」的解析引擎。輸入是一份 IKEA 家具組裝說明書(整份 PDF 或掃描圖片),你要輸出一份結構化的互動式組裝指南 JSON。

解析原則:
1. **辨識產品**:封面的家具名稱(如 KALLAX)、頁尾的文件編號(如 AA-2051412-6)、家具類型與構造(幾格層架、桌、櫃等)。
2. **零件與五金清單**:通常在前幾頁。IKEA 會在每個五金旁印 6 碼料號(如 101339)與數量(如 64x)。panel=大型板件、hardware=螺絲/木榫等、fitting=牆面固定件等配件。為每個零件取一個好懂的繁體中文名稱。
3. **工具**:開頭的人形圖示氣泡框內畫的是需要自備的工具(螺絲起子、水平儀、鉛筆等);包裝內附的工具(六角板手、螺絲定位器)會出現在零件清單,includedInBox=true。
4. **警告**:多語言警告頁(傾倒危險等)整理成一則 danger 警告;人形漫畫頁的提示(勿單人搬運、鋪地毯防刮、疑問打給 IKEA)整理成 generalTips 或 caution。
5. **步驟**:說明書上的大數字就是步驟編號。每一步要:
   - 讀懂圖示的空間關係:哪個零件、插入/對齊/鎖進哪裡、箭頭方向、放大圈內是哪顆五金與數量(如「8x 101339」)。
   - 用繁體中文寫出清楚的操作指示(actions,每條配上動作 verb)。
   - 列出 partsUsed(引用零件 id 與數量)、toolsUsed。
   - orientation 描述方向要點(例如「圓孔面朝外側」「有預鑽孔的一面朝上」)。
   - cautions / commonMistakes:根據圖上的警示符號與常見組裝經驗,寫出這一步容易出錯的地方(方向裝反、木榫未插到底、螺絲先不要鎖死等)。
   - 若同一步有直放/橫放兩種版本(說明書後段重複的步驟編號),把它們合併為一步,在 summary 說明兩種擺法,或拆成 12 與 12B 兩步。
6. **視覺化指令(visual)**:每步以說明書中最能代表該步的一頁為 basePage,focus 裁切到主圖區域,再疊加標註:
   - highlight:框住這一步要拿的零件(tone=part)、五金放大圈(tone=hardware)、要對準的目標位置(tone=target)。
   - arrow:組裝方向(照著圖上的虛線/箭頭方向畫)。
   - marker:每個螺絲/木榫插入點打點標記。
   - zoom:框住原圖的放大圈,note 寫「使用 8 顆木榫 101339」這類說明。
   - compare:圖上有 ✓/✗ 對比時使用。
   - 所有座標都是相對整頁圖片的正規化座標(0~1,左上為原點)。座標要盡量準確地落在圖上的對應元素。
7. 全部文字使用繁體中文;動詞明確;不要編造說明書上沒有的零件或步驟。`;

export interface ParseInput {
  fileType: "pdf" | "image";
  /** PDF 原始檔 bytes(fileType=pdf 時,直接以 document block 送整份保留頁碼) */
  pdfBytes?: Buffer;
  /** 頁面圖片 bytes,依頁碼排序(fileType=image 時逐頁以 image block 送出) */
  pageImages: Buffer[];
  pageCount: number;
}

/** 使用者訊息文字(兩個引擎共用) */
export function buildUserText(input: ParseInput): string {
  return `這份說明書共 ${input.pageCount} 頁。請完整解析並輸出結構化組裝指南 JSON(source.fileType="${input.fileType}"、source.pageCount=${input.pageCount})。`;
}

/**
 * 呼叫 Claude 將說明書解析為 AssemblyGuide。
 * - PDF:直接以 document block 送整份 PDF(保留頁碼資訊)。
 * - 圖片:以 image block 逐頁送出。
 * 全程在記憶體中處理 bytes,不落地到檔案系統 —— Vercel serverless function
 * 只有 /tmp 可寫且不保證跨呼叫延續,pipeline 就不依賴中繼檔案。
 * 以 structured outputs(JSON Schema)保證輸出可解析,再用 zod 驗證。
 */
export async function parseManual(input: ParseInput): Promise<AssemblyGuide> {
  const client = new Anthropic();

  const content: Anthropic.ContentBlockParam[] = [];
  if (input.fileType === "pdf") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.pdfBytes!.toString("base64") },
    });
  } else {
    for (const img of input.pageImages) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") },
      });
    }
  }
  content.push({ type: "text", text: buildUserText(input) });

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(AssemblyGuide) },
    messages: [{ role: "user", content }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("模型拒絕處理這份文件,請確認上傳的是家具組裝說明書。");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("說明書過長,輸出被截斷。請嘗試拆分頁數後重新上傳。");
  }

  const text = message.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("模型未回傳內容。");
  return AssemblyGuide.parse(JSON.parse(text));
}
