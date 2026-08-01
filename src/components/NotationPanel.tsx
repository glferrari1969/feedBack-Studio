import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArrangementInfo, MidiNote, ProjectState } from "../types/music";
import {
  BASS_5_TUNING,
  BASS_STANDARD_TUNING,
  DROP_D_TUNING,
  GUITAR_STANDARD_TUNING,
  pitchToPositions,
  stringFretToPitch,
} from "./FretboardMapper";
import { detectChordName } from "./ChordDiagram";
import { exportArrangement, exportNotationPdf } from "../api/backend";
import { MusicXmlPreview } from "./MusicXmlPreview";
import {
  DrumLegendIcon,
  drumIconForPieceId,
} from "./DrumLegendIcons";

interface NotationPanelProps {
  project: ProjectState;
  arrangements: ArrangementInfo[];
  selectedArrangementId: string;
  selectedArrangement?: ArrangementInfo;
  arrangementKind: "guitar" | "bass" | null;
  notes: MidiNote[];
  duration: number;
  bpm: number;
  meter: [number, number];
  onSelectArrangement: (id: string) => void;
}

type TuningPreset = {
  id: string;
  label: string;
  pitches: number[];
};

type PositionedNote = MidiNote & {
  string: number;
  fret: number;
};

type ChordGroup = {
  id: string;
  start: number;
  notes: PositionedNote[];
};

type ChordSummary = {
  id: string;
  name: string;
  notes: PositionedNote[];
  occurrences: number;
};

type TabSystem = {
  id: string;
  start: number;
  end: number;
  span: number;
  notes: PositionedNote[];
  excluded: MidiNote[];
};

type TabPlacedNote = {
  note: PositionedNote;
  left: number;
};

type SystemGuide = {
  id: string;
  left: number;
  kind: "bar" | "beat";
  barNumber?: number;
};

type PitchSpelling = {
  letterIndex: number;
  accidental: "" | "#";
};

type TechniquePlacement = {
  note: PositionedNote;
  left: number;
  tabTop: number;
  staffTop: number;
};

type TechniqueCurve = {
  id: string;
  d: string;
  kind: "legato" | "slide" | "vibrato" | "bend";
};

type TechniqueLabel = {
  id: string;
  left: number;
  top: number;
  text: string;
  kind: "legato" | "palm" | "bend";
};

type TechniqueSpan = {
  id: string;
  start: number;
  end: number;
  top: number;
};

type SystemTimingLayout = {
  guides: SystemGuide[];
  mapTimeToLeft: (time: number) => number;
};

type NoteRhythmGlyph = {
  hollow: boolean;
  stem: boolean;
  flags: 0 | 1 | 2 | 3;
  dotted: boolean;
};

const FRET_MAX = 24;
const CHORD_SELECTION_TOLERANCE = 0.02;
const OPEN_POSITION_MAX_FRET = 4;
// Keep this switch for future troubleshooting without exposing debug UI in normal usage.
const ENABLE_NOTATION_PDF_DEBUG = false;
const TREBLE_STAFF_BOTTOM_DIATONIC = 30; // E4
const BASS_STAFF_BOTTOM_DIATONIC = 18; // G2
const PITCH_CLASS_TO_SPELLING: PitchSpelling[] = [
  { letterIndex: 0, accidental: "" },
  { letterIndex: 0, accidental: "#" },
  { letterIndex: 1, accidental: "" },
  { letterIndex: 1, accidental: "#" },
  { letterIndex: 2, accidental: "" },
  { letterIndex: 3, accidental: "" },
  { letterIndex: 3, accidental: "#" },
  { letterIndex: 4, accidental: "" },
  { letterIndex: 4, accidental: "#" },
  { letterIndex: 5, accidental: "" },
  { letterIndex: 5, accidental: "#" },
  { letterIndex: 6, accidental: "" },
];

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

type DrumNotationLane = {
  id: string;
  label: string;
  fullName: string;
  symbol: string;
  pitches: number[];
  staffStep: number;
  notehead: "x" | "normal";
  stemDirection: "up" | "down";
};

type DrumPlacedHit = MidiNote & {
  laneIndex: number;
  lane: DrumNotationLane;
  quantizedStart: number;
  staffStep: number;
  notehead: "x" | "normal";
  stemDirection: "up" | "down";
  openRing: boolean;
  displayName: string;
};

type DrumScorePlacedHit = {
  id: string;
  lane: DrumNotationLane;
  staffStep: number;
  notehead: "x" | "normal";
  stemDirection: "up" | "down";
  openRing: boolean;
  x: number;
  y: number;
  title: string;
};

type DrumStaffLegendBaseItem = {
  id: string;
  label: string;
  pieceId: string;
  pitch: number;
};

type DrumStaffLegendItem = DrumStaffLegendBaseItem & {
  laneLabel: string;
  staffStep: number;
  notehead: "x" | "normal";
  stemDirection: "up" | "down";
  openRing: boolean;
  active: boolean;
};

type DrumScoreSystem = {
  id: string;
  systemIndex: number;
  startBar: number;
  endBar: number;
  beatsPerSystem: number;
  beatDuration: number;
  startTime: number;
  endTime: number;
  staffTop: number;
  staffBottom: number;
  staffLeft: number;
  staffRight: number;
  staffSpacing: number;
  noteHeadRadiusX: number;
  noteHeadRadiusY: number;
  hits: DrumScorePlacedHit[];
};

const DRUM_SCORE_BARS_PER_SYSTEM = 4;
const DRUM_SCORE_GUIDE_SUBDIVISIONS = 4;
const DRUM_SCORE_VIEWBOX_WIDTH = 1140;
const DRUM_SCORE_SYSTEM_HEIGHT = 208;
const DRUM_SCORE_STAFF_TOP = 72;
const DRUM_SCORE_STAFF_LINE_SPACING = 14;
const DRUM_SCORE_STAFF_LEFT = 56;
const DRUM_SCORE_STAFF_RIGHT = 1128;

const DRUM_STAFF_LEGEND_BASE: DrumStaffLegendBaseItem[] = [
  { id: "kick", label: "Kick / Bass Drum", pieceId: "kick", pitch: 36 },
  { id: "floor", label: "Floor Tom", pieceId: "tom_floor", pitch: 41 },
  { id: "tom1", label: "Tom Drum 1", pieceId: "tom_hi", pitch: 50 },
  { id: "tom2", label: "Tom Drum 2", pieceId: "tom_mid", pitch: 47 },
  { id: "snare", label: "Snare Drum", pieceId: "snare", pitch: 38 },
  { id: "ride", label: "Ride Cymbal", pieceId: "ride", pitch: 51 },
  { id: "hh_closed", label: "Closed Hi-Hat", pieceId: "hh_closed", pitch: 42 },
  { id: "hh_open", label: "Open Hi-Hat", pieceId: "hh_open", pitch: 46 },
  { id: "hh_pedal", label: "Hi-Hat Pedal", pieceId: "hh_pedal", pitch: 44 },
  { id: "crash", label: "Crash Cymbal", pieceId: "crash_l", pitch: 49 },
];

const DRUM_NOTATION_LANES: DrumNotationLane[] = [
  {
    id: "hh",
    label: "HH",
    fullName: "Hi-Hat",
    symbol: "x",
    pitches: [46, 44, 42],
    staffStep: -1,
    notehead: "x",
    stemDirection: "up",
  },
  {
    id: "sn",
    label: "Sn",
    fullName: "Snare",
    symbol: "o",
    pitches: [40, 38, 37],
    staffStep: 4,
    notehead: "normal",
    stemDirection: "up",
  },
  {
    id: "t1",
    label: "T1",
    fullName: "Tom High",
    symbol: "o",
    pitches: [50, 48],
    staffStep: 1,
    notehead: "normal",
    stemDirection: "up",
  },
  {
    id: "t2",
    label: "T2",
    fullName: "Tom Mid",
    symbol: "o",
    pitches: [47, 45],
    staffStep: 3,
    notehead: "normal",
    stemDirection: "up",
  },
  {
    id: "t3",
    label: "T3",
    fullName: "Tom Low / Floor",
    symbol: "o",
    pitches: [43, 41],
    staffStep: 6,
    notehead: "normal",
    stemDirection: "down",
  },
  {
    id: "cr",
    label: "Cr",
    fullName: "Crash / China / Splash",
    symbol: "X",
    pitches: [57, 55, 52, 49, 30],
    staffStep: -3,
    notehead: "x",
    stemDirection: "up",
  },
  {
    id: "ri",
    label: "Ri",
    fullName: "Ride / Bell",
    symbol: "O",
    pitches: [59, 53, 51, 80],
    staffStep: -2,
    notehead: "x",
    stemDirection: "up",
  },
  {
    id: "ki",
    label: "Ki",
    fullName: "Kick",
    symbol: "K",
    pitches: [36, 35],
    staffStep: 10,
    notehead: "normal",
    stemDirection: "down",
  },
];

