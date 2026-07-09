"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AssemblyGuide, Part, Step } from "@/lib/schema";
import { getLocalGuide, triggerDownload } from "@/lib/localGuides";
import StepCanvas, { type StepCanvasHandle } from "./StepCanvas";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCompass,
  IconCrossCircle,
  IconDocument,
  IconEye,
  IconEyeOff,
  IconLightbulb,
  IconMagnifierMinus,
  IconMagnifierPlus,
  IconReplay,
  IconShare,
  IconWarningTriangle,
  IconWrench,
} from "./icons";

const VERB_LABEL: Record<string, string> = {
  insert: "插入",
  align: "對齊",
  screw: "鎖緊",
  hammer: "敲入",
  rotate: "旋轉",
  flip: "翻轉",
  attach: "安裝",
  place: "放置",
  slide: "推入",
  mark: "標記",
  drill: "鑽孔",
  press: "壓入",
  check: "檢查",
};

const KIND_LABEL: Record<Part["kind"], string> = {
  panel: "板件",
  hardware: "五金",
  fitting: "固定配件",
  accessory: "配件",
};

export default function GuideViewer({ id }: { id: string }) {
  const [guide, setGuide] = useState<AssemblyGuide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"detail" | "parts" | "warnings">("detail");
  const [fullPage, setFullPage] = useState(false);
  const [showAnn, setShowAnn] = useState(true);
  const [replayKey, setReplayKey] = useState(0);
  const [originalOpen, setOriginalOpen] = useState(false);
  const [originalPage, setOriginalPage] = useState(1);
  /** 本機指南的頁面圖 object URL（1-based 對應 index+1）；null = 使用伺服器 API（示範指南） */
  const [pageUrls, setPageUrls] = useState<string[] | null>(null);
  /** 本機指南留存的原始檔（供下載）；示範指南或舊紀錄為 null */
  const [source, setSource] = useState<{ blob: Blob; name: string } | null>(null);
  const canvasRef = useRef<StepCanvasHandle>(null);
  const [sharing, setSharing] = useState(false);
  /** 按下「全部完成」後顯示的完成畫面 */
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    void (async () => {
      // 1. 先找瀏覽器本機的指南（使用者上傳解析的結果存在 IndexedDB）
      try {
        const local = await getLocalGuide(id);
        if (local) {
          if (cancelled) return;
          urls = local.pages.map((b) => URL.createObjectURL(b));
          setPageUrls(urls);
          if (local.sourceFile) {
            setSource({ blob: local.sourceFile, name: local.fileName || "manual.pdf" });
          }
          setGuide(local.guide);
          return;
        }
      } catch {
        /* IndexedDB 不可用時退回伺服器 */
      }
      // 2. 伺服器內建的示範指南（如 kallax）
      const res = await fetch(`/api/guides/${id}`).catch(() => null);
      if (cancelled) return;
      if (!res || !res.ok) {
        setError("找不到這份指南。指南只保存在解析它的瀏覽器中，請重新上傳說明書。");
        return;
      }
      const data = await res.json();
      if (data.job.status !== "ready" || !data.guide) {
        setError("找不到這份指南，請重新上傳說明書。");
        return;
      }
      setGuide(data.guide as AssemblyGuide);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [id]);

  /** 取得某一頁（1-based）的圖片網址：本機 object URL 或示範指南 API */
  const pageSrc = useCallback(
    (page: number) =>
      pageUrls ? pageUrls[page - 1] ?? "" : `/api/guides/${id}/pages/${page}`,
    [pageUrls, id]
  );

  const partById = useMemo(() => {
    const m = new Map<string, Part>();
    guide?.parts.forEach((p) => m.set(p.id, p));
    return m;
  }, [guide]);

  // 進度記憶：載入指南後還原上次的完成勾選與所在步驟；之後隨操作保存
  const progressKey = `guide-progress-${id}`;
  useEffect(() => {
    if (!guide) return;
    try {
      const raw = localStorage.getItem(progressKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { done?: string[]; stepIdx?: number };
      if (Array.isArray(saved.done)) setDone(new Set(saved.done));
      if (
        typeof saved.stepIdx === "number" &&
        saved.stepIdx >= 0 &&
        saved.stepIdx < guide.steps.length
      ) {
        setStepIdx(saved.stepIdx);
      }
    } catch {
      /* 進度資料壞掉就從頭開始 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide, progressKey]);
  useEffect(() => {
    if (!guide) return;
    localStorage.setItem(progressKey, JSON.stringify({ done: [...done], stepIdx }));
  }, [guide, done, stepIdx, progressKey]);

  // 預載下一步的底圖，切換步驟時不用等載入
  useEffect(() => {
    if (!guide) return;
    const next = guide.steps[stepIdx + 1];
    if (!next) return;
    const img = new Image();
    img.src = pageSrc(next.visual.basePage);
  }, [guide, stepIdx, pageSrc]);

  // 鍵盤導航：← → 切換步驟；模態框開啟時 ← → 翻原始說明書頁、Esc 關閉
  useEffect(() => {
    if (!guide) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (completed) {
        if (e.key === "Escape") setCompleted(false);
        return;
      }
      if (originalOpen) {
        if (e.key === "Escape") setOriginalOpen(false);
        if (e.key === "ArrowLeft") setOriginalPage((p) => Math.max(1, p - 1));
        if (e.key === "ArrowRight") {
          setOriginalPage((p) => Math.min(guide.source.pageCount, p + 1));
        }
        return;
      }
      if (e.key === "ArrowLeft") setStepIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") {
        setStepIdx((i) => Math.min(guide.steps.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guide, originalOpen, completed]);

  if (error) return <div className="loading-page">{error}</div>;
  if (!guide) return <div className="loading-page">載入指南中…</div>;

  const steps = guide.steps;
  const step = steps[stepIdx];
  const pct = Math.round((done.size / steps.length) * 100);

  const goTo = (i: number) => {
    if (i < 0 || i >= steps.length) return;
    setStepIdx(i);
    setReplayKey((k) => k + 1);
    setTab("detail");
    setOriginalPage(steps[i].pages[0] ?? 1);
  };

  const markDoneAndNext = () => {
    setDone((prev) => new Set(prev).add(step.id));
    if (stepIdx < steps.length - 1) goTo(stepIdx + 1);
  };

  /** 分享此步驟：畫布輸出成 PNG，行動裝置走系統分享、其他環境直接下載 */
  const shareStep = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const title = `${guide.product.name}｜步驟 ${step.index}：${step.title}`;
      const blob = await canvasRef.current?.exportPng(title);
      if (!blob) return;
      const fileName = `${guide.product.name}-步驟${step.index}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else {
        triggerDownload(blob, fileName);
      }
    } catch {
      /* 使用者取消系統分享等，不視為錯誤 */
    } finally {
      setSharing(false);
    }
  };

  return (
    <main className="container">
      <div className="guide-head">
        <h2>{guide.product.name}</h2>
        {guide.product.documentCode && (
          <span className="doc-code">{guide.product.documentCode}</span>
        )}
        <div className="progress-side">
          <div className="progress-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="pct">
            {done.size} / {steps.length} 步
          </span>
        </div>
      </div>

      {/* 步驟號碼列（對應說明書上的大數字） */}
      <div className="step-strip" role="tablist" aria-label="組裝步驟">
        {steps.map((s, i) => (
          <button
            key={s.id}
            title={`步驟 ${s.index}：${s.title}`}
            className={
              "step-dot" +
              (i === stepIdx ? " current" : "") +
              (done.has(s.id) && i !== stepIdx ? " done" : "")
            }
            onClick={() => goTo(i)}
          >
            {done.has(s.id) && i !== stepIdx ? <IconCheck size={17} /> : s.index}
          </button>
        ))}
      </div>

      <div className="viewer">
        {/* 左：視覺化畫布 */}
        <div className="panel">
          <div className="canvas-toolbar">
            <span className="step-label">
              步驟 {step.index}：{step.title}
            </span>
            <button
              className={"icon-btn" + (showAnn ? " on" : "")}
              title={showAnn ? "隱藏標註" : "顯示標註"}
              onClick={() => setShowAnn((v) => !v)}
            >
              {showAnn ? <IconEye /> : <IconEyeOff />}
            </button>
            <button
              className="icon-btn"
              title={fullPage ? "放大細節" : "顯示整頁"}
              onClick={() => setFullPage((v) => !v)}
            >
              {fullPage ? <IconMagnifierPlus /> : <IconMagnifierMinus />}
            </button>
            <button
              className="icon-btn"
              title="重播本步驟標註"
              onClick={() => setReplayKey((k) => k + 1)}
            >
              <IconReplay />
            </button>
            <button
              className="icon-btn"
              title="分享此步驟（輸出成圖片）"
              disabled={sharing}
              onClick={() => void shareStep()}
            >
              <IconShare />
            </button>
            <button
              className="icon-btn"
              title="查看原始說明書"
              onClick={() => {
                setOriginalPage(step.pages[0] ?? step.visual.basePage);
                setOriginalOpen(true);
              }}
            >
              <IconDocument />
            </button>
          </div>

          <StepCanvas
            ref={canvasRef}
            pageSrc={pageSrc}
            visual={step.visual}
            fullPage={fullPage}
            replayKey={replayKey}
            showAnnotations={showAnn}
          />
          {step.visual.caption && (
            <div className="canvas-caption">{step.visual.caption}</div>
          )}

          <div className="step-controls">
            <button
              className="btn btn-secondary"
              disabled={stepIdx === 0}
              onClick={() => goTo(stepIdx - 1)}
            >
              <IconChevronLeft size={16} /> 上一步
            </button>
            <span className="mid">
              {step.index} / {steps.length}
            </span>
            {stepIdx < steps.length - 1 ? (
              <button className="btn btn-primary" onClick={markDoneAndNext}>
                下一步 <IconChevronRight size={16} />
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setDone((prev) => new Set(prev).add(step.id));
                  setCompleted(true);
                }}
              >
                全部完成 <IconCheck size={16} />
              </button>
            )}
          </div>
        </div>

        {/* 右：詳細資訊 */}
        <div className="panel">
          <div className="tabs">
            <button className={tab === "detail" ? "on" : ""} onClick={() => setTab("detail")}>
              本步驟
            </button>
            <button className={tab === "parts" ? "on" : ""} onClick={() => setTab("parts")}>
              零件與工具
            </button>
            <button
              className={tab === "warnings" ? "on" : ""}
              onClick={() => setTab("warnings")}
            >
              注意事項
            </button>
          </div>

          {tab === "detail" && <StepDetail step={step} partById={partById} guide={guide} />}

          {tab === "parts" && (
            <div className="inventory">
              <div className="section-label">零件與五金</div>
              {guide.parts.map((p) => (
                <div className="inv-row" key={p.id}>
                  <span className="qty">{p.quantity}×</span>
                  <span>
                    {p.name}
                    {p.partNumber && <div className="meta">料號 {p.partNumber}</div>}
                  </span>
                  <span className="kind-tag">{KIND_LABEL[p.kind]}</span>
                </div>
              ))}
              <div className="section-label" style={{ marginTop: 20 }}>
                工具
              </div>
              {guide.tools.map((t) => (
                <div className="inv-row" key={t.id}>
                  <span className="qty">{t.includedInBox ? "內附" : "自備"}</span>
                  <span>
                    {t.name}
                    {t.note && <div className="meta">{t.note}</div>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === "warnings" && (
            <div style={{ padding: "4px 0 14px", maxHeight: "62vh", overflowY: "auto" }}>
              {/* IKEA 原廠說明書的防傾倒警告插圖 */}
              <div className="warning-illustration">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/pictograms/anchor-warning.png" alt="固定前貼牆直立，禁止傾斜攀爬" />
              </div>
              {guide.warnings.map((w) => (
                <div key={w.id} className={`warning-card ${w.severity}`}>
                  <b>{w.title}</b>
                  {w.text}
                  <div className="pages">說明書第 {w.pages.join("、")} 頁</div>
                </div>
              ))}
              {guide.generalTips.length > 0 && (
                <div style={{ padding: "4px 18px" }}>
                  <div className="section-label">組裝小提醒</div>
                  {guide.generalTips.map((tip, i) => (
                    <div key={i} className="callout tip">
                      <IconLightbulb size={17} />
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 組裝完成畫面 */}
      {completed && (
        <div className="modal-backdrop" onClick={() => setCompleted(false)}>
          <div className="modal complete-card" onClick={(e) => e.stopPropagation()}>
            <span className="complete-icon">
              <IconCheck size={32} />
            </span>
            <h3>組裝完成！</h3>
            <p>
              {guide.product.name} 的 {steps.length} 個步驟已全部完成，辛苦了。
            </p>
            {guide.warnings.some((w) => w.severity === "danger") && (
              <p className="complete-warn">
                <IconWarningTriangle size={15} /> 最後提醒：依說明書將家具固定於牆面，避免傾倒。
              </p>
            )}
            <div className="complete-actions">
              <Link className="btn btn-primary" href="/">
                回首頁
              </Link>
              <button className="btn btn-secondary" onClick={() => setCompleted(false)}>
                繼續檢視指南
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 原始說明書模態框 */}
      {originalOpen && (
        <div className="modal-backdrop" onClick={() => setOriginalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>
                原始說明書 — 第 {originalPage} / {guide.source.pageCount} 頁
              </span>
              <span className="modal-head-actions">
                {source && (
                  <button
                    className="btn btn-secondary"
                    title="下載當時上傳的原始說明書檔案"
                    onClick={() => triggerDownload(source.blob, source.name)}
                  >
                    下載原始檔
                  </button>
                )}
                <button className="icon-btn" title="關閉" onClick={() => setOriginalOpen(false)}>
                  ✕
                </button>
              </span>
            </div>
            <div className="modal-body">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pageSrc(originalPage)} alt={`第 ${originalPage} 頁`} />
            </div>
            <div className="modal-nav">
              <button
                className="btn btn-secondary"
                disabled={originalPage <= 1}
                onClick={() => setOriginalPage((p) => p - 1)}
              >
                <IconChevronLeft size={16} /> 前一頁
              </button>
              <button
                className="btn btn-secondary"
                disabled={originalPage >= guide.source.pageCount}
                onClick={() => setOriginalPage((p) => p + 1)}
              >
                後一頁 <IconChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function StepDetail({
  step,
  partById,
  guide,
}: {
  step: Step;
  partById: Map<string, Part>;
  guide: AssemblyGuide;
}) {
  const toolById = new Map(guide.tools.map((t) => [t.id, t]));
  return (
    <div className="detail-body">
      <h3>
        步驟 {step.index}：{step.title}
      </h3>
      <div className="summary">{step.summary}</div>

      <div className="section-label">操作指示</div>
      <ol className="action-list">
        {step.actions.map((a, i) => (
          <li key={i}>
            <span className="verb-badge">{VERB_LABEL[a.verb] ?? a.verb}</span>
            <span>{a.text}</span>
          </li>
        ))}
      </ol>

      {step.partsUsed.length > 0 && (
        <>
          <div className="section-label">使用零件</div>
          <div className="chip-row">
            {step.partsUsed.map((u) => {
              const p = partById.get(u.partId);
              return (
                <span className="part-chip" key={u.partId}>
                  <b>{u.quantity}×</b> {p?.name ?? u.partId}
                  {p?.partNumber && <span className="pn">#{p.partNumber}</span>}
                </span>
              );
            })}
          </div>
        </>
      )}

      {step.toolsUsed.length > 0 && (
        <>
          <div className="section-label">使用工具</div>
          <div className="chip-row">
            {step.toolsUsed.map((tid) => (
              <span className="part-chip" key={tid}>
                <IconWrench size={14} /> {toolById.get(tid)?.name ?? tid}
              </span>
            ))}
          </div>
        </>
      )}

      {step.orientation && (
        <>
          <div className="section-label">方向與位置</div>
          <div className="callout orient">
            <IconCompass size={17} />
            <span>{step.orientation}</span>
          </div>
        </>
      )}

      {step.cautions.length > 0 && (
        <>
          <div className="section-label">注意事項</div>
          {step.cautions.map((c, i) => (
            <div className="callout warn" key={i}>
              <IconWarningTriangle size={17} />
              <span>{c}</span>
            </div>
          ))}
        </>
      )}

      {step.commonMistakes.length > 0 && (
        <>
          <div className="section-label">常見錯誤</div>
          {step.commonMistakes.map((m, i) => (
            <div className="callout mistake" key={i}>
              <IconCrossCircle size={17} />
              <span>{m}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
