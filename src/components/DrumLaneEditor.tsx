import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { MidiNote } from "../types/music";
import {
  DrumLegendIcon,
  drumIconForLaneCategory,
  drumIconForPieceId,
} from "./DrumLegendIcons";

interface DrumLaneEditorProps {
  notes: MidiNote[];
  selectedTrackId: string;
  duration: number;
  currentTime: number;
  zoom: number;
  bpm: number;
  beatsPerBar: number;
  onChangeNote: (note: MidiNote) => void;
  onSelectNote: (noteId: string) => void;
  onAddNotes: (notes: MidiNote[]) => void;
  onDeleteNote: (noteId: string) => void;
  onSeek: (time: number) => void;
  headerControl?: ReactNode;
}

type DrumLane = {
  id: string;
  label: string;
  fullName: string;
  category: "kick" | "drum" | "cymbal";
  symbol: string;
  pitches: number[];
  pieceIds: string[];
  pieceNames: string[];
};

type DrumLanePresetId = "rb4" | "phase_shift_8" | "ekit_full";

type DrumPieceDef = {
  id: string;
  fullName: string;
  category: "kick" | "drum" | "cymbal";
  symbol: string;
  pitches: number[];
};

type DrumLaneDef = {
  id: string;
  label: string;
  fullName: string;
  pieceIds: string[];
  symbol?: string;
  category?: "kick" | "drum" | "cymbal";
};

const DRUM_PIECES: DrumPieceDef[] = [
  { id: "kick", fullName: "Kick", category: "kick", symbol: "K", pitches: [35, 36] },
  { id: "snare", fullName: "Snare", category: "drum", symbol: "o", pitches: [38, 40] },
  { id: "snare_xstick", fullName: "Snare Cross-stick", category: "drum", symbol: "x", pitches: [37] },
  { id: "tom_hi", fullName: "Tom High", category: "drum", symbol: "o", pitches: [50, 48] },
  { id: "tom_mid", fullName: "Tom Mid", category: "drum", symbol: "o", pitches: [47, 45] },
  { id: "tom_low", fullName: "Tom Low", category: "drum", symbol: "o", pitches: [43] },
  { id: "tom_floor", fullName: "Tom Floor", category: "drum", symbol: "o", pitches: [41] },
  { id: "hh_closed", fullName: "Hi-Hat Closed", category: "cymbal", symbol: "x", pitches: [42] },
  { id: "hh_open", fullName: "Hi-Hat Open", category: "cymbal", symbol: "X", pitches: [46] },
  { id: "hh_pedal", fullName: "Hi-Hat Pedal", category: "cymbal", symbol: "x", pitches: [44] },
  { id: "stack", fullName: "Stack Cymbal", category: "cymbal", symbol: "*", pitches: [30] },
  { id: "crash_l", fullName: "Crash Left", category: "cymbal", symbol: "X", pitches: [49] },
  { id: "crash_r", fullName: "Crash Right", category: "cymbal", symbol: "X", pitches: [57] },
  { id: "splash", fullName: "Splash", category: "cymbal", symbol: "s", pitches: [55] },
  { id: "china", fullName: "China", category: "cymbal", symbol: "C", pitches: [52] },
  { id: "ride", fullName: "Ride", category: "cymbal", symbol: "O", pitches: [51, 59] },
  { id: "ride_bell", fullName: "Ride Bell", category: "cymbal", symbol: "B", pitches: [53] },
  { id: "bell", fullName: "Bell Cymbal", category: "cymbal", symbol: "b", pitches: [80] },
];

const DRUM_PIECE_BY_ID = new Map(DRUM_PIECES.map((piece) => [piece.id, piece]));

