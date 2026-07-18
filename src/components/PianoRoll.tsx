import type { ReactNode } from 'react';
import type { MidiNote } from '../types/music';

interface PianoRollProps {
  notes: MidiNote[];
  selectedTrackId: string;
  duration: number;
  currentTime: number;
  zoom: number;
  onChangeNote: (note: MidiNote) => void;
  onSelectNote: (noteId: string) => void;
  headerControl?: ReactNode;
}

const MIN_PITCH = 36;
const MAX_PITCH = 72;
const PITCH_RANGE = MAX_PITCH - MIN_PITCH + 1;

export function PianoRoll({ notes, selectedTrackId, duration, currentTime, zoom, onChangeNote, onSelectNote, headerControl }: PianoRollProps) {
  const visibleNotes = notes.filter((note) => note.trackId === selectedTrackId);
  const contentWidth = Math.max(820, duration * 42 * zoom);
  const timeToPx = (time: number) => (time / duration) * contentWidth;

  return (
    <section className="panel pianoRoll">
      <div className="panelHeader withAction">
        <span>Piano roll editor</span>
        <div className="panelHeaderActions">{headerControl}</div>
      </div>
      <div className="horizontalScroller paddedScroller">
        <div className="pianoRollGrid" style={{ width: `${contentWidth}px` }}>
          {Array.from({ length: PITCH_RANGE }).map((_, row) => (
            <div className="pitchLine" key={row} style={{ top: `${(row / PITCH_RANGE) * 100}%` }} />
          ))}
          {visibleNotes.map((note) => {
            const left = timeToPx(note.start);
            const width = Math.max(timeToPx(note.duration), 10);
            const top = ((MAX_PITCH - note.pitch) / PITCH_RANGE) * 100;
            return (
              <button
                key={note.id}
                className={`noteBlock ${note.selected ? 'selected' : ''}`}
                style={{ left: `${left}px`, width: `${width}px`, top: `${top}%` }}
                onClick={() => onSelectNote(note.id)}
                onDoubleClick={() => onChangeNote({ ...note, pitch: note.pitch + 1 })}
                title={`Pitch ${note.pitch}. Double-click: raise by one semitone.`}
              >
                {note.pitch}
              </button>
            );
          })}
          <div className="playhead" style={{ left: `${timeToPx(currentTime)}px` }} />
        </div>
      </div>
      <p className="hint">Click a note to select it. Double-click to raise its pitch. Use zoom for detailed edits.</p>
    </section>
  );
}
