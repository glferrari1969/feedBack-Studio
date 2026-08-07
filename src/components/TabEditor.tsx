import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { MidiNote, SyncPoint, ToneBlock, ToneChange } from "../types/music";
import {
  BASS_5_TUNING,
  BASS_STANDARD_TUNING,
  DROP_D_TUNING,
  GUITAR_STANDARD_TUNING,
  pitchToPositions,
  stringFretToPitch,
} from "./FretboardMapper";
import { TechniquePanel } from "./TechniquePanel";

interface TabEditorProps {
  notes: MidiNote[];
  selectedTrackId: string;
  arrangementKind: "guitar" | "bass";
  duration: number;
  currentTime: number;
  tuning?: number[];
  zoom: number;
  syncPoints?: SyncPoint[];
  tones?: ToneBlock | null;
  selectedSyncPointId?: string | null;
  onSelectSyncPoint?: (id: string) => void;
  onChangeSyncPoint?: (point: SyncPoint) => void;
  onAddSyncPointAt?: (time: number) => void;
  onChangeNote: (note: MidiNote) => void;
  onSelectNote: (noteId: string) => void;
  onAddNotes: (notes: MidiNote[]) => void;
  onDeleteNote: (noteId: string) => void;
  onSeek: (time: number) => void;
  onChangeTuning?: (tuning: number[]) => void;
  headerControl?: ReactNode;
  chordDiagram?: ReactNode;
}

const FRET_MAX = 24;
const DEFAULT_NOTE_DURATION = 0.5;
const CHORD_SELECTION_TOLERANCE = 0.02;
const DRAG_ACTIVATION_DISTANCE_PX = 8;

type TuningPreset = {
  id: string;
  label: string;
  pitches: number[];
};

const GUITAR_PRESETS_6: TuningPreset[] = [
  { id: "gtr6-standard", label: "Standard", pitches: GUITAR_STANDARD_TUNING },
  { id: "gtr6-eb-standard", label: "Eb Standard", pitches: [39, 44, 49, 54, 58, 63] },
  { id: "gtr6-d-standard", label: "D Standard", pitches: [38, 43, 48, 53, 57, 62] },
  { id: "gtr6-c-sharp-standard", label: "C# Standard", pitches: [37, 42, 47, 52, 56, 61] },
  { id: "gtr6-c-standard", label: "C Standard", pitches: [36, 41, 46, 51, 55, 60] },
  { id: "gtr6-drop-d", label: "Drop D", pitches: DROP_D_TUNING },
  { id: "gtr6-drop-c", label: "Drop C", pitches: [36, 43, 48, 53, 57, 62] },
  { id: "gtr6-drop-b", label: "Drop B", pitches: [35, 42, 47, 52, 56, 61] },
  { id: "gtr6-drop-a", label: "Drop A", pitches: [33, 40, 45, 50, 54, 59] },
  { id: "gtr6-drop-ab", label: "Drop Ab", pitches: [32, 39, 44, 49, 53, 58] },
  { id: "gtr6-open-g", label: "Open G", pitches: [38, 43, 50, 55, 59, 62] },
  { id: "gtr6-open-d", label: "Open D", pitches: [38, 45, 50, 54, 57, 62] },
  { id: "gtr6-dadgad", label: "DADGAD", pitches: [38, 45, 50, 55, 57, 62] },
  { id: "gtr6-open-e", label: "Open E", pitches: [40, 47, 52, 56, 59, 64] },
];

const GUITAR_PRESETS_7: TuningPreset[] = [
  { id: "gtr7-standard", label: "Standard", pitches: [35, 40, 45, 50, 55, 59, 64] },
  { id: "gtr7-bb-standard", label: "Bb Standard", pitches: [34, 39, 44, 49, 54, 58, 63] },
  { id: "gtr7-a-standard", label: "A Standard", pitches: [33, 38, 43, 48, 53, 57, 62] },
  { id: "gtr7-g-standard", label: "G Standard", pitches: [31, 36, 41, 46, 51, 55, 60] },
  { id: "gtr7-drop-a", label: "Drop A", pitches: [33, 40, 45, 50, 55, 59, 64] },
  { id: "gtr7-drop-g", label: "Drop G", pitches: [31, 38, 43, 48, 53, 57, 62] },
  { id: "gtr7-drop-f-sharp", label: "Drop F#", pitches: [30, 37, 42, 47, 52, 56, 61] },
];

const GUITAR_PRESETS_8: TuningPreset[] = [
  { id: "gtr8-standard", label: "Standard", pitches: [30, 35, 40, 45, 50, 55, 59, 64] },
  { id: "gtr8-drop-e", label: "Drop E", pitches: [28, 35, 40, 45, 50, 55, 59, 64] },
  { id: "gtr8-drop-a-drop-e", label: "Drop A + Drop E", pitches: [28, 33, 40, 45, 50, 55, 59, 64] },
  { id: "gtr8-e-standard", label: "E Standard", pitches: [28, 33, 38, 43, 48, 53, 57, 62] },
  { id: "gtr8-eb-standard", label: "Eb Standard", pitches: [27, 32, 37, 42, 47, 52, 56, 61] },
  { id: "gtr8-drop-d", label: "Drop D", pitches: [26, 33, 38, 43, 48, 53, 57, 62] },
];

const BASS_PRESETS_4: TuningPreset[] = [
  { id: "bass4-standard", label: "Standard", pitches: BASS_STANDARD_TUNING },
  { id: "bass4-eb-standard", label: "Eb Standard", pitches: [27, 32, 37, 42] },
  { id: "bass4-d-standard", label: "D Standard", pitches: [26, 31, 36, 41] },
  { id: "bass4-c-sharp-standard", label: "C# Standard", pitches: [25, 30, 35, 40] },
  { id: "bass4-c-standard", label: "C Standard", pitches: [24, 29, 34, 39] },
  { id: "bass4-drop-d", label: "Drop D", pitches: [26, 33, 38, 43] },
  { id: "bass4-drop-c", label: "Drop C", pitches: [24, 31, 36, 41] },
  { id: "bass4-bead", label: "BEAD", pitches: [23, 28, 33, 38] },
];