const DRUM_LANE_PRESETS: Array<{ id: DrumLanePresetId; label: string; lanes: DrumLaneDef[] }> = [
  {
    id: "rb4",
    label: "RB4",
    lanes: [
      { id: "rb4_kick", label: "Ki", fullName: "Kick", pieceIds: ["kick"], category: "kick", symbol: "K" },
      { id: "rb4_snare", label: "Sn", fullName: "Snare", pieceIds: ["snare", "snare_xstick"], category: "drum", symbol: "o" },
      { id: "rb4_hihat", label: "HH", fullName: "Hi-Hat", pieceIds: ["hh_closed", "hh_open", "hh_pedal"], category: "cymbal", symbol: "x" },
      { id: "rb4_tom", label: "T", fullName: "Toms (High/Mid)", pieceIds: ["tom_hi", "tom_mid"], category: "drum", symbol: "o" },
      { id: "rb4_floor", label: "FT", fullName: "Floor Toms", pieceIds: ["tom_low", "tom_floor"], category: "drum", symbol: "o" },
      { id: "rb4_crash", label: "Cr", fullName: "Crash / Stack / China", pieceIds: ["crash_l", "crash_r", "splash", "china", "stack"], category: "cymbal", symbol: "X" },
      { id: "rb4_ride", label: "Ri", fullName: "Ride / Bells", pieceIds: ["ride", "ride_bell", "bell"], category: "cymbal", symbol: "O" },
    ],
  },
  {
    id: "phase_shift_8",
    label: "Phase Shift 8",
    lanes: [
      { id: "ps8_hh", label: "HH", fullName: "Hi-Hat", pieceIds: ["hh_closed", "hh_open", "hh_pedal"], category: "cymbal", symbol: "x" },
      { id: "ps8_sn", label: "Sn", fullName: "Snare", pieceIds: ["snare", "snare_xstick"], category: "drum", symbol: "o" },
      { id: "ps8_t1", label: "T1", fullName: "Tom High", pieceIds: ["tom_hi"], category: "drum", symbol: "o" },
      { id: "ps8_t2", label: "T2", fullName: "Tom Mid", pieceIds: ["tom_mid"], category: "drum", symbol: "o" },
      { id: "ps8_t3", label: "T3", fullName: "Tom Low / Floor", pieceIds: ["tom_low", "tom_floor"], category: "drum", symbol: "o" },
      { id: "ps8_cr", label: "Cr", fullName: "Crash / Stack / China", pieceIds: ["crash_l", "crash_r", "splash", "china", "stack"], category: "cymbal", symbol: "X" },
      { id: "ps8_ri", label: "Ri", fullName: "Ride / Bells", pieceIds: ["ride", "ride_bell", "bell"], category: "cymbal", symbol: "O" },
      { id: "ps8_ki", label: "Ki", fullName: "Kick", pieceIds: ["kick"], category: "kick", symbol: "K" },
    ],
  },
  {
    id: "ekit_full",
    label: "E-kit Full",
    lanes: [
      { id: "hh_pedal", label: "HH-p", fullName: "Hi-Hat Pedal", pieceIds: ["hh_pedal"] },
      { id: "hh_closed", label: "HH-c", fullName: "Hi-Hat Closed", pieceIds: ["hh_closed"] },
      { id: "hh_open", label: "HH-o", fullName: "Hi-Hat Open", pieceIds: ["hh_open"] },
      { id: "snare_xstick", label: "Sn-x", fullName: "Snare Cross-stick", pieceIds: ["snare_xstick"] },
      { id: "snare", label: "Sn", fullName: "Snare", pieceIds: ["snare"] },
      { id: "tom_hi", label: "T1", fullName: "Tom High", pieceIds: ["tom_hi"] },
      { id: "tom_mid", label: "T2", fullName: "Tom Mid", pieceIds: ["tom_mid"] },
      { id: "tom_low", label: "T3", fullName: "Tom Low", pieceIds: ["tom_low"] },
      { id: "tom_floor", label: "FT", fullName: "Tom Floor", pieceIds: ["tom_floor"] },
      { id: "stack", label: "Stk", fullName: "Stack Cymbal", pieceIds: ["stack"] },
      { id: "crash_l", label: "Cr-L", fullName: "Crash Left", pieceIds: ["crash_l"] },
      { id: "splash", label: "Sp", fullName: "Splash", pieceIds: ["splash"] },
      { id: "china", label: "Ch", fullName: "China", pieceIds: ["china"] },
      { id: "ride", label: "Ri", fullName: "Ride", pieceIds: ["ride"] },
      { id: "ride_bell", label: "Ri-B", fullName: "Ride Bell", pieceIds: ["ride_bell"] },
      { id: "bell", label: "Bl", fullName: "Bell Cymbal", pieceIds: ["bell"] },
      { id: "crash_r", label: "Cr-R", fullName: "Crash Right", pieceIds: ["crash_r"] },
      { id: "kick", label: "Ki", fullName: "Kick", pieceIds: ["kick"] },
    ],
  },
];

