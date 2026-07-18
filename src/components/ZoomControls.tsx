interface ZoomControlsProps {
  label: string;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  min?: number;
  max?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ZoomControls({ label, zoom, onZoomChange, min = 0.5, max = 8 }: ZoomControlsProps) {
  const setZoom = (next: number) => onZoomChange(Number(clamp(next, min, max).toFixed(2)));
  return (
    <div className="zoomInline" aria-label={label}>
      <span className="zoomLabel">{label}</span>
      <button type="button" className="smallButton" onClick={() => setZoom(zoom / 1.25)}>−</button>
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={zoom}
        onChange={(event) => setZoom(Number(event.target.value))}
      />
      <button type="button" className="smallButton" onClick={() => setZoom(zoom * 1.25)}>+</button>
      <button type="button" className="smallButton" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
    </div>
  );
}
