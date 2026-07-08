"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GuideJobStatus } from "@/lib/schema";
import { GEMINI_KEY_STORAGE } from "./ApiKeySettings";
import { IconUpload } from "./icons";

/** 前端顯示的階段：uploading 是「檔案還在傳送中」，其餘對應後端工作狀態 */
type UploadPhase = GuideJobStatus | "uploading";

const STAGES: { keys: UploadPhase[]; label: string }[] = [
  { keys: ["uploading", "uploaded"], label: "上傳檔案" },
  { keys: ["rendering"], label: "轉換頁面" },
  { keys: ["parsing"], label: "AI 解析說明書" },
  { keys: ["ready"], label: "生成指南" },
];

/** 回應不是 JSON 時（平台層 413/500 等），依 HTTP 狀態給出可行動的訊息 */
function httpErrorMessage(status: number): string {
  if (status === 413) {
    return "檔案過大：超過伺服器單次請求上限（Vercel 平台約 4.5MB）。請壓縮 PDF 或改上傳單頁圖片。";
  }
  if (status >= 500) {
    return `伺服器錯誤（${status}）：可能是部署環境尚未設定儲存空間（Vercel 需設定 BLOB_READ_WRITE_TOKEN）。`;
  }
  return `上傳失敗（HTTP ${status}），請稍後再試。`;
}

/** 輪詢連續失敗達此次數（約 30 秒）即放棄並顯示錯誤 */
const MAX_POLL_FAILURES = 12;

export default function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadPhase | null>(null);

  const upload = useCallback(async (file: File) => {
    setError(null);
    setStatus("uploading"); // 立即顯示狀態列，大檔案傳送中也有回饋
    const fd = new FormData();
    fd.append("file", file);
    // 右上角設定的 Gemini 金鑰：僅存於瀏覽器，只隨本次請求送出使用
    const headers: Record<string, string> = {};
    const geminiKey = localStorage.getItem(GEMINI_KEY_STORAGE);
    if (geminiKey) headers["x-gemini-api-key"] = geminiKey;

    try {
      const res = await fetch("/api/guides", { method: "POST", body: fd, headers });
      // 平台層錯誤（413/500 等）的回應可能不是 JSON，安全解析避免整個流程靜默中止
      let data: { id?: string; error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        /* 非 JSON 回應 */
      }
      if (!res.ok || !data?.id) {
        setStatus(null);
        setError(data?.error ?? httpErrorMessage(res.status));
        return;
      }
      setJobId(data.id);
      setStatus("uploaded");
    } catch {
      setStatus(null);
      setError("上傳失敗：無法連線到伺服器，請確認網路後再試。");
    }
  }, []);

  // 輪詢解析狀態
  useEffect(() => {
    if (!jobId) return;
    let failures = 0;
    const stop = (msg?: string) => {
      clearInterval(timer);
      if (msg) {
        setError(msg);
        setStatus(null);
        setJobId(null);
      }
    };
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/guides/${jobId}`);
        if (!res.ok) {
          // 連續查不到狀態就放棄，不再無聲空轉
          if (++failures >= MAX_POLL_FAILURES) {
            stop(
              res.status === 404
                ? "查不到這筆解析工作：部署環境可能沒有共用儲存（Vercel 需設定 BLOB_READ_WRITE_TOKEN），工作狀態在請求之間遺失了。"
                : `查詢解析狀態失敗（HTTP ${res.status}），請重新上傳。`
            );
          }
          return;
        }
        failures = 0;
        const { job } = await res.json();
        setStatus(job.status);
        if (job.status === "ready") {
          stop();
          router.push(`/guide/${jobId}`);
        }
        if (job.status === "error") {
          stop(job.error ?? "解析失敗");
        }
      } catch {
        if (++failures >= MAX_POLL_FAILURES) {
          stop("查詢解析狀態時連線失敗，請確認網路後重新上傳。");
        }
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [jobId, router]);

  if (status && status !== "error") {
    const activeIdx = STAGES.findIndex((s) => s.keys.includes(status));
    return (
      <div className="pipeline-status">
        <h3>正在生成你的組裝指南…</h3>
        <p>AI 正在閱讀每一頁，辨識零件、箭頭與步驟，通常需要 1–3 分鐘。</p>
        <div className="pipeline-steps">
          {STAGES.map((s, i) => (
            <span
              key={s.label}
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
      <p>支援 PDF、JPG、PNG。先到右上角「API 金鑰」設定 Gemini 金鑰（僅存於你的瀏覽器）</p>
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
