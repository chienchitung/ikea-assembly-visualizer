import { GEMINI_KEY_STORAGE } from "@/components/ApiKeySettings";
import { pdfToPageBlobs } from "./pdfToImages";
import { MAX_INLINE_BYTES, parseManualWithGemini } from "./geminiParse";
import { saveLocalGuide } from "./localGuides";

/**
 * 解析工作管理器（模組層級單例）。
 *
 * 解析管線不綁在任何 React 元件的生命週期上：使用者切到其他瀏覽器分頁、
 * 或在站內切換頁面（元件卸載）時，解析照常在背景繼續執行；回到首頁時
 * 元件重新訂閱目前狀態，完成後自動導向指南。
 *
 * 另外：解析期間更新分頁標題顯示進度，並攔截關閉/重新整理提醒使用者
 * 解析會中斷。
 */

export type ParsePhase = "reading" | "rendering" | "parsing" | "saving";

export interface ParseJobState {
  status: "idle" | "running" | "done" | "error";
  phase: ParsePhase | null;
  fileName: string | null;
  /** status=done 時的新指南 id */
  guideId: string | null;
  error: string | null;
}

const PHASE_LABEL: Record<ParsePhase, string> = {
  reading: "讀取檔案",
  rendering: "轉換頁面",
  parsing: "AI 解析說明書",
  saving: "生成指南",
};

let state: ParseJobState = {
  status: "idle",
  phase: null,
  fileName: null,
  guideId: null,
  error: null,
};
const listeners = new Set<(s: ParseJobState) => void>();
let baseTitle: string | null = null;

function setState(patch: Partial<ParseJobState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
  syncTitle();
}

function syncTitle() {
  if (typeof document === "undefined") return;
  if (baseTitle === null) baseTitle = document.title;
  document.title =
    state.status === "running" && state.phase
      ? `⏳ ${PHASE_LABEL[state.phase]}… | ${baseTitle}`
      : baseTitle;
}

function beforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = "";
}

export function getParseJobState(): ParseJobState {
  return state;
}

/** 訂閱狀態變化；訂閱時立即回呼一次目前狀態。 */
export function subscribeParseJob(fn: (s: ParseJobState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

/** 前端處理完 done / error 後呼叫，把狀態歸零。 */
export function acknowledgeParseJob() {
  if (state.status === "done" || state.status === "error") {
    setState({ status: "idle", phase: null, fileName: null, guideId: null, error: null });
  }
}

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 啟動解析。已有工作進行中時忽略（一次一件）。 */
export function startParseJob(file: File): void {
  if (state.status === "running") return;

  const apiKey =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(GEMINI_KEY_STORAGE)?.trim()
      : undefined;
  if (!apiKey) {
    setState({
      status: "error",
      error: "請先點右上角「API 金鑰」設定 Google Gemini 金鑰（僅存於你的瀏覽器）。",
    });
    return;
  }
  if (!ACCEPTED.includes(file.type)) {
    setState({ status: "error", error: "僅支援 PDF、JPG、PNG 格式。" });
    return;
  }
  if (file.size > MAX_INLINE_BYTES) {
    setState({
      status: "error",
      error: "檔案過大：Gemini 單次請求上限約 14MB，請壓縮檔案後再試。",
    });
    return;
  }

  setState({ status: "running", phase: "reading", fileName: file.name, guideId: null, error: null });
  window.addEventListener("beforeunload", beforeUnload);

  void (async () => {
    try {
      const isPdf = file.type === "application/pdf";
      const bytes = await file.arrayBuffer();
      // 先做 base64（pdfjs 會把 buffer 轉移給 worker）
      const fileBase64 = await blobToBase64(file);

      setState({ phase: "rendering" });
      const pages: Blob[] = isPdf ? await pdfToPageBlobs(bytes) : [file];

      setState({ phase: "parsing" });
      const guide = await parseManualWithGemini({
        apiKey,
        fileType: isPdf ? "pdf" : "image",
        pdfBase64: isPdf ? fileBase64 : undefined,
        images: isPdf ? undefined : [{ base64: fileBase64, mimeType: file.type }],
        pageCount: pages.length,
      });

      setState({ phase: "saving" });
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      await saveLocalGuide({
        id,
        createdAt: new Date().toISOString(),
        fileName: file.name,
        guide,
        pages,
      });
      setState({ status: "done", phase: null, guideId: id });
    } catch (err) {
      setState({
        status: "error",
        phase: null,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      window.removeEventListener("beforeunload", beforeUnload);
    }
  })();
}
