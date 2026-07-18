import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { resolveAssetUrl } from "../api/backend";
import type { LyricLine } from "../types/music";

interface LyricsWaveformViewProps {
  duration: number;
  currentTime: number;
  selectedStemName: string;
  selectedStemUrl?: string;
  zoom: number;
  playing?: boolean;
  lyrics?: LyricLine[];
  selectedLyricId?: string | null;
  onSeek: (time: number) => void;
  onSelectLyric?: (id: string | null) => void;
  onChangeLyrics: (lyrics: LyricLine[], source?: string) => void;
  lyricsSource?: string;
  headerControl?: ReactNode;
}

interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
  normalizedBy: number;
}

type DragMode = "move" | "start" | "end";
interface DragState {
  id: string;
  mode: DragMode;
  startClientX: number;
  originalT: number;
  originalD: number;
  originalRows: Array<LyricLine & { id: string }>;
  rippleOriginals: Array<LyricLine & { id: string }>;
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

function demoAmplitude(x: number) {
  return (
    Math.sin(x * 0.03) * 0.35 +
    Math.sin(x * 0.013) * 0.25 +
    Math.sin(x * 0.081) * 0.18
  );
}

async function decodePeaks(url: string, peakCount: number): Promise<WaveformPeaks> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  const buffer = await response.arrayBuffer();
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio API is not available");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
      decoded.getChannelData(channel),
    );
    const min = new Float32Array(peakCount);
    const max = new Float32Array(peakCount);
    const absForNormalization: number[] = [];
    const samplesPerPeak = decoded.length / peakCount;

    for (let i = 0; i < peakCount; i += 1) {
      const start = Math.floor(i * samplesPerPeak);
      const end = Math.max(start + 1, Math.min(decoded.length, Math.floor((i + 1) * samplesPerPeak)));
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
      if (i % 8 === 0) absForNormalization.push(Math.max(Math.abs(bucketMin), Math.abs(bucketMax)));
    }

    const normalizedBy = clamp(percentile(absForNormalization, 0.985), 0.04, 1);
    return { min, max, normalizedBy };
  } finally {
    void context.close();
  }
}

function sortedLyrics(lyrics?: LyricLine[]) {
  return [...(lyrics ?? [])].sort((a, b) => Number(a.t || 0) - Number(b.t || 0));
}

function lyricId(line: LyricLine, index: number) {
  return line.id ?? `${line.t}-${index}`;
}

