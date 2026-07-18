import { useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { ToneBlock, ToneChange } from "../types/music";
import { Pause, Play } from "lucide-react";
import { WaveformView } from "./WaveformView";
import { ZoomControls } from "./ZoomControls";

interface ToneEditorProps {
  tones?: ToneBlock | null;
  duration: number;
  currentTime: number;
  onChange: (tones: ToneBlock | null) => void;
  onSeek: (time: number) => void;
  selectedStemName: string;
  selectedStemUrl?: string;
  waveformZoom: number;
  onWaveformZoomChange: (zoom: number) => void;
  playing: boolean;
  onPlayPause: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeChanges(tones?: ToneBlock | null): ToneChange[] {
  return (Array.isArray(tones?.changes) ? tones!.changes! : [])
    .map((change) => ({ t: Number(change.t), name: String(change.name ?? "").trim() }))
    .filter((change) => Number.isFinite(change.t) && change.t >= 0 && change.name)
    .sort((a, b) => a.t - b.t);
}

function normalizeDefinitions(tones?: ToneBlock | null): Record<string, unknown>[] {
  return Array.isArray(tones?.definitions) ? tones!.definitions! : [];
}

function getToneName(definition: Record<string, unknown>, fallback: string) {
  const name = definition.Name ?? definition.name ?? definition.Key ?? definition.key;
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

function toDisplayTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return `${mins}:${secs.toFixed(2).padStart(5, "0")}`;
}

function sortChanges(changes: ToneChange[]) {
  return [...changes].sort((a, b) => a.t - b.t);
}

interface DragState {
  index: number;
  startClientX: number;
  originalT: number;
}

export function ToneEditor({
  tones,
  duration,
  currentTime,
  onChange,
  onSeek,
  selectedStemName,
  selectedStemUrl,
  waveformZoom,
  onWaveformZoomChange,
  playing,
  onPlayPause,
}: ToneEditorProps) {
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const definitions = useMemo(() => normalizeDefinitions(tones), [tones]);
  const names = useMemo(() => definitions.map((definition, index) => getToneName(definition, `Tone ${index + 1}`)), [definitions]);
  const changes = useMemo(() => normalizeChanges(tones), [tones]);
  const activeBase = tones?.base || names[0] || "";

  const emit = (patch: Partial<ToneBlock>) => {
    const next: ToneBlock = { ...(tones ?? {}), definitions, changes, ...patch };
    if (!next.base && names[0]) next.base = names[0];
    onChange(next);
  };

  const timelineDuration = duration > 0 ? duration : 1;

  const addChangeAt = (time: number) => {
    const name = activeBase || names[0];
    if (!name) return;
    const nextChange = { t: Number(clamp(time, 0, duration).toFixed(3)), name };
    emit({ changes: sortChanges([...changes, nextChange]) });
  };

  const addChange = () => addChangeAt(currentTime);

  const updateChange = (index: number, patch: Partial<ToneChange>, options?: { sort?: boolean }) => {
    if (index < 0 || index >= changes.length) return;
    const shouldSort = options?.sort ?? true;
    const nextChanges = changes
      .map((change, changeIndex) =>
        changeIndex === index
          ? {
              ...change,
              ...patch,
              t: patch.t !== undefined ? Number(clamp(patch.t, 0, duration).toFixed(3)) : change.t,
            }
          : change,
      );
    emit({
      changes: shouldSort ? sortChanges(nextChanges) : nextChanges,
    });
  };

  const finalizeChangeOrder = () => {
    emit({ changes: sortChanges(changes) });
  };

  const clientXToTime = (clientX: number) => {
    const timeline = timelineRef.current;
    if (!timeline || duration <= 0) return 0;
    const rect = timeline.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  const beginDrag = (event: PointerEvent<HTMLElement>, index: number) => {
    if (index < 0 || index >= changes.length) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      index,
      startClientX: event.clientX,
      originalT: changes[index].t,
    });
    onSeek(changes[index].t);
  };

  const continueDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragState || !(event.buttons & 1)) return;
    event.stopPropagation();
    const timeline = timelineRef.current;
    if (!timeline || duration <= 0) return;
    const deltaSeconds = ((event.clientX - dragState.startClientX) / timeline.clientWidth) * duration;
    const nextTime = Number(clamp(dragState.originalT + deltaSeconds, 0, duration).toFixed(3));
    updateChange(dragState.index, { t: nextTime }, { sort: false });
    onSeek(nextTime);
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragState) return;
    event.stopPropagation();
    const timeline = timelineRef.current;
    if (timeline && duration > 0) {
      const deltaSeconds = ((event.clientX - dragState.startClientX) / timeline.clientWidth) * duration;
      const nextTime = Number(clamp(dragState.originalT + deltaSeconds, 0, duration).toFixed(3));
      updateChange(dragState.index, { t: nextTime }, { sort: true });
    } else {
      finalizeChangeOrder();
    }
    setDragState(null);
  };

  const cancelDrag = () => {
    if (!dragState) return;
    finalizeChangeOrder();
    setDragState(null);
  };

  const deleteChange = (index: number) => {
    emit({ changes: changes.filter((_, changeIndex) => changeIndex !== index) });
  };

  const segments = useMemo(() => {
    const events = [...changes];
    if (activeBase && !events.some((change) => Math.abs(change.t) < 0.001)) events.unshift({ t: 0, name: activeBase });
    return events
      .sort((a, b) => a.t - b.t)
      .map((change, index, sorted) => ({ ...change, end: sorted[index + 1]?.t ?? duration }))
      .filter((segment) => segment.end > segment.t);
  }, [activeBase, changes, duration]);

  const waveformPoints = useMemo(
    () => changes.map((change, index) => ({
      id: `tone-change-${index}`,
      time: change.t,
      bar: index + 1,
      beat: 1,
    })),
    [changes],
  );

  const waveformPointIndex = (id: string) => {
    const index = Number(id.replace("tone-change-", ""));
    return Number.isInteger(index) ? index : -1;
  };

  if (!tones && !definitions.length) {
    return (
      <section className="panel toneEditorPanel">
        <div className="panelHeader compactHeader">
          <div>
            <h3>Tone changes</h3>
            <span>No tones imported for this arrangement.</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel toneEditorPanel toneChangesOnlyPanel">
      <div className="panelHeader compactHeader">
        <div>
          <h3>Tone changes</h3>
          <span>Lyrics-sync style editor: drag markers on the timeline, double-click to add a change point.</span>
        </div>
      </div>

      <div className="tonePlaybackBar">
        <button type="button" className="primaryButton" onClick={onPlayPause} disabled={!selectedStemUrl}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="secondaryButton" onClick={() => onSeek(0)}>
          Return to start
        </button>
        <span className="timeReadout">{toDisplayTime(currentTime)} / {toDisplayTime(duration)}</span>
        {!selectedStemUrl ? <span className="miniMeta">No audio source available</span> : null}
      </div>

      <WaveformView
        duration={duration}
        currentTime={currentTime}
        selectedStemName={selectedStemName}
        selectedStemUrl={selectedStemUrl}
        zoom={waveformZoom}
        playing={playing}
        syncPoints={waveformPoints}
        timelineSegments={segments.map((segment) => ({ start: segment.t, end: segment.end, label: segment.name }))}
        timelineLaneHeight={58}
        waveformHeight={220}
        onSeek={onSeek}
        onAddSyncPointAt={addChangeAt}
        onChangeSyncPoint={(point) => {
          const index = waveformPointIndex(point.id);
          if (index >= 0) updateChange(index, { t: point.time });
        }}
        title={`Tone-change waveform · ${selectedStemName}`}
        addHint="Double-click: add tone change"
        syncPointLabel={(point) => changes[waveformPointIndex(point.id)]?.name ?? "Tone"}
        syncPointTitle={(point) => {
          const change = changes[waveformPointIndex(point.id)];
          return change ? `${change.name} @ ${toDisplayTime(point.time)}` : toDisplayTime(point.time);
        }}
        headerControl={
          <ZoomControls
            label="Zoom"
            zoom={waveformZoom}
            onZoomChange={onWaveformZoomChange}
            min={0.5}
            max={16}
          />
        }
      />

      <div className="toneSyncEditor">
        <div className="subHeader splitSubHeader">
          <span>Tone sync lane</span>
          <button className="smallButton" onClick={addChange}>Add at playhead</button>
        </div>
        <div
          className="toneSyncTimeline"
          ref={timelineRef}
          title="Double click to add a tone change. Drag markers to retime tone switches."
          onClick={(event) => onSeek(clientXToTime(event.clientX))}
          onDoubleClick={(event) => addChangeAt(clientXToTime(event.clientX))}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
        >
          {segments.map((segment, index) => {
            const left = timelineDuration > 0 ? (segment.t / timelineDuration) * 100 : 0;
            const width = timelineDuration > 0 ? ((segment.end - segment.t) / timelineDuration) * 100 : 0;
            return (
              <div
                key={`${segment.name}-${segment.t}-${index}`}
                className="toneSyncSegment"
                style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%` }}
                title={`${segment.name} · ${toDisplayTime(segment.t)} - ${toDisplayTime(segment.end)}`}
              >
                <span>{segment.name}</span>
              </div>
            );
          })}

          {changes.map((change, index) => {
            const left = timelineDuration > 0 ? (change.t / timelineDuration) * 100 : 0;
            const nextTime = changes[index + 1]?.t ?? timelineDuration;
            const active = currentTime >= change.t && currentTime < nextTime;
            const dragging = dragState?.index === index;
            return (
              <button
                key={`${change.name}-${change.t}-${index}`}
                type="button"
                className={`toneSyncMarker ${active ? "active" : ""} ${dragging ? "dragging" : ""}`}
                style={{ left: `${left}%` }}
                title={`${change.name} @ ${toDisplayTime(change.t)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSeek(change.t);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => beginDrag(event, index)}
              >
                <span className="toneSyncMarkerLabel">{change.name}</span>
                <span className="toneSyncMarkerTime">{toDisplayTime(change.t)}</span>
              </button>
            );
          })}

          <div
            className="toneSyncPlayhead"
            style={{ left: `${timelineDuration > 0 ? (clamp(currentTime, 0, timelineDuration) / timelineDuration) * 100 : 0}%` }}
            aria-hidden="true"
          />
        </div>
        <p className="hint smallHint paddedHint">Double-click the lane to add a change point. Drag a marker to retime the tone switch. Click a marker to seek.</p>
      </div>

      <div className="toneEditorBody toneEditorBodyCompact">
        <label>
          Base tone
          <select value={activeBase} onChange={(event) => emit({ base: event.target.value })}>
            {names.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      <div className="toneChangeEditor compactToneChangeEditor">
        <div className="subHeader splitSubHeader">
          <span>Tone changes over time</span>
          <button className="smallButton" onClick={addChange}>Add at playhead</button>
        </div>
        <div className="toneChangeTable">
          <span className="syncHead">Time</span>
          <span className="syncHead">Tone</span>
          <span className="syncHead">Actions</span>
          {changes.map((change, index) => (
            <div className="toneChangeRow" key={`${change.name}-${change.t}-${index}`}>
              <input
                type="number"
                step="0.001"
                value={change.t}
                onFocus={() => onSeek(change.t)}
                onChange={(event) => updateChange(index, { t: Number(event.target.value) })}
              />
              <select value={change.name} onChange={(event) => updateChange(index, { name: event.target.value })}>
                {names.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <div className="toneChangeButtons">
                <button className="smallButton" onClick={() => onSeek(change.t)}>Go</button>
                <button className="dangerButton" onClick={() => deleteChange(index)}>X</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
