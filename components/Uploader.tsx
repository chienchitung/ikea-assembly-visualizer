"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GEMINI_KEY_STORAGE } from "./ApiKeySettings";
import { IconUpload } from "./icons";
import { pdfToPageBlobs } from "@/lib/pdfToImages";
import { MAX_INLINE_BYTES, parseManualWithGemini } from "@/lib/geminiParse";
import { saveLocalGuide } from "@/lib/localGuides";

/**
 * 上傳與解析全部在瀏覽器內完成：
 * 讀取檔案 → pdfjs 轉頁面圖 → 以使用者的金鑰直接呼叫 Gemini →
 * 結果存入 IndexedDB → 導向指南頁。
 * 不經過本站伺服器，部署環境不需要金鑰或儲存空間設定，
 * 也不受平台的請求大小限制（如 Vercel 的 4.5MB）。
 */

type Phase = "reading" | "rendering" | "parsing" | "saving";

const STAGES: { key: Phase; label: string }[] = [
  { key: "reading", label: "讀取檔案" },
  { key: "rendering", label: "轉換頁面" },
  { key: "parsing", label: "AI 解析說明書" },
  { key: "saving", label: "生成指南" },
];

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

export default function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Phase | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);

      const apiKey = localStorage.getItem(GEMINI_KEY_STORAGE)?.trim();
      if (!apiKey) {
        setError("請先點右上角「API 金鑰」設定 Google Gemini 金鑰（僅存於你的瀏覽器）。");
        return;
      }
      if (!ACCEPTED.includes(file.type)) {
        setError("僅支援 PDF、JPG、PNG 格式。");
        return;
      }
      if (file.size > MAX_INLINE_BYTES) {
        setError("檔案過大：Gemini 單次請求上限約 14MB，請壓縮檔案後再試。");
        return;
      }

      const isPdf = file.type === "application/pdf";
      setStatus("reading");
      try {
        const bytes = await file.arrayBuffer();
        // 先做 base64（pdfjs 會把 buffer 轉移給 worker）
        const fileBase64 = await blobToBase64(file);

        setStatus("rendering");
        const pages: Blob[] = isPdf ? await pdfToPageBlobs(bytes) : [file];

        setStatus("parsing");
        const guide = await parseManualWithGemini({
          apiKey,
          fileType: isPdf ? "pdf" : "image",
          pdfBase64: isPdf ? fileBase64 : undefined,
          images: isPdf ? undefined : [{ base64: fileBase64, mimeType: file.type }],
          pageCount: pages.length,
        });

        setStatus("saving");
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        await saveLocalGuide({
          id,
          createdAt: new Date().toISOString(),
          fileName: file.name,
          guide,
          pages,
        });
        router.push(`/guide/${id}`);
      } catch (err) {
        setStatus(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [router]
  );

  if (status) {
    const activeIdx = STAGES.findIndex((s) => s.key === status);
    return (
      <div className="pipeline-status">
        <h3>正在生成你的組裝指南…</h3>
        <p>AI 正在閱讀每一頁，辨識零件、箭頭與步驟，通常需要 1–3 分鐘。請保持此頁開啟。</p>
        <div className="pipeline-steps">
          {STAGES.map((s, i) => (
            <span
              key={s.key}
              className={
                "pipeline-chip " +
                (i < activeIdx ? "done" : i === activeIdx ? "active" : "")
              }
            >
              {i + 1}. {s.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={"upload-zone" + (dragging ? " dragging" : "")}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void upload(file);
      }}
    >
      <span className="up-icon">
        <IconUpload size={26} />
      </span>
      <h3>拖放或點擊上傳 IKEA 組裝說明書</h3>
      <p>支援 PDF、JPG、PNG（14MB 以內）。先到右上角「API 金鑰」設定 Gemini 金鑰（僅存於你的瀏覽器）</p>
      {error && <div className="upload-error">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
