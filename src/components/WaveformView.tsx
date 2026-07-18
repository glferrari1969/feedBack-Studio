import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { resolveAssetUrl } from "../api/backend";
import type { BeatGridPoint, SyncPoint, TempoMapPoint } from "../types/music";

interface WaveformViewProps {
  duration: number;
  currentTime: number;
  bpm?: number;
  beatsPerBar?: number;
  beatgrid?: BeatGridPoint[];
  tempoMap?: TempoMapPoint[];
  selectedStemName: string;
  selectedStemUrl?: string;
  zoom: number;
  playing?: boolean;
  syncPoints?: SyncPoint[];
  selectedSyncPointId?: string | null;
  onSeek: (time: number) => void;
  onSelectSyncPoint?: (id: string) => void;
  onChangeSyncPoint?: (point: SyncPoint) => void;
  onAddSyncPointAt?: (time: number) => void;
  headerControl?: ReactNode;
  title?: string;
  addHint?: string;
  syncPointLabel?: (point: SyncPoint) => string;
  syncPointTitle?: (point: SyncPoint) => string;
  timelineSegments?: Array<{ start: number; end: number; label: string }>;
  timelineLaneHeight?: number;
  waveformHeight?: number;
}

interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
  normalizedBy: number;
}

function demoAmplitude(x: number) {
  return (
    Math.sin(x * 0.03) * 0.35 +
    Math.sin(x * 0.013) * 0.25 +
    Math.sin(x * 0.081) * 0.18
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function percentile(values: number[], p: number) {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor(sorted.length * p), 0, sorted.length - 1);
  return sorted[index] || 1;
}

async function decodePeaks(
  url: string,
  peakCount: number,
): Promise<WaveformPeaks> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  const buffer = await response.arrayBuffer();
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio API is not available");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, channel) => decoded.getChannelData(channel),
    );
    const min = new Float32Array(peakCount);
    const max = new Float32Array(peakCount);
    const absForNormalization: number[] = [];
    const samplesPerPeak = decoded.length / peakCount;

    for (let i = 0; i < peakCount; i += 1) {
      const start = Math.floor(i * samplesPerPeak);
      const end = Math.max(
        start + 1,
        Math.min(decoded.length, Math.floor((i + 1) * samplesPerPeak)),
      );
      let bucketMin = 1;
      let bucketMax = -1;

      for (const channelData of channels) {
        for (let j = start; j < end; j += 1) {
          const value = channelData[j];
          if (value < bucketMin) bucketMin = value;
          if (value > bucketMax) bucketMax = value;
        }
      }

      if (bucketMin === 1 && bucketMax === -1) {
        bucketMin = 0;
        bucketMax = 0;
      }

      min[i] = bucketMin;
      max[i] = bucketMax;
      if (i % 8 === 0)
        absForNormalization.push(
          Math.max(Math.abs(bucketMin), Math.abs(bucketMax)),
        );
    }

    const normalizedBy = clamp(percentile(absForNormalization, 0.985), 0.04, 1);
    return { min, max, normalizedBy };
  } finally {
    void context.close();
  }
}

