"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
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

/** 目前可視範圍（viewBox），供標籤夾限位置用 */
interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  /** 取得某一頁（1-based）圖片網址 */
  pageSrc: (page: number) => string;
  visual: VisualSpec;
  /** 顯示整頁（true）或聚焦裁切（false） */
  fullPage: boolean;
  /** 每次遞增就重播標註動畫 */
  replayKey: number;
  /** 是否顯示標註圖層 */
  showAnnotations: boolean;
}

/** 供外部（工具列）呼叫的能力：把當前步驟畫布輸出成 PNG */
export interface StepCanvasHandle {
  exportPng(title: string): Promise<Blob | null>;
}

/**
 * 步驟畫布：以說明書頁面圖為底，依 VisualSpec 疊加 SVG 標註
 * （高亮 / 箭頭 / 位置標記 / 放大提示 / 對錯比較）。
 * 座標系：x 以 0~1000 表示頁寬，y 依圖片實際長寬比換算。
 *
 * 標註分兩層渲染：先畫所有圖形（框、箭頭），再畫所有文字標籤，
 * 確保文字永遠在框線之上；文字位置會夾限在可視範圍內，避免被裁掉。
 *
 * 互動：雙指捏合縮放（1–6 倍）、放大後單指/滑鼠拖曳平移、
 * 雙擊放大到該點（再雙擊還原）。切換步驟或裁切模式時自動還原。
 */