const BASS_PRESETS_5: TuningPreset[] = [
  { id: "bass5-standard", label: "Standard", pitches: BASS_5_TUNING },
  { id: "bass5-high-c", label: "High C", pitches: [28, 33, 38, 43, 48] },
  { id: "bass5-eb-standard", label: "Eb Standard", pitches: [22, 27, 32, 37, 42] },
  { id: "bass5-d-standard", label: "D Standard", pitches: [21, 26, 31, 36, 41] },
  { id: "bass5-c-sharp-standard", label: "C# Standard", pitches: [20, 25, 30, 35, 40] },
  { id: "bass5-c-standard", label: "C Standard", pitches: [19, 24, 29, 34, 39] },
  { id: "bass5-drop-a", label: "Drop A", pitches: [21, 28, 33, 38, 43] },
];

const BASS_PRESETS_6: TuningPreset[] = [
  { id: "bass6-standard", label: "Standard", pitches: [23, 28, 33, 38, 43, 48] },
  { id: "bass6-eb-standard", label: "Eb Standard", pitches: [22, 27, 32, 37, 42, 47] },
  { id: "bass6-d-standard", label: "D Standard", pitches: [21, 26, 31, 36, 41, 46] },
  { id: "bass6-c-sharp-standard", label: "C# Standard", pitches: [20, 25, 30, 35, 40, 45] },
  { id: "bass6-c-standard", label: "C Standard", pitches: [19, 24, 29, 34, 39, 44] },
];

function stringCountOptions(kind: "guitar" | "bass") {
  return kind === "bass" ? [4, 5, 6] : [6, 7, 8];
}

function tuningPresetsFor(kind: "guitar" | "bass", strings: number): TuningPreset[] {
  if (kind === "guitar") {
    if (strings === 8) return GUITAR_PRESETS_8;
    return strings === 7 ? GUITAR_PRESETS_7 : GUITAR_PRESETS_6;
  }
  if (strings === 6) return BASS_PRESETS_6;
  return strings === 5 ? BASS_PRESETS_5 : BASS_PRESETS_4;
}

