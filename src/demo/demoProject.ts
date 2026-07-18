import type { ProjectState } from '../types/music';

const makeId = (prefix: string, index: number) => `${prefix}-${index}`;

export const demoProject: ProjectState = {
  id: 'demo-song',
  title: 'Demo Song',
  bpm: 120,
  meter: [4, 4],
  duration: 32,
  arrangements: [
    { id: 'bass', name: 'Bass', type: 'bass', noteCount: 16 },
    { id: 'guitar', name: 'Lead Guitar', type: 'guitar', noteCount: 16 }
  ],
  selectedArrangementId: 'bass',
  stems: [
    { id: 'mix', name: 'Original Mix', kind: 'mix', muted: false, solo: false, volume: 0.9 },
    { id: 'bass', name: 'Bass', kind: 'bass', muted: false, solo: false, volume: 0.85 },
    { id: 'guitar', name: 'Guitar', kind: 'guitar', muted: false, solo: false, volume: 0.8 },
    { id: 'drums', name: 'Drums', kind: 'drums', muted: false, solo: false, volume: 0.8 }
  ],
  notes: Array.from({ length: 32 }).map((_, index) => ({
    id: makeId('note', index),
    trackId: index % 3 === 0 ? 'guitar' : 'bass',
    pitch: 40 + ((index * 5) % 24),
    start: index * 0.5,
    duration: index % 4 === 0 ? 0.9 : 0.42,
    velocity: 80
  })),
  syncPoints: [
    { id: 'sp-1', bar: 1, beat: 1, time: 0 },
    { id: 'sp-2', bar: 2, beat: 1, time: 2.02 },
    { id: 'sp-3', bar: 3, beat: 1, time: 4.01 },
    { id: 'sp-4', bar: 4, beat: 1, time: 6.05 }
  ],
  musicXml: undefined
};
