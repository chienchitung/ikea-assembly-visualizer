/**
 * 指南 JSON 修復器。
 *
 * Gemini 的 responseJsonSchema 結構化輸出不保證 100% 符合 schema——
 * 常見缺陷是漏掉 nullable 欄位（直接省略而不是給 null）、動作 verb
 * 超出枚舉、單一標註物件缺欄位。與其因為一個小欄位讓整份指南作廢，
 * 這裡把可修的補齊、把壞掉的個別標註丟棄，修完再交回 zod 驗證把關。
 *
 * 大型說明書分批解析（見 lib/geminiParse.ts、lib/prompt.ts）分兩階段呼叫，
 * 各自的回應形狀不同（前段資料不含 steps；步驟批次只有 steps），因此把
 * 逐欄位的修復邏輯拆成可重用的小函式，組成三個對外函式：repairGuide
 * （單次解析，完整指南）、repairFrontMatter（前段資料）、repairStepsBatch
 * （步驟批次）。
 */

const VERBS = [
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
] as const;
const KINDS = ["panel", "hardware", "fitting", "accessory"] as const;
const SEVERITIES = ["danger", "caution", "info"] as const;
const HIGHLIGHT_TONES = ["part", "hardware", "target", "warning"] as const;
const ARROW_TONES = ["move", "rotate", "warning"] as const;
const MARKER_TONES = ["hardware", "target", "warning"] as const;

/* ---------- 基本工具 ---------- */

type Dict = Record<string, unknown>;

function obj(v: unknown): Dict {
  return typeof v === "object" && v !== null ? (v as Dict) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function strArr(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === "string" && x.trim() !== "");
}
function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}
function numOrNull(v: unknown): number | null {
  const n = num(v, NaN);
  return Number.isNaN(n) ? null : n;
}
function numArr(v: unknown, fallback: number[]): number[] {
  const out = arr(v)
    .map((x) => numOrNull(x))
    .filter((x): x is number => x !== null);
  return out.length ? out : fallback;
}
function enumOr<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}
function bboxOrNull(v: unknown): { x: number; y: number; w: number; h: number } | null {
  const b = obj(v);
  const x = numOrNull(b.x);
  const y = numOrNull(b.y);
  const w = numOrNull(b.w);
  const h = numOrNull(b.h);
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
}
function pointOrNull(v: unknown): { x: number; y: number } | null {
  const p = obj(v);
  const x = numOrNull(p.x);
  const y = numOrNull(p.y);
  if (x === null || y === null) return null;
  return { x, y };
}

/* ---------- 標註：可修則修，不可修則丟棄該筆 ---------- */

function repairAnnotation(v: unknown): Dict | null {
  const a = obj(v);
  switch (a.type) {
    case "highlight": {
      const bbox = bboxOrNull(a.bbox);
      if (!bbox) return null;
      return {
        type: "highlight",
        shape: enumOr(a.shape, ["rect", "circle"] as const, "rect"),
        bbox,
        label: strOrNull(a.label),
        tone: enumOr(a.tone, HIGHLIGHT_TONES, "part"),
      };
    }
    case "arrow": {
      const from = pointOrNull(a.from);
      const to = pointOrNull(a.to);
      if (!from || !to) return null;
      return {
        type: "arrow",
        from,
        to,
        label: strOrNull(a.label),
        tone: enumOr(a.tone, ARROW_TONES, "move"),
      };
    }
    case "marker": {
      const at = pointOrNull(a.at);
      if (!at) return null;
      return {
        type: "marker",
        at,
        label: str(a.label, "●"),
        tone: enumOr(a.tone, MARKER_TONES, "hardware"),
      };
    }
    case "zoom": {
      const bbox = bboxOrNull(a.bbox);
      if (!bbox) return null;
      return { type: "zoom", bbox, note: str(a.note, "詳見放大圖") };
    }
    case "compare": {
      const correct = bboxOrNull(a.correct);
      const wrong = bboxOrNull(a.wrong);
      if (!correct && !wrong) return null;
      return { type: "compare", correct, wrong, note: str(a.note, "正確做法") };
    }
    default:
      return null;
  }
}

/* ---------- 逐欄位修復（可重用，供下方三個對外函式組合） ---------- */

type ClampPage = (v: unknown, fallback: number) => number;

function makeClampPage(pageCount: number): ClampPage {
  return (v, fallback) => Math.min(Math.max(Math.round(num(v, fallback)), 1), Math.max(pageCount, 1));
}