function matchingPresetId(
  kind: "guitar" | "bass",
  strings: number,
  tuning: number[],
) {
  const key = tuning.join(",");
  const match = tuningPresetsFor(kind, strings).find(
    (preset) => preset.pitches.join(",") === key,
  );
  return match?.id ?? "custom";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midiToName(pitch: number) {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function getVisualStrings(tuning: number[]) {
  return tuning.map((pitch, index) => ({ string: index + 1, pitch })).reverse();
}

function formatTuningNotes(tuning: number[]) {
  return tuning
    .slice()
    .reverse()
    .map((pitch) => midiToName(pitch))
    .join(" ");
}

function toDisplayStringNumber(internalString: number, totalStrings: number) {
  return clamp(totalStrings - internalString + 1, 1, totalStrings);
}

function toInternalStringNumber(displayString: number, totalStrings: number) {
  return clamp(totalStrings - displayString + 1, 1, totalStrings);
}

function isExactPositionPlayable(note: MidiNote, tuning: number[]) {
  if (typeof note.string !== "number" || typeof note.fret !== "number") return false;
  if (note.string < 1 || note.string > tuning.length) return false;
  if (note.fret < 0 || note.fret > FRET_MAX) return false;
  return stringFretToPitch(note.string, note.fret, tuning) === note.pitch;
}

function pickNearestPosition(
  note: MidiNote,
  tuning: number[],
  previous?: { string: number; fret: number },
) {
  const positions = pitchToPositions(note.pitch, tuning, FRET_MAX);
  if (!positions.length) return null;

  const preferredString =
    typeof note.string === "number"
      ? clamp(note.string, 1, tuning.length)
      : undefined;
  const preferredFret =
    typeof note.fret === "number" ? clamp(note.fret, 0, FRET_MAX) : undefined;

  const anchorString = preferredString ?? previous?.string ?? Math.ceil(tuning.length / 2);
  const anchorFret = preferredFret ?? previous?.fret ?? 5;

  return positions
    .slice()
    .sort((a, b) => {
      const scoreA =
        Math.abs(a.string - anchorString) * (preferredString ? 4 : 3) +
        Math.abs(a.fret - anchorFret);
      const scoreB =
        Math.abs(b.string - anchorString) * (preferredString ? 4 : 3) +
        Math.abs(b.fret - anchorFret);
      if (scoreA !== scoreB) return scoreA - scoreB;
      return a.fret - b.fret;
    })[0];
}

function mapTrackNotesToTuning(trackNotes: MidiNote[], tuning: number[]) {
  const positionedNotes: Array<MidiNote & { string: number; fret: number }> = [];
  const excludedNotes: MidiNote[] = [];
  let previous: { string: number; fret: number } | undefined;

  trackNotes.forEach((note) => {
    if (isExactPositionPlayable(note, tuning)) {
      const fixedNote = {
        ...note,
        string: note.string as number,
        fret: note.fret as number,
      };
      positionedNotes.push(fixedNote);
      previous = { string: fixedNote.string, fret: fixedNote.fret };
      return;
    }

    const next = pickNearestPosition(note, tuning, previous);
    if (!next) {
      excludedNotes.push(note);
      return;
    }

    const mappedNote = {
      ...note,
      string: next.string,
      fret: next.fret,
    };
    positionedNotes.push(mappedNote);
    previous = { string: mappedNote.string, fret: mappedNote.fret };
  });

  return { positionedNotes, excludedNotes };
}

function excludedFretDelta(note: MidiNote, tuning: number[]) {
  if (!tuning.length) return 0;
  const minOpen = Math.min(...tuning);
  const maxPlayable = Math.max(...tuning.map((openPitch) => openPitch + FRET_MAX));
  if (note.pitch < minOpen) return note.pitch - minOpen;
  if (note.pitch > maxPlayable) return note.pitch - maxPlayable;
  return 0;
}

function excludedFretLabel(note: MidiNote, tuning: number[]) {
  const delta = excludedFretDelta(note, tuning);
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  return signed;
}

function normalizeToneChanges(tones: ToneBlock | null | undefined): ToneChange[] {
  if (!tones) return [];
  const baseName = typeof tones.base === "string" ? tones.base.trim() : "";
  const rawChanges = Array.isArray(tones.changes) ? tones.changes : [];
  const sortedChanges = rawChanges
    .map((change) => ({
      t: Number(change.t),
      name: String(change.name ?? "").trim(),
    }))
    .filter((change) => Number.isFinite(change.t) && change.t >= 0 && change.name)
    .sort((a, b) => a.t - b.t);

  const collapsedByTime: ToneChange[] = [];
  for (const change of sortedChanges) {
    const previous = collapsedByTime[collapsedByTime.length - 1];
    if (previous && Math.abs(previous.t - change.t) < 0.001) {
      // Keep the latest event when multiple tone changes share the same instant.
      collapsedByTime[collapsedByTime.length - 1] = change;
      continue;
    }
    collapsedByTime.push(change);
  }

  const changes = collapsedByTime.filter(
    (change, index) => index === 0 || collapsedByTime[index - 1].name !== change.name,
  );

  if (baseName && !changes.some((change) => Math.abs(change.t) < 0.001)) {
    return [{ t: 0, name: baseName }, ...changes];
  }
  return changes;
}

function toneAtTime(changes: ToneChange[], currentTime: number, fallback = "No tone") {
  let current = fallback;
  for (const change of changes) {
    if (change.t <= currentTime + 0.001) current = change.name;
    else break;
  }
  return current;
}

export function TabEditor({
  notes,
  selectedTrackId,
  arrangementKind,
  duration,
  currentTime,
  tuning,
  zoom,
  syncPoints = [],
  tones,
  selectedSyncPointId,
  onSelectSyncPoint,
  onChangeSyncPoint,
  onAddSyncPointAt,
  onChangeNote,
  onSelectNote,
  onAddNotes,
  onDeleteNote,
  onSeek,
  onChangeTuning,
  headerControl,
  chordDiagram,
}: TabEditorProps) {
  const defaultTuning =
    arrangementKind === "bass" ? BASS_STANDARD_TUNING : GUITAR_STANDARD_TUNING;
  const initialTuning = tuning?.length ? tuning : defaultTuning;
  const initialStringOptions = stringCountOptions(arrangementKind);
  const initialStringCount = initialStringOptions.includes(initialTuning.length)
    ? initialTuning.length
    : initialStringOptions[0];
  const [localTuning, setLocalTuning] = useState<number[]>(initialTuning);
  const [selectedStringCount, setSelectedStringCount] = useState(initialStringCount);
  const [selectedTuningPresetId, setSelectedTuningPresetId] = useState(
    matchingPresetId(arrangementKind, initialStringCount, initialTuning),
  );
  const [snap, setSnap] = useState(0.0625);
  const [nudge, setNudge] = useState(0.01);
  const [newFret, setNewFret] = useState(0);
  const [activeEditorNoteId, setActiveEditorNoteId] = useState<string | null>(null);
  const [selectedExcludedNoteId, setSelectedExcludedNoteId] = useState<string | null>(null);
  const preferredEditorNoteIdRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    dragActivated: boolean;
    original: MidiNote;
    chordOriginals: MidiNote[];
    rippleOriginals: MidiNote[];
    chordStart: number;
    anchorString: number;
  } | null>(null);

  useEffect(() => {
    const next = tuning?.length ? tuning : defaultTuning;
    const options = stringCountOptions(arrangementKind);
    const nextStringCount = options.includes(next.length) ? next.length : options[0];
    setLocalTuning(next);
    setSelectedStringCount(nextStringCount);
    setSelectedTuningPresetId(
      matchingPresetId(arrangementKind, nextStringCount, next),
    );
  }, [arrangementKind, selectedTrackId, tuning?.join(",")]);

  const availableTuningPresets = useMemo(
    () => tuningPresetsFor(arrangementKind, selectedStringCount),
    [arrangementKind, selectedStringCount],
  );

  useEffect(() => {
    setSelectedTuningPresetId(
      matchingPresetId(arrangementKind, selectedStringCount, localTuning),
    );
  }, [arrangementKind, selectedStringCount, localTuning]);

  const visibleStrings = useMemo(
    () => getVisualStrings(localTuning),
    [localTuning],
  );
  const contentWidth = Math.max(1600, duration * 118 * zoom);
  const toneChanges = useMemo(() => normalizeToneChanges(tones), [tones]);
  const tuningSummary = useMemo(() => formatTuningNotes(localTuning), [localTuning]);
  const activeToneName = toneAtTime(toneChanges, currentTime, tones?.base || "No tone");
  const timeToPx = (time: number) =>
    duration > 0 ? (time / duration) * contentWidth : 0;
  const clientXToTime = (clientX: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return 0;
    return clamp(
      ((clientX - rect.left) / contentWidth) * duration,
      0,
      duration,
    );
  };
  const sourceTrackNotes = useMemo(() => {
    return notes
      .filter((note) => note.trackId === selectedTrackId)
      .sort((a, b) => a.start - b.start);
  }, [notes, selectedTrackId]);

  const mappedTrack = useMemo(
    () => mapTrackNotesToTuning(sourceTrackNotes, localTuning),
    [sourceTrackNotes, localTuning],
  );

  const trackNotes = mappedTrack.positionedNotes;
  const excludedTrackNotes = mappedTrack.excludedNotes;
  const excludedNoteIds = useMemo(
    () => new Set(excludedTrackNotes.map((note) => note.id)),
    [excludedTrackNotes],
  );
  const positionedById = useMemo(
    () => new Map(trackNotes.map((note) => [note.id, note] as const)),
    [trackNotes],
  );

  const excludedSummary = useMemo(() => {
    if (!excludedTrackNotes.length) return "";
    return excludedTrackNotes
      .slice(0, 5)
      .map((note) => `${excludedFretLabel(note, localTuning)} @ ${note.start.toFixed(2)}s`)
      .join(", ");
  }, [excludedTrackNotes, localTuning]);

  useEffect(() => {
    if (!selectedExcludedNoteId) return;
    if (excludedTrackNotes.some((note) => note.id === selectedExcludedNoteId)) return;
    setSelectedExcludedNoteId(null);
  }, [excludedTrackNotes, selectedExcludedNoteId]);

  const excludedNoteTop = (pitch: number) => {
    if (!visibleStrings.length) return "50%";
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    visibleStrings.forEach((item, index) => {
      const distance = Math.abs(item.pitch - pitch);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return `${((closestIndex + 0.5) / visibleStrings.length) * 100}%`;
  };

  const selectedNotes = useMemo(
    () =>
      sourceTrackNotes
        .filter((note) => note.selected)
        .map((note) => positionedById.get(note.id) ?? note),
    [sourceTrackNotes, positionedById],
  );
  const preferredSelectedNote =
    preferredEditorNoteIdRef.current !== null
      ? selectedNotes.find((note) => note.id === preferredEditorNoteIdRef.current)
      : undefined;
  const selectedNote =
    selectedNotes.find((note) => note.id === activeEditorNoteId) ??
    preferredSelectedNote ??
    selectedNotes[0];

  const selectedChordNotes = useMemo(() => {
    if (!selectedNote) return [];
    return selectedNotes
      .filter(
        (note) =>
          Math.abs(note.start - selectedNote.start) <= CHORD_SELECTION_TOLERANCE,
      )
      .sort(
        (a, b) =>
          (b.string ?? 0) - (a.string ?? 0) ||
          (a.fret ?? 0) - (b.fret ?? 0) ||
          a.pitch - b.pitch,
      );
  }, [selectedNotes, selectedNote]);

  const noteGroups = useMemo(() => {
    const groups: Array<{ start: number; notes: MidiNote[] }> = [];
    sourceTrackNotes.forEach((note) => {
      const positioned = positionedById.get(note.id) ?? note;
      const lastGroup = groups[groups.length - 1];
      if (
        lastGroup &&
        Math.abs(positioned.start - lastGroup.start) <= CHORD_SELECTION_TOLERANCE
      ) {
        lastGroup.notes.push(positioned);
        return;
      }
      groups.push({ start: positioned.start, notes: [positioned] });
    });
    groups.forEach((group) => {
      group.notes.sort(
        (a, b) =>
          (b.string ?? 0) - (a.string ?? 0) ||
          (a.fret ?? 0) - (b.fret ?? 0) ||
          a.pitch - b.pitch,
      );
    });
    return groups;
  }, [sourceTrackNotes, positionedById]);

  const selectedGroupIndex = useMemo(() => {
    if (!selectedNote) return -1;
    const byId = noteGroups.findIndex((group) =>
      group.notes.some((note) => note.id === selectedNote.id),
    );
    if (byId >= 0) return byId;
    return noteGroups.findIndex(
      (group) =>
        Math.abs(group.start - selectedNote.start) <= CHORD_SELECTION_TOLERANCE,
    );
  }, [noteGroups, selectedNote]);
  const canGoPreviousGroup = selectedGroupIndex > 0;
  const canGoNextGroup =
    selectedGroupIndex >= 0 && selectedGroupIndex < noteGroups.length - 1;

  useEffect(() => {
    if (!selectedNote) {
      if (selectedExcludedNoteId !== null) {
        setSelectedExcludedNoteId(null);
      }
      return;
    }
    const nextExcludedId = excludedNoteIds.has(selectedNote.id)
      ? selectedNote.id
      : null;
    if (selectedExcludedNoteId !== nextExcludedId) {
      setSelectedExcludedNoteId(nextExcludedId);
    }
  }, [selectedNote, excludedNoteIds, selectedExcludedNoteId]);

  useEffect(() => {
    if (selectedNote) {
      preferredEditorNoteIdRef.current = selectedNote.id;
      if (activeEditorNoteId !== selectedNote.id) {
        setActiveEditorNoteId(selectedNote.id);
      }
      return;
    }
    preferredEditorNoteIdRef.current = null;
    if (activeEditorNoteId !== null) {
      setActiveEditorNoteId(null);
    }
  }, [selectedNote, activeEditorNoteId]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || duration <= 0) return;
    const playheadX = timeToPx(currentTime);
    const margin = Math.min(320, scroller.clientWidth * 0.36);
    const leftEdge = scroller.scrollLeft + margin;
    const rightEdge = scroller.scrollLeft + scroller.clientWidth - margin;
    if (playheadX < leftEdge || playheadX > rightEdge) {
      scroller.scrollLeft = Math.max(
        0,
        playheadX - scroller.clientWidth * 0.45,
      );
    }
  }, [currentTime, contentWidth, duration]);

  const snapTime = (value: number) => {
    if (snap <= 0) return Number(value.toFixed(4));
    return Number((Math.round(value / snap) * snap).toFixed(4));
  };

  const positionForStringKeepingPitch = (
    pitch: number,
    targetString: number,
    fallbackString?: number,
  ) => {
    const directFret = pitch - (localTuning[targetString - 1] ?? 0);
    if (directFret >= 0 && directFret <= FRET_MAX) {
      return { string: targetString, fret: directFret, pitch };
    }

    const validPositions = pitchToPositions(pitch, localTuning, FRET_MAX);
    if (!validPositions.length) return null;

    if (fallbackString !== undefined && targetString !== fallbackString) {
      const direction = Math.sign(targetString - fallbackString);
      const directional = validPositions
        .filter((pos) =>
          direction > 0
            ? pos.string > fallbackString
            : pos.string < fallbackString,
        )
        .sort(
          (a, b) =>
            Math.abs(a.string - targetString) -
              Math.abs(b.string - targetString) || a.fret - b.fret,
        )[0];
      if (directional) return directional;
    }

    return validPositions.sort(
      (a, b) =>
        Math.abs(a.string - targetString) - Math.abs(b.string - targetString) ||
        a.fret - b.fret,
    )[0];
  };

  const updateNoteStringKeepingPitch = (note: MidiNote, targetString: number) => {
    const next = positionForStringKeepingPitch(
      note.pitch,
      clamp(targetString, 1, localTuning.length),
      note.string,
    );
    if (!next) return note;
    return { ...note, string: next.string, fret: next.fret, pitch: note.pitch };
  };

  const positionForExactStringKeepingPitch = (
    pitch: number,
    targetString: number,
  ) => {
    const normalizedString = clamp(targetString, 1, localTuning.length);
    const fret = pitch - (localTuning[normalizedString - 1] ?? 0);
    if (fret < 0 || fret > FRET_MAX) return null;
    return { string: normalizedString, fret, pitch };
  };

  const isChordStringDeltaValid = (chordNotes: MidiNote[], delta: number) => {
    return chordNotes.every((note) => {
      const baseString = note.string ?? 1;
      const targetString = baseString + delta;
      if (targetString < 1 || targetString > localTuning.length) return false;
      return Boolean(positionForExactStringKeepingPitch(note.pitch, targetString));
    });
  };

  const nearestValidChordDelta = (chordNotes: MidiNote[], requestedDelta: number) => {
    const maxDelta = localTuning.length - 1;
    let bestDelta = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let delta = -maxDelta; delta <= maxDelta; delta += 1) {
      if (!isChordStringDeltaValid(chordNotes, delta)) continue;
      const distance = Math.abs(delta - requestedDelta);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
      }
    }

    return bestDelta;
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!drag || !rect) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.dragActivated) {
        // A plain click should only select; activate dragging only after
        // moving a small distance to avoid accidental edits.
        if (Math.hypot(dx, dy) < DRAG_ACTIVATION_DISTANCE_PX) return;
        drag.dragActivated = true;
      }
      const xDeltaSeconds = (dx / contentWidth) * duration;
      const rowHeight = rect.height / visibleStrings.length;
      const rowIndex = clamp(
        Math.floor((event.clientY - rect.top) / rowHeight),
        0,
        visibleStrings.length - 1,
      );
      const stringNumber = visibleStrings[rowIndex].string;
      const requestedStringDelta = stringNumber - drag.anchorString;
      const chordStringDelta =
        drag.chordOriginals.length > 1
          ? nearestValidChordDelta(drag.chordOriginals, requestedStringDelta)
          : requestedStringDelta;
      const isRippleMode = event.ctrlKey;
      const anchorRawStart = drag.original.start + xDeltaSeconds;
      const anchorSnappedStart = snapTime(anchorRawStart);
      const anchorClampedStart = clamp(
        anchorSnappedStart,
        0,
        Math.max(0, duration - drag.original.duration),
      );
      const rippleDelta = anchorClampedStart - drag.original.start;

      drag.chordOriginals.forEach((originalNote) => {
        const rawStart = originalNote.start + xDeltaSeconds;
        const snappedStart = snapTime(rawStart);
        const baseString = originalNote.string ?? 1;
        const targetString = clamp(
          baseString + chordStringDelta,
          1,
          localTuning.length,
        );
        const movedOnString =
          drag.chordOriginals.length > 1
            ? (() => {
                const exact = positionForExactStringKeepingPitch(
                  originalNote.pitch,
                  targetString,
                );
                if (!exact) return originalNote;
                return {
                  ...originalNote,
                  string: exact.string,
                  fret: exact.fret,
                  pitch: originalNote.pitch,
                };
              })()
            : updateNoteStringKeepingPitch(originalNote, targetString);
        onChangeNote({
          ...movedOnString,
          start: clamp(
            snappedStart,
            0,
            Math.max(0, duration - originalNote.duration),
          ),
          duration: originalNote.duration,
        });
      });

      drag.rippleOriginals.forEach((originalNote) => {
        const targetStart = isRippleMode
          ? originalNote.start + rippleDelta
          : originalNote.start;
        onChangeNote({
          ...originalNote,
          start: clamp(
            targetStart,
            0,
            Math.max(0, duration - originalNote.duration),
          ),
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
  }, [contentWidth, duration, localTuning, onChangeNote, snap, visibleStrings]);

  const addNoteAt = (time: number, stringNumber: number, fret: number) => {
    const snappedStart = snapTime(time);
    onAddNotes([
      {
        id: crypto.randomUUID(),
        trackId: selectedTrackId,
        start: clamp(snappedStart, 0, duration),
        duration: DEFAULT_NOTE_DURATION,
        velocity: 96,
        string: stringNumber,
        fret,
        pitch: stringFretToPitch(stringNumber, fret, localTuning),
        techniques: {},
      },
    ]);
  };

  const eventToTime = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    return clamp((x / contentWidth) * duration, 0, duration);
  };

  const handleGridClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const time = eventToTime(event);
    if (time === null) return;
    onSeek(time);
  };

  const handleGridDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = gridRef.current?.getBoundingClientRect();
    const time = eventToTime(event);
    if (!rect || time === null) return;
    if (event.shiftKey || event.altKey) {
      onAddSyncPointAt?.(time);
      return;
    }
    const rowHeight = rect.height / visibleStrings.length;
    const rowIndex = clamp(
      Math.floor((event.clientY - rect.top) / rowHeight),
      0,
      visibleStrings.length - 1,
    );
    const stringNumber = visibleStrings[rowIndex].string;
    addNoteAt(time, stringNumber, newFret);
  };

  const applyNotePatch = (note: MidiNote, patch: Partial<MidiNote>) => {
    if (patch.string !== undefined && patch.fret === undefined) {
      const next = updateNoteStringKeepingPitch(note, patch.string);
      onChangeNote({
        ...next,
        ...patch,
        string: next.string,
        fret: next.fret,
        pitch: note.pitch,
      });
      return;
    }

    const nextString = patch.string ?? note.string ?? 1;
    const nextFret = patch.fret ?? note.fret ?? 0;
    onChangeNote({
      ...note,
      ...patch,
      string: nextString,
      fret: nextFret,
      pitch:
        patch.fret !== undefined || patch.pitch !== undefined
          ? stringFretToPitch(nextString, nextFret, localTuning)
          : note.pitch,
    });
  };

  const updateSelected = (patch: Partial<MidiNote>) => {
    if (!selectedNote) return;
    applyNotePatch(selectedNote, patch);
  };

  const transposeSelectedPitch = (semitones: number) => {
    if (!selectedNote) return;
    const nextPitch = clamp(selectedNote.pitch + semitones, 0, 127);
    const moved = { ...selectedNote, pitch: nextPitch };
    const mapped = pickNearestPosition(moved, localTuning);
    if (mapped) {
      onChangeNote({
        ...moved,
        string: mapped.string,
        fret: mapped.fret,
      });
      return;
    }
    onChangeNote(moved);
  };

  const updateChordMember = (note: MidiNote, patch: Partial<MidiNote>) => {
    applyNotePatch(note, patch);
  };

  const moveSelectedString = (delta: number) => {
    if (!selectedNote) return;
    const currentString = selectedNote.string ?? 1;
    const targetString = clamp(currentString + delta, 1, localTuning.length);
    const next = updateNoteStringKeepingPitch(selectedNote, targetString);
    onChangeNote(next);
  };

  const addPowerChord = () => {
    const stringNumber = arrangementKind === "bass" ? 1 : 5;
    const rootFret = clamp(newFret, 0, FRET_MAX - 2);
    const start = snapTime(currentTime);
    const chordNotes: MidiNote[] = [
      {
        id: crypto.randomUUID(),
        trackId: selectedTrackId,
        start,
        duration: 1,
        velocity: 100,
        string: stringNumber,
        fret: rootFret,
        pitch: stringFretToPitch(stringNumber, rootFret, localTuning),
        techniques: {},
      },
      {
        id: crypto.randomUUID(),
        trackId: selectedTrackId,
        start,
        duration: 1,
        velocity: 100,
        string: Math.min(stringNumber + 1, localTuning.length),
        fret: rootFret + 2,
        pitch: stringFretToPitch(
          Math.min(stringNumber + 1, localTuning.length),
          rootFret + 2,
          localTuning,
        ),
        techniques: {},
      },
    ];
    onAddNotes(chordNotes);
  };

  const focusChordMember = (noteId: string) => {
    const note = sourceTrackNotes.find((candidate) => candidate.id === noteId);
    preferredEditorNoteIdRef.current = noteId;
    setActiveEditorNoteId(noteId);
    onSelectNote(noteId);
    if (note) onSeek(note.start);
  };

  const selectAdjacentGroup = (direction: -1 | 1) => {
    if (!selectedNote || selectedGroupIndex < 0) return;
    const nextIndex = selectedGroupIndex + direction;
    if (nextIndex < 0 || nextIndex >= noteGroups.length) return;

    const targetGroup = noteGroups[nextIndex];
    if (!targetGroup.notes.length) return;

    const selectedString = selectedNote.string ?? targetGroup.notes[0].string ?? 1;
    const selectedFret = selectedNote.fret ?? targetGroup.notes[0].fret ?? 0;
    const target = targetGroup.notes
      .slice()
      .sort(
        (a, b) =>
          Math.abs((a.string ?? selectedString) - selectedString) -
            Math.abs((b.string ?? selectedString) - selectedString) ||
          Math.abs((a.fret ?? selectedFret) - selectedFret) -
            Math.abs((b.fret ?? selectedFret) - selectedFret) ||
          a.pitch - b.pitch,
      )[0];

    if (!target) return;
    focusChordMember(target.id);
    onSeek(targetGroup.start);
  };

  const addNoteToSelectedChord = () => {
    if (!selectedNote) return;
    const usedStrings = new Set(
      selectedChordNotes
        .map((note) => note.string)
        .filter((value): value is number => typeof value === "number"),
    );
    let nextString = clamp(selectedNote.string ?? 1, 1, localTuning.length);
    if (usedStrings.has(nextString)) {
      for (let candidate = 1; candidate <= localTuning.length; candidate += 1) {
        if (!usedStrings.has(candidate)) {
          nextString = candidate;
          break;
        }
      }
    }
    const nextFret = clamp(newFret, 0, FRET_MAX);
    const nextId = crypto.randomUUID();
    onAddNotes([
      {
        id: nextId,
        trackId: selectedTrackId,
        start: selectedNote.start,
        duration: selectedNote.duration,
        velocity: selectedNote.velocity,
        string: nextString,
        fret: nextFret,
        pitch: stringFretToPitch(nextString, nextFret, localTuning),
        techniques: {},
      },
    ]);
    focusChordMember(nextId);
  };

  const applyTuningPreset = (preset: TuningPreset) => {
    setLocalTuning(preset.pitches);
    setSelectedTuningPresetId(preset.id);
    onChangeTuning?.(preset.pitches);
  };

  const applyStringCount = (nextStringCount: number) => {
    setSelectedStringCount(nextStringCount);
    const nextPresets = tuningPresetsFor(arrangementKind, nextStringCount);
    const fallbackPreset = nextPresets[0];
    if (!fallbackPreset) {
      setSelectedTuningPresetId("custom");
      return;
    }
    setLocalTuning(fallbackPreset.pitches);
    setSelectedTuningPresetId(fallbackPreset.id);
    onChangeTuning?.(fallbackPreset.pitches);
  };

  return (
    <section className="panel tabEditor">
      <div className="panelHeader tabEditorHeader">
        <h2>Tab editor</h2>
        <div className="tabToolbar">
          {headerControl}
          <label>
            Snap
            <select
              value={snap}
              onChange={(event) => setSnap(Number(event.target.value))}
            >
              <option value={0}>Free</option>
              <option value={0.03125}>1/128</option>
              <option value={0.0625}>1/64</option>
              <option value={0.125}>1/32</option>
              <option value={0.25}>1/16</option>
              <option value={0.5}>1/8</option>
              <option value={1}>1/4</option>
            </select>
          </label>
          <label>
            Nudge
            <select
              value={nudge}
              onChange={(event) => setNudge(Number(event.target.value))}
            >
              <option value={0.005}>5 ms</option>
              <option value={0.01}>10 ms</option>
              <option value={0.025}>25 ms</option>
              <option value={0.05}>50 ms</option>
              <option value={0.1}>100 ms</option>
            </select>
          </label>
          <label>
            New fret
            <input
              type="number"
              min={0}
              max={FRET_MAX}
              value={newFret}
              onChange={(event) =>
                setNewFret(clamp(Number(event.target.value), 0, FRET_MAX))
              }
            />
          </label>
        </div>
      </div>

      <div className="tabPresetBar">
        <label className="tabPresetField">
          Strings
          <select
            value={selectedStringCount}
            onChange={(event) => applyStringCount(Number(event.target.value))}
          >
            {stringCountOptions(arrangementKind).map((count) => (
              <option key={count} value={count}>
                {arrangementKind === "bass" ? `Bass ${count}-string` : `Guitar ${count}-string`}
              </option>
            ))}
          </select>
        </label>
        <label className="tabPresetField tabPresetWide">
          Tuning
          <select
            value={selectedTuningPresetId}
            onChange={(event) => {
              const nextId = event.target.value;
              if (nextId === "custom") {
                setSelectedTuningPresetId("custom");
                return;
              }
              const preset = availableTuningPresets.find((item) => item.id === nextId);
              if (!preset) return;
              applyTuningPreset(preset);
            }}
          >
            {availableTuningPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {selectedTuningPresetId === "custom" ? (
              <option value="custom">Custom (from file)</option>
            ) : null}
          </select>
        </label>
        <div className="tuningSummary" aria-live="polite">
          Open strings: {tuningSummary}
        </div>
      </div>
      {excludedTrackNotes.length ? (
        <>
          <p className="hint slimHint">
            {excludedTrackNotes.length} note(s) are outside this tuning/string setup and are shown in red with a signed fret delta.
            {excludedSummary ? ` Example: ${excludedSummary}` : ""}
          </p>
        </>
      ) : null}

      <div className="toneStickyStatus" title={`Active tone: ${activeToneName}`}>
        <span>Active tone</span>
        <strong>{activeToneName}</strong>
      </div>

      <div className="horizontalScroller paddedScroller" ref={scrollerRef}>
        {toneChanges.length ? (
          <div className="toneLane" style={{ width: `${contentWidth}px` }}>
            {toneChanges.map((change, index) => {
              const next = toneChanges[index + 1];
              const left = timeToPx(change.t);
              const right = next ? timeToPx(next.t) : contentWidth;
              return (
                <button
                  key={`${change.t}-${change.name}-${index}`}
                  type="button"
                  className="toneSegment"
                  style={{
                    left: `${left}px`,
                    width: `${Math.max(24, right - left)}px`,
                  }}
                  title={`${change.name} · ${change.t.toFixed(3)}s`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSeek(change.t);
                  }}
                >
                  <span>{change.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="toneLane emptyToneLane" style={{ width: `${contentWidth}px` }}>
            No tone/effects imported for this arrangement.
          </div>
        )}
        <div
          className="tabGrid"
          ref={gridRef}
          onClick={handleGridClick}
          onDoubleClick={handleGridDoubleClick}
          style={{ width: `${contentWidth}px` }}
        >
          {visibleStrings.map((stringInfo, row) => (
            <div
              key={stringInfo.string}
              className="tabStringRow"
              style={{ top: `${((row + 0.5) / visibleStrings.length) * 100}%` }}
            >
              <span>{midiToName(stringInfo.pitch)}</span>
            </div>
          ))}

          {trackNotes.map((note) => {
            const visualIndex = visibleStrings.findIndex(
              (item) => item.string === note.string,
            );
            const top = `${((visualIndex + 0.5) / visibleStrings.length) * 100}%`;
            const techniques = Object.entries(note.techniques ?? {})
              .filter(([, value]) => value)
              .map(([key]) => key.slice(0, 2).toUpperCase())
              .join(" ");
            return (
              <button
                key={note.id}
                type="button"
                className={`tabNote ${note.selected ? "selected" : ""}`}
                style={{
                  left: `${timeToPx(note.start)}px`,
                  width: `${Math.max(timeToPx(note.duration), 34)}px`,
                  top,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelectedExcludedNoteId(null);
                  preferredEditorNoteIdRef.current = note.id;
                  setActiveEditorNoteId(note.id);
                  onSelectNote(note.id);
                  onSeek(note.start);
                  const chordOriginals = trackNotes.filter(
                    (candidate) =>
                      Math.abs(candidate.start - note.start) <=
                      CHORD_SELECTION_TOLERANCE,
                  );
                  const chordIds = new Set(chordOriginals.map((item) => item.id));
                  const chordStart = chordOriginals.length
                    ? Math.min(...chordOriginals.map((item) => item.start))
                    : note.start;
                  const rippleOriginals = trackNotes.filter(
                    (candidate) =>
                      !chordIds.has(candidate.id) &&
                      candidate.start > chordStart + CHORD_SELECTION_TOLERANCE,
                  );
                  dragRef.current = {
                    id: note.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    dragActivated: false,
                    original: note,
                    chordOriginals,
                    rippleOriginals,
                    chordStart,
                    anchorString: note.string ?? 1,
                  };
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  updateSelected({
                    fret: clamp((note.fret ?? 0) + 1, 0, FRET_MAX),
                    string: note.string,
                  });
                }}
                title="Drag left/right to move in time. Drag up/down to change string while keeping the same MIDI note. Control+drag: ripple all following notes/chords. Double click: +1 fret."
              >
                <strong>{note.fret}</strong>
                {techniques ? <em>{techniques}</em> : null}
              </button>
            );
          })}

          {excludedTrackNotes.map((note) => {
            const top = excludedNoteTop(note.pitch);
            const selected = note.id === selectedExcludedNoteId;
            return (
              <button
                key={`excluded-${note.id}`}
                type="button"
                className={`tabNote tabExcludedNote ${selected ? "selected" : ""}`}
                style={{
                  left: `${timeToPx(note.start)}px`,
                  width: `${Math.max(timeToPx(note.duration), 52)}px`,
                  top,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  preferredEditorNoteIdRef.current = note.id;
                  setSelectedExcludedNoteId(note.id);
                  setActiveEditorNoteId(note.id);
                  onSelectNote(note.id);
                  onSeek(note.start);
                }}
                title="Excluded note for current tuning. Click to select and edit."
              >
                <strong>{excludedFretLabel(note, localTuning)}</strong>
              </button>
            );
          })}

          {syncPoints.map((point) => {
            const selected = point.id === selectedSyncPointId;
            return (
              <button
                key={point.id}
                type="button"
                className={`syncMarker tabSyncMarker ${selected ? "selected" : ""}`}
                style={{ left: `${timeToPx(point.time)}px` }}
                title={`Sync ${point.bar}.${point.beat} · ${point.time.toFixed(3)}s`}
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
                  {point.bar}.{point.beat}
                </span>
              </button>
            );
          })}

          <div
            className="playhead"
            style={{ left: `${timeToPx(currentTime)}px` }}
          />
        </div>
      </div>

      <div className="tabEditorBottom">
        <section className="selectedNotePanel noteAndChordPanel">
          <div className="subHeader">Selected note / chord</div>
          <div className="noteAndChordGrid">
            <div className="noteEditArea">
          {!selectedNote ? (
            <p className="hint slimHint">
              Double click in the tablature to add a note. Shift+double click
              adds a sync point. Select a note to edit it.
            </p>
          ) : (
            <div className="noteEditGrid">
              <label>
                String{" "}
                <input
                  type="number"
                  min={1}
                  max={localTuning.length}
                  value={toDisplayStringNumber(selectedNote.string ?? 1, localTuning.length)}
                  onChange={(event) =>
                    updateSelected({
                      string: toInternalStringNumber(
                        clamp(
                          Number(event.target.value),
                          1,
                          localTuning.length,
                        ),
                        localTuning.length,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Fret{" "}
                <input
                  type="number"
                  min={0}
                  max={FRET_MAX}
                  value={selectedNote.fret ?? 0}
                  onChange={(event) =>
                    updateSelected({
                      fret: clamp(Number(event.target.value), 0, FRET_MAX),
                    })
                  }
                />
              </label>
              <label>
                Start{" "}
                <input
                  type="number"
                  step={0.001}
                  value={selectedNote.start}
                  onChange={(event) =>
                    updateSelected({
                      start: clamp(Number(event.target.value), 0, duration),
                    })
                  }
                />
              </label>
              <label>
                Duration{" "}
                <input
                  type="number"
                  step={0.125}
                  min={0.125}
                  value={selectedNote.duration}
                  onChange={(event) =>
                    updateSelected({
                      duration: clamp(
                        Number(event.target.value),
                        0.125,
                        duration,
                      ),
                    })
                  }
                />
              </label>
              <div className="noteButtons">
                <div className="noteButtonRow navRow">
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() => selectAdjacentGroup(-1)}
                    disabled={!canGoPreviousGroup}
                  >
                    Prev note/chord
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() => selectAdjacentGroup(1)}
                    disabled={!canGoNextGroup}
                  >
                    Next note/chord
                  </button>
                </div>
                <div className="noteButtonRow">
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() =>
                      updateSelected({
                        start: clamp(Number((selectedNote.start - nudge).toFixed(4)), 0, duration),
                      })
                    }
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() =>
                      updateSelected({
                        start: clamp(Number((selectedNote.start + nudge).toFixed(4)), 0, duration),
                      })
                    }
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() =>
                      updateSelected({
                        duration: clamp(
                          selectedNote.duration + snap,
                          0.125,
                          duration,
                        ),
                      })
                    }
                  >
                    Lengthen
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() =>
                      updateSelected({
                        duration: clamp(
                          selectedNote.duration - snap,
                          0.125,
                          duration,
                        ),
                      })
                    }
                  >
                    Shorten
                  </button>
                </div>
                <div className="noteButtonRow">
                  <button
                    type="button"
                    className="smallButton"
                    title="Move to the visually upper string while keeping MIDI note and duration"
                    onClick={() => moveSelectedString(1)}
                  >
                    String ↑
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    title="Move to the visually lower string while keeping MIDI note and duration"
                    onClick={() => moveSelectedString(-1)}
                  >
                    String ↓
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() => transposeSelectedPitch(-12)}
                  >
                    Pitch -12
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() => transposeSelectedPitch(12)}
                  >
                    Pitch +12
                  </button>
                </div>
                <div className="noteButtonRow dangerRow">
                  <button
                    type="button"
                    className="dangerButton"
                    onClick={() => onDeleteNote(selectedNote.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="chordMemberEditor">
                <div className="chordMemberHeader">
                  <strong>Chord notes at {selectedNote.start.toFixed(3)}s</strong>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={addNoteToSelectedChord}
                  >
                    Add note to chord
                  </button>
                </div>
                <div className="chordMemberList">
                  {selectedChordNotes.map((note, index) => (
                    <div
                      key={note.id}
                      className={`chordMemberRow ${note.id === selectedNote.id ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        className="smallButton chordMemberTag"
                        onClick={() => focusChordMember(note.id)}
                        title="Focus this note"
                      >
                        {index + 1}. {midiToName(note.pitch)}{excludedNoteIds.has(note.id) ? ` (${excludedFretLabel(note, localTuning)})` : ""}
                      </button>
                      <label>
                        String
                        <input
                          type="number"
                          min={1}
                          max={localTuning.length}
                          value={toDisplayStringNumber(note.string ?? 1, localTuning.length)}
                          onChange={(event) =>
                            updateChordMember(note, {
                              string: toInternalStringNumber(
                                clamp(
                                  Number(event.target.value),
                                  1,
                                  localTuning.length,
                                ),
                                localTuning.length,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Fret
                        <input
                          type="number"
                          min={0}
                          max={FRET_MAX}
                          value={note.fret ?? 0}
                          onChange={(event) =>
                            updateChordMember(note, {
                              fret: clamp(Number(event.target.value), 0, FRET_MAX),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="dangerButton"
                        onClick={() => onDeleteNote(note.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
            </div>
            {chordDiagram ? <div className="inlineChordDiagram">{chordDiagram}</div> : null}
          </div>
        </section>

        <TechniquePanel
          selectedNote={selectedNote}
          onChangeNote={onChangeNote}
        />

        <section className="chordPanel">
          <div className="subHeader">Quick insert</div>
          <button
            type="button"
            className="secondaryButton"
            onClick={() =>
              addNoteAt(
                currentTime,
                arrangementKind === "bass" ? 1 : 6,
                newFret,
              )
            }
          >
            Add note at playhead
          </button>
          <button
            type="button"
            className="secondaryButton"
            onClick={addPowerChord}
          >
            Add power chord
          </button>
        </section>
      </div>

      <p className="hint">
        Double click the grid to add a note. Shift+double click adds a sync
        point. Drag a note to move it in time or to another string while keeping
        the same MIDI note when that string can play it. If you select one note
        in a chord, the other notes with the same start time are selected too.
        Use the panel to edit fret, duration, tuning, and techniques.
      </p>
    </section>
  );
}
