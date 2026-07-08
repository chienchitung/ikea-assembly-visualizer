"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssemblyGuide, Part, Step } from "@/lib/schema";
import { getLocalGuide } from "@/lib/localGuides";
import StepCanvas from "./StepCanvas";
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
                onClick={() => setDone((prev) => new Set(prev).add(step.id))}
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

      {/* 原始說明書模態框 */}
      {originalOpen && (
        <div className="modal-backdrop" onClick={() => setOriginalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>
                原始說明書 — 第 {originalPage} / {guide.source.pageCount} 頁
              </span>
              <button className="icon-btn" title="關閉" onClick={() => setOriginalOpen(false)}>
                ✕
              </button>
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
