"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconUpload } from "./icons";
import {
  acknowledgeParseJob,
  getParseJobState,
  startParseJob,
  subscribeParseJob,
  type ParseJobState,
  type ParsePhase,
} from "@/lib/parseJob";

/**
 * 上傳入口。實際解析在 lib/parseJob.ts 的模組層級工作管理器執行，
 * 不綁定本元件生命週期——切換瀏覽器分頁或站內頁面都不會中斷解析；
 * 回到首頁時重新訂閱狀態，完成後自動導向指南。
 */

const STAGES: { key: ParsePhase; label: string }[] = [
  { key: "reading", label: "讀取檔案" },
  { key: "rendering", label: "轉換頁面" },
  { key: "parsing", label: "AI 解析說明書" },
  { key: "saving", label: "生成指南" },
];

export default function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [job, setJob] = useState<ParseJobState>(getParseJobState());

  useEffect(() => subscribeParseJob(setJob), []);

  // 解析完成（包括在其他頁面時完成、回到首頁才看到）→ 導向新指南
  useEffect(() => {
    if (job.status === "done" && job.guideId) {
      const id = job.guideId;
      acknowledgeParseJob();
      router.push(`/guide/${id}`);
    }
  }, [job, router]);

  if (job.status === "running") {
    const activeIdx = STAGES.findIndex((s) => s.key === job.phase);
    return (
      <div className="pipeline-status">
        <h3>正在生成你的組裝指南…</h3>
        <p>
          AI 正在閱讀每一頁，辨識零件、箭頭與步驟，通常需要 1–3
          分鐘。可以切換到其他分頁，解析會在背景繼續；完成前請不要關閉此分頁。
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
              {i + 1}. {s.label}
            </span>
          ))}
        </div>
        {job.detail && <p className="pipeline-detail">{job.detail}</p>}
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
        if (file) {
          acknowledgeParseJob();
          startParseJob(file);
        }
      }}
    >
      <span className="up-icon">
        <IconUpload size={26} />
      </span>
      <h3>拖放或點擊上傳 IKEA 組裝說明書</h3>
      <p>支援 PDF、JPG、PNG（14MB 以內）。先到右上角「API 金鑰」設定 Gemini 金鑰（僅存於你的瀏覽器）</p>
      {job.status === "error" && job.error && (
        <div className="upload-error">{job.error}</div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            acknowledgeParseJob();
            startParseJob(file);
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}