function repairPart(v: unknown, i: number, clampPage: ClampPage): Dict {
  const p = obj(v);
  const imgRef = obj(p.imageRef);
  const imgBbox = bboxOrNull(imgRef.bbox);
  return {
    id: str(p.id, `P${i + 1}`),
    name: str(p.name, `零件 ${i + 1}`),
    partNumber: strOrNull(p.partNumber),
    quantity: num(p.quantity, 1),
    kind: enumOr(p.kind, KINDS, "hardware"),
    description: strOrNull(p.description),
    imageRef:
      imgBbox && numOrNull(imgRef.page) !== null
        ? { page: clampPage(imgRef.page, 1), bbox: imgBbox }
        : null,
  };
}

function repairTool(v: unknown, i: number): Dict {
  const t = obj(v);
  return {
    id: str(t.id, `T${i + 1}`),
    name: str(t.name, `工具 ${i + 1}`),
    includedInBox: typeof t.includedInBox === "boolean" ? t.includedInBox : false,
    note: strOrNull(t.note),
  };
}

function repairWarning(v: unknown, i: number): Dict {
  const w = obj(v);
  return {
    id: str(w.id, `W${i + 1}`),
    severity: enumOr(w.severity, SEVERITIES, "info"),
    title: str(w.title, "注意"),
    text: str(w.text, ""),
    pages: numArr(w.pages, []),
  };
}

function repairStep(v: unknown, i: number, clampPage: ClampPage): Dict {
  const s = obj(v);
  const visual = obj(s.visual);
  const basePage = clampPage(visual.basePage, 1);
  return {
    id: str(s.id, `S${i + 1}`),
    index: num(s.index, i + 1),
    title: str(s.title, `步驟 ${i + 1}`),
    summary: str(s.summary, ""),
    pages: numArr(s.pages, [basePage]).map((p) => clampPage(p, basePage)),
    actions: arr(s.actions)
      .map((av) => {
        const a = obj(av);
        const text = strOrNull(a.text);
        return text ? { verb: enumOr(a.verb, VERBS, "check"), text } : null;
      })
      .filter((a): a is { verb: (typeof VERBS)[number]; text: string } => a !== null),
    partsUsed: arr(s.partsUsed)
      .map((uv) => {
        const u = obj(uv);
        const partId = strOrNull(u.partId);
        return partId ? { partId, quantity: num(u.quantity, 1) } : null;
      })
      .filter((u): u is { partId: string; quantity: number } => u !== null),
    toolsUsed: strArr(s.toolsUsed),
    orientation: strOrNull(s.orientation),
    cautions: strArr(s.cautions),
    commonMistakes: strArr(s.commonMistakes),
    visual: {
      basePage,
      focus: bboxOrNull(visual.focus),
      annotations: arr(visual.annotations)
        .map(repairAnnotation)
        .filter((a): a is Dict => a !== null),
      caption: strOrNull(visual.caption),
    },
  };
}

function repairFrontMatterFields(
  raw: unknown,
  fileType: "pdf" | "image",
  pageCount: number,
  clampPage: ClampPage
): Dict {
  const g = obj(raw);
  const product = obj(g.product);
  return {
    product: {
      name: str(product.name, "未命名產品"),
      documentCode: strOrNull(product.documentCode),
      category: strOrNull(product.category),
      description: strOrNull(product.description),
    },
    // source 是已知事實，直接覆寫，不信任模型輸出
    source: { fileType, pageCount },
    parts: arr(g.parts).map((v, i) => repairPart(v, i, clampPage)),
    tools: arr(g.tools).map((v, i) => repairTool(v, i)),
    warnings: arr(g.warnings).map((v, i) => repairWarning(v, i)),
    generalTips: strArr(g.generalTips),
  };
}

/* ---------- 主修復流程 ---------- */

/** 單次解析（完整指南，含 steps）的修復。 */
export function repairGuide(raw: unknown, fileType: "pdf" | "image", pageCount: number): unknown {
  const clampPage = makeClampPage(pageCount);
  const g = obj(raw);
  return {
    schemaVersion: "1.0",
    ...repairFrontMatterFields(raw, fileType, pageCount, clampPage),
    steps: arr(g.steps).map((v, i) => repairStep(v, i, clampPage)),
  };
}

/** 分批解析 · 前段資料階段（product/parts/tools/warnings/generalTips，不含 steps）的修復。 */
export function repairFrontMatter(raw: unknown, fileType: "pdf" | "image", pageCount: number): unknown {
  const clampPage = makeClampPage(pageCount);
  return { schemaVersion: "1.0", ...repairFrontMatterFields(raw, fileType, pageCount, clampPage) };
}

/** 分批解析 · 步驟批次階段（單一批次的 steps）的修復。 */
export function repairStepsBatch(raw: unknown, pageCount: number): unknown {
  const clampPage = makeClampPage(pageCount);
  const g = obj(raw);
  return { steps: arr(g.steps).map((v, i) => repairStep(v, i, clampPage)) };
}
