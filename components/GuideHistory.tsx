"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  deleteLocalGuide,
  downloadLocalGuideSource,
  formatBytes,
  getStorageEstimate,
  listLocalGuides,
  type LocalGuideMeta,
  type StorageEstimate,
} from "@/lib/localGuides";
import { IconDocument } from "./icons";

/**
 * 我的解析紀錄：列出此瀏覽器（IndexedDB）保存的所有已解析指南，
 * 可隨時回來重新開啟或刪除。沒有任何紀錄時整個區塊不顯示。
 *
 * 沒有 app 層級的筆數上限，只受瀏覽器儲存配額限制——這裡用
 * navigator.storage.estimate() 顯示目前用量比例，並提供「依大小排序」
 * 方便找出該清掉哪幾筆。
 */

type SortMode = "recent" | "size";

export default function GuideHistory() {
  const [metas, setMetas] = useState<LocalGuideMeta[] | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [sort, setSort] = useState<SortMode>("recent");
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
    setEstimate(await getStorageEstimate());
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

  const sorted = useMemo(() => {
    if (!metas) return [];
    return sort === "size" ? [...metas].sort((a, b) => b.bytes - a.bytes) : metas;
  }, [metas, sort]);

  if (!metas || metas.length === 0) return null;

  const totalBytes = metas.reduce((sum, m) => sum + m.bytes, 0);
  const usedRatio = estimate ? estimate.usageBytes / estimate.quotaBytes : null;
  const nearFull = usedRatio !== null && usedRatio > 0.8;

  return (
    <section className="history-section">
      <div className="history-head">
        <div>
          <h2>我的解析紀錄</h2>
          <p className="sub">
            保存在此瀏覽器中，隨時可回來查看（清除瀏覽資料會一併清除）。共 {metas.length}{" "}
            筆，佔用約 {formatBytes(totalBytes)}。
          </p>
        </div>
        <div className="history-sort">
          <button
            className={sort === "recent" ? "on" : ""}
            onClick={() => setSort("recent")}
          >
            依時間
          </button>
          <button className={sort === "size" ? "on" : ""} onClick={() => setSort("size")}>
            依大小
          </button>
        </div>
      </div>

      {estimate && (
        <div className={"storage-meter" + (nearFull ? " near-full" : "")}>
          <div className="progress-bar">
            <div style={{ width: `${Math.min(100, (usedRatio ?? 0) * 100)}%` }} />
          </div>
          <span>
            瀏覽器儲存空間已使用 {formatBytes(estimate.usageBytes)} / 約{" "}
            {formatBytes(estimate.quotaBytes)}
            {nearFull && "（快滿了，建議清理較舊的紀錄）"}
          </span>
        </div>
      )}

      <div className="history-grid">
        {sorted.map((m) => {
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
