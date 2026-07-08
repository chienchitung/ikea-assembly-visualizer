# IKEA 組裝說明書自動視覺化指南生成系統

上傳任一 IKEA 家具組裝說明書(PDF / JPG / PNG),系統自動解析零件、工具、警示符號、
箭頭方向與步驟順序,生成一份**互動式、逐步、有視覺化標註**的組裝指南。

內建已解析完成的 **KALLAX 層架組(4×3)** 示範資料:不需要 API 金鑰即可在
`/guide/kallax` 體驗完整功能(16 步驟、11 種零件、64 支木榫的完整流程)。

## 快速開始

```bash
npm install
npm run dev          # http://localhost:3000 → 點「開啟示範指南」
```

要啟用「上傳任一說明書」的自動解析,三種方式擇一:

1. **使用者自帶 Gemini 金鑰(免伺服器設定)**:點右上角「API 金鑰」輸入
   Google Gemini API 金鑰 —— 金鑰只存在該使用者瀏覽器的 localStorage,
   伺服器不保存,解析時才隨該次請求送出使用。金鑰可在
   [Google AI Studio](https://aistudio.google.com/apikey) 免費取得。
2. 伺服器設定 `GEMINI_API_KEY`(全站共用 Gemini)。
3. 伺服器設定 `ANTHROPIC_API_KEY`(全站共用 Claude)。

優先順序:瀏覽器金鑰 > `GEMINI_API_KEY` > `ANTHROPIC_API_KEY`。
PDF 轉頁面圖是純 JS 實作(`pdfjs-dist` + `@napi-rs/canvas`),
不需要另外安裝 poppler-utils / pdftoppm。

### Gemini 模型選擇

三個模型皆支援 PDF 文件視覺理解與 JSON 結構化輸出,可在右上角面板切換:

| 模型 | 適用情境 |
|---|---|
| `gemini-2.5-flash`(預設) | 速度快、成本低,一般說明書足夠 |
| `gemini-2.5-pro` | 複雜/頁數多的說明書,理解最穩定的正式版 |
| `gemini-3-pro-preview` | 最新一代、能力最強(預覽版,依帳號開放情況) |

實作上使用 Gemini REST API 的 `responseJsonSchema` 結構化輸出,
schema 由 zod(`lib/schema.ts`)以 `z.toJSONSchema()` 產生,與 Claude
路徑共用同一份定義;不支援該欄位的舊模型會自動降級為純 JSON 模式,
最後一律再以 zod 驗證。注意:Gemini 以 inline 方式送整份 PDF,單一請求
上限約 20MB(base64 後),因此走 Gemini 時原始 PDF 限制約 14MB。

## 系統架構

```
上傳 PDF/圖片
   │  POST /api/guides
   ▼
1. 建立工作(job.json)
2. pdfjs-dist + @napi-rs/canvas 在記憶體中轉出逐頁 JPEG(不落地到磁碟)
3. Claude(claude-opus-4-8)視覺解析:
     · PDF 以 document block 整份送入(保留頁碼)
     · 圖片以 image block 送入
     · structured outputs(JSON Schema)強制輸出合法指南 JSON
     · zod 再驗證一次
4. 寫入 guide.json → 前端輪詢 GET /api/guides/<id> → 進入檢視器
```

背景解析工作用 `@vercel/functions` 的 `waitUntil` 包裝,確保 API 回傳
202 之後,serverless function 仍會把 pipeline 跑到底,而不是回應一送出
就被平台回收。

| 目錄 | 內容 |
|---|---|
| `lib/schema.ts` | 指南資料格式(zod,單一事實來源) |
| `schema/assembly-guide.schema.json` | 同格式的 JSON Schema 文件(對外交付格式) |
| `lib/parser.ts` | Claude 解析引擎(提示詞 + structured outputs) |
| `lib/rasterize.ts` | PDF → 頁面 JPEG(pdfjs-dist + @napi-rs/canvas,純 JS 無外部二進位檔) |
| `lib/store.ts` | 儲存層,本機檔案系統 / Vercel Blob 雙後端(見下方部署章節) |
| `lib/demoGuides.ts` | 示範指南註冊表(建置時靜態 import,不依賴執行期讀檔) |
| `app/api/guides/*` | 上傳 / 狀態查詢 / 頁面圖片 API |
| `components/GuideViewer.tsx` | 互動式檢視器(步驟清單、進度、詳情分頁) |
| `components/StepCanvas.tsx` | 視覺化畫布:頁面底圖 + SVG 標註疊層 |
| `public/demo/kallax/` | KALLAX 示範資料(guide.json + 24 頁頁面圖) |

## 結構化輸出格式(AssemblyGuide JSON)

每份說明書解析為一份 `AssemblyGuide`:

- **product** — 家具名稱、文件編號、類型描述
- **parts[]** — 零件與五金(id、繁中名稱、IKEA 料號、數量、種類、說明書上的縮圖位置)
- **tools[]** — 工具(內附 / 需自備)
- **warnings[]** — 警示(danger / caution / info,含對應頁碼)
- **steps[]** — 逐步流程,每一步包含:
  - `index`、`title`、`summary`、`pages`(對應原始頁碼)
  - `actions[]` — 逐條操作指示,每條帶動作類型(insert / align / screw / rotate / flip …)
  - `partsUsed[]`、`toolsUsed[]` — 引用零件/工具 id 與數量
  - `orientation` — 方向與位置要點
  - `cautions[]`、`commonMistakes[]` — 注意事項與常見錯誤
  - `visual` — **視覺化呈現指令**:以說明書某頁為底圖(`basePage` + `focus` 裁切),
    疊加標註(座標一律為 0~1 正規化座標):
    - `highlight` 重點零件/目標位置高亮(rect / circle,語意色調)
    - `arrow` 組裝方向箭頭(含動畫描邊)
    - `marker` 螺絲/木榫位置圓點標記
    - `zoom` 局部放大提示
    - `compare` 正確 ✓ / 錯誤 ✕ 對比
- **generalTips[]** — 全程通用提醒

完整定義見 `schema/assembly-guide.schema.json`。這份 JSON 與前端解耦,
可直接再用於教學頁面、流程圖、2D/3D 動畫生成等下游應用。

## 互動式檢視器功能

- 步驟號碼列(對應說明書上的大數字)+ 上一步 / 下一步 / 重播標註動畫
- 放大細節(聚焦裁切)⇄ 顯示整頁 切換、標註圖層開關
- 查看原始說明書對應頁(模態框逐頁翻閱)
- 零件與工具清單、警示與組裝小提醒分頁
- 組裝進度列與步驟完成勾選

## 視覺設計依據

介面對齊 IKEA.com(Skapa 設計系統)的視覺語彙:

- **Logo**:`public/ikea-logo.svg` 的幾何與字標**直接取自 IKEA 官方組裝說明書
  (AA-2051412-6)封面的向量原稿**(以 pdftocairo 抽出 PDF 中的原始路徑),
  僅將單色印刷版重新上色為品牌標準色(藍 `#0058A3` / 黃 `#FFDB00`)——
  字型、橢圓、比例、® 皆為官方原樣。
- **色彩**:白底、文字 `#111`、次要 `#484848`、髮絲線 `#DFDFDF`、
  區塊底 `#F5F5F5`;語意色 成功 `#0A8A00`、錯誤 `#CC0008`、警示 `#F26A1B`。
  標註色(藍/橘/綠/紅/粉)對應 IKEA 延伸色卡。
- **字體**:IKEA 品牌字體 Noto IKEA 以 Noto 家族為基底;本專案自行託管
  `@fontsource/noto-sans-tc`(不依賴外部 CDN)。
- **圖示**:依 Skapa icon 規格(24px 格線、2px 筆畫、單色)繪製的線條圖示
  (`components/icons.tsx`),不使用 emoji。
- **小人物插圖**:`public/pictograms/` 內的組裝提醒插圖(兩人組裝、鋪地毯、
  備工具、防傾倒警告等)**全部直接擷取自 IKEA 原廠說明書頁面**,
  非自行仿製。
- **按鈕**:IKEA 膠囊型(全圓角)主按鈕 + 圓形 icon 按鈕。

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `GEMINI_API_KEY` | — | 伺服器端 Gemini 金鑰(使用者瀏覽器金鑰優先於此) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | 伺服器端 Gemini 預設模型 |
| `ANTHROPIC_API_KEY` | — | 伺服器端 Claude 金鑰(無任何 Gemini 金鑰時使用) |
| `PARSER_MODEL` | `claude-opus-4-8` | 解析使用的 Claude 模型 |
| `BLOB_READ_WRITE_TOKEN` | — | 設定後自動改用 Vercel Blob 儲存(見下方部署章節);本機開發不需要 |

## 部署到 Vercel

上傳解析功能會需要寫入儲存空間、背景執行 1–3 分鐘的工作 —— 這些在
Vercel 的 serverless function 環境下**不能**沿用「本機開發」的預設值,
必須額外設定:

1. **連接 Vercel Blob**(必要,否則上傳會失敗):Vercel 專案 → **Storage**
   → **Create Database** → 選 **Blob**,連接後 Vercel 會自動把
   `BLOB_READ_WRITE_TOKEN` 注入到專案環境變數 —— 程式碼會自動偵測到這個
   變數並切換成 Blob 儲存後端(`lib/store.ts`),不需要改任何設定。
   沒有連接 Blob 時,`app/api/guides/route.ts` 仍會嘗試寫入本機檔案系統,
   但 Vercel function 的檔案系統唯讀,上傳會直接 500。
2. **設定 `ANTHROPIC_API_KEY`**:Vercel 專案 → **Settings** → **Environment
   Variables**。
3. **確認方案支援足夠的函式執行時間**:一份說明書解析(rasterize + 呼叫
   Claude)常需 1–3 分鐘。專案目前設定 `maxDuration = 300`(見
   `app/api/guides/route.ts`),但 Vercel Hobby 方案預設的函式執行上限
   遠低於此(需開啟 Fluid Compute 或升級方案才能拉長)——如果上傳在
   Vercel 上時常於解析中途被中斷,請依你的方案調整這個值,或考慮拆分
   較大份的說明書。
4. 內建的 **KALLAX 示範指南**(`/guide/kallax`)不受以上限制:它在建置時
   以靜態 import 打包進程式碼、頁面圖是 `public/` 下的靜態資源,不需要
   Blob 或 API 金鑰即可在 Vercel 上正常瀏覽。

## 已知限制

- 上傳解析約需 1–3 分鐘(整份說明書一次送入 Claude),受限於 Vercel 函式
  執行時間上限,大份說明書在免費方案上可能無法跑完全程。
- 標註座標由模型估計,偶有偏移;檢視器提供「顯示整頁 / 查看原始說明書」作為對照。
