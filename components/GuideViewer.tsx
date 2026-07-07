"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssemblyGuide, Part, Step } from "@/lib/schema";
import StepCanvas from "./StepCanvas";

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

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/guides/${id}`);
      if (!res.ok) {
        setError("找不到這份指南,請重新上傳說明書。");
        return;
      }
      const data = await res.json();
      if (data.job.status !== "ready" || !data.guide) {
        setError(
          data.job.status === "error"
            ? `解析失敗:${data.job.error ?? "未知錯誤"}`
            : "這份說明書還在解析中,請稍後再試。"
        );
        return;
      }
      setGuide(data.guide as AssemblyGuide);
    })();
  }, [id]);

  const partById = useMemo(() => {
    const m = new Map<string, Part>();
    guide?.parts.forEach((p) => m.set(p.id, p));
    return m;
  }, [guide]);

  if (error) return <div className="loading-page">⚠ {error}</div>;
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
      <div className="progress-wrap">
        <div className="progress-meta">
          <h2>
            {guide.product.name}
            {guide.product.documentCode && (
              <span
                style={{ fontSize: 13, color: "var(--ink-soft)", fontWeight: 400, marginLeft: 10 }}
              >
                {guide.product.documentCode}
              </span>
            )}
          </h2>
          <span className="pct">
            已完成 {done.size} / {steps.length} 步({pct}%)
          </span>
        </div>
        <div className="progress-bar">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="viewer">
        {/* 左:步驟清單 */}
        <div className="panel">
          <div className="panel-header">🪜 組裝步驟</div>
          <div className="step-list">
            {steps.map((s, i) => (
              <button
                key={s.id}
                className={
                  "step-item" +
                  (i === stepIdx ? " current" : "") +
                  (done.has(s.id) ? " done" : "")
                }
                onClick={() => goTo(i)}
              >
                <span className="step-num">{done.has(s.id) ? "✓" : s.index}</span>
                <span>
                  <span className="s-title">{s.title}</span>
                  <span className="s-sub">
                    第 {s.pages.join("、")} 頁
                    {s.partsUsed.length > 0 && ` · ${totalQty(s)} 個零件`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 中:視覺化畫布 */}
        <div className="panel canvas-panel">
          <div className="canvas-toolbar">
            <button
              className={"tool-btn" + (showAnn ? " on" : "")}
              onClick={() => setShowAnn((v) => !v)}
            >
              ✨ 標註 {showAnn ? "開" : "關"}
            </button>
            <button
              className={"tool-btn" + (!fullPage ? " on" : "")}
              onClick={() => setFullPage((v) => !v)}
            >
              {fullPage ? "🔍 放大細節" : "🗺 顯示整頁"}
            </button>
            <button className="tool-btn" onClick={() => setReplayKey((k) => k + 1)}>
              ▶ 重播本步驟
            </button>
            <button
              className="tool-btn"
              onClick={() => {
                setOriginalPage(step.pages[0] ?? step.visual.basePage);
                setOriginalOpen(true);
              }}
            >
              📖 查看原始說明書
            </button>
          </div>

          <StepCanvas
            guideId={id}
            visual={step.visual}
            fullPage={fullPage}
            replayKey={replayKey}
            showAnnotations={showAnn}
          />
          {step.visual.caption && <div className="canvas-caption">{step.visual.caption}</div>}

          <div className="step-controls">
            <button className="btn btn-ghost" disabled={stepIdx === 0} onClick={() => goTo(stepIdx - 1)}>
              ← 上一步
            </button>
            <span className="spacer" />
            <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
              步驟 {step.index} / 共 {steps.length} 步
            </span>
            <span className="spacer" />
            {stepIdx < steps.length - 1 ? (
              <button className="btn btn-primary" onClick={markDoneAndNext}>
                完成,下一步 →
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => setDone((prev) => new Set(prev).add(step.id))}
              >
                🎉 全部完成
              </button>
            )}
          </div>
        </div>

        {/* 右:詳細資訊 */}
        <div className="panel">
          <div className="tabs">
            <button className={tab === "detail" ? "on" : ""} onClick={() => setTab("detail")}>
              本步驟
            </button>
            <button className={tab === "parts" ? "on" : ""} onClick={() => setTab("parts")}>
              零件清單
            </button>
            <button className={tab === "warnings" ? "on" : ""} onClick={() => setTab("warnings")}>
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
            <div style={{ padding: "8px 0", maxHeight: "62vh", overflowY: "auto" }}>
              {guide.warnings.map((w) => (
                <div key={w.id} className={`warning-card ${w.severity}`}>
                  <b>
                    {w.severity === "danger" ? "🚨" : w.severity === "caution" ? "⚠️" : "ℹ️"}{" "}
                    {w.title}
                  </b>
                  {w.text}
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
                    說明書第 {w.pages.join("、")} 頁
                  </div>
                </div>
              ))}
              {guide.generalTips.length > 0 && (
                <div style={{ padding: "4px 16px" }}>
                  <div className="section-label">組裝小提醒</div>
                  {guide.generalTips.map((tip, i) => (
                    <div key={i} className="callout warn" style={{ background: "#f7f9fb", border: "1px solid var(--line)", color: "var(--ink)" }}>
                      💡 {tip}
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
              <button className="tool-btn" onClick={() => setOriginalOpen(false)}>
                ✕ 關閉
              </button>
            </div>
            <div className="modal-body">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/guides/${id}/pages/${originalPage}`} alt={`第 ${originalPage} 頁`} />
            </div>
            <div className="modal-nav">
              <button
                className="tool-btn"
                disabled={originalPage <= 1}
                onClick={() => setOriginalPage((p) => p - 1)}
              >
                ← 前一頁
              </button>
              <button
                className="tool-btn"
                disabled={originalPage >= guide.source.pageCount}
                onClick={() => setOriginalPage((p) => p + 1)}
              >
                後一頁 →
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function totalQty(s: Step): number {
  return s.partsUsed.reduce((sum, u) => sum + u.quantity, 0);
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
        步驟 {step.index}:{step.title}
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
                🔧 {toolById.get(tid)?.name ?? tid}
              </span>
            ))}
          </div>
        </>
      )}

      {step.orientation && (
        <>
          <div className="section-label">方向與位置</div>
          <div className="callout orient">🧭 {step.orientation}</div>
        </>
      )}

      {step.cautions.length > 0 && (
        <>
          <div className="section-label">注意事項</div>
          {step.cautions.map((c, i) => (
            <div className="callout warn" key={i}>
              ⚠️ {c}
            </div>
          ))}
        </>
      )}

      {step.commonMistakes.length > 0 && (
        <>
          <div className="section-label">常見錯誤</div>
          {step.commonMistakes.map((m, i) => (
            <div className="callout mistake" key={i}>
              ❌ {m}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
