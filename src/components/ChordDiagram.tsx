import type { ArrangementInfo, MidiNote } from '../types/music';
import { BASS_STANDARD_TUNING, GUITAR_STANDARD_TUNING, ensureTabPosition } from './FretboardMapper';

interface ChordDiagramProps {
  notes: MidiNote[];
  arrangement?: ArrangementInfo;
  arrangementKind: 'guitar' | 'bass' | null;
  selectedTrackId: string;
  currentTime: number;
}

function midiToName(pitch: number) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((pitch % 12) + 12) % 12]}`;
}

function pitchClass(pitch: number) {
  return ((pitch % 12) + 12) % 12;
}

function formatPitchClass(pc: number) {
  return midiToName(pc);
}

interface ChordPattern {
  suffix: string;
  required: number[];
  optional?: number[];
  forbidden?: number[];
  priority: number;
}

const CHORD_PATTERNS: ChordPattern[] = [
  { suffix: 'maj13', required: [0, 4, 11, 9], optional: [2, 5, 7], priority: 170 },
  { suffix: '13', required: [0, 4, 10, 9], optional: [2, 5, 7], priority: 169 },
  { suffix: 'm13', required: [0, 3, 10, 9], optional: [2, 5, 7], priority: 168 },
  { suffix: 'maj11', required: [0, 4, 11, 5], optional: [2, 7], priority: 166 },
  { suffix: '11', required: [0, 4, 10, 5], optional: [2, 7], priority: 165 },
  { suffix: 'm11', required: [0, 3, 10, 5], optional: [2, 7], priority: 164 },
  { suffix: 'maj9', required: [0, 4, 11, 2], optional: [7], priority: 162 },
  { suffix: '9', required: [0, 4, 10, 2], optional: [7], priority: 161 },
  { suffix: 'm9', required: [0, 3, 10, 2], optional: [7], priority: 160 },
  { suffix: '6/9', required: [0, 4, 9, 2], optional: [7], priority: 156 },
  { suffix: 'm6/9', required: [0, 3, 9, 2], optional: [7], priority: 155 },

  { suffix: '7b9', required: [0, 4, 10, 1], optional: [7], priority: 150 },
  { suffix: '7#9', required: [0, 4, 10, 3], optional: [7], priority: 149 },
  { suffix: '7#11', required: [0, 4, 10, 6, 7], optional: [2, 9], priority: 148 },
  { suffix: '7b5', required: [0, 4, 10, 6], optional: [1, 2, 3, 8, 9], forbidden: [7], priority: 147 },
  { suffix: '7b13', required: [0, 4, 10, 7, 8], optional: [1, 2, 3, 6, 9], priority: 146 },
  { suffix: '7#5', required: [0, 4, 10, 8], optional: [1, 2, 3, 6, 9], priority: 145 },

  { suffix: 'maj7#11', required: [0, 4, 11, 6, 7], optional: [2, 9], priority: 142 },
  { suffix: 'maj7b5', required: [0, 4, 11, 6], optional: [2, 9], forbidden: [7], priority: 141 },
  { suffix: 'maj7#5', required: [0, 4, 11, 8], optional: [2, 6, 9], priority: 140 },
  { suffix: 'm(maj7)', required: [0, 3, 11], optional: [7, 2, 5, 9], priority: 139 },

  { suffix: 'maj7', required: [0, 4, 11], optional: [7, 2, 5, 9], forbidden: [10], priority: 135 },
  { suffix: '7', required: [0, 4, 10], optional: [7, 2, 5, 9, 1, 3, 6, 8], priority: 134 },
  { suffix: 'm7', required: [0, 3, 10], optional: [7, 2, 5, 9, 1, 6, 8], priority: 133 },
  { suffix: 'm7b5', required: [0, 3, 6, 10], optional: [1, 2, 5, 8, 9], priority: 132 },
  { suffix: 'dim7', required: [0, 3, 6, 9], optional: [1, 2, 5, 8, 10], priority: 131 },

  { suffix: '13sus4', required: [0, 5, 10, 9], optional: [2, 7], priority: 126 },
  { suffix: '9sus4', required: [0, 5, 10, 2], optional: [7], priority: 125 },
  { suffix: '7sus4', required: [0, 5, 10], optional: [7, 2, 9], priority: 124 },
  { suffix: '7sus2', required: [0, 2, 10], optional: [7, 5, 9], priority: 123 },

  { suffix: '6', required: [0, 4, 9], optional: [7, 2, 5], forbidden: [10, 11], priority: 121 },
  { suffix: 'm6', required: [0, 3, 9], optional: [7, 2, 5], forbidden: [10, 11], priority: 120 },
  { suffix: 'add9', required: [0, 4, 2], optional: [7, 5, 9], forbidden: [10, 11], priority: 118 },
  { suffix: 'm(add9)', required: [0, 3, 2], optional: [7, 5, 9], forbidden: [10, 11], priority: 117 },
  { suffix: 'add11', required: [0, 4, 5], optional: [7, 2, 9], forbidden: [10, 11], priority: 116 },
  { suffix: 'm(add11)', required: [0, 3, 5], optional: [7, 2, 9], forbidden: [10, 11], priority: 115 },
  { suffix: 'sus2sus4', required: [0, 2, 5, 7], optional: [9], forbidden: [3, 4, 10, 11], priority: 114 },
  { suffix: 'sus2', required: [0, 2, 7], optional: [5, 9], forbidden: [3, 4, 10, 11], priority: 113 },
  { suffix: 'sus4', required: [0, 5, 7], optional: [2, 9], forbidden: [3, 4, 10, 11], priority: 112 },

  { suffix: 'dim', required: [0, 3, 6], optional: [9, 2, 5], forbidden: [4, 7, 8], priority: 108 },
  { suffix: 'aug', required: [0, 4, 8], optional: [2, 6, 10], forbidden: [3, 7], priority: 107 },
  { suffix: '', required: [0, 4], optional: [7, 2, 5, 9], forbidden: [3], priority: 106 },
  { suffix: 'm', required: [0, 3], optional: [7, 2, 5, 9], forbidden: [4], priority: 105 },
  { suffix: '5', required: [0, 7], optional: [], forbidden: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11], priority: 90 },
];

function toIntervals(rootPc: number, pcs: number[]) {
  return Array.from(new Set(pcs.map((pc) => (pc - rootPc + 12) % 12))).sort((a, b) => a - b);
}

function matchesPattern(intervals: number[], pattern: ChordPattern) {
  const intervalSet = new Set(intervals);
  for (const required of pattern.required) {
    if (!intervalSet.has(required)) return false;
  }

  if (pattern.forbidden) {
    for (const forbidden of pattern.forbidden) {
      if (intervalSet.has(forbidden)) return false;
    }
  }

  if (pattern.optional) {
    const allowedSet = new Set([...pattern.required, ...pattern.optional]);
    for (const interval of intervalSet) {
      if (!allowedSet.has(interval)) return false;
    }
  }

  return true;
}

function describeIntervals(rootPc: number, intervals: number[]) {
  const labels: Record<number, string> = {
    1: 'b9',
    2: '9',
    3: 'm3/#9',
    4: '3',
    5: '11',
    6: 'b5/#11',
    7: '5',
    8: '#5/b13',
    9: '13',
    10: 'b7',
    11: 'maj7',
  };

  const tail = intervals.filter((interval) => interval !== 0).map((interval) => labels[interval] ?? String(interval));
  if (!tail.length) return formatPitchClass(rootPc);
  return `${formatPitchClass(rootPc)}(${tail.join(',')})`;
}

export function detectChordName(notes: MidiNote[]) {
  if (!notes.length) return 'No chord';

  const sortedByPitch = [...notes].sort((a, b) => a.pitch - b.pitch);
  const bassPc = pitchClass(sortedByPitch[0].pitch);
  const pcs = Array.from(new Set(sortedByPitch.map((note) => pitchClass(note.pitch))));
  const pitchClassCount = sortedByPitch.reduce((acc, note) => {
    const pc = pitchClass(note.pitch);
    acc.set(pc, (acc.get(pc) ?? 0) + 1);
    return acc;
  }, new Map<number, number>());

  if (pcs.length === 1) return formatPitchClass(pcs[0]);

  const matches = pcs
    .map((rootPc) => {
      const intervals = toIntervals(rootPc, pcs);
      const pattern = CHORD_PATTERNS.find((candidate) => matchesPattern(intervals, candidate));
      if (!pattern) return null;
      return {
        rootPc,
        quality: pattern.suffix,
        priority: pattern.priority,
        intervalCount: intervals.length,
        rootCount: pitchClassCount.get(rootPc) ?? 0,
        isBassRoot: rootPc === bassPc,
        intervals,
      };
    })
    .filter((item): item is { rootPc: number; quality: string; priority: number; intervalCount: number; rootCount: number; isBassRoot: boolean; intervals: number[] } => Boolean(item))
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.intervalCount !== b.intervalCount) return b.intervalCount - a.intervalCount;
      if (a.rootCount !== b.rootCount) return b.rootCount - a.rootCount;
      if (a.isBassRoot !== b.isBassRoot) return a.isBassRoot ? -1 : 1;
      return a.rootPc - b.rootPc;
    });

  if (matches.length) {
    const best = matches[0];
    const root = formatPitchClass(best.rootPc);
    const bass = formatPitchClass(bassPc);
    const symbol = `${root}${best.quality}`;
    return best.rootPc === bassPc ? symbol : `${symbol}/${bass}`;
  }

  const fallbackRoot = [...pcs].sort((a, b) => {
    const aCount = pitchClassCount.get(a) ?? 0;
    const bCount = pitchClassCount.get(b) ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    if ((a === bassPc) !== (b === bassPc)) return a === bassPc ? -1 : 1;
    return a - b;
  })[0];
  const fallback = describeIntervals(fallbackRoot, toIntervals(fallbackRoot, pcs));
  const bass = formatPitchClass(bassPc);
  return fallbackRoot === bassPc ? fallback : `${fallback}/${bass}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const OPEN_POSITION_MAX_FRET = 4;