function drumLaneIndexForPitch(pitch: number): number {
  const direct = DRUM_NOTATION_LANES.findIndex((lane) => lane.pitches.includes(pitch));
  if (direct >= 0) return direct;
  let fallbackIndex = DRUM_NOTATION_LANES.length - 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  DRUM_NOTATION_LANES.forEach((lane, index) => {
    const base = lane.pitches[0] ?? 36;
    const distance = Math.abs(base - pitch);
    if (distance < bestDistance) {
      bestDistance = distance;
      fallbackIndex = index;
    }
  });
  return fallbackIndex;
}

function drumLedgerSteps(staffStep: number): number[] {
  const steps: number[] = [];
  if (staffStep < 0) {
    for (let step = -2; step >= staffStep; step -= 2) {
      steps.push(step);
    }
  }
  if (staffStep > 8) {
    for (let step = 10; step <= staffStep; step += 2) {
      steps.push(step);
    }
  }
  return steps;
}

function resolveDrumHitStyle(note: MidiNote, lane: DrumNotationLane) {
  let staffStep = lane.staffStep;
  let notehead = lane.notehead;
  let stemDirection = lane.stemDirection;
  let openRing = false;
  let displayName = lane.fullName;

  if (lane.id === "hh") {
    if (note.pitch === 46) {
      openRing = true;
      displayName = "Open Hi-Hat";
    } else if (note.pitch === 44) {
      staffStep = 9;
      stemDirection = "down";
      displayName = "Hi-Hat Pedal";
    } else {
      displayName = "Closed Hi-Hat";
    }
    notehead = "x";
  }

  if (lane.id === "ri" && note.pitch === 53) {
    displayName = "Ride Bell";
  }

  return {
    staffStep,
    notehead,
    stemDirection,
    openRing,
    displayName,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midiToName(pitch: number, includeOctave = true) {
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
  const base = names[((pitch % 12) + 12) % 12];
  if (!includeOctave) return base;
  return `${base}${Math.floor(pitch / 12) - 1}`;
}

function formatTuningNotes(tuning: number[]) {
  return tuning.map((pitch) => midiToName(pitch)).join(" ");
}

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

function formatTime(value: number) {
  const total = Math.max(0, value);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

function getVisualStrings(tuning: number[]) {
  return tuning.map((pitch, index) => ({ string: index + 1, pitch })).reverse();
}

function toWrittenPitchForStaff(
  pitch: number,
  arrangementKind: "guitar" | "bass" | null,
) {
  // Guitar notation is conventionally written one octave above sounding pitch.
  return arrangementKind === "guitar" ? pitch + 12 : pitch;
}

function toPitchSpelling(pitch: number) {
  return PITCH_CLASS_TO_SPELLING[((pitch % 12) + 12) % 12];
}

function pitchToDiatonicIndex(pitch: number) {
  const spelling = toPitchSpelling(pitch);
  const octave = Math.floor(pitch / 12) - 1;
  return octave * 7 + spelling.letterIndex;
}

function ledgerOffsetsForRelativeStep(relativeStep: number) {
  const offsets: number[] = [];
  if (relativeStep < 0) {
    for (let step = -2; step >= relativeStep; step -= 2) {
      offsets.push(step);
    }
  }
  if (relativeStep > 8) {
    for (let step = 10; step <= relativeStep; step += 2) {
      offsets.push(step);
    }
  }
  return offsets;
}

function buildTriangularWavePath(
  startX: number,
  endX: number,
  y: number,
  amplitude: number,
  peaks: number,
) {
  if (endX <= startX) return `M ${startX} ${y}`;
  const segments = Math.max(2, peaks * 2);
  let path = `M ${startX} ${y}`;
  for (let index = 1; index <= segments; index += 1) {
    const x = startX + ((endX - startX) * index) / segments;
    const delta = index === segments
      ? 0
      : index % 2 === 1
        ? -amplitude
        : amplitude;
    path += ` L ${x} ${y + delta}`;
  }
  return path;
}

function formatBendAmount(semitones: number) {
  if (semitones <= 1) return "1/2";
  if (semitones === 2) return "full";
  if (semitones === 3) return "1 1/2";
  return "2";
}

const RHYTHM_CANDIDATES: Array<{ beats: number; glyph: NoteRhythmGlyph }> = [
  { beats: 4, glyph: { hollow: true, stem: false, flags: 0, dotted: false } },
  { beats: 3, glyph: { hollow: true, stem: true, flags: 0, dotted: true } },
  { beats: 2, glyph: { hollow: true, stem: true, flags: 0, dotted: false } },
  { beats: 1.5, glyph: { hollow: false, stem: true, flags: 0, dotted: true } },
  { beats: 1, glyph: { hollow: false, stem: true, flags: 0, dotted: false } },
  { beats: 0.75, glyph: { hollow: false, stem: true, flags: 1, dotted: true } },
  { beats: 0.5, glyph: { hollow: false, stem: true, flags: 1, dotted: false } },
  { beats: 0.375, glyph: { hollow: false, stem: true, flags: 2, dotted: true } },
  { beats: 0.25, glyph: { hollow: false, stem: true, flags: 2, dotted: false } },
  { beats: 0.1875, glyph: { hollow: false, stem: true, flags: 3, dotted: true } },
  { beats: 0.125, glyph: { hollow: false, stem: true, flags: 3, dotted: false } },
];

function classifyNoteRhythm(duration: number, beatDuration: number): NoteRhythmGlyph {
  const safeBeatDuration = Math.max(beatDuration, 0.001);
  const durationBeats = Math.max(duration / safeBeatDuration, 0.0625);
  let best = RHYTHM_CANDIDATES[0];
  let bestScore = Number.POSITIVE_INFINITY;

  RHYTHM_CANDIDATES.forEach((candidate) => {
    const score = Math.abs(Math.log(durationBeats / candidate.beats));
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  });

  return { ...best.glyph };
}

function isExactPositionPlayable(
  note: MidiNote,
  tuning: number[],
): note is PositionedNote {
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
  const positionedNotes: PositionedNote[] = [];
  const excludedNotes: MidiNote[] = [];
  let previous: { string: number; fret: number } | undefined;

  trackNotes.forEach((note) => {
    if (isExactPositionPlayable(note, tuning)) {
      const fixedNote: PositionedNote = {
        ...note,
        string: note.string,
        fret: note.fret,
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

    const mappedNote: PositionedNote = {
      ...note,
      string: next.string,
      fret: next.fret,
    };
    positionedNotes.push(mappedNote);
    previous = { string: mappedNote.string, fret: mappedNote.fret };
  });

  return { positionedNotes, excludedNotes };
}

function groupChordEvents(notes: PositionedNote[]) {
  const groups: ChordGroup[] = [];
  const sorted = [...notes].sort(
    (a, b) =>
      a.start - b.start ||
      (a.string ?? 0) - (b.string ?? 0) ||
      (a.fret ?? 0) - (b.fret ?? 0) ||
      a.pitch - b.pitch,
  );

  sorted.forEach((note) => {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.start - note.start) <= CHORD_SELECTION_TOLERANCE) {
      last.notes.push(note);
      return;
    }
    groups.push({
      id: `${note.id}-${Math.round(note.start * 1000)}`,
      start: note.start,
      notes: [note],
    });
  });

  return groups
    .map((group) => ({
      ...group,
      notes: group.notes.sort(
        (a, b) =>
          (a.string ?? 0) - (b.string ?? 0) ||
          (a.fret ?? 0) - (b.fret ?? 0) ||
          a.pitch - b.pitch,
      ),
    }))
    .filter((group) => group.notes.length > 1);
}

function buildTabSystems(
  positionedNotes: PositionedNote[],
  excludedNotes: MidiNote[],
  duration: number,
  systemDuration: number,
) {
  const positionedLast = positionedNotes.reduce(
    (max, note) => Math.max(max, note.start + Math.max(note.duration, 0)),
    0,
  );
  const excludedLast = excludedNotes.reduce(
    (max, note) => Math.max(max, note.start),
    0,
  );
  const timelineEnd = Math.max(
    positionedLast,
    excludedLast,
    Math.min(Math.max(duration, 0), systemDuration),
  );
  const totalDuration = Math.max(systemDuration, timelineEnd);
  const systemCount = Math.max(1, Math.ceil(totalDuration / systemDuration));

  return Array.from({ length: systemCount }, (_, index): TabSystem => {
    const start = index * systemDuration;
    const end = Math.min(totalDuration, start + systemDuration);
    const span = Math.max(0.5, end - start);

    return {
      id: `tab-system-${index}`,
      start,
      end,
      span,
      notes: positionedNotes
        .filter((note) => note.start >= start && note.start < end)
        .sort((a, b) => a.start - b.start || a.string - b.string || a.fret - b.fret),
      excluded: excludedNotes
        .filter((note) => note.start >= start && note.start < end)
        .sort((a, b) => a.start - b.start || a.pitch - b.pitch),
    };
  });
}

function buildSystemGuides(
  system: TabSystem,
  bpm: number,
  meter: [number, number],
) : SystemTimingLayout {
  const { start, end, span } = system;
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const beatsPerBar = Number.isFinite(meter[0]) && meter[0] > 0
    ? Math.max(1, Math.round(meter[0]))
    : 4;
  const beatUnit = Number.isFinite(meter[1]) && meter[1] > 0
    ? Math.max(1, Math.round(meter[1]))
    : 4;
  const beatDuration = (60 / safeBpm) * (4 / beatUnit);
  const linearMap = (time: number) => clamp(((time - start) / span) * 100, 0, 100);

  if (!Number.isFinite(beatDuration) || beatDuration <= 0 || span <= 0) {
    return {
      guides: [
        { id: "fallback-start", left: 0, kind: "bar" },
        { id: "fallback-end", left: 100, kind: "bar" },
      ],
      mapTimeToLeft: linearMap,
    };
  }

  const firstBeatIndex = Math.max(0, Math.floor(start / beatDuration));
  const lastBeatIndex = Math.max(firstBeatIndex, Math.ceil(end / beatDuration) - 1);
  const epsilon = 0.000001;
  const slots: Array<{
    beatIndex: number;
    start: number;
    end: number;
    leftStart: number;
    leftEnd: number;
    scaledWeight: number;
  }> = [];

  for (let beatIndex = firstBeatIndex; beatIndex <= lastBeatIndex; beatIndex += 1) {
    const beatStart = Math.max(start, beatIndex * beatDuration);
    const beatEnd = Math.min(end, (beatIndex + 1) * beatDuration);
    const beatSpan = beatEnd - beatStart;
    if (beatSpan <= epsilon) continue;

    const notesInBeat = system.notes.filter(
      (note) => note.start >= beatStart - CHORD_SELECTION_TOLERANCE && note.start < beatEnd - epsilon,
    );
    const onsetStacks = new Map<number, number>();
    notesInBeat.forEach((note) => {
      const onsetKey = Math.round(note.start / CHORD_SELECTION_TOLERANCE);
      onsetStacks.set(onsetKey, (onsetStacks.get(onsetKey) ?? 0) + 1);
    });
    const uniqueOnsets = onsetStacks.size;
    const maxStack = onsetStacks.size
      ? Math.max(...Array.from(onsetStacks.values()))
      : 0;
    const excludedInBeat = system.excluded.filter(
      (note) => note.start >= beatStart - CHORD_SELECTION_TOLERANCE && note.start < beatEnd - epsilon,
    ).length;

    const baseWeight = notesInBeat.length
      ? 1 + uniqueOnsets * 0.28 + Math.max(0, maxStack - 1) * 0.14 + excludedInBeat * 0.08
      : 0.9;
    const scaledWeight = clamp(baseWeight, 0.86, 2.9) * (beatSpan / beatDuration);

    slots.push({
      beatIndex,
      start: beatStart,
      end: beatEnd,
      leftStart: 0,
      leftEnd: 0,
      scaledWeight,
    });
  }

  if (!slots.length) {
    return {
      guides: [
        { id: "guide-start", left: 0, kind: "bar" },
        { id: "guide-end", left: 100, kind: "bar" },
      ],
      mapTimeToLeft: linearMap,
    };
  }

  const totalWeight = slots.reduce((sum, slot) => sum + slot.scaledWeight, 0);
  let cursor = 0;
  slots.forEach((slot, index) => {
    slot.leftStart = cursor;
    if (index === slots.length - 1 || totalWeight <= epsilon) {
      cursor = 100;
    } else {
      cursor += (slot.scaledWeight / totalWeight) * 100;
    }
    slot.leftEnd = cursor;
  });

  const guides: SystemGuide[] = slots.map((slot) => {
    const isBar = slot.beatIndex % beatsPerBar === 0;
    return {
      id: `guide-${slot.beatIndex}`,
      left: slot.leftStart,
      kind: isBar ? "bar" : "beat",
      barNumber: isBar ? Math.floor(slot.beatIndex / beatsPerBar) + 1 : undefined,
    };
  });

  if (!guides.length || Math.abs(guides[0].left) > 0.2) {
    guides.unshift({ id: "guide-start", left: 0, kind: "bar" });
  }
  if (Math.abs(guides[guides.length - 1].left - 100) > 0.2) {
    guides.push({ id: "guide-end", left: 100, kind: "bar" });
  }

  const mapTimeToLeft = (time: number) => {
    if (time <= start) return 0;
    if (time >= end) return 100;
    const slot = slots.find((candidate) => time <= candidate.end + epsilon) ?? slots[slots.length - 1];
    const localSpan = Math.max(slot.end - slot.start, epsilon);
    const ratio = clamp((time - slot.start) / localSpan, 0, 1);
    return clamp(slot.leftStart + ratio * (slot.leftEnd - slot.leftStart), 0, 100);
  };

  return {
    guides,
    mapTimeToLeft,
  };
}

function layoutSystemNotes(system: TabSystem, mapTimeToLeft: (time: number) => number) {
  const minSpacing = 2.8;
  const lastLeftByString = new Map<number, number>();

  return system.notes
    .slice()
    .sort((a, b) => a.start - b.start || a.string - b.string || a.fret - b.fret)
    .map((note): TabPlacedNote => {
      const baseLeft = mapTimeToLeft(note.start);
      const previous = lastLeftByString.get(note.string) ?? -100;
      const adjusted = clamp(
        baseLeft - previous < minSpacing ? previous + minSpacing : baseLeft,
        0,
        99.5,
      );
      lastLeftByString.set(note.string, adjusted);
      return { note, left: adjusted };
    });
}

function ChordCard({
  chord,
  tuning,
}: {
  chord: ChordSummary;
  tuning: number[];
}) {
  const fretted = chord.notes.filter((note) => (note.fret ?? 0) > 0);
  const minFret = fretted.reduce((min, note) => Math.min(min, note.fret), 99);
  const maxFret = fretted.reduce((max, note) => Math.max(max, note.fret), 0);
  const useNutPosition = maxFret > 0 && maxFret <= OPEN_POSITION_MAX_FRET;
  const baseFret = minFret === 99 || useNutPosition ? 1 : clamp(minFret, 1, 20);
  const fretCount = 5;
  const stringCount = tuning.length;
  const width = Math.max(62, stringCount * 10 + 11);
  const height = 84;
  const top = 13;
  const left = 10;
  const gridWidth = width - 20;
  const gridHeight = 57;
  const stringGap = stringCount > 1 ? gridWidth / (stringCount - 1) : gridWidth;
  const fretGap = gridHeight / fretCount;
  const playedStrings = new Set(
    chord.notes
      .filter((note) => typeof note.string === "number")
      .map((note) => clamp(note.string, 1, stringCount)),
  );
  const playedNotesByString = Array.from({ length: stringCount }, (_, index) => {
    const stringNumber = index + 1;
    const onString = chord.notes
      .filter((note) => note.string === stringNumber)
      .sort((a, b) => b.fret - a.fret || b.pitch - a.pitch)[0];
    return onString ? midiToName(onString.pitch, false) : "-";
  });

  return (
    <article className="notationChordCard notationPaperCard">
      <div className="notationChordHead">
        <strong>{chord.name}</strong>
        {chord.occurrences > 1 ? <span>{chord.occurrences}x</span> : null}
      </div>
      <svg
        className="chordDiagram notationChordDiagram"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Chord ${chord.name}`}
      >
        {Array.from({ length: stringCount }).map((_, stringIndex) => {
          const x = left + stringIndex * stringGap;
          return <line key={`s-${stringIndex}`} x1={x} y1={top} x2={x} y2={top + gridHeight} />;
        })}

        {Array.from({ length: stringCount }).map((_, stringIndex) => {
          const stringNumber = stringIndex + 1;
          if (playedStrings.has(stringNumber)) return null;
          const x = left + stringIndex * stringGap;
          return (
            <text key={`mute-${stringIndex}`} x={x} y={8} textAnchor="middle">
              X
            </text>
          );
        })}

        {Array.from({ length: fretCount + 1 }).map((_, fretIndex) => {
          const y = top + fretIndex * fretGap;
          return (
            <line
              key={`f-${fretIndex}`}
              x1={left}
              y1={y}
              x2={left + gridWidth}
              y2={y}
              className={fretIndex === 0 ? "nutLine" : ""}
            />
          );
        })}

        {baseFret > 1 ? <text x={1} y={top + fretGap * 0.7}>{baseFret}</text> : null}

        {playedNotesByString.map((playedNote, stringIndex) => {
          const x = left + stringIndex * stringGap;
          const isSilent = playedNote === "-";
          return (
            <text
              key={`label-${stringIndex}`}
              x={x}
              y={top + gridHeight + 10}
              className={isSilent ? "stringLabel notationMutedLabel" : "stringLabel notationPlayedLabel"}
              textAnchor="middle"
            >
              {playedNote}
            </text>
          );
        })}

        {chord.notes.map((note) => {
          const visualStringIndex = clamp((note.string ?? 1) - 1, 0, stringCount - 1);
          const x = left + visualStringIndex * stringGap;
          const fret = note.fret ?? 0;

          if (fret === 0) {
            return (
              <text key={note.id} x={x} y={8} textAnchor="middle">
                0
              </text>
            );
          }

          const relativeFret = clamp(fret - baseFret + 1, 1, fretCount);
          const y = top + (relativeFret - 0.5) * fretGap;
          return (
            <g key={note.id}>
              <circle cx={x} cy={y} r={4.4} />
            </g>
          );
        })}
      </svg>
    </article>
  );
}

export function NotationPanel({
  project,
  arrangements,
  selectedArrangementId,
  selectedArrangement,
  arrangementKind,
  notes,
  duration,
  bpm,
  meter,
  onSelectArrangement,
}: NotationPanelProps) {
  const [musicXmlZoom, setMusicXmlZoom] = useState(1.5);
  const [drumNotationZoom, setDrumNotationZoom] = useState(1);
  const [musicXmlText, setMusicXmlText] = useState("");
  const [musicXmlBusy, setMusicXmlBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [musicXmlError, setMusicXmlError] = useState<string | null>(null);
  const [pdfDebugInfo, setPdfDebugInfo] = useState<string | null>(null);
  const [selectedStringCount, setSelectedStringCount] = useState(6);
  const [selectedTuningPresetId, setSelectedTuningPresetId] = useState("custom");
  const [localTuning, setLocalTuning] = useState<number[]>(GUITAR_STANDARD_TUNING);

  const drumArrangementActive = useMemo(() => {
    if (!selectedArrangement) return false;
    if (selectedArrangement.type === "drums") return true;
    if (selectedArrangement.id === "__drum_tab__") return true;
    const text = `${selectedArrangement.id} ${selectedArrangement.name} ${selectedArrangement.file ?? ""}`.toLowerCase();
    return text.includes("drum") || text.includes("percussion");
  }, [selectedArrangement]);

  const keysArrangementActive = useMemo(() => {
    if (!selectedArrangement || drumArrangementActive) return false;
    if (selectedArrangement.type === "keys" || selectedArrangement.type === "piano") {
      return true;
    }
    const text = `${selectedArrangement.id} ${selectedArrangement.name} ${selectedArrangement.file ?? ""}`.toLowerCase();
    return ["keys", "piano", "keyboard"].some((word) => text.includes(word));
  }, [drumArrangementActive, selectedArrangement]);

  const arrangementTuningKey = selectedArrangement?.tuning?.join(",") ?? "";
  const frettedArrangementKind =
    arrangementKind === "guitar" || arrangementKind === "bass"
      ? arrangementKind
      : null;

  useEffect(() => {
    if (!frettedArrangementKind) return;
    const defaultTuning =
      frettedArrangementKind === "bass" ? BASS_STANDARD_TUNING : GUITAR_STANDARD_TUNING;
    const initialTuning = selectedArrangement?.tuning?.length
      ? selectedArrangement.tuning
      : defaultTuning;
    const availableStringCounts = stringCountOptions(frettedArrangementKind);
    const nextStringCount = availableStringCounts.includes(initialTuning.length)
      ? initialTuning.length
      : availableStringCounts[0];
    const fallbackPreset = tuningPresetsFor(frettedArrangementKind, nextStringCount)[0];
    const alignedTuning =
      initialTuning.length === nextStringCount
        ? initialTuning
        : fallbackPreset?.pitches ?? defaultTuning;

    setSelectedStringCount(nextStringCount);
    setLocalTuning(alignedTuning);
    setSelectedTuningPresetId(
      matchingPresetId(frettedArrangementKind, nextStringCount, alignedTuning),
    );
  }, [frettedArrangementKind, arrangementTuningKey, selectedArrangementId]);

  useEffect(() => {
    if (!frettedArrangementKind) return;
    setSelectedTuningPresetId(
      matchingPresetId(frettedArrangementKind, selectedStringCount, localTuning),
    );
  }, [frettedArrangementKind, localTuning, selectedStringCount]);

  const availableTuningPresets = useMemo(
    () =>
      frettedArrangementKind
        ? tuningPresetsFor(frettedArrangementKind, selectedStringCount)
        : ([] as TuningPreset[]),
    [frettedArrangementKind, selectedStringCount],
  );

  const tuningSummary = useMemo(() => formatTuningNotes(localTuning), [localTuning]);

  const trackNotes = useMemo(
    () =>
      notes
        .filter((note) => note.trackId === selectedArrangementId)
        .sort((a, b) => a.start - b.start),
    [notes, selectedArrangementId],
  );

  const mappedTrack = useMemo(
    () => mapTrackNotesToTuning(trackNotes, localTuning),
    [localTuning, trackNotes],
  );

  const chordGroups = useMemo(
    () => groupChordEvents(mappedTrack.positionedNotes),
    [mappedTrack.positionedNotes],
  );

  const chordSummary = useMemo(() => {
    const map = new Map<string, ChordSummary>();

    chordGroups.forEach((group, index) => {
      const name = detectChordName(group.notes);
      const key = name.trim().toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.occurrences += 1;
        return;
      }

      map.set(key, {
        id: `${key || "chord"}-${index}`,
        name,
        notes: group.notes,
        occurrences: 1,
      });
    });

    return Array.from(map.values());
  }, [chordGroups]);

  const musicXmlRequestRef = useRef(0);
  const notationSheetRef = useRef<HTMLElement | null>(null);

  const applyTuningPreset = (preset: TuningPreset) => {
    setLocalTuning(preset.pitches);
    setSelectedTuningPresetId(preset.id);
  };

  const applyStringCount = (nextStringCount: number) => {
    if (!frettedArrangementKind) return;
    setSelectedStringCount(nextStringCount);
    const nextPresets = tuningPresetsFor(frettedArrangementKind, nextStringCount);
    const fallbackPreset = nextPresets[0];
    if (!fallbackPreset) {
      setSelectedTuningPresetId("custom");
      return;
    }
    setLocalTuning(fallbackPreset.pitches);
    setSelectedTuningPresetId(fallbackPreset.id);
  };

  const excludedPreview = mappedTrack.excludedNotes
    .slice(0, 5)
    .map((note) => `${formatTime(note.start)} - ${midiToName(note.pitch)}`)
    .join(" | ");

  const unsupportedKind =
    !keysArrangementActive &&
    frettedArrangementKind === null;

  const drumDuration = Math.max(0.1, duration || 0.1);
  const drumBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const drumBeatUnit = Number.isFinite(meter[1]) && meter[1] > 0 ? meter[1] : 4;
  const drumBeatDuration = (60 / drumBpm) * (4 / drumBeatUnit);
  const drumBeatsPerBar = Number.isFinite(meter[0]) && meter[0] > 0 ? Math.round(meter[0]) : 4;
  const drumBarDuration = Math.max(0.001, drumBeatDuration * Math.max(1, drumBeatsPerBar));

  const drumPlacedHits = useMemo<DrumPlacedHit[]>(
    () =>
      trackNotes.map((note) => {
        const laneIndex = drumLaneIndexForPitch(note.pitch);
        const lane = DRUM_NOTATION_LANES[laneIndex];
        const hitStyle = resolveDrumHitStyle(note, lane);
        const quantizedStart = clamp(note.start, 0, drumDuration);
        return {
          ...note,
          laneIndex,
          lane,
          quantizedStart,
          staffStep: hitStyle.staffStep,
          notehead: hitStyle.notehead,
          stemDirection: hitStyle.stemDirection,
          openRing: hitStyle.openRing,
          displayName: hitStyle.displayName,
        };
      }),
    [drumDuration, trackNotes],
  );

  const usedDrumPieceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const hit of drumPlacedHits) {
      if (hit.lane.id === "hh") {
        if (hit.pitch === 46) {
          ids.add("hh_open");
        } else if (hit.pitch === 44) {
          ids.add("hh_pedal");
        } else {
          ids.add("hh_closed");
        }
        continue;
      }
      if (hit.lane.id === "sn") {
        ids.add("snare");
        continue;
      }
      if (hit.lane.id === "t1") {
        ids.add("tom_hi");
        continue;
      }
      if (hit.lane.id === "t2") {
        ids.add("tom_mid");
        continue;
      }
      if (hit.lane.id === "t3") {
        ids.add("tom_floor");
        continue;
      }
      if (hit.lane.id === "ri") {
        ids.add("ride");
        continue;
      }
      if (hit.lane.id === "cr") {
        ids.add("crash_l");
        continue;
      }
      if (hit.lane.id === "ki") {
        ids.add("kick");
      }
    }
    return ids;
  }, [drumPlacedHits]);

  const drumStaffLegendItems = useMemo<DrumStaffLegendItem[]>(() => {
    return DRUM_STAFF_LEGEND_BASE.map((item) => {
      const laneIndex = drumLaneIndexForPitch(item.pitch);
      const lane = DRUM_NOTATION_LANES[laneIndex];
      const legendNote: MidiNote = {
        id: `legend-${item.id}`,
        trackId: "legend",
        pitch: item.pitch,
        start: 0,
        duration: 0.25,
        velocity: 100,
      };
      const style = resolveDrumHitStyle(legendNote, lane);
      return {
        ...item,
        laneLabel: lane.label,
        staffStep: style.staffStep,
        notehead: style.notehead,
        stemDirection: style.stemDirection,
        openRing: style.openRing,
        active: usedDrumPieceIds.has(item.pieceId),
      };
    }).sort((a, b) => a.staffStep - b.staffStep || a.label.localeCompare(b.label));
  }, [usedDrumPieceIds]);

  const drumScoreSystems = useMemo<DrumScoreSystem[]>(() => {
    const maxNoteTime = drumPlacedHits.reduce(
      (max, note) => Math.max(max, note.quantizedStart + Math.max(0.01, note.duration)),
      0,
    );
    const timelineEnd = Math.max(drumDuration, maxNoteTime);
    const barCount = Math.max(1, Math.ceil(timelineEnd / drumBarDuration));
    const systemCount = Math.max(1, Math.ceil(barCount / DRUM_SCORE_BARS_PER_SYSTEM));
    const staffBottom = DRUM_SCORE_STAFF_TOP + DRUM_SCORE_STAFF_LINE_SPACING * 4;

    return Array.from({ length: systemCount }, (_, systemIndex) => {
      const startBar = systemIndex * DRUM_SCORE_BARS_PER_SYSTEM;
      const endBar = Math.min(barCount, startBar + DRUM_SCORE_BARS_PER_SYSTEM);
      const barsInSystem = Math.max(1, endBar - startBar);
      const startTime = startBar * drumBarDuration;
      const endTime = endBar * drumBarDuration;
      const systemDuration = Math.max(0.001, endTime - startTime);
      const beatsPerSystem = barsInSystem * drumBeatsPerBar;
      const contentWidth = DRUM_SCORE_STAFF_RIGHT - DRUM_SCORE_STAFF_LEFT;
      const stepToY = (staffStep: number) =>
        DRUM_SCORE_STAFF_TOP + (staffStep * DRUM_SCORE_STAFF_LINE_SPACING) / 2;

      const hits = drumPlacedHits
        .filter((note) => note.quantizedStart >= startTime && note.quantizedStart < endTime)
        .map((note) => {
          const localTime = clamp(note.quantizedStart - startTime, 0, systemDuration);
          const x = DRUM_SCORE_STAFF_LEFT + (localTime / systemDuration) * contentWidth;
          return {
            id: note.id,
            lane: note.lane,
            staffStep: note.staffStep,
            notehead: note.notehead,
            stemDirection: note.stemDirection,
            openRing: note.openRing,
            x,
            y: stepToY(note.staffStep),
            title: `${note.displayName} - ${note.start.toFixed(3)}s`,
          };
        })
        .sort((a, b) => a.x - b.x || a.y - b.y);

      return {
        id: `drum-system-${systemIndex}`,
        systemIndex,
        startBar,
        endBar,
        beatsPerSystem,
        beatDuration: drumBeatDuration,
        startTime,
        endTime,
        staffTop: DRUM_SCORE_STAFF_TOP,
        staffBottom,
        staffLeft: DRUM_SCORE_STAFF_LEFT,
        staffRight: DRUM_SCORE_STAFF_RIGHT,
        staffSpacing: DRUM_SCORE_STAFF_LINE_SPACING,
        noteHeadRadiusX: 6,
        noteHeadRadiusY: 4.2,
        hits,
      };
    });
  }, [drumBarDuration, drumBeatDuration, drumBeatsPerBar, drumDuration, drumPlacedHits]);

  const loadMusicXml = useCallback(async (targetProject: ProjectState) => {
    if (!selectedArrangementId || unsupportedKind) {
      musicXmlRequestRef.current += 1;
      setMusicXmlBusy(false);
      setMusicXmlText("");
      setMusicXmlError(null);
      return;
    }

    const requestId = musicXmlRequestRef.current + 1;
    musicXmlRequestRef.current = requestId;
    setMusicXmlBusy(true);
    setMusicXmlError(null);
    try {
      const { blob } = await exportArrangement(targetProject, selectedArrangementId, "musicxml");
      const xml = await blob.text();
      if (requestId !== musicXmlRequestRef.current) return;
      setMusicXmlText(xml);
    } catch (error) {
      if (requestId !== musicXmlRequestRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setMusicXmlError(message || "Unable to generate MusicXML.");
    } finally {
      if (requestId === musicXmlRequestRef.current) {
        setMusicXmlBusy(false);
      }
    }
  }, [selectedArrangementId, unsupportedKind]);

  const handleExportPdf = useCallback(async () => {
    if (pdfBusy) {
      return;
    }

    const sheetNode = notationSheetRef.current;
    if (!sheetNode) {
      setMusicXmlError("Notation sheet is not ready yet.");
      return;
    }

    let captureHost: HTMLDivElement | null = null;
    setPdfBusy(true);
    setMusicXmlError(null);
    if (ENABLE_NOTATION_PDF_DEBUG) {
      setPdfDebugInfo(null);
    }

    const serializeScoreSvg = (svg: SVGSVGElement) => {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.removeAttribute("style");
      clone.removeAttribute("width");
      clone.removeAttribute("height");
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      if (!clone.getAttribute("preserveAspectRatio")) {
        clone.setAttribute("preserveAspectRatio", "xMinYMin meet");
      }
      return new XMLSerializer().serializeToString(clone);
    };

    try {
      if (drumArrangementActive) {
        const drumScoreSvgs = Array.from(
          sheetNode.querySelectorAll<SVGSVGElement>(".drumScoreSystemSvg"),
        )
          .map((svg) => serializeScoreSvg(svg))
          .filter((item) => item.includes("<svg"));

        if (!drumScoreSvgs.length) {
          throw new Error("Drum score is not rendered yet.");
        }

        const result = await exportNotationPdf(project.id, selectedArrangementId, {
          title: project.title || "Untitled",
          artist: project.artist,
          album: project.album,
          year: project.year,
          arrangement_name: selectedArrangement?.name,
          bpm,
          meter,
          score_svgs: drumScoreSvgs,
          open_after_export: true,
        });

        if (!result.opened) {
          const openMsg = result.openError ? ` (${result.openError})` : "";
          setMusicXmlError(
            `PDF created at ${result.path}, but automatic opening failed${openMsg}.`,
          );
        }
        return;
      }

      if (!musicXmlText.trim()) {
        throw new Error("Generate MusicXML before exporting to PDF.");
      }

      const [{ default: html2canvas }] = await Promise.all([
        import("html2canvas"),
      ]);

      const liveScoreSvgs = Array.from(sheetNode.querySelectorAll<SVGSVGElement>(".musicXmlCanvas svg"));
      if (!liveScoreSvgs.length) {
        throw new Error("Music score is not rendered yet. Try Refresh MusicXML first.");
      }

      // Capture only the chord diagram block. Textual title/artist header is rendered by backend.
      const chordSection = sheetNode.querySelector<HTMLElement>(".notationUnifiedChordSection");
      let headerPngDataUrl: string | undefined;
      if (chordSection) {
        const chordWidth = Math.ceil(chordSection.scrollWidth || chordSection.getBoundingClientRect().width || 0);
        const scoreWidth = Math.max(
          800,
          Math.round(chordWidth || 1200),
        );

        captureHost = document.createElement("div");
        captureHost.className = "notationPdfCaptureHost";
        captureHost.style.position = "fixed";
        captureHost.style.left = "-100000px";
        captureHost.style.top = "0";
        captureHost.style.width = `${scoreWidth}px`;
        captureHost.style.background = "#ffffff";
        captureHost.style.padding = "0";
        captureHost.style.margin = "0";
        captureHost.style.zIndex = "-1";

        const topBlock = document.createElement("section");
        topBlock.style.width = `${scoreWidth}px`;
        topBlock.style.background = "#ffffff";
        topBlock.style.boxSizing = "border-box";
        topBlock.style.padding = "8px 0";

        const chordClone = chordSection.cloneNode(true) as HTMLElement;
        chordClone.querySelector(".notationUnifiedChordHeader")?.remove();
        chordClone.style.border = "0";
        chordClone.style.borderRadius = "0";
        chordClone.style.background = "#ffffff";
        chordClone.style.boxShadow = "none";
        chordClone.style.padding = "4px 0";

        chordClone.querySelectorAll<HTMLElement>(".notationChordCard").forEach((node) => {
          node.style.background = "#ffffff";
          node.style.border = "0";
          node.style.boxShadow = "none";
          node.style.width = "104px";
        });
        chordClone.querySelectorAll<HTMLElement>(".notationChordHead").forEach((node) => {
          node.style.background = "#ffffff";
          node.style.borderBottom = "0";
          node.style.fontSize = "11px";
        });
        chordClone.querySelectorAll<HTMLElement>(".notationChordDiagram").forEach((node) => {
          node.style.maxWidth = "98px";
        });

        topBlock.appendChild(chordClone);
        captureHost.appendChild(topBlock);
        document.body.appendChild(captureHost);

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });

        const topCanvas = await html2canvas(topBlock, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          logging: false,
          width: Math.ceil(topBlock.scrollWidth),
          height: Math.ceil(topBlock.scrollHeight),
          windowWidth: Math.ceil(topBlock.scrollWidth),
          windowHeight: Math.ceil(topBlock.scrollHeight),
          scrollX: 0,
          scrollY: 0,
        });
        headerPngDataUrl = topCanvas.toDataURL("image/png");

        captureHost.remove();
        captureHost = null;
      }

      const scoreSvgs = liveScoreSvgs
        .map((svg) => {
          const clone = svg.cloneNode(true) as SVGSVGElement;
          try {
            let contentMinY = Number.POSITIVE_INFINITY;
            let contentMaxY = Number.NEGATIVE_INFINITY;
            const contentElements = Array.from(
              svg.querySelectorAll<SVGGraphicsElement>(
                "path,line,polyline,polygon,circle,ellipse,text,use",
              ),
            );
            for (const element of contentElements) {
              try {
                const box = element.getBBox();
                if (!Number.isFinite(box.y) || !Number.isFinite(box.height) || box.height <= 0) {
                  continue;
                }
                contentMinY = Math.min(contentMinY, box.y);
                contentMaxY = Math.max(contentMaxY, box.y + box.height);
              } catch {
                // Skip elements with invalid bounds.
              }
            }

            if (
              Number.isFinite(contentMinY)
              && Number.isFinite(contentMaxY)
              && contentMaxY - contentMinY > 1
            ) {
              const padding = 2;
              const minY = contentMinY - padding;
              const maxY = contentMaxY + padding;
              const vb = svg.viewBox?.baseVal;
              if (
                vb
                && Number.isFinite(vb.width)
                && Number.isFinite(vb.height)
                && vb.width > 1
                && vb.height > 1
              ) {
                const baseTop = vb.y;
                const baseBottom = vb.y + vb.height;
                const trimmedTop = Math.max(baseTop, minY);
                const trimmedBottom = Math.min(baseBottom, maxY);
                if (trimmedBottom - trimmedTop > 1) {
                  // Keep original horizontal viewBox so all pages share identical side margins.
                  clone.setAttribute("viewBox", `${vb.x} ${trimmedTop} ${vb.width} ${trimmedBottom - trimmedTop}`);
                }
              }
            }
          } catch {
            // Ignore bbox extraction errors and keep original SVG bounds.
          }
          return serializeScoreSvg(clone);
        })
        .filter((item) => item.includes("<svg"));

      const result = await exportNotationPdf(project.id, selectedArrangementId, {
        title: project.title || "Untitled",
        artist: project.artist,
        album: project.album,
        year: project.year,
        arrangement_name: selectedArrangement?.name,
        bpm,
        meter,
        header_png_data_url: headerPngDataUrl,
        score_svgs: scoreSvgs,
        open_after_export: true,
      });

      if (ENABLE_NOTATION_PDF_DEBUG) {
        const allPagesDebug = result.debug?.pages || [];
        if (allPagesDebug.length) {
          const lines = allPagesDebug.map((page, index) => {
            const available = Number(page.availableHeightPt || 0).toFixed(1);
            const groups = page.groupCount ?? 0;
            const segments = page.segmentCount ?? 0;
            const units = (page as { unitCount?: number }).unitCount ?? 0;
            const pairing = (page as { pairingApplied?: boolean }).pairingApplied ? "yes" : "no";
            const scale = Number(page.scale || 0).toFixed(4);
            const fallback = page.fallback || "none";
            const segHeights = (page.segmentHeightsSrc || []).map((value) => Number(value).toFixed(1)).join(",");
            const forcedBreak = (page as { forcedPageBreakBefore?: boolean }).forcedPageBreakBefore ? "yes" : "no";
            return `p${index}: avail=${available}pt scale=${scale} groups=${groups} units=${units} pairing=${pairing} segments=${segments} breakBefore=${forcedBreak} fallback=${fallback} segSrc=[${segHeights}]`;
          });
          setPdfDebugInfo(`PDF debug\n${lines.join("\n")}`);
        }
      }

      if (!result.opened) {
        const openMsg = result.openError ? ` (${result.openError})` : "";
        setMusicXmlError(
          `PDF created at ${result.path}, but automatic opening failed${openMsg}.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMusicXmlError(`PDF export failed: ${message}`);
    } finally {
      if (captureHost && captureHost.parentElement) {
        captureHost.remove();
      }
      setPdfBusy(false);
    }
  }, [
    bpm,
    drumArrangementActive,
    meter,
    musicXmlText,
    pdfBusy,
    project.album,
    project.artist,
    project.id,
    project.title,
    project.year,
    selectedArrangement?.name,
    selectedArrangementId,
  ]);

  useEffect(() => {
    void loadMusicXml(project);
  }, [loadMusicXml, project.id]);

  return (
    <section className="notationPage">
      <div className="notationLayout">
        <aside className="notationSideRail">
          <section className="panel compactPanel">
            <div className="panelHeader">Arrangement to notate</div>
            <label className="field">
              <span>Arrangements in file</span>
              <select
                value={selectedArrangementId}
                onChange={(event) => onSelectArrangement(event.target.value)}
              >
                {arrangements.length === 0 ? <option value="">No arrangement</option> : null}
                {arrangements.map((arrangement) => (
                  <option key={arrangement.id} value={arrangement.id}>
                    {arrangement.name} {arrangement.noteCount ? `(${arrangement.noteCount})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="panel compactPanel">
            <div className="panelHeader">Instrument setup</div>
            {drumArrangementActive ? (
              <>
                <div className="notationSetupFields">
                  <div className="tuningSummary" aria-live="polite">
                    {trackNotes.length} drum hit(s) in this arrangement
                  </div>
                </div>
                <p className="hint slimHint">
                  Drum notation preview uses a standard percussion staff with bar/beat guides and drum noteheads.
                </p>
              </>
            ) : keysArrangementActive ? (
              <>
                <div className="notationSetupFields">
                  <div className="tuningSummary" aria-live="polite">
                    {trackNotes.length} note event(s) in this arrangement
                  </div>
                </div>
                <p className="hint slimHint">
                  Piano/keys arrangements use plain MusicXML staff rendering.
                </p>
              </>
            ) : unsupportedKind ? (
              <p className="hint slimHint">
                Notation view is available only for guitar or bass arrangements.
              </p>
            ) : (
              <>
                <div className="notationSetupFields">
                  <label className="tabPresetField">
                    Strings
                    <select
                      value={selectedStringCount}
                      onChange={(event) => applyStringCount(Number(event.target.value))}
                    >
                      {stringCountOptions(frettedArrangementKind!).map((count) => (
                        <option key={count} value={count}>
                          {frettedArrangementKind === "bass"
                            ? `Bass ${count}-string`
                            : `Guitar ${count}-string`}
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
                        const preset = availableTuningPresets.find(
                          (item) => item.id === nextId,
                        );
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

                {mappedTrack.excludedNotes.length > 0 ? (
                  <div className="notationWarning" role="status" aria-live="polite">
                    <strong>
                      {mappedTrack.excludedNotes.length} note(s) are outside this tuning/string setup.
                    </strong>
                    <span>{excludedPreview}</span>
                  </div>
                ) : (
                  <p className="hint slimHint">
                    All notes are playable with the selected number of strings and tuning.
                  </p>
                )}
              </>
            )}
          </section>
        </aside>

        <section className="notationMainPane">
          <section className="panel notationTabPanel">
            <div className="panelHeader withAction">
              <span>Notation</span>
              {drumArrangementActive ? (
                <div className="notationEngineBar">
                  <label className="notationZoomControl">
                    Drum chart zoom
                    <input
                      type="range"
                      min={0.6}
                      max={1}
                      step={0.05}
                      value={drumNotationZoom}
                      onChange={(event) => setDrumNotationZoom(Number(event.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={pdfBusy || !selectedArrangementId || drumScoreSystems.length === 0}
                    onClick={handleExportPdf}
                  >
                    {pdfBusy ? "Exporting PDF..." : "Export PDF"}
                  </button>
                </div>
              ) : (
                <div className="notationEngineBar">
                  <label className="notationZoomControl">
                    Zoom
                    <input
                      type="range"
                      min={0.6}
                      max={1.8}
                      step={0.05}
                      value={musicXmlZoom}
                      onChange={(event) => setMusicXmlZoom(Number(event.target.value))}
                    />
                  </label>

                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={!musicXmlText || musicXmlBusy || pdfBusy}
                    onClick={handleExportPdf}
                  >
                    {pdfBusy ? "Exporting PDF..." : "Export PDF"}
                  </button>

                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={musicXmlBusy || !selectedArrangementId || unsupportedKind}
                    onClick={() => void loadMusicXml(project)}
                  >
                    {musicXmlBusy ? "Updating..." : "Refresh MusicXML"}
                  </button>
                </div>
              )}
            </div>
            {drumArrangementActive ? (
              <>
                {musicXmlError ? <p className="hint slimHint">PDF status: {musicXmlError}</p> : null}

                <section
                  className="notationUnifiedSheet notationPaperCard notationDrumSheet"
                  ref={notationSheetRef}
                >
                  <header className="notationUnifiedHeader">
                    <h2>{project.title || "Untitled"}</h2>
                    <p className="notationUnifiedArtist">{project.artist || "Unknown artist"}</p>
                    {project.album || project.year ? (
                      <p className="notationUnifiedAlbumYear">
                        {project.album || "Unknown album"}
                        {project.year ? ` (${project.year})` : ""}
                      </p>
                    ) : null}
                    <div className="notationUnifiedMetaRow">
                      <span>{selectedArrangement?.name || "Drum arrangement"}</span>
                      <span>{`Tempo ${Math.round(bpm)} BPM`}</span>
                      <span>{`Meter ${meter[0]}/${meter[1]}`}</span>
                    </div>
                  </header>

                  <section className="drumNotationStaffLegend" aria-label="Drum score symbol legend">
                    <div className="drumNotationStaffLegendTitle">Staff legend (symbol to instrument)</div>
                    <div className="drumNotationStaffLegendGrid">
                      {drumStaffLegendItems.map((item) => (
                        <div
                          key={item.id}
                          className={`drumNotationStaffLegendItem${item.active ? " is-active" : ""}`}
                          title={item.label}
                        >
                          <span className="drumNotationStaffLegendGlyph" aria-hidden="true">
                            {(() => {
                              const topY = 28;
                              const halfSpace = 5;
                              const lineSpacing = halfSpace * 2;
                              const headX = 32;
                              const headY = topY + item.staffStep * halfSpace;
                              const headRx = 6.4;
                              const headRy = 4.2;
                              const stemLength = 14;
                              const stemUp = item.stemDirection === "up";
                              const stemX = stemUp ? headX + headRx : headX - headRx;
                              const stemY1 = stemUp ? headY - 1 : headY + 1;
                              const stemY2 = stemUp
                                ? Math.max(2, stemY1 - stemLength)
                                : Math.min(98, stemY1 + stemLength);
                              const ledgerSteps = drumLedgerSteps(item.staffStep);
                              return (
                                <svg viewBox="0 0 64 100" role="img" aria-label={`${item.label} notation symbol`}>
                                  <line x1="6" y1={topY} x2="58" y2={topY} className="drumLegendStaffLine" />
                                  <line x1="6" y1={topY + lineSpacing} x2="58" y2={topY + lineSpacing} className="drumLegendStaffLine" />
                                  <line x1="6" y1={topY + lineSpacing * 2} x2="58" y2={topY + lineSpacing * 2} className="drumLegendStaffLine" />
                                  <line x1="6" y1={topY + lineSpacing * 3} x2="58" y2={topY + lineSpacing * 3} className="drumLegendStaffLine" />
                                  <line x1="6" y1={topY + lineSpacing * 4} x2="58" y2={topY + lineSpacing * 4} className="drumLegendStaffLine" />

                                  {ledgerSteps.map((step) => {
                                    const ledgerY = topY + step * halfSpace;
                                    return (
                                      <line
                                        key={`legend-ledger-${item.id}-${step}`}
                                        x1={headX - 10}
                                        x2={headX + 10}
                                        y1={ledgerY}
                                        y2={ledgerY}
                                        className="drumLegendStaffLine"
                                      />
                                    );
                                  })}

                                  {item.notehead === "x" ? (
                                    <g className="drumLegendNoteCross">
                                      <line
                                        x1={headX - headRx}
                                        y1={headY - headRy}
                                        x2={headX + headRx}
                                        y2={headY + headRy}
                                      />
                                      <line
                                        x1={headX - headRx}
                                        y1={headY + headRy}
                                        x2={headX + headRx}
                                        y2={headY - headRy}
                                      />
                                    </g>
                                  ) : (
                                    <ellipse cx={headX} cy={headY} rx={headRx} ry={headRy} className="drumLegendNoteFilled" />
                                  )}

                                  <line x1={stemX} y1={stemY1} x2={stemX} y2={stemY2} className="drumLegendStem" />
                                  {item.openRing ? (
                                    <circle cx={headX} cy={headY} r={headRx + 2.4} className="drumLegendOpenRing" />
                                  ) : null}
                                </svg>
                              );
                            })()}
                          </span>
                          <span className="drumNotationStaffLegendText">
                            <span className="drumNotationStaffLegendInstrument">{item.label}</span>
                            <span className="drumNotationStaffLegendMeta">
                              {item.notehead === "x" ? "X notehead" : "Filled notehead"}
                              {item.openRing ? " + open ring" : ""} - lane {item.laneLabel}
                            </span>
                          </span>
                          <span className="drumNotationStaffLegendIcon" aria-hidden="true">
                            <DrumLegendIcon icon={drumIconForPieceId(item.pieceId)} title={item.label} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="drumScorePaper" aria-label="Drum score staff view">
                    <div className="drumScoreViewport" style={{ transform: `scale(${drumNotationZoom})` }}>
                      {drumScoreSystems.map((system) => {
                        const barsInSystem = Math.max(1, system.endBar - system.startBar);
                        const beatsInSystem = Math.max(1, system.beatsPerSystem);
                        const totalSubdivisionSteps = beatsInSystem * DRUM_SCORE_GUIDE_SUBDIVISIONS;
                        const contentWidth = system.staffRight - system.staffLeft;
                        const halfSpace = system.staffSpacing / 2;
                        const safeBeatsPerBar = Math.max(1, drumBeatsPerBar);

                        return (
                          <article key={system.id} className="drumScoreSystem">
                            <svg
                              className="drumScoreSystemSvg"
                              viewBox={`0 0 ${DRUM_SCORE_VIEWBOX_WIDTH} ${DRUM_SCORE_SYSTEM_HEIGHT}`}
                              role="img"
                              aria-label={`Drum score bars ${system.startBar + 1}-${system.endBar}`}
                            >
                              {system.systemIndex === 0 ? (
                                <text
                                  x={system.staffLeft - 16}
                                  y={system.staffTop + system.staffSpacing * 2.05}
                                  className="drumScoreMeterText"
                                  fill="#4f3f2b"
                                  fontSize={18}
                                  fontWeight={700}
                                  fontFamily="Georgia, Times New Roman, serif"
                                >
                                  {`${meter[0]}/${meter[1]}`}
                                </text>
                              ) : null}

                              {Array.from({ length: 5 }, (_, lineIndex) => {
                                const y = system.staffTop + lineIndex * system.staffSpacing;
                                return (
                                  <line
                                    key={`staff-${system.id}-${lineIndex}`}
                                    x1={system.staffLeft}
                                    x2={system.staffRight}
                                    y1={y}
                                    y2={y}
                                    className="drumScoreStaffLine"
                                    stroke="#4e402d"
                                    strokeWidth={1.5}
                                  />
                                );
                              })}

                              {Array.from({ length: totalSubdivisionSteps + 1 }, (_, stepIndex) => {
                                if (stepIndex % DRUM_SCORE_GUIDE_SUBDIVISIONS === 0) {
                                  return null;
                                }
                                const x =
                                  system.staffLeft +
                                  (stepIndex / Math.max(1, totalSubdivisionSteps)) * contentWidth;
                                return (
                                  <line
                                    key={`subdivision-${system.id}-${stepIndex}`}
                                    x1={x}
                                    x2={x}
                                    y1={system.staffTop - 8}
                                    y2={system.staffBottom + 32}
                                    className="drumScoreSubdivisionGuide"
                                    stroke="#5a4a31"
                                    strokeOpacity={0.11}
                                    strokeWidth={0.8}
                                  />
                                );
                              })}

                              {Array.from({ length: beatsInSystem + 1 }, (_, beatIndex) => {
                                const x = system.staffLeft + (beatIndex / beatsInSystem) * contentWidth;
                                const isBar = beatIndex % safeBeatsPerBar === 0;
                                return (
                                  <line
                                    key={`beat-${system.id}-${beatIndex}`}
                                    x1={x}
                                    x2={x}
                                    y1={system.staffTop - 8}
                                    y2={system.staffBottom + 32}
                                    className={isBar ? "drumScoreBarLine" : "drumScoreBeatGuide"}
                                    stroke={isBar ? "#372c1d" : "#53422b"}
                                    strokeOpacity={isBar ? 0.68 : 0.22}
                                    strokeWidth={isBar ? 1.9 : 1}
                                  />
                                );
                              })}

                              {system.hits.map((hit) => {
                                const ledgerSteps = drumLedgerSteps(hit.staffStep);
                                const stemLength = 28;
                                const stemUp = hit.stemDirection === "up";
                                const stemX = stemUp
                                  ? hit.x + system.noteHeadRadiusX
                                  : hit.x - system.noteHeadRadiusX;
                                const stemY1 = stemUp ? hit.y - 1 : hit.y + 1;
                                const stemY2 = stemUp ? stemY1 - stemLength : stemY1 + stemLength;

                                return (
                                  <g key={`${system.id}-${hit.id}`} className="drumScoreHit" aria-label={hit.title}>
                                    {ledgerSteps.map((step) => {
                                      const ledgerY = system.staffTop + step * halfSpace;
                                      return (
                                        <line
                                          key={`${system.id}-${hit.id}-ledger-${step}`}
                                          x1={hit.x - 10}
                                          x2={hit.x + 10}
                                          y1={ledgerY}
                                          y2={ledgerY}
                                          className="drumScoreLedgerLine"
                                          stroke="#4a3b28"
                                          strokeWidth={1.4}
                                        />
                                      );
                                    })}

                                    {hit.notehead === "x" ? (
                                      <g className="drumScoreHeadX">
                                        <line
                                          x1={hit.x - system.noteHeadRadiusX}
                                          y1={hit.y - system.noteHeadRadiusY}
                                          x2={hit.x + system.noteHeadRadiusX}
                                          y2={hit.y + system.noteHeadRadiusY}
                                          stroke="#1f1810"
                                          strokeWidth={1.5}
                                          strokeLinecap="round"
                                        />
                                        <line
                                          x1={hit.x - system.noteHeadRadiusX}
                                          y1={hit.y + system.noteHeadRadiusY}
                                          x2={hit.x + system.noteHeadRadiusX}
                                          y2={hit.y - system.noteHeadRadiusY}
                                          stroke="#1f1810"
                                          strokeWidth={1.5}
                                          strokeLinecap="round"
                                        />
                                        {hit.openRing ? (
                                          <circle
                                            cx={hit.x}
                                            cy={hit.y}
                                            r={system.noteHeadRadiusX + 2.6}
                                            fill="none"
                                            stroke="#1f1810"
                                            strokeWidth={1.2}
                                          />
                                        ) : null}
                                      </g>
                                    ) : (
                                      <ellipse
                                        cx={hit.x}
                                        cy={hit.y}
                                        rx={system.noteHeadRadiusX}
                                        ry={system.noteHeadRadiusY}
                                        className="drumScoreHeadNormal"
                                        fill="#1f1810"
                                        stroke="#1f1810"
                                        strokeWidth={0.9}
                                      />
                                    )}

                                    <line
                                      x1={stemX}
                                      x2={stemX}
                                      y1={stemY1}
                                      y2={stemY2}
                                      className="drumScoreStem"
                                      stroke="#1f1810"
                                      strokeWidth={1.35}
                                      strokeLinecap="round"
                                    />
                                  </g>
                                );
                              })}

                              {Array.from({ length: barsInSystem }, (_, barOffset) => {
                                const barNumber = system.startBar + barOffset + 1;
                                const label = String(barNumber);
                                const boxWidth = 8 + label.length * 7;
                                const boxHeight = 14;
                                const baseX =
                                  system.staffLeft + (barOffset / barsInSystem) * contentWidth + 4;
                                const baseY = system.staffTop - 16;

                                const intersectsRange = (
                                  aMin: number,
                                  aMax: number,
                                  bMin: number,
                                  bMax: number,
                                ) => aMax >= bMin && bMax >= aMin;

                                const hasCollision = (candidateX: number, candidateY: number) => {
                                  const labelLeft = candidateX - 3;
                                  const labelRight = labelLeft + boxWidth;
                                  const labelTop = candidateY - boxHeight + 2;
                                  const labelBottom = labelTop + boxHeight;

                                  return system.hits.some((hit) => {
                                    const headLeft = hit.x - system.noteHeadRadiusX - 2;
                                    const headRight = hit.x + system.noteHeadRadiusX + 2;
                                    const headTop = hit.y - system.noteHeadRadiusY - 2;
                                    const headBottom = hit.y + system.noteHeadRadiusY + 2;
                                    const headOverlap =
                                      intersectsRange(labelLeft, labelRight, headLeft, headRight) &&
                                      intersectsRange(labelTop, labelBottom, headTop, headBottom);
                                    if (headOverlap) return true;

                                    const stemUp = hit.stemDirection === "up";
                                    const stemX = stemUp
                                      ? hit.x + system.noteHeadRadiusX
                                      : hit.x - system.noteHeadRadiusX;
                                    const stemTop = stemUp ? hit.y - 29 : hit.y - 1;
                                    const stemBottom = stemUp ? hit.y + 1 : hit.y + 29;
                                    const stemOverlap =
                                      stemX >= labelLeft - 1 &&
                                      stemX <= labelRight + 1 &&
                                      intersectsRange(labelTop, labelBottom, stemTop, stemBottom);
                                    return stemOverlap;
                                  });
                                };

                                let x = baseX;
                                let y = baseY;
                                if (hasCollision(x, y)) {
                                  y = baseY - 11;
                                }
                                if (hasCollision(x, y)) {
                                  x = baseX + (barOffset % 2 === 0 ? 0 : 7);
                                  y = baseY - 19;
                                }
                                if (hasCollision(x, y)) {
                                  x = baseX - (barOffset % 2 === 0 ? 5 : 1);
                                  y = baseY - 24;
                                }

                                return (
                                  <g key={`bar-label-${system.id}-${barNumber}`}>
                                    <rect
                                      x={x - 3}
                                      y={y - boxHeight + 2}
                                      width={boxWidth}
                                      height={boxHeight}
                                      rx={2}
                                      fill="#fffdf6"
                                      stroke="#e0d1b6"
                                      strokeWidth={0.9}
                                    />
                                    <text
                                      x={x}
                                      y={y}
                                      className="drumScoreBarNumber"
                                      fill="#4e3f2a"
                                      fontSize={11}
                                      fontWeight={800}
                                      fontFamily="Georgia, Times New Roman, serif"
                                    >
                                      {label}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </section>

                <p className="hint slimHint">
                  Standard drum staff view with beat/subdivision guides; hit spacing follows real onset timing. Export PDF produces an A4 portrait sheet.
                </p>
              </>
            ) : unsupportedKind ? (
              <p className="hint slimHint">
                MusicXML notation is available only for guitar or bass arrangements.
              </p>
            ) : (
              <>
                {musicXmlError ? <p className="hint slimHint">MusicXML error: {musicXmlError}</p> : null}
                {ENABLE_NOTATION_PDF_DEBUG && pdfDebugInfo ? (
                  <div className="pdfDebugPanel">
                    <label className="pdfDebugLabel" htmlFor="pdf-debug-output">PDF debug output</label>
                    <textarea
                      id="pdf-debug-output"
                      className="pdfDebugOutput"
                      value={pdfDebugInfo}
                      readOnly
                      rows={2}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </div>
                ) : null}
                {musicXmlBusy && !musicXmlText ? (
                  <p className="hint slimHint">Generating MusicXML engraving...</p>
                ) : null}

                <section className="notationUnifiedSheet notationPaperCard" ref={notationSheetRef}>
                  <header className="notationUnifiedHeader">
                    <h2>{project.title || "Untitled"}</h2>
                    <p className="notationUnifiedArtist">{project.artist || "Unknown artist"}</p>
                    {project.album || project.year ? (
                      <p className="notationUnifiedAlbumYear">
                        {project.album || "Unknown album"}
                        {project.year ? ` (${project.year})` : ""}
                      </p>
                    ) : null}
                    <div className="notationUnifiedMetaRow">
                      <span>{selectedArrangement?.name || "Arrangement"}</span>
                      <span>{`Tempo ${Math.round(bpm)} BPM`}</span>
                      <span>{`Meter ${meter[0]}/${meter[1]}`}</span>
                    </div>
                  </header>

                  {!keysArrangementActive ? (
                    <section className="notationUnifiedChordSection">
                      <div className="notationUnifiedChordHeader">
                        <span>Chord diagrams</span>
                        <span className="miniMeta">{chordSummary.length} unique chord(s)</span>
                      </div>
                      {chordSummary.length ? (
                        <div className="notationUnifiedChordRow" aria-label="Chord diagrams">
                          {chordSummary.map((chord) => (
                            <ChordCard key={chord.id} chord={chord} tuning={localTuning} />
                          ))}
                        </div>
                      ) : (
                        <p className="hint slimHint">
                          No simultaneous notes found in this arrangement, so there are no chord diagrams to draw.
                        </p>
                      )}
                    </section>
                  ) : null}

                  {musicXmlText ? (
                    <MusicXmlPreview xml={musicXmlText} zoom={musicXmlZoom} />
                  ) : !musicXmlBusy ? (
                    <p className="hint slimHint">No MusicXML available for this arrangement yet.</p>
                  ) : null}
                </section>

                <p className="hint slimHint">
                  {keysArrangementActive
                    ? "Piano/keys now render only the traditional MusicXML staff. Chord names are shown if they are present in the exported MusicXML. Export PDF generates an A4 portrait file from the notation sheet."
                    : "MusicXML engraving uses OpenSheetMusicDisplay (BSD-3-Clause). Export PDF generates an A4 portrait file from the notation sheet."}
                </p>
              </>
            )}
          </section>
        </section>
      </div>
    </section>
  );
}
