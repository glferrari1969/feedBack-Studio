export type DrumIconId =
  | "kick"
  | "snare"
  | "tom"
  | "hihatClosed"
  | "hihatOpen"
  | "hihatPedal"
  | "ride"
  | "crash"
  | "china"
  | "splash"
  | "rideBell"
  | "bell"
  | "stack"
  | "genericDrum"
  | "genericCymbal";

const STROKE = "#f28c00";
const STROKE_WIDTH = 2;

function cymbalBase() {
  return (
    <>
      <ellipse cx="24" cy="16" rx="12" ry="4.6" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
      <circle cx="24" cy="16" r="2.6" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
      <line x1="24" y1="20" x2="24" y2="40" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </>
  );
}

function drumShell(top = 14, bottom = 31) {
  return (
    <>
      <ellipse cx="24" cy={top} rx="12" ry="4.8" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
      <line x1="12" y1={top} x2="12" y2={bottom} stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <line x1="36" y1={top} x2="36" y2={bottom} stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <ellipse cx="24" cy={bottom} rx="12" ry="4.8" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
    </>
  );
}

function renderDrumIcon(icon: DrumIconId) {
  switch (icon) {
    case "kick":
      return (
        <>
          <circle cx="24" cy="24" r="14" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <circle cx="18" cy="24" r="2.8" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <line x1="10" y1="24" x2="5" y2="28" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="38" y1="24" x2="43" y2="28" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "snare":
      return (
        <>
          {drumShell(15, 28)}
          <line x1="19" y1="22" x2="29" y2="19" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="10" y1="34" x2="7" y2="41" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="38" y1="34" x2="41" y2="41" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "tom":
      return (
        <>
          {drumShell(14, 30)}
          <line x1="18" y1="18" x2="18" y2="30" stroke={STROKE} strokeWidth={1.6} strokeLinecap="round" />
          <line x1="30" y1="18" x2="30" y2="30" stroke={STROKE} strokeWidth={1.6} strokeLinecap="round" />
        </>
      );
    case "hihatClosed":
      return (
        <>
          <ellipse cx="24" cy="13" rx="12" ry="4.2" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <ellipse cx="24" cy="18" rx="12" ry="4.2" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <circle cx="24" cy="15.5" r="2.2" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <line x1="24" y1="22" x2="24" y2="40" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "hihatOpen":
      return (
        <>
          <ellipse cx="24" cy="11" rx="12" ry="4.2" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <ellipse cx="24" cy="20" rx="12" ry="4.2" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <circle cx="24" cy="15.5" r="2.2" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <line x1="24" y1="24" x2="24" y2="40" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="40" y1="10" x2="43" y2="7" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="40" y1="14" x2="43" y2="11" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "hihatPedal":
      return (
        <>
          <line x1="12" y1="36" x2="38" y2="36" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="12" y1="36" x2="18" y2="24" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="18" y1="24" x2="38" y2="36" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="17" y1="21" x2="17" y2="10" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="31" y1="21" x2="31" y2="10" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="17" y1="10" x2="20" y2="7" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="31" y1="10" x2="28" y2="7" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "ride":
      return (
        <>
          {cymbalBase()}
          <ellipse cx="24" cy="16" rx="4.6" ry="2.2" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
        </>
      );
    case "crash":
      return (
        <>
          <ellipse cx="24" cy="15" rx="13" ry="4.6" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <path d="M11 15 Q24 9 37 15" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <line x1="24" y1="20" x2="24" y2="40" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "china":
      return (
        <>
          <path d="M10 17 Q24 9 38 17" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <path d="M10 17 Q24 25 38 17" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <line x1="24" y1="21" x2="24" y2="40" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "splash":
      return (
        <>
          <ellipse cx="24" cy="16" rx="9" ry="3.4" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <circle cx="24" cy="16" r="1.8" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <line x1="24" y1="19" x2="24" y2="38" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "rideBell":
      return (
        <>
          <ellipse cx="24" cy="16" rx="10.5" ry="3.8" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <ellipse cx="24" cy="16" rx="4.5" ry="2.8" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <circle cx="24" cy="16" r="1.3" fill={STROKE} />
          <line x1="24" y1="20" x2="24" y2="38" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "bell":
      return (
        <>
          <path d="M17 13 Q24 8 31 13" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <path d="M18 13 L16 23 Q24 29 32 23 L30 13" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <line x1="24" y1="29" x2="24" y2="39" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "stack":
      return (
        <>
          <ellipse cx="24" cy="13" rx="11" ry="3.8" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <ellipse cx="24" cy="17" rx="10" ry="3.4" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <ellipse cx="24" cy="21" rx="9" ry="3.1" fill="none" stroke={STROKE} strokeWidth={STROKE_WIDTH} />
          <line x1="24" y1="24" x2="24" y2="40" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
        </>
      );
    case "genericDrum":
      return (
        <>
          {drumShell(14, 30)}
        </>
      );
    case "genericCymbal":
    default:
      return cymbalBase();
  }
}

export function DrumLegendIcon({
  icon,
  title,
  className,
}: {
  icon: DrumIconId;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      role="img"
      aria-label={title || icon}
      focusable="false"
    >
      {renderDrumIcon(icon)}
    </svg>
  );
}

export function drumIconForLaneCategory(category: "kick" | "drum" | "cymbal"): DrumIconId {
  if (category === "kick") return "kick";
  if (category === "drum") return "genericDrum";
  return "genericCymbal";
}

export function drumIconForNotationLaneId(laneId: string): DrumIconId {
  const id = laneId.toLowerCase();
  if (id === "ki") return "kick";
  if (id === "sn") return "snare";
  if (id === "t1" || id === "t2" || id === "t3") return "tom";
  if (id === "hh") return "hihatClosed";
  if (id === "ri") return "ride";
  if (id === "cr") return "crash";
  return "genericDrum";
}

export function drumIconForPieceId(pieceId: string): DrumIconId {
  const id = pieceId.toLowerCase();
  if (id === "kick") return "kick";
  if (id === "snare" || id === "snare_xstick") return "snare";
  if (id === "tom_hi" || id === "tom_mid" || id === "tom_low" || id === "tom_floor") return "tom";
  if (id === "hh_closed") return "hihatClosed";
  if (id === "hh_open") return "hihatOpen";
  if (id === "hh_pedal") return "hihatPedal";
  if (id === "ride") return "ride";
  if (id === "ride_bell") return "rideBell";
  if (id === "bell") return "bell";
  if (id === "crash_l" || id === "crash_r") return "crash";
  if (id === "china") return "china";
  if (id === "splash") return "splash";
  if (id === "stack") return "stack";
  return "genericDrum";
}
