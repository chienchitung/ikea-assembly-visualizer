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

要啟用「上傳任一說明書」的自動解析,需要:

1. `export ANTHROPIC_API_KEY=sk-ant-...`(解析引擎使用 Claude 視覺模型)
2. 系統安裝 poppler-utils(`pdftoppm`,用於 PDF 轉頁面圖):
   `apt-get install poppler-utils` 或 `brew install poppler`

## 系統架構

```
上傳 PDF/圖片
   │  POST /api/guides
   ▼
1. 儲存原始檔(.data/guides/<id>/source.pdf)
2. pdftoppm 轉出逐頁 JPEG(頁面底圖,供前端與檢視器使用)
3. Claude(claude-opus-4-8)視覺解析:
     · PDF 以 document block 整份送入(保留頁碼)
     · 圖片以 image block 送入
     · structured outputs(JSON Schema)強制輸出合法指南 JSON
     · zod 再驗證一次
4. 寫入 guide.json → 前端輪詢 GET /api/guides/<id> → 進入檢視器
```

| 目錄 | 內容 |
|---|---|
| `lib/schema.ts` | 指南資料格式(zod,單一事實來源) |
| `schema/assembly-guide.schema.json` | 同格式的 JSON Schema 文件(對外交付格式) |
| `lib/parser.ts` | Claude 解析引擎(提示詞 + structured outputs) |
| `lib/rasterize.ts` | PDF → 頁面 JPEG |
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

- 上一步 / 下一步 / 重播本步驟(標註動畫重放)
- 放大細節(聚焦裁切)⇄ 顯示整頁 切換、標註圖層開關
- 查看原始說明書對應頁(模態框逐頁翻閱)
- 零件與工具清單、警示與組裝小提醒分頁
- 組裝進度列與步驟完成勾選

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | 解析引擎必填(示範指南不需要) |
| `PARSER_MODEL` | `claude-opus-4-8` | 解析使用的 Claude 模型 |

## 已知限制

- 上傳解析約需 1–3 分鐘(整份說明書一次送入 Claude)。
- 解析工作儲存在本機 `.data/` 資料夾,適合單機部署;多機部署請改接物件儲存。
- 標註座標由模型估計,偶有偏移;檢視器提供「顯示整頁 / 查看原始說明書」作為對照。