export function WaveformView({
  duration,
  currentTime,
  bpm = 120,
  beatsPerBar = 4,
  beatgrid = [],
  tempoMap = [],
  selectedStemName,
  selectedStemUrl,
  zoom,
  playing,
  syncPoints = [],
  selectedSyncPointId,
  onSeek,
  onSelectSyncPoint,
  onChangeSyncPoint,
  onAddSyncPointAt,
  headerControl,
  title,
  addHint = "Double-click: add sync point",
  syncPointLabel,
  syncPointTitle,
  timelineSegments = [],
  timelineLaneHeight = 0,
  waveformHeight = 190,
}: WaveformViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 900 });
  const contentWidth = Math.max(1200, duration * 76 * zoom);
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const [loadState, setLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const resolvedUrl = useMemo(
    () => resolveAssetUrl(selectedStemUrl),
    [selectedStemUrl],
  );
  // Decode the audio once per source at a stable resolution.
  // Do not tie peak generation to zoom: re-decoding the whole audio file on
  // every zoom change made project loading and zooming very slow. Rendering
  // still uses the current zoom, but the peak cache stays reusable.
  const peakCount = useMemo(
    () => Math.max(8000, Math.min(140000, Math.ceil(duration * 220))),
    [duration],
  );

  const variableTempoGrid = useMemo(() => {
    const preferred = beatgrid.length > 1 ? beatgrid : tempoMap.length > 1 ? tempoMap : [];
    if (!preferred.length) return [] as Array<{ time: number; bar: number; beat: number }>;

    const safeBeatsPerBar =
      Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? Math.round(beatsPerBar) : 4;
    const cleaned = preferred
      .map((point) => {
        const rawTime = Number(point.time);
        if (!Number.isFinite(rawTime)) return null;

        const rawBeat = Number((point as { beat?: number }).beat);
        const rawBeatIndex = Number((point as { beatIndex?: number }).beatIndex);
        const beatIndex = Number.isFinite(rawBeatIndex) && rawBeatIndex > 0 ? Math.round(rawBeatIndex) : 1;
        const beat =
          Number.isFinite(rawBeat) && rawBeat > 0
            ? Math.round(rawBeat)
            : ((beatIndex - 1) % safeBeatsPerBar) + 1;

        const rawBar = Number((point as { bar?: number }).bar);
        const bar =
          Number.isFinite(rawBar) && rawBar > 0
            ? Math.round(rawBar)
            : Math.floor((beatIndex - 1) / safeBeatsPerBar) + 1;

        return {
          time: Math.max(0, rawTime),
          beat,
          bar,
        };
      })
      .filter((point): point is { time: number; beat: number; bar: number } => Boolean(point))
      .filter((point) => point.time <= duration + 0.5)
      .sort((a, b) => a.time - b.time);

    return cleaned;
  }, [beatgrid, tempoMap, duration, beatsPerBar]);

  const timeToPx = (time: number) =>
    duration > 0 ? (time / duration) * contentWidth : 0;
  const clientXToTime = (clientX: number) => {
    const surface = surfaceRef.current;
    if (!surface || duration <= 0) return 0;
    const rect = surface.getBoundingClientRect();
    return clamp(
      ((clientX - rect.left) / contentWidth) * duration,
      0,
      duration,
    );
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const updateViewport = () => {
      setViewport({
        left: scroller.scrollLeft,
        width: Math.max(1, scroller.clientWidth),
      });
    };

    updateViewport();
    scroller.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", updateViewport);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    if (!resolvedUrl) {
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    decodePeaks(resolvedUrl, peakCount)
      .then((nextPeaks) => {
        if (cancelled) return;
        setPeaks(nextPeaks);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedUrl, peakCount]);

  useEffect(() => {
    if (!playing) return;
    const scroller = scrollerRef.current;
    if (!scroller || duration <= 0) return;
    const playheadX = timeToPx(currentTime);
    const margin = Math.min(280, scroller.clientWidth * 0.35);
    const leftEdge = scroller.scrollLeft + margin;
    const rightEdge = scroller.scrollLeft + scroller.clientWidth - margin;
    if (playheadX < leftEdge || playheadX > rightEdge) {
      scroller.scrollLeft = clamp(
        playheadX - scroller.clientWidth * 0.45,
        0,
        contentWidth,
      );
    }
  }, [currentTime, contentWidth, duration, playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, Math.floor(viewport.width));
    const rect = canvas.getBoundingClientRect();
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = cssWidth * dpr;
    canvas.height = height * dpr;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, height);
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, cssWidth, height);

    const middle = height / 2;
    context.strokeStyle = "rgba(148, 163, 184, 0.22)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, middle);
    context.lineTo(cssWidth, middle);
    context.stroke();

    const visibleStart = viewport.left;
    const visibleEnd = viewport.left + cssWidth;
    const visibleStartSeconds = (visibleStart / contentWidth) * duration;
    const visibleEndSeconds = (visibleEnd / contentWidth) * duration;
    if (variableTempoGrid.length > 1 && duration > 0) {
      // Variable-tempo grid from imported beat markers (beatgrid/tempoMap).
      const lower = visibleStartSeconds - 0.001;
      const upper = visibleEndSeconds + 0.001;

      let lo = 0;
      let hi = variableTempoGrid.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (variableTempoGrid[mid].time < lower) lo = mid + 1;
        else hi = mid;
      }

      let lastBeatX = -Infinity;
      let lastBarX = -Infinity;
      const minBeatSpacingPx = 8;
      const minBarSpacingPx = 14;
      context.lineWidth = 1;

      for (let i = lo; i < variableTempoGrid.length; i += 1) {
        const marker = variableTempoGrid[i];
        if (marker.time > upper) break;

        const x = (marker.time / duration) * contentWidth - visibleStart;
        const isBar = marker.beat === 1;

        if (isBar) {
          if (x - lastBarX >= minBarSpacingPx) {
            context.strokeStyle = "rgba(100, 116, 139, 0.82)";
            context.beginPath();
            context.moveTo(Math.round(x) + 0.5, 0);
            context.lineTo(Math.round(x) + 0.5, height);
            context.stroke();
            lastBarX = x;
            lastBeatX = x;
          }
          continue;
        }

        if (x - lastBeatX < minBeatSpacingPx) continue;
        context.strokeStyle = "rgba(51, 65, 85, 0.55)";
        context.beginPath();
        context.moveTo(Math.round(x) + 0.5, 0);
        context.lineTo(Math.round(x) + 0.5, height);
        context.stroke();
        lastBeatX = x;
      }
    } else {
      const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
      const safeBeatsPerBar =
        Number.isFinite(beatsPerBar) && beatsPerBar > 0
          ? Math.round(beatsPerBar)
          : 4;
      const beatSeconds = 60 / safeBpm;
      const barSeconds = beatSeconds * safeBeatsPerBar;
      const pixelsPerSecond = duration > 0 ? contentWidth / duration : 0;
      const pixelsPerBeat = beatSeconds * pixelsPerSecond;

      // Fallback for sources without beatgrid/tempoMap: use fixed BPM grid.
      let beatStride = 1;
      if (pixelsPerBeat < 8) beatStride = 8;
      else if (pixelsPerBeat < 14) beatStride = 4;
      else if (pixelsPerBeat < 28) beatStride = 2;

      const beatStepSeconds = beatSeconds * beatStride;
      const firstBeatTime =
        Math.ceil(visibleStartSeconds / beatStepSeconds) * beatStepSeconds;
      context.lineWidth = 1;
      for (let t = firstBeatTime; t <= visibleEndSeconds; t += beatStepSeconds) {
        const x = (t / duration) * contentWidth - visibleStart;
        context.strokeStyle = "rgba(51, 65, 85, 0.55)";
        context.beginPath();
        context.moveTo(Math.round(x) + 0.5, 0);
        context.lineTo(Math.round(x) + 0.5, height);
        context.stroke();
      }

      if (barSeconds > 0) {
        const pixelsPerBar = barSeconds * pixelsPerSecond;
        let barStride = 1;
        if (pixelsPerBar < 10) barStride = 2;
        if (pixelsPerBar < 5) barStride = 4;
        const barStepSeconds = barSeconds * barStride;
        const firstBarTime =
          Math.ceil(visibleStartSeconds / barStepSeconds) * barStepSeconds;
        context.strokeStyle = "rgba(100, 116, 139, 0.82)";
        for (let t = firstBarTime; t <= visibleEndSeconds; t += barStepSeconds) {
          const x = (t / duration) * contentWidth - visibleStart;
          context.beginPath();
          context.moveTo(Math.round(x) + 0.5, 0);
          context.lineTo(Math.round(x) + 0.5, height);
          context.stroke();
        }
      }
    }

    if (peaks?.min.length) {
      const points = peaks.min.length;
      const gain = 0.96 / peaks.normalizedBy;
      context.strokeStyle = "#93c5fd";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x < cssWidth; x += 1) {
        const globalX = visibleStart + x;
        const index = clamp(
          Math.floor((globalX / contentWidth) * points),
          0,
          points - 1,
        );
        const minY =
          middle - clamp(peaks.max[index] * gain, -1, 1) * middle * 0.92;
        const maxY =
          middle - clamp(peaks.min[index] * gain, -1, 1) * middle * 0.92;
        context.moveTo(x + 0.5, minY);
        context.lineTo(x + 0.5, maxY);
      }
      context.stroke();

      context.strokeStyle = "rgba(219, 234, 254, 0.55)";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x < cssWidth; x += 2) {
        const globalX = visibleStart + x;
        const index = clamp(
          Math.floor((globalX / contentWidth) * points),
          0,
          points - 1,
        );
        const amp = clamp(
          Math.max(Math.abs(peaks.min[index]), Math.abs(peaks.max[index])) *
            gain *
            0.55,
          0,
          1,
        );
        context.moveTo(x + 0.5, middle - amp * middle * 0.78);
        context.lineTo(x + 0.5, middle + amp * middle * 0.78);
      }
      context.stroke();
    } else {
      context.strokeStyle = "#64748b";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x < cssWidth; x += 1) {
        const amp = Math.abs(
          demoAmplitude(
            (viewport.left + x) / Math.max(zoom, 0.1) +
              selectedStemName.length * 17,
          ),
        );
        context.moveTo(x + 0.5, middle - amp * middle);
        context.lineTo(x + 0.5, middle + amp * middle);
      }
      context.stroke();
    }

    if (loadState === "loading") {
      context.fillStyle = "rgba(226, 232, 240, 0.9)";
      context.font = "13px system-ui, sans-serif";
      context.fillText("Loading waveform...", 16, 24);
    }
    if (loadState === "error") {
      context.fillStyle = "rgba(251, 191, 36, 0.95)";
      context.font = "13px system-ui, sans-serif";
      context.fillText(
        "Waveform preview: audio could not be decoded",
        16,
        24,
      );
    }

    const playheadX = duration > 0 ? timeToPx(currentTime) - visibleStart : 0;
    if (playheadX >= -4 && playheadX <= cssWidth + 4) {
      context.strokeStyle = "#f8fafc";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, height);
      context.stroke();
    }
  }, [
    duration,
    currentTime,
    selectedStemName,
    bpm,
    beatsPerBar,
    variableTempoGrid,
    zoom,
    contentWidth,
    peaks,
    loadState,
    viewport,
    waveformHeight,
    timelineLaneHeight,
  ]);

  const handleSurfaceDoubleClick = (
    event: React.MouseEvent<HTMLCanvasElement>,
  ) => {
    const time = clientXToTime(event.clientX);
    onAddSyncPointAt?.(time);
  };

  return (
    <section className="panel waveform">
      <div className="panelHeader withAction">
        <span>{title ?? `Waveform: ${selectedStemName}`}</span>
        <div className="panelHeaderActions">
          <span className="miniMeta">
            {loadState === "ready"
              ? `real audio · ${peaks?.min.length.toLocaleString("en-US") ?? 0} peak`
              : loadState === "loading"
                ? "loading"
                : "preview"}
          </span>
          <span className="miniMeta">{addHint}</span>
          {headerControl}
        </div>
      </div>
      <div className="horizontalScroller waveformScroller" ref={scrollerRef}>
        <div
          className="waveformSurface"
          ref={surfaceRef}
          style={{ width: `${contentWidth}px`, height: `${waveformHeight + timelineLaneHeight}px` }}
        >
          {timelineSegments.length > 0 ? (
            <div
              className="waveformToneLane"
              style={{ height: `${timelineLaneHeight}px` }}
              aria-label="Tone sync lane"
              onClick={(event) => onSeek(clientXToTime(event.clientX))}
              onDoubleClick={(event) => onAddSyncPointAt?.(clientXToTime(event.clientX))}
            >
              {timelineSegments.map((segment, index) => (
                <div
                  key={`${segment.label}-${segment.start}-${index}`}
                  className="waveformToneSegment"
                  style={{
                    left: `${timeToPx(segment.start)}px`,
                    width: `${Math.max(2, timeToPx(segment.end) - timeToPx(segment.start))}px`,
                  }}
                  title={`${segment.label} · ${segment.start.toFixed(3)}s`}
                >
                  <span>{segment.label}</span>
                </div>
              ))}
            </div>
          ) : null}
          {timelineLaneHeight > 0 ? (
            <div
              className="waveformUnifiedPlayhead"
              style={{ left: `${timeToPx(currentTime)}px`, height: `${waveformHeight + timelineLaneHeight}px` }}
              aria-hidden="true"
            />
          ) : null}
          <canvas
            ref={canvasRef}
            className="waveformCanvas"
            style={{
              width: `${viewport.width}px`,
              transform: `translateX(${viewport.left}px)`,
              top: `${timelineLaneHeight}px`,
              height: `${waveformHeight}px`,
            }}
            onClick={(event) => {
              onSeek(clientXToTime(event.clientX));
            }}
            onDoubleClick={handleSurfaceDoubleClick}
          />
          {syncPoints.map((point) => {
            const left = timeToPx(point.time);
            const selected = point.id === selectedSyncPointId;
            return (
              <button
                key={point.id}
                type="button"
                className={`syncMarker waveformSyncMarker ${selected ? "selected" : ""}`}
                style={{ left: `${left}px`, height: `${waveformHeight + timelineLaneHeight}px` }}
                title={`Sync ${point.bar}.${point.beat} · ${point.time.toFixed(3)}s`}
                {...(syncPointTitle ? { title: syncPointTitle(point) } : {})}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectSyncPoint?.(point.id);
                  onSeek(point.time);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onSelectSyncPoint?.(point.id);
                }}
                onPointerMove={(event) => {
                  if (!(event.buttons & 1)) return;
                  event.stopPropagation();
                  const nextTime = Number(
                    clientXToTime(event.clientX).toFixed(3),
                  );
                  onChangeSyncPoint?.({ ...point, time: nextTime });
                  onSeek(nextTime);
                }}
              >
                <span>
                  {syncPointLabel?.(point) ?? `${point.bar}.${point.beat}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
