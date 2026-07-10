import { z } from "zod";

/**
 * 組裝指南結構化資料格式（Assembly Guide Schema）
 *
 * 這是系統的核心輸出格式：解析器（Claude 視覺解析）產生這份 JSON,
 * 前端互動式檢視器直接依照它渲染逐步指南與視覺化標註。
 *
 * 所有座標一律使用「正規化座標」：相對於該頁面圖片的 (0,0)=左上、（1,1）=右下。
 */

// ---------- 視覺化標註（Visual Annotations） ----------

/** 正規化矩形 [x, y, w, h],0~1 */
export const BBox = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const Point = z.object({ x: z.number(), y: z.number() });

/** 重點零件/區域高亮 */
const HighlightAnnotation = z.object({
  type: z.literal("highlight"),
  shape: z.enum(["rect", "circle"]),
  bbox: BBox,
  label: z.string().nullable(),
  /** 語意色彩：part=零件（藍）、hardware=五金（橘）、target=目標位置（綠）、warning=警告（紅） */
  tone: z.enum(["part", "hardware", "target", "warning"]),
});

/** 組裝方向箭頭 */
const ArrowAnnotation = z.object({
  type: z.literal("arrow"),
  from: Point,
  to: Point,
  label: z.string().nullable(),
  tone: z.enum(["move", "rotate", "warning"]),
});

/** 螺絲/連接位置標記（圓點+編號） */
const MarkerAnnotation = z.object({
  type: z.literal("marker"),
  at: Point,
  label: z.string(),
  tone: z.enum(["hardware", "target", "warning"]),
});

/** 局部放大提示：框住原圖某區域，顯示說明文字 */
const ZoomAnnotation = z.object({
  type: z.literal("zoom"),
  bbox: BBox,
  note: z.string(),
});

/** 正確 vs 錯誤 比較（打勾/打叉框） */
const CompareAnnotation = z.object({
  type: z.literal("compare"),
  correct: BBox.nullable(),
  wrong: BBox.nullable(),
  note: z.string(),
});

export const Annotation = z.discriminatedUnion("type", [
  HighlightAnnotation,
  ArrowAnnotation,
  MarkerAnnotation,
  ZoomAnnotation,
  CompareAnnotation,
]);
export type Annotation = z.infer<typeof Annotation>;

/** 每一步驟的視覺化呈現指令 */
export const VisualSpec = z.object({
  /** 以說明書哪一頁作為底圖（1-based） */
  basePage: z.number(),
  /** 底圖的裁切聚焦區域；null 表示整頁 */
  focus: BBox.nullable(),
  annotations: z.array(Annotation),
  caption: z.string().nullable(),
});
export type VisualSpec = z.infer<typeof VisualSpec>;

// ---------- 零件 / 工具 / 警告 ----------

export const Part = z.object({
  /** 穩定識別碼，如 "P1"、"HW-104321" */
  id: z.string(),
  /** 顯示名稱（繁體中文） */
  name: z.string(),
  /** IKEA 零件料號（印在說明書上的 6 碼數字），沒有則為 null */
  partNumber: z.string().nullable(),
  quantity: z.number(),
  kind: z.enum(["panel", "hardware", "fitting", "accessory"]),
  description: z.string().nullable(),
  /** 零件在說明書上的示意圖位置（供 UI 顯示縮圖） */
  imageRef: z
    .object({ page: z.number(), bbox: BBox })
    .nullable(),
});
export type Part = z.infer<typeof Part>;

export const Tool = z.object({
  id: z.string(),
  name: z.string(),
  /** 是否包含在包裝內（如內附六角板手 true；自備螺絲起子 false） */
  includedInBox: z.boolean(),
  note: z.string().nullable(),
});
export type Tool = z.infer<typeof Tool>;

export const Warning = z.object({
  id: z.string(),
  severity: z.enum(["danger", "caution", "info"]),
  title: z.string(),
  text: z.string(),
  /** 出現在說明書哪些頁 */
  pages: z.array(z.number()),
});
export type Warning = z.infer<typeof Warning>;

// ---------- 組裝步驟 ----------

const PartUsage = z.object({
  partId: z.string(),
  quantity: z.number(),
});

export const Step = z.object({
  id: z.string(),
  /** 步驟編號（對應說明書上的大數字；分支步驟可加後綴如 "12B"） */
  index: z.number(),
  title: z.string(),
  /** 這一步要做什麼（1~2 句總結） */
  summary: z.string(),
  /** 對應原始說明書頁碼（1-based） */
  pages: z.array(z.number()),
  /** 逐條操作指示 */
  actions: z.array(
    z.object({
      /** 主要動作類型，用於 UI 圖示 */
      verb: z.enum([
        "insert",
        "align",
        "screw",
        "hammer",
        "rotate",
        "flip",
        "attach",
        "place",
        "slide",
        "mark",
        "drill",
        "press",
        "check",
      ]),
      text: z.string(),
    })
  ),
  partsUsed: z.array(PartUsage),
  toolsUsed: z.array(z.string()),
  /** 組裝位置與方向要點 */
  orientation: z.string().nullable(),
  /** 注意事項 */
  cautions: z.array(z.string()),
  /** 常見錯誤提醒 */
  commonMistakes: z.array(z.string()),
  /** 視覺化呈現指令 */
  visual: VisualSpec,
});
export type Step = z.infer<typeof Step>;

// ---------- 完整指南 ----------

export const AssemblyGuide = z.object({
  schemaVersion: z.literal("1.0"),
  product: z.object({
    /** 家具名稱，如 "KALLAX 層架組" */
    name: z.string(),
    /** 說明書文件編號，如 "AA-2051412-6" */
    documentCode: z.string().nullable(),
    category: z.string().nullable(),
    /** 一句話描述（組成、格數、方向等） */
    description: z.string().nullable(),
  }),
  source: z.object({
    fileType: z.enum(["pdf", "image"]),
    pageCount: z.number(),
  }),
  parts: z.array(Part),
  tools: z.array(Tool),
  warnings: z.array(Warning),
  steps: z.array(Step),
  /** 全程通用提示（如：在地毯上組裝、需兩人） */
  generalTips: z.array(z.string()),
});
export type AssemblyGuide = z.infer<typeof AssemblyGuide>;

// ---------- 分批解析用子集合 ----------
//
// 頁數多的說明書(見 lib/geminiParse.ts 的分批解析)拆成兩階段呼叫模型:
// 1. GuideFrontMatter:整份文件一次呼叫,只要求產品/零件/工具/警示 ——
//    不含 steps,輸出量不隨步驟數膨脹,大文件也不會被截斷。
// 2. StepsBatch:依頁碼範圍分批呼叫,只要求該範圍內的 steps。
// 最後把每批 steps 依序合併,拼回一份完整 AssemblyGuide 並整體驗證一次。

export const GuideFrontMatter = AssemblyGuide.omit({ steps: true });
export type GuideFrontMatter = z.infer<typeof GuideFrontMatter>;

export const StepsBatch = z.object({ steps: z.array(Step) });
export type StepsBatch = z.infer<typeof StepsBatch>;

// ---------- 解析工作狀態 ----------

export type GuideJobStatus = "uploaded" | "rendering" | "parsing" | "ready" | "error";

export interface GuideJob {
  id: string;
  status: GuideJobStatus;
  createdAt: string;
  fileName: string;
  fileType: "pdf" | "image";
  pageCount: number;
  error?: string;
  /** Blob 儲存模式下，已上傳頁面圖片的公開網址（依頁碼排序，1-based）。 */
  pageUrls?: string[];
}