function laneFromDef(def: DrumLaneDef): DrumLane {
  const pieces = def.pieceIds
    .map((pieceId) => DRUM_PIECE_BY_ID.get(pieceId))
    .filter((piece): piece is DrumPieceDef => Boolean(piece));
  const pitches = Array.from(new Set(pieces.flatMap((piece) => piece.pitches)));
  const category =
    def.category ??
    (pieces.some((piece) => piece.category === "kick")
      ? "kick"
      : pieces.every((piece) => piece.category === "cymbal")
        ? "cymbal"
        : "drum");
  const symbol = def.symbol ?? pieces[0]?.symbol ?? "o";
  return {
    id: def.id,
    label: def.label,
    fullName: def.fullName,
    category,
    symbol,
    pitches,
    pieceIds: def.pieceIds,
    pieceNames: pieces.map((piece) => piece.fullName),
  };
}

const STEP_DIVISIONS = [8, 16, 32] as const;
type StepDivision = (typeof STEP_DIVISIONS)[number];

function laneIndexForPitch(pitch: number, lanes: DrumLane[]): number {
  const directIndex = lanes.findIndex((lane) => lane.pitches.includes(pitch));
  if (directIndex >= 0) return directIndex;

  let fallbackIndex = lanes.length - 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  lanes.forEach((lane, index) => {
    const reference = lane.pitches[0] ?? 36;
    const distance = Math.abs(reference - pitch);
    if (distance < bestDistance) {
      bestDistance = distance;
      fallbackIndex = index;
    }
  });
  return fallbackIndex;
}

