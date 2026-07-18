export const GUITAR_STANDARD_TUNING = [40, 45, 50, 55, 59, 64];
export const BASS_STANDARD_TUNING = [28, 33, 38, 43];
export const BASS_5_TUNING = [23, 28, 33, 38, 43];
export const DROP_D_TUNING = [38, 45, 50, 55, 59, 64];

export interface StringFretPosition {
  string: number;
  fret: number;
  pitch: number;
}

export function getDefaultTuning(kind: 'guitar' | 'bass'): number[] {
  return kind === 'bass' ? BASS_STANDARD_TUNING : GUITAR_STANDARD_TUNING;
}

export function pitchToPositions(pitch: number, tuning: number[], maxFret = 24): StringFretPosition[] {
  return tuning
    .map((openPitch, index) => ({ string: index + 1, fret: pitch - openPitch, pitch }))
    .filter((position) => position.fret >= 0 && position.fret <= maxFret);
}

export function stringFretToPitch(stringNumber: number, fret: number, tuning: number[]): number {
  const openPitch = tuning[stringNumber - 1] ?? tuning[0] ?? 40;
  return openPitch + fret;
}

export function chooseNearestPosition(
  pitch: number,
  tuning: number[],
  previous?: { string?: number; fret?: number },
  maxFret = 24
): StringFretPosition {
  const positions = pitchToPositions(pitch, tuning, maxFret);
  if (!positions.length) {
    return { string: 1, fret: Math.max(0, Math.min(maxFret, pitch - tuning[0])), pitch };
  }
  if (!previous?.string || previous.fret === undefined) {
    return positions.sort((a, b) => Math.abs(a.fret - 5) - Math.abs(b.fret - 5))[0];
  }
  return positions.sort((a, b) => {
    const scoreA = Math.abs(a.string - previous.string!) * 3 + Math.abs(a.fret - previous.fret!);
    const scoreB = Math.abs(b.string - previous.string!) * 3 + Math.abs(b.fret - previous.fret!);
    return scoreA - scoreB;
  })[0];
}

export function ensureTabPosition<T extends { pitch: number; string?: number; fret?: number }>(
  note: T,
  tuning: number[],
  previous?: { string?: number; fret?: number }
): T & { string: number; fret: number } {
  if (note.string && note.fret !== undefined) return note as T & { string: number; fret: number };
  const position = chooseNearestPosition(note.pitch, tuning, previous);
  return { ...note, string: position.string, fret: position.fret };
}

const NOTE_CLASS_TO_SEMITONE: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

function parseNoteToken(token: string): number | null {
  const match = token.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const accidental = match[2] || "";
  const octave = Number(match[3]);
  if (!Number.isFinite(octave)) return null;
  const key = `${letter}${accidental}`;
  const semitone = NOTE_CLASS_TO_SEMITONE[key];
  if (semitone === undefined) return null;
  const midi = (octave + 1) * 12 + semitone;
  if (!Number.isFinite(midi) || midi < 0 || midi > 127) return null;
  return midi;
}

export function parseTuningInput(value: string): number[] | null {
  const parsed = value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const numeric = Number(part);
      if (Number.isFinite(numeric)) return numeric;
      return parseNoteToken(part);
    })
    .filter((pitch): pitch is number => Number.isFinite(pitch));
  return parsed.length ? parsed : null;
}
