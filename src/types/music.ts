export type StemKind = 'mix' | 'full' | 'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other';

export interface StemTrack {
  id: string;
  name: string;
  kind: StemKind;
  url?: string;
  muted: boolean;
  solo: boolean;
  volume: number;
}

export interface GuitarTechniques {
  palmMute?: boolean;
  hammerOn?: boolean;
  pullOff?: boolean;
  slide?: boolean;
  bend?: boolean;
  vibrato?: boolean;
  harmonic?: boolean;
}

export interface MidiNote {
  id: string;
  trackId: string;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  selected?: boolean;
  string?: number;
  fret?: number;
  techniques?: GuitarTechniques;
}

export interface SyncPoint {
  id: string;
  bar: number;
  beat: number;
  time: number;
}


export interface BeatGridPoint {
  id: string;
  beatIndex: number;
  bar: number;
  beat: number;
  time: number;
}

export interface TempoMapPoint {
  id: string;
  beatIndex: number;
  bar: number;
  beat: number;
  time: number;
  bpm: number;
}

export interface ToneChange {
  t: number;
  name: string;
}

export interface ToneBlock {
  base?: string;
  changes?: ToneChange[];
  definitions?: Record<string, unknown>[];
}

export interface ArrangementInfo {
  id: string;
  name: string;
  type?: 'guitar' | 'bass' | 'keys' | 'drums' | 'vocals' | 'piano' | 'other' | 'unknown';
  file?: string;
  noteCount?: number;
  tuning?: number[];
  tuningName?: string;
  capo?: number;
  source?: string;
  tones?: ToneBlock | null;
}

export interface LyricLine {
  id?: string;
  t: number;
  d: number;
  w: string;
}

export interface ProjectState {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  year?: string;
  metadata?: Record<string, string>;
  coverUrl?: string;
  coverPath?: string;
  lyrics?: LyricLine[];
  lyricsSource?: string;
  bpm: number;
  meter: [number, number];
  duration: number;
  stems: StemTrack[];
  arrangements: ArrangementInfo[];
  selectedArrangementId?: string;
  notes: MidiNote[];
  syncPoints: SyncPoint[];
  beatgrid?: BeatGridPoint[];
  tempoMap?: TempoMapPoint[];
  syncSource?: string;
  syncWarning?: string;
  musicXml?: string | null;
  outputPath?: string;
  sloppackPath?: string;
  originalSloppackPath?: string;
  workingSloppackPath?: string;
  hasUncommittedChanges?: boolean;
}
