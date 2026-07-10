import type { Part, Tool } from "./schema";

/**
 * 解析提示詞（瀏覽器端 Gemini 解析使用；不依賴任何 Node/瀏覽器專屬 API）。
 */
export const SYSTEM_PROMPT = `你是「IKEA 組裝說明書視覺化系統」的解析引擎。輸入是一份 IKEA 家具組裝說明書（整份 PDF 或掃描圖片），你要輸出一份結構化的互動式組裝指南 JSON。

解析原則：
1. **辨識產品**：封面的家具名稱（如 KALLAX）、頁尾的文件編號（如 AA-2051412-6）、家具類型與構造（幾格層架、桌、櫃等）。
2. **零件與五金清單**：通常在前幾頁。IKEA 會在每個五金旁印 6 碼料號（如 101339）與數量（如 64x）。panel=大型板件、hardware=螺絲/木榫等、fitting=牆面固定件等配件。為每個零件取一個好懂的繁體中文名稱。
3. **工具**：開頭的人形圖示氣泡框內畫的是需要自備的工具（螺絲起子、水平儀、鉛筆等）；包裝內附的工具（六角板手、螺絲定位器）會出現在零件清單，includedInBox=true。
4. **警告**：多語言警告頁（傾倒危險等）整理成一則 danger 警告；人形漫畫頁的提示（勿單人搬運、鋪地毯防刮、疑問打給 IKEA）整理成 generalTips 或 caution。
5. **步驟**：說明書上的大數字就是步驟編號。每一步要：
   - 讀懂圖示的空間關係：哪個零件、插入/對齊/鎖進哪裡、箭頭方向、放大圈內是哪顆五金與數量（如「8x 101339」）。
   - 用繁體中文寫出清楚的操作指示（actions，每條配上動作 verb）。
   - 列出 partsUsed（引用零件 id 與數量）、toolsUsed。
   - orientation 描述方向要點（例如「圓孔面朝外側」「有預鑽孔的一面朝上」）。
   - cautions / commonMistakes：根據圖上的警示符號與常見組裝經驗，寫出這一步容易出錯的地方（方向裝反、木榫未插到底、螺絲先不要鎖死等）。
   - 若同一步有直放/橫放兩種版本（說明書後段重複的步驟編號），把它們合併為一步，在 summary 說明兩種擺法，或拆成 12 與 12B 兩步。
6. **視覺化指令（visual）**：每步以說明書中最能代表該步的一頁為 basePage，focus 裁切到主圖區域，再疊加標註：
   - highlight：框住這一步要拿的零件（tone=part）、五金放大圈（tone=hardware）、要對準的目標位置（tone=target）。
   - arrow：組裝方向（照著圖上的虛線/箭頭方向畫）。
   - marker：每個螺絲/木榫插入點打點標記。
   - zoom：框住原圖的放大圈，note 寫「使用 8 顆木榫 101339」這類說明。
   - compare：圖上有 ✓/✗ 對比時使用。
   - 所有座標都是相對整頁圖片的正規化座標（0~1，左上為原點）。座標要盡量準確地落在圖上的對應元素。
   - **標註文字必須清楚可讀**：label 用簡短詞語（12 字以內）；label 與 note 的位置要避開圖中的關鍵線條與其他標註框，優先放在鄰近的空白處；標註對象靠近 focus 邊緣時，把文字往內側放，不要超出 focus 範圍，避免被裁掉或互相遮擋。
7. **絕對不可以省略步驟**：輸出的 steps 必須涵蓋文件中每一個印出的步驟編號，不可跳過、不可大幅合併多個步驟為一步（直放/橫放這種同一步驟編號的兩種擺法例外，見上）。如果篇幅有限，寧可精簡每一步的文字（summary 縮短、cautions/commonMistakes 各留 0~1 條、annotations 只保留最關鍵的 1~2 個），也絕對不能為了縮短輸出而整步整步不寫。
8. 全部文字使用繁體中文，標點符號一律使用全形（，、。：；？！（））；動詞明確；不要編造說明書上沒有的零件或步驟。`;

/** 使用者訊息文字（單次解析用；分批解析見下方 buildFrontMatterText / buildStepsBatchText） */
export function buildUserText(fileType: "pdf" | "image", pageCount: number): string {
  return `這份說明書共 ${pageCount} 頁。請完整解析並輸出結構化組裝指南 JSON（source.fileType="${fileType}"、source.pageCount=${pageCount}）。`;
}

/**
 * 分批解析（見 lib/geminiParse.ts）:
 * 單次呼叫模型的輸出 token 有上限;頁數與步驟數愈多,逐步視覺化標註累加起來的
 * JSON 就愈長 —— 模型為了在上限內產出「語法合法」的 JSON,可能會自行大幅減少
 * 步驟數,而不是輸出到一半被截斷報錯,這正是大份說明書「只解析出兩三個步驟」
 * 的成因。頁數超過 CHUNK_THRESHOLD_PAGES 時改走兩階段呼叫,把輸出量攤開成
 * 多次呼叫,單次輸出量不再隨整份說明書的總步驟數膨脹。
 */
export const CHUNK_THRESHOLD_PAGES = 26;
/** 分批解析時,每批送出的頁數。 */
export const STEPS_BATCH_SIZE = 16;

/** 分批解析 · 前段資料階段（product/parts/tools/warnings/generalTips,不含 steps）的提示文字 */
export function buildFrontMatterText(pageCount: number): string {
  return `這份說明書共 ${pageCount} 頁。這次請只解析並輸出「產品資訊、零件清單、工具清單、警告、通用提示」（product / source / parts / tools / warnings / generalTips），不需要輸出任何步驟。請完整看過整份文件，確保零件與工具清單涵蓋所有會在組裝步驟中用到的零件與五金——即使某個零件只在後面的步驟頁才出現（不是集中列在前幾頁的零件總表裡），也要把它加進 parts 清單並給一個合理的 id。`;
}

/** 分批解析 · 步驟批次階段的提示文字 */
export function buildStepsBatchText(
  pageNumbers: number[],
  totalPages: number,
  knownParts: Part[],
  knownTools: Tool[]
): string {
  return `這份說明書共 ${totalPages} 頁，以下依序是第 ${pageNumbers.join("、")} 頁的圖片。

已知的零件與工具清單（請直接引用其中的 id；只有這幾頁出現清單中沒有的全新零件時，才需要另外取新 id）：
零件：${JSON.stringify(knownParts)}
工具：${JSON.stringify(knownTools)}

請只針對這幾頁圖片裡「實際印出的組裝步驟」輸出 steps 陣列：
- index 用頁面上印出的真實步驟編號。
- pages 欄位填實際頁碼（對照上面列出的頁碼，不是這批圖片內的第幾張）。
- 如果這幾頁沒有任何組裝步驟（例如零件表、警告頁、完成圖或封面），回傳 steps: []。
- 不要輸出其他頁碼範圍的步驟，只處理這幾頁上出現的步驟。
- 這是分批處理中的一批，不代表全部頁數，不要因為只看到這幾頁就省略其中任何一步。`;
}

/** 把 1..pageCount 切成每批最多 batchSize 頁的連續頁碼區間 */
export function splitIntoPageBatches(pageCount: number, batchSize: number): number[][] {
  const batches: number[][] = [];
  for (let start = 1; start <= pageCount; start += batchSize) {
    const end = Math.min(start + batchSize - 1, pageCount);
    batches.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
  }
  return batches;
}