function buildBeatTimes(duration: number, bpm: number): number[] {
  const safeDuration = Math.max(0.1, duration || 0.1);
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const beatLength = 60 / safeBpm;
  if (beatLength <= 0) return [];

  const beatCount = Math.min(4000, Math.ceil(safeDuration / beatLength) + 1);
  const times: number[] = [];
  for (let i = 0; i < beatCount; i += 1) {
    times.push(i * beatLength);
  }
  return times;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function quantizeTime(time: number, stepSeconds: number, duration: number): number {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return clamp(time, 0, duration);
  const snapped = Math.round(time / stepSeconds) * stepSeconds;
  return clamp(snapped, 0, duration);
}

export function DrumLaneEditor({
  notes,
  selectedTrackId,
  duration,
  currentTime,
  zoom,
  bpm,
  beatsPerBar,
  onChangeNote,
  onSelectNote,
  onAddNotes,
  onDeleteNote,
  onSeek,
  headerControl,
}: DrumLaneEditorProps) {
  const [editMode, setEditMode] = useState<"lanes" | "step">("lanes");
  const [lanePresetId, setLanePresetId] = useState<DrumLanePresetId>("ekit_full");
  const [stepDivision, setStepDivision] = useState<StepDivision>(16);
  const [stepSelection, setStepSelection] = useState<{ start: number; end: number } | null>(null);
  const [stepSelectionAnchor, setStepSelectionAnchor] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    original: MidiNote;
    anchorLaneIndex: number;
    chordOriginals: MidiNote[];
    rippleOriginals: MidiNote[];
  } | null>(null);
  const stepDragRef = useRef<{
    startX: number;
    selectionStart: number;
    selectionEnd: number;
    movedOriginals: MidiNote[];
    rippleOriginals: MidiNote[];
    lastDeltaSteps: number;
    lastRippleMode: boolean;
  } | null>(null);
  const suppressStepClickRef = useRef(false);

  const visibleNotes = useMemo(
    () =>
      notes
        .filter((note) => note.trackId === selectedTrackId)
        .sort((a, b) => a.start - b.start),
    [notes, selectedTrackId],
  );

  const activePreset = useMemo(
    () => DRUM_LANE_PRESETS.find((preset) => preset.id === lanePresetId) ?? DRUM_LANE_PRESETS[2],
    [lanePresetId],
  );

  const activeLanes = useMemo(
    () => activePreset.lanes.map(laneFromDef),
    [activePreset],
  );

  const safeDuration = Math.max(0.1, duration || 0.1);
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const beatSeconds = 60 / safeBpm;
  const stepSeconds = beatSeconds * (4 / stepDivision);
  const stepsPerBeat = Math.max(1, Math.round(stepDivision / 4));
  const stepsPerBar = Math.max(1, stepsPerBeat * Math.max(1, Math.round(beatsPerBar || 4)));
  const contentWidth = Math.max(820, safeDuration * 42 * zoom);
  const laneHeight = 100 / Math.max(1, activeLanes.length);
  const timeToPx = (time: number) => (Math.max(0, time) / safeDuration) * contentWidth;
  const beatTimes = buildBeatTimes(safeDuration, bpm);
  const barLengthBeats = Math.max(1, Math.round(beatsPerBar || 4));

  const stepCount = Math.min(5000, Math.ceil(safeDuration / stepSeconds) + 1);
  const stepWidthPx = Math.max(1, timeToPx(stepSeconds));
  const stepTimes = useMemo(() => {
    const times: number[] = [];
    for (let index = 0; index < stepCount; index += 1) {
      times.push(index * stepSeconds);
    }
    return times;
  }, [stepCount, stepSeconds]);

  const normalizeSelection = (start: number, end: number) => ({
    start: clamp(Math.min(start, end), 0, stepCount - 1),
    end: clamp(Math.max(start, end), 0, stepCount - 1),
  });

  const noteToStepIndex = (startTime: number) =>
    clamp(Math.round(startTime / stepSeconds), 0, stepCount - 1);

  const stepHitMap = useMemo(() => {
    const map = new Map<string, MidiNote>();
    visibleNotes.forEach((note) => {
      const laneIndex = laneIndexForPitch(note.pitch, activeLanes);
      const stepIndex = noteToStepIndex(note.start);
      const key = `${laneIndex}:${stepIndex}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, note);
        return;
      }
      const stepTime = stepIndex * stepSeconds;
      const existingDelta = Math.abs(existing.start - stepTime);
      const candidateDelta = Math.abs(note.start - stepTime);
      if (candidateDelta < existingDelta) map.set(key, note);
    });
    return map;
  }, [activeLanes, noteToStepIndex, stepCount, stepSeconds, visibleNotes]);

  const stepSelectionRange =
    stepSelection && editMode === "step"
      ? normalizeSelection(stepSelection.start, stepSelection.end)
      : null;
  const selectedNote = visibleNotes.find((note) => note.selected) ?? null;

  const clientXToTime = (clientX: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = clamp(clientX - rect.left, 0, rect.width);
    return clamp((x / contentWidth) * safeDuration, 0, safeDuration);
  };

  const addDrumHitAt = (laneIndex: number, time: number, velocity = 100) => {
    const lane = activeLanes[laneIndex] ?? activeLanes[activeLanes.length - 1];
    const pitch = lane.pitches[0] ?? 36;
    const snappedStart = quantizeTime(time, stepSeconds, safeDuration);
    const durationSeconds = clamp(stepSeconds * 0.85, 0.03, 0.22);
    onAddNotes([
      {
        id: crypto.randomUUID(),
        trackId: selectedTrackId,
        pitch,
        start: Number(snappedStart.toFixed(4)),
        duration: Number(durationSeconds.toFixed(4)),
        velocity: clamp(Math.round(velocity), 1, 127),
        string: 1,
        fret: clamp(pitch - 36, 0, 24),
        techniques: {},
      },
    ]);
  };

  const toggleStepHit = (laneIndex: number, stepIndex: number) => {
    const key = `${laneIndex}:${stepIndex}`;
    const existing = stepHitMap.get(key);
    if (existing) {
      onSelectNote(existing.id);
      onSeek(existing.start);
      onDeleteNote(existing.id);
      return;
    }
    const velocity = visibleNotes.find((note) => laneIndexForPitch(note.pitch, activeLanes) === laneIndex)?.velocity ?? 100;
    const hitTime = stepIndex * stepSeconds;
    onSeek(hitTime);
    addDrumHitAt(laneIndex, hitTime, velocity);
  };

  const quantizeAllHits = () => {
    if (!visibleNotes.length) return;
    visibleNotes.forEach((note) => {
      const snappedStart = quantizeTime(note.start, stepSeconds, safeDuration);
      const snappedDuration = clamp(note.duration || stepSeconds * 0.85, 0.03, Math.max(0.03, stepSeconds));
      const nextNote = {
        ...note,
        start: Number(snappedStart.toFixed(4)),
        duration: Number(snappedDuration.toFixed(4)),
      };
      if (Math.abs(nextNote.start - note.start) > 0.0001 || Math.abs(nextNote.duration - note.duration) > 0.0001) {
        onChangeNote(nextNote);
      }
    });
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || editMode !== "lanes") return;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;

      const dx = event.clientX - drag.startX;
      const xDeltaSeconds = (dx / contentWidth) * safeDuration;

      const rowHeight = rect.height / Math.max(1, activeLanes.length);
      const rowIndex = clamp(
        Math.floor((event.clientY - rect.top) / rowHeight),
        0,
        activeLanes.length - 1,
      );
      const laneDelta = rowIndex - drag.anchorLaneIndex;
      const isRippleMode = event.ctrlKey;

      const anchorRawStart = drag.original.start + xDeltaSeconds;
      const anchorSnappedStart = quantizeTime(anchorRawStart, stepSeconds, safeDuration);
      const anchorClampedStart = clamp(
        anchorSnappedStart,
        0,
        Math.max(0, safeDuration - drag.original.duration),
      );
      const rippleDelta = anchorClampedStart - drag.original.start;

      drag.chordOriginals.forEach((originalNote) => {
        const originalLaneIndex = laneIndexForPitch(originalNote.pitch, activeLanes);
        const targetLaneIndex = clamp(originalLaneIndex + laneDelta, 0, activeLanes.length - 1);
        const targetLane = activeLanes[targetLaneIndex];
        const sourceLane = activeLanes[originalLaneIndex];
        const sourcePitchIndex = sourceLane?.pitches.indexOf(originalNote.pitch) ?? -1;
        const normalizedPitchIndex = sourcePitchIndex >= 0 ? sourcePitchIndex : 0;
        const nextPitch = targetLane.pitches[Math.min(normalizedPitchIndex, targetLane.pitches.length - 1)] ?? targetLane.pitches[0] ?? originalNote.pitch;

        const rawStart = originalNote.start + xDeltaSeconds;
        const snappedStart = quantizeTime(rawStart, stepSeconds, safeDuration);
        onChangeNote({
          ...originalNote,
          start: clamp(snappedStart, 0, Math.max(0, safeDuration - originalNote.duration)),
          duration: originalNote.duration,
          pitch: nextPitch,
          fret: clamp(nextPitch - 36, 0, 24),
        });
      });

      drag.rippleOriginals.forEach((originalNote) => {
        const targetStart = isRippleMode ? originalNote.start + rippleDelta : originalNote.start;
        onChangeNote({
          ...originalNote,
          start: clamp(targetStart, 0, Math.max(0, safeDuration - originalNote.duration)),
          duration: originalNote.duration,
        });
      });
    };

    const handleUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [activeLanes, contentWidth, editMode, onChangeNote, safeDuration, stepSeconds]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = stepDragRef.current;
      if (!drag || editMode !== "step") return;

      const dx = event.clientX - drag.startX;
      const rawDeltaSteps = Math.round(dx / stepWidthPx);
      const minDelta = -drag.selectionStart;
      const maxDelta = (stepCount - 1) - drag.selectionEnd;
      const deltaSteps = clamp(rawDeltaSteps, minDelta, maxDelta);
      const rippleMode = event.ctrlKey;
      if (deltaSteps === drag.lastDeltaSteps && rippleMode === drag.lastRippleMode) {
        return;
      }

      drag.lastDeltaSteps = deltaSteps;
      drag.lastRippleMode = rippleMode;
      if (deltaSteps !== 0) suppressStepClickRef.current = true;

      setStepSelection({
        start: drag.selectionStart + deltaSteps,
        end: drag.selectionEnd + deltaSteps,
      });
      setStepSelectionAnchor(drag.selectionStart + deltaSteps);

      drag.movedOriginals.forEach((originalNote) => {
        const originalStep = noteToStepIndex(originalNote.start);
        const targetStep = clamp(originalStep + deltaSteps, 0, stepCount - 1);
        const targetStart = Number((targetStep * stepSeconds).toFixed(4));
        onChangeNote({
          ...originalNote,
          start: targetStart,
          duration: Number(clamp(originalNote.duration || stepSeconds * 0.85, 0.03, Math.max(0.03, stepSeconds)).toFixed(4)),
        });
      });

      drag.rippleOriginals.forEach((originalNote) => {
        const originalStep = noteToStepIndex(originalNote.start);
        const targetStep = rippleMode
          ? clamp(originalStep + deltaSteps, 0, stepCount - 1)
          : originalStep;
        const targetStart = Number((targetStep * stepSeconds).toFixed(4));
        onChangeNote({
          ...originalNote,
          start: targetStart,
          duration: Number(clamp(originalNote.duration || stepSeconds * 0.85, 0.03, Math.max(0.03, stepSeconds)).toFixed(4)),
        });
      });
    };

    const handleUp = () => {
      stepDragRef.current = null;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [editMode, noteToStepIndex, onChangeNote, stepCount, stepSeconds, stepWidthPx]);

  useEffect(() => {
    if (!visibleNotes.length) return;
    if (dragRef.current || stepDragRef.current) return;
    const tolerance = Math.max(0.03, stepSeconds * 0.5);
    let nearest: MidiNote | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const note of visibleNotes) {
      const delta = Math.abs(note.start - currentTime);
      if (delta < bestDelta) {
        bestDelta = delta;
        nearest = note;
      }
    }
    const nearestId = nearest?.id;
    if (!nearestId || bestDelta > tolerance || nearestId === selectedNote?.id) return;
    onSelectNote(nearestId);
  }, [currentTime, onSelectNote, selectedNote?.id, stepSeconds, visibleNotes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedNote) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isInputField =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        Boolean(target?.isContentEditable);
      if (isInputField) return;
      event.preventDefault();
      onDeleteNote(selectedNote.id);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDeleteNote, selectedNote]);

  return (
    <section className="panel drumLaneEditor">
      <div className="panelHeader withAction">
        <span>Drum lane editor</span>
        <div className="panelHeaderActions">{headerControl}</div>
      </div>
      <div className="drumEditorControls">
        <label className="drumModeSwitch">
          Mode
          <select value={editMode} onChange={(event) => setEditMode(event.target.value as "lanes" | "step") }>
            <option value="lanes">Lane chart</option>
            <option value="step">Step sequencer</option>
          </select>
        </label>
        <label className="drumPresetSelect">
          Lane preset
          <select value={lanePresetId} onChange={(event) => setLanePresetId(event.target.value as DrumLanePresetId)}>
            {DRUM_LANE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>
        <label className="drumStepSelect">
          Grid
          <select
            value={stepDivision}
            onChange={(event) => setStepDivision(Number(event.target.value) as StepDivision)}
          >
            <option value={8}>1/8</option>
            <option value={16}>1/16</option>
            <option value={32}>1/32</option>
          </select>
        </label>
        <button type="button" className="secondaryButton" onClick={quantizeAllHits} disabled={!visibleNotes.length}>
          Quantize all
        </button>
        {editMode === "step" ? (
          <button
            type="button"
            className="secondaryButton"
            disabled={!stepSelectionRange}
            onClick={() => {
              setStepSelection(null);
              setStepSelectionAnchor(null);
            }}
          >
            Clear selection
          </button>
        ) : null}
      </div>
      <div className="drumLaneViewport">
        <div className="drumLaneLegendOverlay" aria-hidden="true">
          {activeLanes.map((lane, index) => (
            <div
              key={`legend-${lane.id}`}
              className="drumLaneLegendRow"
              style={{ top: `${index * laneHeight}%`, height: `${laneHeight}%` }}
            >
              <span className="drumLaneLabel" title={lane.fullName}>{lane.label}</span>
            </div>
          ))}
        </div>
        <div className="horizontalScroller paddedScroller drumLaneScroller">
          <div ref={gridRef} className={`drumLaneGrid ${editMode === "step" ? "stepMode" : ""}`} style={{ width: `${contentWidth}px` }}>
          {activeLanes.map((lane, index) => (
            <div
              key={lane.id}
              className="drumLaneRow"
              style={{ top: `${index * laneHeight}%`, height: `${laneHeight}%` }}
              onClick={(event) => {
                if (editMode !== "lanes") return;
                onSeek(clientXToTime(event.clientX));
              }}
              onDoubleClick={(event) => {
                if (editMode !== "lanes") return;
                event.stopPropagation();
                const hitTime = clientXToTime(event.clientX);
                const velocity = selectedNote?.velocity ?? 100;
                addDrumHitAt(index, hitTime, velocity);
                onSeek(hitTime);
              }}
            />
          ))}

          {editMode === "step"
            ? stepTimes.map((time, index) => {
                const isBar = index % stepsPerBar === 0;
                const isBeat = !isBar && index % stepsPerBeat === 0;
                return (
                  <div
                    key={`step-line-${index}`}
                    className={`drumBeatLine ${isBar ? "major" : isBeat ? "medium" : "minor"}`}
                    style={{ left: `${timeToPx(time)}px` }}
                  />
                );
              })
            : beatTimes.map((time, index) => {
                const major = index % barLengthBeats === 0;
                return (
                  <div
                    key={`beat-${index}`}
                    className={`drumBeatLine ${major ? "major" : "minor"}`}
                    style={{ left: `${timeToPx(time)}px` }}
                  />
                );
              })}

          {editMode === "step"
            ? activeLanes.map((lane, laneIndex) =>
                stepTimes.map((time, stepIndex) => {
                  const key = `${laneIndex}:${stepIndex}`;
                  const note = stepHitMap.get(key);
                  const top = laneIndex * laneHeight + laneHeight / 2;
                  const left = timeToPx(time);
                  return (
                    <button
                      key={`step-${key}`}
                      className={`drumStepCell ${note ? "active" : ""} ${stepSelectionRange && stepIndex >= stepSelectionRange.start && stepIndex <= stepSelectionRange.end ? "range" : ""}`}
                      style={{ left: `${left}px`, top: `${top}%` }}
                      onPointerDown={(event) => {
                        if (event.shiftKey) return;
                        const activeRange =
                          stepSelectionRange &&
                          stepIndex >= stepSelectionRange.start &&
                          stepIndex <= stepSelectionRange.end
                            ? stepSelectionRange
                            : normalizeSelection(stepIndex, stepIndex);
                        const movedOriginals = visibleNotes.filter((candidate) => {
                          const candidateStep = noteToStepIndex(candidate.start);
                          return candidateStep >= activeRange.start && candidateStep <= activeRange.end;
                        });
                        const rippleOriginals = visibleNotes.filter((candidate) => {
                          const candidateStep = noteToStepIndex(candidate.start);
                          return candidateStep > activeRange.end;
                        });
                        if (!movedOriginals.length) {
                          stepDragRef.current = null;
                          return;
                        }
                        stepDragRef.current = {
                          startX: event.clientX,
                          selectionStart: activeRange.start,
                          selectionEnd: activeRange.end,
                          movedOriginals,
                          rippleOriginals,
                          lastDeltaSteps: 0,
                          lastRippleMode: event.ctrlKey,
                        };
                        suppressStepClickRef.current = false;
                      }}
                      onClick={(event) => {
                        if (suppressStepClickRef.current) {
                          suppressStepClickRef.current = false;
                          return;
                        }
                        if (event.shiftKey) {
                          if (stepSelectionAnchor === null) {
                            setStepSelectionAnchor(stepIndex);
                            setStepSelection(normalizeSelection(stepIndex, stepIndex));
                            return;
                          }
                          setStepSelection(normalizeSelection(stepSelectionAnchor, stepIndex));
                          return;
                        }
                        if (note) {
                          onSelectNote(note.id);
                          onSeek(note.start);
                        }
                        toggleStepHit(laneIndex, stepIndex);
                      }}
                      title={`${lane.fullName} (${lane.label}) @ ${time.toFixed(3)}s`}
                    >
                      {note ? lane.symbol : ""}
                    </button>
                  );
                }),
              )
            : visibleNotes.map((note) => {
              const laneIndex = laneIndexForPitch(note.pitch, activeLanes);
              const lane = activeLanes[laneIndex];
                const left = timeToPx(note.start);
                const top = laneIndex * laneHeight + laneHeight / 2;
                const currentPitchIndex = lane.pitches.indexOf(note.pitch);
                const nextPitch = lane.pitches[(currentPitchIndex + 1) % lane.pitches.length] ?? note.pitch;

                return (
                  <button
                    key={note.id}
                    className={`noteBlock drumHit ${note.selected ? "selected" : ""}`}
                    style={{ left: `${left}px`, top: `${top}%` }}
                    onPointerDown={(event) => {
                      if (editMode !== "lanes") return;
                      event.stopPropagation();
                      onSelectNote(note.id);
                      onSeek(note.start);
                      const chordOriginals = visibleNotes.filter(
                        (candidate) => Math.abs(candidate.start - note.start) <= 0.02,
                      );
                      const chordIds = new Set(chordOriginals.map((item) => item.id));
                      const chordStart = chordOriginals.length
                        ? Math.min(...chordOriginals.map((item) => item.start))
                        : note.start;
                      const rippleOriginals = visibleNotes.filter(
                        (candidate) =>
                          !chordIds.has(candidate.id) &&
                          candidate.start > chordStart + 0.02,
                      );
                      dragRef.current = {
                        id: note.id,
                        startX: event.clientX,
                        original: note,
                        anchorLaneIndex: laneIndexForPitch(note.pitch, activeLanes),
                        chordOriginals,
                        rippleOriginals,
                      };
                    }}
                    onClick={() => {
                      onSelectNote(note.id);
                      onSeek(note.start);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      onChangeNote({ ...note, pitch: nextPitch });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelectNote(note.id);
                      onSeek(note.start);
                      onDeleteNote(note.id);
                    }}
                    title={`${lane.fullName} (${lane.label}) - pitch ${note.pitch} - vel ${note.velocity} - t ${note.start.toFixed(3)}s. Drag: move hit. Ctrl+drag: move all following hits.`}
                  >
                    <span className="drumHitSymbol">{lane.symbol}</span>
                  </button>
                );
              })}

            <div className="playhead" style={{ left: `${timeToPx(currentTime)}px` }} />
          </div>
        </div>
      </div>
      <div className="drumLaneLegend" aria-label="Drum lane legend">
        <div className="drumLegendHeader">
          <p className="drumLegendIntro">
            Lane labels and symbols in this preset map to drum piece IDs.
          </p>
          <p className="drumLegendHint">
            {editMode === "step"
              ? "Click a cell to toggle a hit. Shift+click selects a column range, drag moves the selection, Ctrl+drag ripple-shifts all following events."
              : "Click a hit to select and seek, double-click empty lane space to add, and right-click or press Delete to remove."}
          </p>
        </div>
        <div className="drumLegendGrid">
          {activeLanes.map((lane) => {
            const primaryPiece = lane.pieceIds[0] ?? "";
            const icon = primaryPiece
              ? drumIconForPieceId(primaryPiece)
              : drumIconForLaneCategory(lane.category);
            return (
              <div key={`legend-item-${lane.id}`} className="drumLegendItem">
                <span className="drumLegendName">{lane.fullName}</span>
                <div className="drumLegendVisualRow">
                  <span className={`drumLegendIcon ${lane.category}`} aria-hidden="true">
                    <DrumLegendIcon icon={icon} title={lane.fullName} />
                  </span>
                  <span className="drumLegendCode">{lane.label}</span>
                  <span className="drumLegendMidi">MIDI {lane.pitches.join("/")}</span>
                </div>
                <span className="drumLegendPieces">{lane.pieceNames.join(" + ")}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
