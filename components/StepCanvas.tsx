"use client";

import { useEffect, useMemo, useState } from "react";
import type { Annotation, VisualSpec } from "@/lib/schema";

// IKEA 色卡用色（與品牌延伸色一致）：藍=零件、橘=五金、綠=目標位置、紅=警示、粉=旋轉
const TONE_COLOR: Record<string, string> = {
  part: "#0058a3",
  hardware: "#f26a1b",
  target: "#008c46",
  warning: "#cc0008",
  move: "#0058a3",
  rotate: "#e75294",
};

interface Props {
  guideId: string;
  visual: VisualSpec;
  /** 顯示整頁（true）或聚焦裁切（false） */
  fullPage: boolean;
  /** 每次遞增就重播標註動畫 */
  replayKey: number;
  /** 是否顯示標註圖層 */
  showAnnotations: boolean;
}

/**
 * 步驟畫布：以說明書頁面圖為底，依 VisualSpec 疊加 SVG 標註
 * （高亮 / 箭頭 / 位置標記 / 放大提示 / 對錯比較）。
 * 座標系：x 以 0~1000 表示頁寬，y 依圖片實際長寬比換算。
 */
export default function StepCanvas({
  guideId,
  visual,
  fullPage,
  replayKey,
  showAnnotations,
}: Props) {
  const pageUrl = `/api/guides/${guideId}/pages/${visual.basePage}`;
  const [aspect, setAspect] = useState<number | null>(null); // height / width

  useEffect(() => {
    setAspect(null);
    const img = new Image();
    img.onload = () => setAspect(img.naturalHeight / img.naturalWidth);
    img.src = pageUrl;
  }, [pageUrl]);

  const W = 1000;
  const H = aspect ? W * aspect : W * 1.41;

  // 正規化座標 → viewBox 座標
  const nx = (x: number) => x * W;
  const ny = (y: number) => y * H;

  const viewBox = useMemo(() => {
    if (fullPage || !visual.focus) return `0 0 ${W} ${H}`;
    const f = visual.focus;
    const pad = 0.035;
    const x = Math.max(0, (f.x - pad) * W);
    const y = Math.max(0, (f.y - pad) * H);
    const w = Math.min(W - x, (f.w + pad * 2) * W);
    const h = Math.min(H - y, (f.h + pad * 2) * H);
    return `${x} ${y} ${w} ${h}`;
  }, [fullPage, visual.focus, W, H]);

  // 依可視範圍縮放標註尺寸，讓線寬/字級在裁切與整頁模式下視覺一致
  const vbW = Number(viewBox.split(" ")[2]);
  const u = vbW / 100;

  if (!aspect) {
    return (
      <div className="canvas-stage" style={{ minHeight: 320, alignItems: "center" }}>
        <span style={{ color: "var(--ink-soft)", fontSize: 14 }}>載入頁面中…</span>
      </div>
    );
  }

  return (
    <div className="canvas-stage">
      <svg viewBox={viewBox} xmlns="http://www.w3.org/2000/svg">
        <image href={pageUrl} x={0} y={0} width={W} height={H} />
        {showAnnotations && (
          <g key={replayKey}>
            {visual.annotations.map((ann, i) => (
              <AnnotationEl key={i} ann={ann} nx={nx} ny={ny} u={u} order={i} />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

function AnnotationEl({
  ann,
  nx,
  ny,
  u,
  order,
}: {
  ann: Annotation;
  nx: (x: number) => number;
  ny: (y: number) => number;
  u: number;
  order: number;
}) {
  const delay = `${order * 0.18}s`;

  switch (ann.type) {
    case "highlight": {
      const c = TONE_COLOR[ann.tone];
      const x = nx(ann.bbox.x);
      const y = ny(ann.bbox.y);
      const w = nx(ann.bbox.w);
      const h = ny(ann.bbox.h);
      return (
        <g>
          {ann.shape === "rect" ? (
            <rect
              className="ann-highlight"
              x={x}
              y={y}
              width={w}
              height={h}
              rx={1.2 * u}
              fill={c}
              fillOpacity={0.13}
              stroke={c}
              strokeWidth={0.55 * u}
            />
          ) : (
            <ellipse
              className="ann-highlight"
              cx={x + w / 2}
              cy={y + h / 2}
              rx={w / 2}
              ry={h / 2}
              fill={c}
              fillOpacity={0.13}
              stroke={c}
              strokeWidth={0.55 * u}
            />
          )}
          {ann.label && (
            <LabelPill x={x} y={y - 1.4 * u} text={ann.label} color={c} u={u} />
          )}
        </g>
      );
    }

    case "arrow": {
      const c = TONE_COLOR[ann.tone];
      const x1 = nx(ann.from.x);
      const y1 = ny(ann.from.y);
      const x2 = nx(ann.to.x);
      const y2 = ny(ann.to.y);
      // 箭頭頭部：沿線方向的小三角形
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 2.4 * u;
      const hx1 = x2 - headLen * Math.cos(angle - 0.45);
      const hy1 = y2 - headLen * Math.sin(angle - 0.45);
      const hx2 = x2 - headLen * Math.cos(angle + 0.45);
      const hy2 = y2 - headLen * Math.sin(angle + 0.45);
      return (
        <g>
          <path
            className="ann-arrow-path"
            d={`M ${x1} ${y1} L ${x2} ${y2}`}
            stroke={c}
            strokeWidth={0.8 * u}
            strokeLinecap="round"
            fill="none"
            style={{ animationDelay: delay }}
          />
          <polygon
            className="ann-marker"
            points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`}
            fill={c}
            style={{ animationDelay: delay }}
          />
          {ann.label && (
            <LabelPill
              x={(x1 + x2) / 2}
              y={(y1 + y2) / 2 - 2 * u}
              text={ann.label}
              color={c}
              u={u}
            />
          )}
        </g>
      );
    }

    case "marker": {
      const c = TONE_COLOR[ann.tone];
      const x = nx(ann.at.x);
      const y = ny(ann.at.y);
      return (
        <g className="ann-marker" style={{ animationDelay: delay }}>
          <circle cx={x} cy={y} r={2.2 * u} fill={c} fillOpacity={0.9} />
          <circle cx={x} cy={y} r={2.2 * u} fill="none" stroke="#fff" strokeWidth={0.35 * u} />
          <text
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={2.1 * u}
            fontWeight={800}
            fill="#fff"
          >
            {ann.label}
          </text>
        </g>
      );
    }

    case "zoom": {
      const x = nx(ann.bbox.x);
      const y = ny(ann.bbox.y);
      const w = nx(ann.bbox.w);
      const h = ny(ann.bbox.h);
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={1 * u}
            fill="none"
            stroke="#55565a"
            strokeWidth={0.4 * u}
            strokeDasharray={`${1.2 * u} ${0.9 * u}`}
          />
          <LabelPill x={x} y={y + h + 3 * u} text={ann.note} color="#484848" u={u} />
        </g>
      );
    }

    case "compare": {
      return (
        <g>
          {ann.correct && (
            <CompareBox bbox={ann.correct} good nx={nx} ny={ny} u={u} />
          )}
          {ann.wrong && (
            <CompareBox bbox={ann.wrong} good={false} nx={nx} ny={ny} u={u} />
          )}
          {ann.correct && (
            <LabelPill
              x={nx(ann.correct.x)}
              y={ny(ann.correct.y) - 1.4 * u}
              text={ann.note}
              color="#0a8a3a"
              u={u}
            />
          )}
        </g>
      );
    }
  }
}

function CompareBox({
  bbox,
  good,
  nx,
  ny,
  u,
}: {
  bbox: { x: number; y: number; w: number; h: number };
  good: boolean;
  nx: (x: number) => number;
  ny: (y: number) => number;
  u: number;
}) {
  const c = good ? "#0a8a3a" : "#d32f2f";
  const x = nx(bbox.x);
  const y = ny(bbox.y);
  const w = nx(bbox.w);
  const h = ny(bbox.h);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={1 * u}
        fill={c}
        fillOpacity={0.08}
        stroke={c}
        strokeWidth={0.5 * u}
      />
      <circle cx={x + w - 2 * u} cy={y + 2 * u} r={2 * u} fill={c} />
      <text
        x={x + w - 2 * u}
        y={y + 2 * u}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={2.4 * u}
        fontWeight={900}
        fill="#fff"
      >
        {good ? "✓" : "✕"}
      </text>
    </g>
  );
}

/** 帶底色的文字標籤（CJK 以每字 1em 估寬） */
function LabelPill({
  x,
  y,
  text,
  color,
  u,
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  u: number;
}) {
  const fontSize = 2.4 * u;
  const width = estimateWidth(text) * fontSize + 2.4 * u;
  const height = 3.6 * u;
  return (
    <g className="ann-marker">
      <rect
        x={x}
        y={y - height}
        width={width}
        height={height}
        rx={0.9 * u}
        fill={color}
        fillOpacity={0.92}
      />
      <text
        x={x + 1.2 * u}
        y={y - height / 2}
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={700}
        fill="#fff"
      >
        {text}
      </text>
    </g>
  );
}

function estimateWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1 : 0.55;
  }
  return w;
}
