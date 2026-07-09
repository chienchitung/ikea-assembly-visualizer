/**
 * 依 IKEA Skapa 設計系統的 icon 規格繪製的線條圖示：
 * 24px 格線、2px 筆畫、平直端點、單色（currentColor）。
 * 取代先前散落各處的 emoji，視覺語彙與 IKEA.com 一致。
 */

function Base({
  children,
  size = 20,
  label,
}: {
  children: React.ReactNode;
  size?: number;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      style={{ flex: "none", display: "block" }}
    >
      {children}
    </svg>
  );
}

type P = { size?: number; label?: string };

export const IconChevronLeft = (p: P) => (
  <Base {...p}>
    <path d="M15 4 L7 12 L15 20" />
  </Base>
);

export const IconChevronRight = (p: P) => (
  <Base {...p}>
    <path d="M9 4 L17 12 L9 20" />
  </Base>
);

export const IconArrowRight = (p: P) => (
  <Base {...p}>
    <path d="M3 12 H21 M14 5 L21 12 L14 19" />
  </Base>
);

export const IconMagnifierPlus = (p: P) => (
  <Base {...p}>
    <circle cx="10.5" cy="10.5" r="7" />
    <path d="M15.8 15.8 L21 21 M7.5 10.5 H13.5 M10.5 7.5 V13.5" />
  </Base>
);

export const IconMagnifierMinus = (p: P) => (
  <Base {...p}>
    <circle cx="10.5" cy="10.5" r="7" />
    <path d="M15.8 15.8 L21 21 M7.5 10.5 H13.5" />
  </Base>
);

export const IconReplay = (p: P) => (
  <Base {...p}>
    <path d="M4 12 a8 8 0 1 1 2.34 5.66" />
    <path d="M4 21 V17 H8" />
  </Base>
);

export const IconDocument = (p: P) => (
  <Base {...p}>
    <path d="M6 2.5 H15 L19.5 7 V21.5 H6 Z" />
    <path d="M15 2.5 V7 H19.5" />
    <path d="M9 12 H16.5 M9 16 H16.5" />
  </Base>
);

export const IconEye = (p: P) => (
  <Base {...p}>
    <path d="M2 12 C5 6.5 8.5 4.5 12 4.5 C15.5 4.5 19 6.5 22 12 C19 17.5 15.5 19.5 12 19.5 C8.5 19.5 5 17.5 2 12 Z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const IconEyeOff = (p: P) => (
  <Base {...p}>
    <path d="M2 12 C5 6.5 8.5 4.5 12 4.5 C15.5 4.5 19 6.5 22 12 C19 17.5 15.5 19.5 12 19.5 C8.5 19.5 5 17.5 2 12 Z" />
    <path d="M4 20 L20 4" />
  </Base>
);

export const IconWarningTriangle = (p: P) => (
  <Base {...p}>
    <path d="M12 3 L22 20.5 H2 Z" />
    <path d="M12 9.5 V14.5" />
    <path d="M12 17.2 V17.5" strokeWidth={2.6} />
  </Base>
);

export const IconCrossCircle = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5" />
  </Base>
);

export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="M4 12.5 L9.5 18 L20 6.5" />
  </Base>
);

export const IconWrench = (p: P) => (
  <Base {...p}>
    <path d="M14.5 3.5 a6 6 0 0 0 -6.9 8.2 L3 16.3 V21 h4.7 l4.6 -4.6 a6 6 0 0 0 8.2 -6.9 L16.6 13.4 L10.6 7.4 Z" />
  </Base>
);

export const IconCompass = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z" />
  </Base>
);

export const IconLightbulb = (p: P) => (
  <Base {...p}>
    <path d="M12 2.5 a6.5 6.5 0 0 1 3.6 11.9 c-.7.5 -1.1 1.2 -1.1 2.1 V17.5 H9.5 v-1 c0 -.9 -.4 -1.6 -1.1 -2.1 A6.5 6.5 0 0 1 12 2.5 Z" />
    <path d="M9.5 21 H14.5" />
  </Base>
);

export const IconUpload = (p: P) => (
  <Base {...p}>
    <path d="M12 15 V3 M6.5 8.5 L12 3 L17.5 8.5" />
    <path d="M3.5 15.5 V20.5 H20.5 V15.5" />
  </Base>
);

export const IconBox = (p: P) => (
  <Base {...p}>
    <path d="M3 7.5 L12 3 L21 7.5 V16.5 L12 21 L3 16.5 Z" />
    <path d="M3 7.5 L12 12 L21 7.5 M12 12 V21" />
  </Base>
);

export const IconClose = (p: P) => (
  <Base {...p}>
    <path d="M5 5 L19 19 M19 5 L5 19" />
  </Base>
);

export const IconKey = (p: P) => (
  <Base {...p}>
    <circle cx="7.5" cy="14.5" r="4.5" />
    <path d="M10.8 11.2 L20 2 M16 6 L19 9 M13 9 L15.5 11.5" />
  </Base>
);

export const IconList = (p: P) => (
  <Base {...p}>
    <path d="M9 5.5 H21 M9 12 H21 M9 18.5 H21" />
    <path d="M4 5.5 H4.02 M4 12 H4.02 M4 18.5 H4.02" strokeWidth={2.8} />
  </Base>
);

export const IconShare = (p: P) => (
  <Base {...p}>
    <path d="M12 15 V3 M7.5 7.5 L12 3 L16.5 7.5" />
    <path d="M5 12 V20 H19 V12" />
  </Base>
);

export const IconExpand = (p: P) => (
  <Base {...p}>
    <path d="M9 3 H3 V9 M15 3 H21 V9 M9 21 H3 V15 M15 21 H21 V15" />
  </Base>
);