export function LyricsWaveformView({
  duration,
  currentTime,
  selectedStemName,
  selectedStemUrl,
  zoom,
  playing,
  lyrics,
  selectedLyricId,
  onSeek,
  onSelectLyric,
  onChangeLyrics,
  lyricsSource,
  headerControl,
}: LyricsWaveformViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 900 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const contentWidth = Math.max(1400, duration * 96 * zoom);
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const resolvedUrl = useMemo(() => resolveAssetUrl(selectedStemUrl), [selectedStemUrl]);
  const rows = useMemo(() => sortedLyrics(lyrics), [lyrics]);
  const selectedLine = rows.find((line, index) => lyricId(line, index) === selectedLyricId) ?? null;
  // Stable peak cache: zoom only changes drawing scale, not audio decoding.
  const peakCount = useMemo(() => Math.max(8000, Math.min(140000, Math.ceil(duration * 220))), [duration]);

  const timeToPx = (time: number) => (duration > 0 ? (time / duration) * contentWidth : 0);
  const clientXToTime = (clientX: number) => {
    const surface = surfaceRef.current;
    if (!surface || duration <= 0) return 0;
    const rect = surface.getBoundingClientRect();
    return clamp(((clientX - rect.left) / contentWidth) * duration, 0, duration);
  };

  const changeLyricById = (id: string, patch: Partial<LyricLine>) => {
    const next = rows
      .map((item, index) => {
        const stableId = lyricId(item, index);
        if (stableId === id) return { ...item, id: item.id ?? stableId, ...patch };
        return { ...item, id: item.id ?? stableId };
      })
      .sort((a, b) => a.t - b.t);
    onChangeLyrics(next, lyricsSource || "user");
  };

  const applyDragWithRipple = (
    drag: DragState,
    anchorPatch: Partial<LyricLine>,
    rippleDelta: number,
    rippleEnabled: boolean,
  ) => {
    const maxStart = (lineDuration: number) => Math.max(0, duration - Math.max(0.05, lineDuration));
    const patchById = new Map<string, Partial<LyricLine>>();
    patchById.set(drag.id, anchorPatch);

    if (rippleEnabled) {
      drag.rippleOriginals.forEach((line) => {
        patchById.set(line.id, {
          t: Number(clamp(line.t + rippleDelta, 0, maxStart(line.d)).toFixed(3)),
        });
      });
    }

    const next = drag.originalRows
      .map((line) => {
        const patch = patchById.get(line.id);
        if (!patch) return { ...line };
        return { ...line, ...patch };
      })
      .sort((a, b) => a.t - b.t);

    onChangeLyrics(next, lyricsSource || "user");
  };

  const addLyricAt = (time: number) => {
    const id = crypto.randomUUID();
    const next = [...rows, { id, t: Number(time.toFixed(3)), d: 1, w: "" }].sort((a, b) => a.t - b.t);
    onChangeLyrics(next, "user");
    onSelectLyric?.(id);
    onSeek(time);
  };

  const beginDrag = (event: PointerEvent<HTMLElement>, id: string, line: LyricLine, mode: DragMode) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const originalRows = rows.map((item, index) => {
      const stableId = lyricId(item, index);
      return {
        id: stableId,
        t: Number(item.t || 0),
        d: Math.max(0.05, Number(item.d || 0.5)),
        w: item.w || "",
      };
    });
    const anchorIndex = originalRows.findIndex((item) => item.id === id);
    const rippleOriginals = anchorIndex >= 0 ? originalRows.slice(anchorIndex + 1) : [];
    setDragState({
      id,
      mode,
      startClientX: event.clientX,
      originalT: line.t,
      originalD: Math.max(0.05, line.d || 0.5),
      originalRows,
      rippleOriginals,
    });
    onSelectLyric?.(id);
    onSeek(line.t);
  };

  const continueDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragState || !(event.buttons & 1)) return;
    event.stopPropagation();
    const deltaSeconds = duration > 0 ? ((event.clientX - dragState.startClientX) / contentWidth) * duration : 0;
    const originalEnd = dragState.originalT + dragState.originalD;

    if (dragState.mode === "move") {
      const nextTime = Number(clamp(dragState.originalT + deltaSeconds, 0, Math.max(0, duration - 0.05)).toFixed(3));
      const rippleDelta = nextTime - dragState.originalT;
      applyDragWithRipple(dragState, { t: nextTime }, rippleDelta, event.ctrlKey);
      onSeek(nextTime);
      return;
    }

    if (dragState.mode === "start") {
      const nextStart = Number(clamp(dragState.originalT + deltaSeconds, 0, Math.max(0, originalEnd - 0.05)).toFixed(3));
      const nextDuration = Number(Math.max(0.05, originalEnd - nextStart).toFixed(3));
      const rippleDelta = nextStart - dragState.originalT;
      applyDragWithRipple(dragState, { t: nextStart, d: nextDuration }, rippleDelta, event.ctrlKey);
      onSeek(nextStart);
      return;
    }

    const nextEnd = Number(clamp(originalEnd + deltaSeconds, dragState.originalT + 0.05, duration).toFixed(3));
    const nextDuration = Number(Math.max(0.05, nextEnd - dragState.originalT).toFixed(3));
    changeLyricById(dragState.id, { d: nextDuration });
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragState) return;
    event.stopPropagation();
    setDragState(null);
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const updateViewport = () => setViewport({ left: scroller.scrollLeft, width: Math.max(1, scroller.clientWidth) });
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
    const margin = Math.min(320, scroller.clientWidth * 0.35);
    const leftEdge = scroller.scrollLeft + margin;
    const rightEdge = scroller.scrollLeft + scroller.clientWidth - margin;
    if (playheadX < leftEdge || playheadX > rightEdge) {
      scroller.scrollLeft = clamp(playheadX - scroller.clientWidth * 0.45, 0, contentWidth);
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

    if (peaks?.min.length) {
      const points = peaks.min.length;
      const gain = 0.96 / peaks.normalizedBy;
      context.strokeStyle = "#93c5fd";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x < cssWidth; x += 1) {
        const globalX = viewport.left + x;
        const index = clamp(Math.floor((globalX / contentWidth) * points), 0, points - 1);
        const minY = middle - clamp(peaks.max[index] * gain, -1, 1) * middle * 0.92;
        const maxY = middle - clamp(peaks.min[index] * gain, -1, 1) * middle * 0.92;
        context.moveTo(x + 0.5, minY);
        context.lineTo(x + 0.5, maxY);
      }
      context.stroke();
    } else {
      context.strokeStyle = "#64748b";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x < cssWidth; x += 1) {
        const amp = Math.abs(demoAmplitude((viewport.left + x) / Math.max(zoom, 0.1) + selectedStemName.length * 17));
        context.moveTo(x + 0.5, middle - amp * middle);
        context.lineTo(x + 0.5, middle + amp * middle);
      }
      context.stroke();
    }

    if (loadState === "loading") {
      context.fillStyle = "rgba(226, 232, 240, 0.9)";
      context.font = "13px system-ui, sans-serif";
      context.fillText("Loading high-resolution waveform...", 16, 24);
    }
    if (loadState === "error") {
      context.fillStyle = "rgba(251, 191, 36, 0.95)";
      context.font = "13px system-ui, sans-serif";
      context.fillText("Waveform could not be decoded: using synthetic preview", 16, 24);
    }

    const playheadX = duration > 0 ? timeToPx(currentTime) - viewport.left : 0;
    if (playheadX >= -4 && playheadX <= cssWidth + 4) {
      context.strokeStyle = "#f8fafc";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, height);
      context.stroke();
    }
  }, [duration, currentTime, selectedStemName, zoom, contentWidth, peaks, loadState, viewport]);

  return (
    <section className="panel lyricsWaveformPanel">
      <div className="panelHeader withAction">
        <div>
          <h2>Lyrics waveform</h2>
          <span className="miniMeta">{selectedStemName} · double-click to add marker · drag body/start/end handles to sync · Ctrl+drag moves following lyrics</span>
        </div>
        <div className="panelHeaderActions">
          <span className="miniMeta">{loadState === "ready" ? `real audio · ${peaks?.min.length.toLocaleString("en-US") ?? 0} peaks` : loadState === "loading" ? "loading" : "preview"}</span>
          {headerControl}
        </div>
      </div>
      {selectedLine ? (
        <div className="activeLyricBanner">
          <span>Selected lyric</span>
          <strong>{selectedLine.w || "Empty lyric"}</strong>
          <small>{selectedLine.t.toFixed(3)}s · {Math.max(0.05, selectedLine.d || 0.5).toFixed(3)}s</small>
        </div>
      ) : null}
      <div className="horizontalScroller waveformScroller lyricsWaveformScroller" ref={scrollerRef}>
        <div
          className="waveformSurface lyricsWaveformSurface"
          ref={surfaceRef}
          style={{ width: `${contentWidth}px` }}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <canvas
            ref={canvasRef}
            className="waveformCanvas lyricsWaveformCanvas"
            style={{ width: `${viewport.width}px`, transform: `translateX(${viewport.left}px)` }}
            onClick={(event) => onSeek(clientXToTime(event.clientX))}
            onDoubleClick={(event) => addLyricAt(clientXToTime(event.clientX))}
          />
          <div className="lyricsMarkerLane" aria-hidden="true" />
          {rows.map((line, index) => {
            const id = lyricId(line, index);
            const start = Number(line.t || 0);
            const lineDuration = Math.max(0.05, Number(line.d || 0.5));
            const left = timeToPx(start);
            const width = Math.max(16, timeToPx(start + lineDuration) - left);
            const selected = selectedLyricId === id;
            const active = currentTime >= start && currentTime <= start + lineDuration;
            return (
              <button
                key={id}
                type="button"
                className={`lyricMarker ${selected ? "selected" : ""} ${active ? "active" : ""}`}
                style={{ left: `${left}px`, width: `${width}px` }}
                title={`${line.w || "Lyric"} · ${start.toFixed(3)}s · ${lineDuration.toFixed(3)}s`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectLyric?.(id);
                  onSeek(start);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => beginDrag(event, id, line, "move")}
                onPointerMove={continueDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <span
                  className="lyricMarkerHandle start"
                  title="Drag to change start time"
                  onPointerDown={(event) => beginDrag(event, id, line, "start")}
                />
                <span className="lyricMarkerLabel">{line.w || "..."}</span>
                <span
                  className="lyricMarkerHandle end"
                  title="Drag to change duration"
                  onPointerDown={(event) => beginDrag(event, id, line, "end")}
                />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
