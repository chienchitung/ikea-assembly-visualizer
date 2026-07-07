"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GuideJobStatus } from "@/lib/schema";

const STAGES: { key: GuideJobStatus; label: string }[] = [
  { key: "uploaded", label: "1. 上傳檔案" },
  { key: "rendering", label: "2. 轉換頁面" },
  { key: "parsing", label: "3. AI 解析說明書" },
  { key: "ready", label: "4. 生成指南" },
];

export default function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<GuideJobStatus | null>(null);

  const upload = useCallback(async (file: File) => {
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/guides", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "上傳失敗");
      return;
    }
    setJobId(data.id);
    setStatus("uploaded");
  }, []);

  // 輪詢解析狀態
  useEffect(() => {
    if (!jobId) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/guides/${jobId}`);
      if (!res.ok) return;
      const { job } = await res.json();
      setStatus(job.status);
      if (job.status === "ready") {
        clearInterval(timer);
        router.push(`/guide/${jobId}`);
      }
      if (job.status === "error") {
        clearInterval(timer);
        setError(job.error ?? "解析失敗");
        setJobId(null);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [jobId, router]);

  if (jobId && status && status !== "error") {
    const activeIdx = STAGES.findIndex((s) => s.key === status);
    return (
      <div className="pipeline-status">
        <h3 style={{ margin: "0 0 4px" }}>正在生成你的組裝指南…</h3>
        <p style={{ color: "var(--ink-soft)", fontSize: 14, margin: 0 }}>
          AI 正在閱讀說明書的每一頁,辨識零件、箭頭與步驟,通常需要 1–3 分鐘。
        </p>
        <div className="pipeline-steps">
          {STAGES.map((s, i) => (
            <span
              key={s.key}
              className={
                "pipeline-chip " +
                (i < activeIdx ? "done" : i === activeIdx ? "active" : "")
              }
            >
              {i < activeIdx ? "✓ " : ""}
              {s.label}
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
      <div className="big-icon">📄</div>
      <h3>拖放或點擊上傳 IKEA 組裝說明書</h3>
      <p>支援 PDF、JPG、PNG,最大 40MB(需設定 ANTHROPIC_API_KEY)</p>
      {error && <div className="upload-error">⚠ {error}</div>}
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
