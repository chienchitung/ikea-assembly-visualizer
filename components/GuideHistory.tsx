"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  deleteLocalGuide,
  downloadLocalGuideSource,
  formatBytes,
  listLocalGuides,
  type LocalGuideMeta,
} from "@/lib/localGuides";
import { IconDocument } from "./icons";

/**
 * 我的解析紀錄：列出此瀏覽器（IndexedDB）保存的所有已解析指南，
 * 可隨時回來重新開啟或刪除。沒有任何紀錄時整個區塊不顯示。
 */
export default function GuideHistory() {
  const [metas, setMetas] = useState<LocalGuideMeta[] | null>(null);
  const thumbsRef = useRef<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    try {
      const list = await listLocalGuides();
      // 重建縮圖 object URL
      thumbsRef.current.forEach((url) => URL.revokeObjectURL(url));
      thumbsRef.current = new Map(
        list
          .filter((m) => m.thumbnail)
          .map((m) => [m.id, URL.createObjectURL(m.thumbnail!)])
      );
      setMetas(list);
    } catch {
      setMetas([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const thumbs = thumbsRef.current;
    return () => {
      thumbs.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [load]);

  const remove = useCallback(
    async (id: string) => {
      await deleteLocalGuide(id);
      void load();
    },
    [load]
  );

  if (!metas || metas.length === 0) return null;

  const totalBytes = metas.reduce((sum, m) => sum + m.bytes, 0);

  return (
    <section className="history-section">
      <h2>我的解析紀錄</h2>
      <p className="sub">
        保存在此瀏覽器中，隨時可回來查看（清除瀏覽資料會一併清除）。共 {metas.length} 筆，佔用約{" "}
        {formatBytes(totalBytes)}。
      </p>
      <div className="history-grid">
        {metas.map((m) => {
          const thumb = thumbsRef.current.get(m.id);
          return (
            <div className="history-card" key={m.id}>
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="thumb" src={thumb} alt={`${m.productName} 說明書縮圖`} />
              ) : (
                <span className="thumb placeholder">
                  <IconDocument size={22} />
                </span>
              )}
              <div className="info">
                <b>{m.productName}</b>
                <span className="meta">
                  {m.stepCount} 步驟 · {m.pageCount} 頁 · {formatBytes(m.bytes)} ·{" "}
                  {new Date(m.createdAt).toLocaleString("zh-TW", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                <span className="meta file">{m.fileName}</span>
              </div>
              <div className="actions">
                <Link className="btn btn-primary" href={`/guide/${m.id}`}>
                  開啟
                </Link>
                {m.hasSource && (
                  <button
                    className="btn btn-secondary"
                    title="下載當時上傳的原始說明書檔案"
                    onClick={() => void downloadLocalGuideSource(m.id)}
                  >
                    下載原始檔
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => void remove(m.id)}>
                  刪除
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
