# IKEA 組裝說明書自動視覺化指南生成系統

上傳任一 IKEA 家具組裝說明書（PDF / JPG / PNG），系統自動解析零件、工具、警示符號、
箭頭方向與步驟順序，生成一份**互動式、逐步、有視覺化標註**的組裝指南。

內建已解析完成的 **KALLAX 層架組（4×3）** 示範資料：不需要 API 金鑰即可在
`/guide/kallax` 體驗完整功能（16 步驟、11 種零件、64 支木榫的完整流程）。

## 操作示範

![操作示範：開啟 KALLAX 示範指南、縮放畫布、逐步切換、查看零件與原始說明書](docs/demo.gif)

以內建的 KALLAX 示範指南錄製：開啟示範 → 放大/縮小細節與顯示整頁 → 逐步
切換步驟 → 查看零件與工具、注意事項分頁 → 對照原始說明書頁面 → 完成畫面。
（[完整畫質 MP4](docs/demo.mp4)）

## 快速開始

```bash
npm install
npm run dev          # http://localhost:3000 → 點「開啟示範」
```

要啟用「上傳任一說明書」的自動解析，只需要一把 Gemini API 金鑰：
點右上角「API 金鑰」輸入 Google Gemini API 金鑰（可在
[Google AI Studio](https://aistudio.google.com/apikey) 免費取得）。

**金鑰與解析結果都只存在使用者自己的瀏覽器**（localStorage / IndexedDB），
伺服器與部署環境不需要任何金鑰、資料庫或儲存空間設定。

## 系統架構（全部在瀏覽器內完成）

```
選擇 PDF/圖片
   ▼
1. 讀取檔案（FileReader，不上傳到本站伺服器）
2. pdfjs-dist 在瀏覽器內把 PDF 轉成逐頁 JPEG（指南底圖）
3. 瀏覽器直接呼叫 Gemini API（gemini-3.6-flash）：
     · 頁數 <= CHUNK_THRESHOLD_PAGES（26）：單次呼叫，PDF 以 inline_data 整份
       送入（原生 PDF 視覺理解，保留頁碼）；圖片以 inline_data 送入
     · 頁數較多：分批解析（見下方「分批解析」）
     · responseJsonSchema 結構化輸出（schema 由 zod 產生）
     · zod 再驗證一次，格式不完整時先嘗試自動修復（lib/guideRepair.ts）再驗一次
4. 指南 JSON + 頁面圖存入 IndexedDB → 導向 /guide/<id> 檢視器
```

**解析工作是模組層級的背景工作，不綁在任何 React 元件或分頁焦點上**
（`lib/parseJob.ts`）：切到其他瀏覽器分頁、或在站內切換頁面，實際發出的
`fetch()` 呼叫都不會被中斷，解析照常在背景跑完；回到首頁時元件重新訂閱
目前狀態，完成後自動導向指南。分頁標題會即時顯示目前階段（如
「⏳ AI 解析說明書…」），並在解析期間攔截關閉/重新整理提醒使用者解析
會中斷（真正會中斷解析的只有「關閉分頁」，不是「切到別的分頁」）。

### 分批解析（大份說明書）

單次呼叫模型的輸出 token 是有上限的；頁數與步驟數愈多，逐步視覺化標註
累加起來的 JSON 就愈長。模型為了在上限內產出「語法合法」的 JSON，可能會
自行大幅減少步驟數，而不是輸出到一半被截斷報錯——這正是大份說明書
「只解析出兩三個步驟」的成因，而非檔案位元組大小或頁數本身的限制。

頁數超過 `CHUNK_THRESHOLD_PAGES`（`lib/prompt.ts`，預設 26 頁）的說明書會
自動改走兩階段分批解析（`lib/geminiParse.ts`）：

1. **前段資料**：整份文件一次呼叫，只要求 `product` / `parts` / `tools` /
   `warnings` / `generalTips`（schema 結構上排除 `steps`），輸出量不隨步驟
   數膨脹。
2. **步驟**：依頁碼切成每批 `STEPS_BATCH_SIZE`（預設 16）頁，**依序**（非
   平行）呼叫——避免同時多個請求超出使用者個人 Gemini 金鑰的每分鐘配額，
   每批只要求落在該頁碼範圍內的步驟，並把第 1 步已解析出的零件/工具清單
   當作已知內容傳入，讓各批引用一致的 id。解析畫面會顯示目前批次進度
   （如「步驟批次 2/4」）。
3. 合併所有批次的 steps、依步驟編號排序，拼回一份完整指南並整體以 zod
   驗證一次。

這個設計的取捨：

- ✅ 部署零設定：不需要 `BLOB_READ_WRITE_TOKEN`、資料庫或伺服器端金鑰。
- ✅ 不受平台請求大小限制（如 Vercel 的 4.5MB）與函式執行時間限制。
- ✅ 說明書內容與金鑰完全不經過本站伺服器，隱私最佳。
- ⚠️ 指南只保存在解析它的那台裝置/瀏覽器（IndexedDB），換裝置需重新解析。
- ⚠️ Gemini 單一請求上限約 20MB（base64 後），原始檔限制約 14MB。

| 目錄 | 內容 |
|---|---|
| `lib/schema.ts` | 指南資料格式（zod，單一事實來源） |
| `schema/assembly-guide.schema.json` | 同格式的 JSON Schema 文件（對外交付格式） |
| `lib/prompt.ts` | 解析提示詞 + 分批解析的提示詞建構與頁碼切批邏輯 |
| `lib/geminiParse.ts` | 瀏覽器端 Gemini 解析引擎（structured outputs + 分批解析 + zod 驗證） |
| `lib/guideRepair.ts` | 結構化輸出格式不完整時的自動修復（單次解析/前段資料/步驟批次共用） |
| `lib/parseJob.ts` | 模組層級解析工作管理器（不綁元件生命週期，背景解析） |
| `lib/pdfToImages.ts` | 瀏覽器端 PDF → 頁面 JPEG（pdfjs-dist） |
| `lib/base64.ts` | Blob → base64 共用小工具 |
| `lib/localGuides.ts` | 瀏覽器本機指南儲存（IndexedDB） |
| `lib/store.ts` | 伺服器端示範指南讀取（僅供 kallax 等內建示範） |
| `lib/demoGuides.ts` | 示範指南註冊表（建置時靜態 import，不依賴執行期讀檔） |
| `app/api/guides/*` | 示範指南的狀態 / 頁面圖片 API |
| `components/Uploader.tsx` | 上傳與瀏覽器內解析管線 |
| `components/GuideViewer.tsx` | 互動式檢視器（步驟清單、進度、詳情分頁） |
| `components/StepCanvas.tsx` | 視覺化畫布：頁面底圖 + SVG 標註疊層 |
| `public/demo/kallax/` | KALLAX 示範資料（guide.json + 24 頁頁面圖） |

### 解析模型

固定使用 `gemini-3.6-flash`（最新一代 Flash 正式版，1M context，原生
支援 PDF 文件視覺理解與 JSON 結構化輸出），不提供切換。實作使用 Gemini REST API 的
`responseJsonSchema` 結構化輸出，schema 由 zod（`lib/schema.ts`）以
`z.toJSONSchema()` 產生，最後一律再以 zod 驗證。

## 結構化輸出格式（AssemblyGuide JSON）

每份說明書解析為一份 `AssemblyGuide`：

- **product** — 家具名稱、文件編號、類型描述
- **parts[]** — 零件與五金（id、繁中名稱、IKEA 料號、數量、種類、說明書上的縮圖位置）
- **tools[]** — 工具（內附 / 需自備）
- **warnings[]** — 警示（danger / caution / info，含對應頁碼）
- **steps[]** — 逐步流程，每一步包含：
  - `index`、`title`、`summary`、`pages`（對應原始頁碼）
  - `actions[]` — 逐條操作指示，每條帶動作類型（insert / align / screw / rotate / flip …）
  - `partsUsed[]`、`toolsUsed[]` — 引用零件/工具 id 與數量
  - `orientation` — 方向與位置要點
  - `cautions[]`、`commonMistakes[]` — 注意事項與常見錯誤
  - `visual` — **視覺化呈現指令**：以說明書某頁為底圖（`basePage` + `focus` 裁切），
    疊加標註（座標一律為 0~1 正規化座標）：
    - `highlight` 重點零件/目標位置高亮（rect / circle，語意色調）
    - `arrow` 組裝方向箭頭（含動畫描邊）
    - `marker` 螺絲/木榫位置圓點標記
    - `zoom` 局部放大提示
    - `compare` 正確 ✓ / 錯誤 ✕ 對比
- **generalTips[]** — 全程通用提醒

完整定義見 `schema/assembly-guide.schema.json`。這份 JSON 與前端解耦，
可直接再用於教學頁面、流程圖、2D/3D 動畫生成等下游應用。

## 互動式檢視器功能

- 步驟號碼列（對應說明書上的大數字）+ 上一步 / 下一步 / 重播標註動畫
- 放大細節（聚焦裁切）⇄ 顯示整頁 切換、標註圖層開關
- 查看原始說明書對應頁（模態框逐頁翻閱）
- 零件與工具清單、警示與組裝小提醒分頁
- 組裝進度列與步驟完成勾選
- 標註文字標籤分層渲染並夾限在可視範圍內，不會被框線遮擋或裁切

## 視覺設計依據

介面對齊 IKEA.com（Skapa 設計系統）的視覺語彙：

- **Logo**：`public/ikea-logo.svg` 的幾何與字標**直接取自 IKEA 官方組裝說明書
  （AA-2051412-6）封面的向量原稿**（以 pdftocairo 抽出 PDF 中的原始路徑），
  僅將單色印刷版重新上色為品牌標準色（藍 `#0058A3` / 黃 `#FFDB00`）——
  字型、橢圓、比例、® 皆為官方原樣。
- **色彩**：白底、文字 `#111`、次要 `#484848`、髮絲線 `#DFDFDF`、
  區塊底 `#F5F5F5`；語意色 成功 `#0A8A00`、錯誤 `#CC0008`、警示 `#F26A1B`。
  標註色（藍/橘/綠/紅/粉）對應 IKEA 延伸色卡。
- **字體**：IKEA 品牌字體 Noto IKEA 以 Noto 家族為基底；本專案自行託管
  `@fontsource/noto-sans-tc`（不依賴外部 CDN）。
- **圖示**：依 Skapa icon 規格（24px 格線、2px 筆畫、單色）繪製的線條圖示
  （`components/icons.tsx`），不使用 emoji。
- **小人物插圖**：`public/pictograms/` 內的組裝提醒插圖（兩人組裝、鋪地毯、
  備工具、防傾倒警告等）**全部直接擷取自 IKEA 原廠說明書頁面**，
  非自行仿製。
- **按鈕**：IKEA 膠囊型（全圓角）主按鈕 + 圓形 icon 按鈕。

## 部署到 Vercel

直接部署即可，**不需要任何環境變數或 Storage 設定**：上傳解析全部在
使用者的瀏覽器內完成，伺服器只提供靜態頁面與內建示範指南。

## 已知限制

- 解析結果保存在瀏覽器 IndexedDB，只在解析它的裝置/瀏覽器上可見；
  清除瀏覽資料會一併清除指南。
- Gemini 單一請求上限約 20MB（base64 後），原始檔限制約 14MB；
  更大的說明書請先壓縮或拆分（分批解析的前段資料階段仍需送整份 PDF，
  不受此限制放寬）。
- 解析需 1–3 分鐘（頁數多、走分批解析的說明書會更久，因為步驟批次是依序
  而非平行呼叫），期間需保持分頁不被關閉（切到別的分頁沒問題，解析在
  背景繼續；關閉分頁才會中斷）。
- 標註座標由模型估計，偶有偏移；檢視器提供「顯示整頁 / 查看原始說明書」作為對照。