const StepCanvas = forwardRef<StepCanvasHandle, Props>(function StepCanvas(
  { pageSrc, visual, fullPage, replayKey, showAnnotations }: Props,
  handleRef
) {
  const pageUrl = pageSrc(visual.basePage);
  const [aspect, setAspect] = useState<number | null>(null); // height / width

  useEffect(() => {
    setAspect(null);
    if (!pageUrl) return;
    const img = new Image();
    img.onload = () => setAspect(img.naturalHeight / img.naturalWidth);
    img.src = pageUrl;
  }, [pageUrl]);

  const W = 1000;
  const H = aspect ? W * aspect : W * 1.41;

  // 正規化座標 → viewBox 座標
  const nx = (x: number) => x * W;
  const ny = (y: number) => y * H;

  const vb = useMemo<ViewRect>(() => {
    if (fullPage || !visual.focus) return { x: 0, y: 0, w: W, h: H };
    const f = visual.focus;
    const pad = 0.035;
    const x = Math.max(0, (f.x - pad) * W);
    const y = Math.max(0, (f.y - pad) * H);
    const w = Math.min(W - x, (f.w + pad * 2) * W);
    const h = Math.min(H - y, (f.h + pad * 2) * H);
    return { x, y, w, h };
  }, [fullPage, visual.focus, W, H]);

  // 依可視範圍縮放標註尺寸，讓線寬/字級在裁切與整頁模式下視覺一致
  const u = vb.w / 100;

  /* ---------- 縮放與平移（雙指捏合 / 拖曳 / 雙擊） ---------- */
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState({ scale: 1, cx: 0, cy: 0 });
  useEffect(() => {
    // 切換步驟、裁切模式或頁面比例改變時還原
    setZoom({ scale: 1, cx: vb.x + vb.w / 2, cy: vb.y + vb.h / 2 });
  }, [visual, fullPage, vb]);

  // 實際顯示的視野：以 (cx, cy) 為中心、依倍率縮小，夾限在整頁範圍內
  const evb = useMemo<ViewRect>(() => {
    if (zoom.scale <= 1) return vb;
    const w = vb.w / zoom.scale;
    const h = vb.h / zoom.scale;
    const x = clamp(zoom.cx - w / 2, 0, W - w);
    const y = clamp(zoom.cy - h / 2, 0, H - h);
    return { x, y, w, h };
  }, [vb, zoom, W, H]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const evbRef = useRef(evb);
  evbRef.current = evb;

  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number; mid: { x: number; y: number } } | null>(
    null
  );

  const unitsPerPx = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? evbRef.current.w / rect.width : 1;
  };
  const pinchOf = () => {
    const [a, b] = [...ptrs.current.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件無作用中的 pointer 時忽略 */
    }
    if (ptrs.current.size === 2) {
      pinch.current = { ...pinchOf(), scale: zoomRef.current.scale };
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2 && pinch.current) {
      const now = pinchOf();
      const scale = clamp(pinch.current.scale * (now.dist / pinch.current.dist), 1, 6);
      const k = unitsPerPx();
      const dx = (now.mid.x - pinch.current.mid.x) * k;
      const dy = (now.mid.y - pinch.current.mid.y) * k;
      pinch.current.mid = now.mid;
      setZoom((z) => ({ scale, cx: z.cx - dx, cy: z.cy - dy }));
    } else if (ptrs.current.size === 1 && zoomRef.current.scale > 1) {
      const k = unitsPerPx();
      setZoom((z) => ({
        ...z,
        cx: z.cx - (e.clientX - prev.x) * k,
        cy: z.cy - (e.clientY - prev.y) * k,
      }));
    }
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoomRef.current.scale > 1) {
      setZoom({ scale: 1, cx: vb.x + vb.w / 2, cy: vb.y + vb.h / 2 });
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const cur = evbRef.current;
    const px = cur.x + ((e.clientX - rect.left) / rect.width) * cur.w;
    const py = cur.y + ((e.clientY - rect.top) / rect.height) * cur.h;
    setZoom({ scale: 2.5, cx: px, cy: py });
  };

  /* ---------- 匯出成 PNG（分享此步驟） ---------- */
  useImperativeHandle(
    handleRef,
    () => ({
      async exportPng(title: string): Promise<Blob | null> {
        const svg = svgRef.current;
        if (!svg) return null;
        const clone = svg.cloneNode(true) as SVGSVGElement;
        // 底圖以 data URL 內嵌，讓序列化後的 SVG 自給自足
        const resp = await fetch(pageUrl);
        const imgBlob = await resp.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = () => reject(new Error("讀取頁面圖失敗"));
          fr.readAsDataURL(imgBlob);
        });
        clone.querySelector("image")?.setAttribute("href", dataUrl);
        // 匯出一律用基準視野（忽略目前縮放）；脫離頁面 CSS 後動畫消失、呈現最終狀態
        clone.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
        const outW = 1400;
        const outH = Math.round((outW * vb.h) / vb.w);
        clone.setAttribute("width", String(outW));
        clone.setAttribute("height", String(outH));
        clone.setAttribute("font-family", "'Noto Sans TC', sans-serif");
        const xml = new XMLSerializer().serializeToString(clone);
        const svgUrl = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error("SVG 轉圖失敗"));
            i.src = svgUrl;
          });
          const header = 84;
          const canvas = document.createElement("canvas");
          canvas.width = outW;
          canvas.height = outH + header;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#111";
          ctx.font = "700 34px 'Noto Sans TC', sans-serif";
          ctx.fillText(title, 32, 54);
          ctx.strokeStyle = "#dfdfdf";
          ctx.beginPath();
          ctx.moveTo(0, header - 0.5);
          ctx.lineTo(canvas.width, header - 0.5);
          ctx.stroke();
          ctx.drawImage(img, 0, header, outW, outH);
          return await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png")
          );
        } finally {
          URL.revokeObjectURL(svgUrl);
        }
      },
    }),
    [pageUrl, vb]
  );

  if (!aspect) {
    return (
      <div className="canvas-stage" style={{ minHeight: 320, alignItems: "center" }}>
        <span style={{ color: "var(--ink-soft)", fontSize: 14 }}>載入頁面中…</span>
      </div>
    );
  }

  const labels = layoutLabels(visual.annotations, nx, ny, u, vb);

  return (
    <div
      className="canvas-stage"
      style={{
        touchAction: zoom.scale > 1 ? "none" : "pan-y",
        cursor: zoom.scale > 1 ? "grab" : "zoom-in",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      <svg
        ref={svgRef}
        viewBox={`${evb.x} ${evb.y} ${evb.w} ${evb.h}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <image href={pageUrl} x={0} y={0} width={W} height={H} />
        {showAnnotations && (
          <g key={replayKey}>
            {/* 第一層：所有圖形 */}
            {visual.annotations.map((ann, i) => (
              <AnnotationEl key={`s${i}`} ann={ann} nx={nx} ny={ny} u={u} order={i} vb={vb} layer="shape" />
            ))}
            {/* 第二層：文字標籤（避讓排版後，永遠壓在框線上方） */}
            {labels.map((p, i) => (
              <g className="ann-marker" key={`l${i}`}>
                <rect
                  x={p.left}
                  y={p.top}
                  width={p.width}
                  height={p.height}
                  rx={0.9 * u}
                  fill={p.color}
                  fillOpacity={0.92}
                />
                <text
                  x={p.left + 1.2 * u}
                  y={p.top + p.height / 2}
                  dominantBaseline="central"
                  fontSize={p.fontSize}
                  fontWeight={700}
                  fill="#fff"
                >
                  {p.text}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
});

export default StepCanvas;

/* ---------- 標籤避讓排版 ---------- */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Obstacle extends Rect {
  weight: number;
}

interface PlacedLabel {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  text: string;
  color: string;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 為每個標註文字挑選干擾最小的位置：
 * 依序嘗試錨點四周的候選位置，計分 = 蓋住標註圖形的面積
 * + 蓋住其他標籤的面積（權重更高）+ 被畫面邊界夾限推移的距離，
 * 取分數最低者。保證文字不出界、不壓到彼此、盡量不遮住圖上重點。
 */
function layoutLabels(
  annotations: Annotation[],
  nx: (x: number) => number,
  ny: (y: number) => number,
  u: number,
  vb: { x: number; y: number; w: number; h: number }
): PlacedLabel[] {
  // 所有標註圖形都是障礙物（含自己的框——文字蓋住自己框住的東西一樣礙眼）。
  // weight = 蓋到時的懲罰權重：實心框/圓點高、箭頭（外接矩形多為空白）低
  const obstacles: Obstacle[] = [];
  for (const ann of annotations) {
    switch (ann.type) {
      case "highlight":
      case "zoom":
        obstacles.push({
          x: nx(ann.bbox.x),
          y: ny(ann.bbox.y),
          w: nx(ann.bbox.w),
          h: ny(ann.bbox.h),
          weight: 40,
        });
        break;
      case "compare":
        for (const b of [ann.correct, ann.wrong]) {
          if (b) obstacles.push({ x: nx(b.x), y: ny(b.y), w: nx(b.w), h: ny(b.h), weight: 40 });
        }
        break;
      case "marker": {
        const r = 2.2 * u;
        obstacles.push({
          x: nx(ann.at.x) - r,
          y: ny(ann.at.y) - r,
          w: 2 * r,
          h: 2 * r,
          weight: 60,
        });
        break;
      }
      case "arrow": {
        // 箭頭以線段的外接矩形近似
        const x1 = nx(ann.from.x);
        const y1 = ny(ann.from.y);
        const x2 = nx(ann.to.x);
        const y2 = ny(ann.to.y);
        obstacles.push({
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.abs(x2 - x1) || u,
          h: Math.abs(y2 - y1) || u,
          weight: 12,
        });
        break;
      }
    }
  }

  const pad = 0.6 * u;
  const gap = 0.9 * u;
  const placed: Rect[] = [];
  const out: PlacedLabel[] = [];

  for (const ann of annotations) {
    let text: string | null = null;
    let color = "#484848";
    let anchor: Rect | null = null;

    switch (ann.type) {
      case "highlight":
        text = ann.label;
        color = TONE_COLOR[ann.tone];
        anchor = { x: nx(ann.bbox.x), y: ny(ann.bbox.y), w: nx(ann.bbox.w), h: ny(ann.bbox.h) };
        break;
      case "arrow": {
        text = ann.label;
        color = TONE_COLOR[ann.tone];
        const mx = (nx(ann.from.x) + nx(ann.to.x)) / 2;
        const my = (ny(ann.from.y) + ny(ann.to.y)) / 2;
        anchor = { x: mx, y: my, w: 0, h: 0 };
        break;
      }
      case "zoom":
        text = ann.note;
        anchor = { x: nx(ann.bbox.x), y: ny(ann.bbox.y), w: nx(ann.bbox.w), h: ny(ann.bbox.h) };
        break;
      case "compare":
        if (ann.correct) {
          text = ann.note;
          color = "#0a8a3a";
          anchor = {
            x: nx(ann.correct.x),
            y: ny(ann.correct.y),
            w: nx(ann.correct.w),
            h: ny(ann.correct.h),
          };
        }
        break;
      case "marker":
        // 編號直接畫在圓點內，不參與排版
        break;
    }
    if (!text || !anchor) continue;

    // 尺寸（放不下就縮小字級，下限 60%）
    let fontSize = 2.4 * u;
    let width = estimateWidth(text) * fontSize + 2.4 * u;
    const maxWidth = vb.w - pad * 2;
    if (width > maxWidth) {
      const s = Math.max(0.6, maxWidth / width);
      fontSize *= s;
      width = estimateWidth(text) * fontSize + 2.4 * u * s;
    }
    const height = fontSize * 1.5;

    const A = anchor;
    const ax = A.x + A.w / 2; // 錨點中心
    const ay = A.y + A.h / 2;
    const candidates = [
      { left: A.x, top: A.y - height - gap }, // 上
      { left: ax - width / 2, top: A.y - height - gap }, // 上（置中）
      { left: A.x, top: A.y + A.h + gap }, // 下
      { left: ax - width / 2, top: A.y + A.h + gap }, // 下（置中）
      { left: A.x + A.w + gap, top: A.y }, // 右上
      { left: A.x - width - gap, top: A.y }, // 左上
      { left: A.x + A.w + gap, top: A.y + A.h - height }, // 右下
      { left: A.x - width - gap, top: A.y + A.h - height }, // 左下
      { left: A.x + A.w + gap, top: ay - height / 2 }, // 右（置中）
      { left: A.x - width - gap, top: ay - height / 2 }, // 左（置中）
      { left: A.x + gap, top: A.y + gap }, // 內側（最後手段）
    ];
    // 錨點被大型圖形罩住時，貼著錨點的候選全都會重疊——
    // 再沿每個鄰近障礙物的外緣加候選位置（例如「大橢圓的正上方」）
    for (const o of obstacles) {
      const near =
        overlapArea({ x: A.x - 4 * u, y: A.y - 4 * u, w: A.w + 8 * u, h: A.h + 8 * u }, o) > 0;
      if (!near) continue;
      candidates.push(
        { left: ax - width / 2, top: o.y - height - gap }, // 障礙物上方
        { left: ax - width / 2, top: o.y + o.h + gap }, // 障礙物下方
        { left: o.x - width - gap, top: ay - height / 2 }, // 障礙物左側
        { left: o.x + o.w + gap, top: ay - height / 2 } // 障礙物右側
      );
    }

    let best: Rect = { x: vb.x + pad, y: vb.y + pad, w: width, h: height };
    let bestScore = Infinity;
    for (const c of candidates) {
      const left = clamp(c.left, vb.x + pad, vb.x + vb.w - width - pad);
      const top = clamp(c.top, vb.y + pad, vb.y + vb.h - height - pad);
      const r: Rect = { x: left, y: top, w: width, h: height };
      const area = width * height;
      let score = (Math.abs(left - c.left) + Math.abs(top - c.top)) / u; // 出界推移
      // 離錨點太遠會讓標籤「認不出在標什麼」，加距離成本
      score += (Math.abs(r.x + width / 2 - ax) + Math.abs(r.y + height / 2 - ay)) / u / 4;
      for (const o of obstacles) {
        // 實心圖形（框、圓點）權重高；箭頭以外接矩形近似、多為空白，權重低
        score += (overlapArea(r, o) / area) * o.weight;
      }
      for (const p of placed) score += (overlapArea(r, p) / area) * 200; // 蓋到其他標籤
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }

    placed.push(best);
    out.push({ left: best.x, top: best.y, width, height, fontSize, text, color });
  }
  return out;
}

function AnnotationEl({
  ann,
  nx,
  ny,
  u,
  order,
  vb,
  layer,
}: {
  ann: Annotation;
  nx: (x: number) => number;
  ny: (y: number) => number;
  u: number;
  order: number;
  vb: ViewRect;
  layer: "shape" | "label";
}) {
  const delay = `${order * 0.18}s`;

  switch (ann.type) {
    case "highlight": {
      const c = TONE_COLOR[ann.tone];
      const x = nx(ann.bbox.x);
      const y = ny(ann.bbox.y);
      const w = nx(ann.bbox.w);
      const h = ny(ann.bbox.h);
      if (layer !== "shape") return null;
      return ann.shape === "rect" ? (
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
      );
    }

    case "arrow": {
      const c = TONE_COLOR[ann.tone];
      const x1 = nx(ann.from.x);
      const y1 = ny(ann.from.y);
      const x2 = nx(ann.to.x);
      const y2 = ny(ann.to.y);
      if (layer !== "shape") return null;
      {
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
          </g>
        );
      }
    }

    case "marker": {
      if (layer !== "shape") return null;
      const c = TONE_COLOR[ann.tone];
      const r = 2.2 * u;
      // 圓點夾限在可視範圍內，避免貼邊被裁半
      const x = clamp(nx(ann.at.x), vb.x + r, vb.x + vb.w - r);
      const y = clamp(ny(ann.at.y), vb.y + r, vb.y + vb.h - r);
      return (
        <g className="ann-marker" style={{ animationDelay: delay }}>
          <circle cx={x} cy={y} r={r} fill={c} fillOpacity={0.9} />
          <circle cx={x} cy={y} r={r} fill="none" stroke="#fff" strokeWidth={0.35 * u} />
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
      if (layer !== "shape") return null;
      return (
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
      );
    }

    case "compare": {
      if (layer !== "shape") return null;
      return (
        <g>
          {ann.correct && <CompareBox bbox={ann.correct} good nx={nx} ny={ny} u={u} />}
          {ann.wrong && <CompareBox bbox={ann.wrong} good={false} nx={nx} ny={ny} u={u} />}
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function estimateWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1 : 0.55;
  }
  return w;
}
