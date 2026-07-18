import type { CSSProperties } from "react";

type VisualKind = "pedal" | "amp" | "cabinet" | "rack" | "utility";
type VisualFamily = "drive" | "modulation" | "space" | "dynamics" | "filter" | "eq" | "neutral";

interface GearVisualProps {
  gearKey: string;
  label: string;
  type: string;
  slot: string;
  params: Record<string, unknown>;
  compact?: boolean;
  selected?: boolean;
  onParamChange?: (key: string, value: unknown) => void;
}

interface NumericRange {
  min: number;
  max: number;
  step: number;
  unit: string;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function visualKind(gearKey: string, type: string, slot: string): VisualKind {
  const lookup = `${gearKey} ${type} ${slot}`.toLowerCase();
  if (/cab|cabinet|speaker/.test(lookup)) return "cabinet";
  if (/\bamp|amplifier/.test(lookup)) return "amp";
  if (/rack|studioeq|graphic.?eq/.test(lookup)) return "rack";
  if (/utility|gate|split|mixer/.test(lookup)) return "utility";
  return "pedal";
}

function visualFamily(gearKey: string, label: string, type: string): VisualFamily {
  const lookup = `${gearKey} ${label} ${type}`.toLowerCase();
  if (/drive|dist|fuzz|boost|overdrive|shred/.test(lookup)) return "drive";
  if (/chorus|flang|phas|trem|vibr|rotary|modul/.test(lookup)) return "modulation";
  if (/delay|echo|reverb|room|hall|space/.test(lookup)) return "space";
  if (/compress|limit|sustain|gate|dynamics/.test(lookup)) return "dynamics";
  if (/wah|filter|envelope|reson/.test(lookup)) return "filter";
  if (/\beq\b|equal|studioeq/.test(lookup)) return "eq";
  return "neutral";
}

function paramLabel(key: string, gearKey: string) {
  let clean = key;
  if (gearKey && clean.toLowerCase().startsWith(`${gearKey.toLowerCase()}_`)) {
    clean = clean.slice(gearKey.length + 1);
  }
  return clean
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function numericRange(key: string, value: number): NumericRange {
  const name = key.toLowerCase();
  if (name.endsWith("q") || /\bq\b/.test(name)) return { min: 0.1, max: 10, step: 0.1, unit: "" };
  if (name.includes("freq")) {
    return value <= 20
      ? { min: 0.02, max: 20, step: 0.01, unit: "kHz" }
      : { min: 20, max: 20000, step: 1, unit: "Hz" };
  }
  if (/time|delay/.test(name)) return value <= 10
    ? { min: 0, max: 10, step: 0.01, unit: "s" }
    : { min: 0, max: 2000, step: 1, unit: "ms" };
  if (/rate|speed/.test(name) && value <= 20) return { min: 0, max: 20, step: 0.01, unit: "Hz" };
  if (/pitch|semitone/.test(name)) return { min: -24, max: 24, step: 1, unit: "st" };
  if (value < 0 || /threshold|thresh|\bdb\b/.test(name)) return { min: -24, max: 24, step: 0.1, unit: "dB" };
  if (value > 100) return { min: 0, max: Math.max(200, Math.ceil(value / 100) * 100), step: 1, unit: "" };
  return { min: 0, max: 100, step: 1, unit: "" };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatValue(value: number, step: number) {
  if (step >= 1) return String(Math.round(value));
  return value.toFixed(step < 0.1 ? 2 : 1).replace(/\.0+$/, "");
}

function RotaryControl({
  paramKey,
  label,
  value,
  onChange,
}: {
  paramKey: string;
  label: string;
  value: number;
  onChange?: (key: string, value: unknown) => void;
}) {
  const range = numericRange(paramKey, value);
  const safeValue = clamp(value, range.min, range.max);
  const ratio = (safeValue - range.min) / Math.max(0.0001, range.max - range.min);
  const angle = -135 + ratio * 270;
  const style = { "--knob-angle": `${angle}deg` } as CSSProperties;
  return (
    <label className="gearKnobControl" title={`${label}: ${formatValue(value, range.step)}${range.unit ? ` ${range.unit}` : ""}`}>
      <span className="gearKnobScale" aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i />
      </span>
      <span className="gearKnob" style={style} aria-hidden="true"><i /></span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={safeValue}
        onChange={(event) => onChange?.(paramKey, Number(event.target.value))}
        aria-label={label}
      />
      <strong>{label}</strong>
      <output>{formatValue(value, range.step)}{range.unit ? ` ${range.unit}` : ""}</output>
    </label>
  );
}

function SliderControl({
  paramKey,
  label,
  value,
  onChange,
}: {
  paramKey: string;
  label: string;
  value: number;
  onChange?: (key: string, value: unknown) => void;
}) {
  const range = numericRange(paramKey, value);
  const safeValue = clamp(value, range.min, range.max);
  return (
    <label className="gearFaderControl" title={`${label}: ${formatValue(value, range.step)}${range.unit ? ` ${range.unit}` : ""}`}>
      <output>{formatValue(value, range.step)}</output>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={safeValue}
        onChange={(event) => onChange?.(paramKey, Number(event.target.value))}
        aria-label={label}
      />
      <strong>{label}</strong>
    </label>
  );
}

function ToggleControl({
  paramKey,
  label,
  value,
  onChange,
}: {
  paramKey: string;
  label: string;
  value: boolean;
  onChange?: (key: string, value: unknown) => void;
}) {
  return (
    <label className="gearToggleControl">
      <input type="checkbox" checked={value} onChange={(event) => onChange?.(paramKey, event.target.checked)} />
      <span aria-hidden="true"><i /></span>
      <strong>{label}</strong>
    </label>
  );
}

function MiniFace({ kind, params }: { kind: VisualKind; params: Record<string, unknown> }) {
  const numeric = Object.values(params).filter((value) => Number.isFinite(Number(value))).slice(0, 4);
  if (kind === "cabinet") {
    return <span className="gearMiniCabinet" aria-hidden="true"><i /><i /><i /><i /></span>;
  }
  return (
    <span className={`gearMiniFace gearMiniFace-${kind}`} aria-hidden="true">
      <span className="gearMiniLed" />
      <span className="gearMiniControls">
        {(numeric.length ? numeric : [35, 65, 48]).map((value, index) => {
          const angle = -135 + clamp(Number(value), 0, 100) * 2.7;
          return <i key={index} style={{ "--mini-angle": `${angle}deg` } as CSSProperties} />;
        })}
      </span>
      {kind === "pedal" || kind === "utility" ? <span className="gearMiniSwitch" /> : null}
    </span>
  );
}

export function GearVisual({
  gearKey,
  label,
  type,
  slot,
  params,
  compact = false,
  selected = false,
  onParamChange,
}: GearVisualProps) {
  const kind = visualKind(gearKey, type, slot);
  const family = visualFamily(gearKey, label, type);
  const entries = Object.entries(params);
  const numericEntries = entries.filter(([, value]) => typeof value !== "boolean" && value !== "" && Number.isFinite(Number(value)));
  const booleanEntries = entries.filter(([, value]) => typeof value === "boolean");
  const isEq = family === "eq" || (kind === "rack" && numericEntries.length >= 6);
  const enabledEntry = entries.find(([key]) => /enabled|bypass|active|on$/i.test(key));
  const enabled = enabledEntry ? Boolean(enabledEntry[1]) : true;

  if (compact) {
    return (
      <span className={`gearVisualCompact gearVisual-${kind} gearFamily-${family} ${selected ? "selected" : ""}`}>
        <MiniFace kind={kind} params={params} />
      </span>
    );
  }

  return (
    <div className={`gearVisual gearVisual-${kind} gearFamily-${family}`}>
      <div className="gearVisualTopLine">
        <span className={`gearPowerLed ${enabled ? "on" : ""}`} title={enabled ? "Active" : "Bypassed"} />
        <span className="gearVisualBrand">feedBack Studio</span>
        <span className="gearVisualKind">{kind}</span>
      </div>
      <div className="gearVisualTitle">
        <strong>{label}</strong>
        <small>{gearKey || type || slot}</small>
      </div>

      {kind === "cabinet" ? (
        <div className="gearCabinetArt" aria-label="Generic speaker cabinet">
          <span /><span /><span /><span />
          <div className="gearCabinetBadge">S</div>
        </div>
      ) : (
        <div className={`gearControlDeck ${isEq ? "eqDeck" : ""}`}>
          {numericEntries.map(([key, rawValue]) => {
            const value = Number(rawValue);
            const labelText = paramLabel(key, gearKey);
            return isEq && !/freq|q$/i.test(key)
              ? <SliderControl key={key} paramKey={key} label={labelText} value={value} onChange={onParamChange} />
              : <RotaryControl key={key} paramKey={key} label={labelText} value={value} onChange={onParamChange} />;
          })}
          {booleanEntries.map(([key, value]) => (
            <ToggleControl key={key} paramKey={key} label={paramLabel(key, gearKey)} value={Boolean(value)} onChange={onParamChange} />
          ))}
          {!entries.length ? <span className="gearNoControls">No adjustable controls</span> : null}
        </div>
      )}

      {(kind === "pedal" || kind === "utility") && (
        <div className="gearFootswitchRow" aria-hidden="true">
          <span className="gearFootswitch"><i /></span>
          <small>ACTIVE</small>
        </div>
      )}
      {kind === "amp" && <div className="gearAmpGrille" aria-hidden="true"><span>feedBack AMP</span></div>}
      {kind === "rack" && <><span className="rackScrew left" /><span className="rackScrew right" /></>}
    </div>
  );
}