export function ChordDiagram({ notes, arrangement, arrangementKind, selectedTrackId, currentTime }: ChordDiagramProps) {
  if (!arrangementKind) {
    return (
      <section className="panel chordDiagramPanel">
        <div className="panelHeader">Diagramma accordo</div>
        <p className="hint slimHint">Available for guitar and bass arrangements.</p>
      </section>
    );
  }

  const defaultTuning = arrangementKind === 'bass' ? BASS_STANDARD_TUNING : GUITAR_STANDARD_TUNING;
  const tuning = arrangement?.tuning?.length ? arrangement.tuning : defaultTuning;
  const trackNotes = notes
    .filter((note) => note.trackId === selectedTrackId)
    .sort((a, b) => a.start - b.start);

  const selectedRaw = trackNotes.filter((note) => note.selected);
  const activeFromTime = trackNotes.filter((note) => note.start <= currentTime + 0.02 && note.start + note.duration >= currentTime - 0.02);
  const active = selectedRaw.length
    ? selectedRaw
    : activeFromTime.length
      ? activeFromTime
      : trackNotes.filter((note) => Math.abs(note.start - currentTime) <= 0.18).slice(0, tuning.length);

  let previous: MidiNote | undefined;
  const mapped = active.map((note) => {
    const next = ensureTabPosition(note, tuning, previous);
    previous = next;
    return next;
  });

  const fretted = mapped.filter(
    (note) =>
      typeof note.string === 'number' &&
      typeof note.fret === 'number' &&
      (note.fret ?? 0) > 0,
  );
  const minFret = fretted.reduce((min, note) => {
    const fret = note.fret ?? 0;
    return Math.min(min, fret);
  }, 99);
  const maxFret = fretted.reduce((max, note) => {
    const fret = note.fret ?? 0;
    return Math.max(max, fret);
  }, 0);
  const useNutPosition = maxFret > 0 && maxFret <= OPEN_POSITION_MAX_FRET;
  const baseFret = minFret === 99 || useNutPosition ? 1 : clamp(minFret, 1, 20);
  const fretCount = 5;
  const stringCount = tuning.length;
  const width = Math.max(124, stringCount * 20 + 28);
  const height = 150;
  const top = 24;
  const left = 18;
  const gridWidth = width - 36;
  const gridHeight = 104;
  const stringGap = stringCount > 1 ? gridWidth / (stringCount - 1) : gridWidth;
  const fretGap = gridHeight / fretCount;
  const playedStrings = new Set(
    mapped
      .filter((note) => typeof note.string === 'number')
      .map((note) => clamp(note.string ?? 1, 1, stringCount)),
  );

  return (
    <section className="panel chordDiagramPanel">
      <div className="panelHeader withAction">
        <span>Diagramma accordo</span>
        <span className="miniMeta">{detectChordName(mapped)}</span>
      </div>
      <svg className="chordDiagram" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Diagramma accordo corrente">
        {Array.from({ length: stringCount }).map((_, index) => {
          const x = left + index * stringGap;
          return <line key={`s-${index}`} x1={x} y1={top} x2={x} y2={top + gridHeight} />;
        })}
        {mapped.length
          ? Array.from({ length: stringCount }).map((_, index) => {
              const stringNumber = index + 1;
              if (playedStrings.has(stringNumber)) return null;
              const x = left + index * stringGap;
              return <text key={`mute-${index}`} x={x} y={14} className="chordTopMarker" textAnchor="middle">X</text>;
            })
          : null}
        {Array.from({ length: fretCount + 1 }).map((_, index) => {
          const y = top + index * fretGap;
          return <line key={`f-${index}`} x1={left} y1={y} x2={left + gridWidth} y2={y} className={index === 0 ? 'nutLine' : ''} />;
        })}
        {baseFret > 1 ? <text x={2} y={top + fretGap * 0.7}>{baseFret}</text> : null}
        {tuning.map((openPitch, index) => {
          const x = left + index * stringGap;
          return <text key={`label-${index}`} x={x} y={top + gridHeight + 18} className="stringLabel" textAnchor="middle">{midiToName(openPitch)}</text>;
        })}
        {mapped.map((note) => {
          const stringNumber = note.string ?? 1;
          const fret = note.fret ?? 0;
          // Tunings are stored from low to high: string 1 is the lowest string.
          // Nel diagramma accordo mostriamo quindi la corda grave a sinistra e l'acuta a destra,
          // come in un chord box tradizionale visto frontalmente.
          const visualStringIndex = clamp(stringNumber - 1, 0, stringCount - 1);
          const x = left + visualStringIndex * stringGap;
          if (fret === 0) {
            return <text key={note.id} x={x} y={16} className="chordTopMarker" textAnchor="middle">0</text>;
          }
          const relativeFret = clamp(fret - baseFret + 1, 1, fretCount);
          const y = top + (relativeFret - 0.5) * fretGap;
          return (
            <g key={note.id}>
              <circle cx={x} cy={y} r={9} />
              <text x={x} y={y} className="dotText" textAnchor="middle" dominantBaseline="middle">{fret}</text>
            </g>
          );
        })}
      </svg>
      <p className="hint slimHint">Shows active notes at the playhead or the nearest note.</p>
    </section>
  );
}
