import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MidiNote, SyncPoint } from '../types/music';

interface PianoRollProps {
  notes: MidiNote[];
  selectedTrackId: string;
  duration: number;
  currentTime: number;
  zoom: number;
  syncPoints?: SyncPoint[];
  selectedSyncPointId?: string | null;
  onSelectSyncPoint?: (id: string) => void;
  onChangeSyncPoint?: (point: SyncPoint) => void;
  onAddSyncPointAt?: (time: number) => void;
  onChangeNote: (note: MidiNote) => void;
  onSelectNote: (noteId: string) => void;
  onAddNotes: (notes: MidiNote[]) => void;
  onDeleteNote: (noteId: string) => void;
  onSeek: (time: number) => void;
  headerControl?: ReactNode;
}

const MIN_VISIBLE_PITCH = 36;
const MAX_VISIBLE_PITCH = 84;
const DEFAULT_NOTE_DURATION = 0.5;
const MIN_NOTE_DURATION = 0.125;
const CHORD_SELECTION_TOLERANCE = 0.02;
const ROW_HEIGHT_PX = 18;
const KEY_LANE_WIDTH_PX = 88;

type DragState = {
  id: string;
  startX: number;
  original: MidiNote;
  chordOriginals: MidiNote[];
  rippleOriginals: MidiNote[];
  chordStart: number;
  anchorPitch: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midiToName(pitch: number) {
  const names = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function noteLabel(note: MidiNote) {
  return `${midiToName(note.pitch)} (${note.pitch})`;
}

function isBlackKey(pitch: number) {
  const pitchClass = ((pitch % 12) + 12) % 12;
  return [1, 3, 6, 8, 10].includes(pitchClass);
}

export function PianoRoll({
  notes,
  selectedTrackId,
  duration,
  currentTime,
  zoom,
  syncPoints = [],
  selectedSyncPointId,
  onSelectSyncPoint,
  onChangeSyncPoint,
  onAddSyncPointAt,
  onChangeNote,
  onSelectNote,
  onAddNotes,
  onDeleteNote,
  onSeek,
  headerControl,
}: PianoRollProps) {
  const [snap, setSnap] = useState(0.0625);
  const [nudge, setNudge] = useState(0.01);
  const [activeEditorNoteId, setActiveEditorNoteId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const visibleNotes = useMemo(
    () => notes
      .filter((note) => note.trackId === selectedTrackId)
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch),
    [notes, selectedTrackId],
  );

  const selectedNotes = useMemo(
    () => visibleNotes.filter((note) => note.selected),
    [visibleNotes],
  );

  const selectedNote =
    selectedNotes.find((note) => note.id === activeEditorNoteId) ??
    selectedNotes[0];

  const selectedChordNotes = useMemo(() => {
    if (!selectedNote) return [];
    return selectedNotes
      .filter(
        (note) =>
          Math.abs(note.start - selectedNote.start) <= CHORD_SELECTION_TOLERANCE,
      )
      .sort((a, b) => a.pitch - b.pitch);
  }, [selectedNote, selectedNotes]);

  useEffect(() => {
    if (selectedNote) {
      if (activeEditorNoteId !== selectedNote.id) {
        setActiveEditorNoteId(selectedNote.id);
      }
      return;
    }
    if (activeEditorNoteId !== null) {
      setActiveEditorNoteId(null);
    }
  }, [selectedNote, activeEditorNoteId]);

  const [minPitch, maxPitch] = useMemo(() => {
    let nextMin = MIN_VISIBLE_PITCH;
    let nextMax = MAX_VISIBLE_PITCH;
    if (visibleNotes.length) {
      const pitches = visibleNotes.map((note) => note.pitch);
      nextMin = Math.min(nextMin, ...pitches);
      nextMax = Math.max(nextMax, ...pitches);
    }
    nextMin = clamp(nextMin - 2, 0, 126);
    nextMax = clamp(nextMax + 2, nextMin + 1, 127);
    return [nextMin, nextMax];
  }, [visibleNotes]);

  const pitchRange = maxPitch - minPitch + 1;
  const gridHeight = Math.max(320, pitchRange * ROW_HEIGHT_PX);
  const contentWidth = Math.max(820, duration * 42 * zoom);
  const pitchForRow = (rowIndex: number) => clamp(maxPitch - rowIndex, 0, 127);
  const rowPitches = useMemo(
    () => Array.from({ length: pitchRange }, (_, row) => pitchForRow(row)),
    [pitchRange, maxPitch],
  );
  const timeToPx = (time: number) => (duration > 0 ? (time / duration) * contentWidth : 0);
  const clientXToTime = (clientX: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return 0;
    return clamp(((clientX - rect.left) / contentWidth) * duration, 0, duration);
  };
  const topForPitch = (pitch: number) => {
    const normalized = clamp(pitch, minPitch, maxPitch);
    return (maxPitch - normalized + 0.5) * ROW_HEIGHT_PX;
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || duration <= 0) return;
    const playheadX = KEY_LANE_WIDTH_PX + timeToPx(currentTime);
    const margin = Math.min(260, scroller.clientWidth * 0.34);
    const leftEdge = scroller.scrollLeft + margin;
    const rightEdge = scroller.scrollLeft + scroller.clientWidth - margin;
    if (playheadX < leftEdge || playheadX > rightEdge) {
      scroller.scrollLeft = Math.max(0, playheadX - scroller.clientWidth * 0.45);
    }
  }, [currentTime, contentWidth, duration]);

  const snapTime = (value: number) => {
    if (snap <= 0) return Number(value.toFixed(4));
    return Number((Math.round(value / snap) * snap).toFixed(4));
  };

  const applyNotePatch = (note: MidiNote, patch: Partial<MidiNote>) => {
    const nextStart = clamp(
      Number((patch.start ?? note.start).toFixed(4)),
      0,
      duration,
    );
    const maxDuration = Math.max(MIN_NOTE_DURATION, duration - nextStart);
    const nextDuration = clamp(
      Number((patch.duration ?? note.duration).toFixed(4)),
      MIN_NOTE_DURATION,
      maxDuration,
    );
    onChangeNote({
      ...note,
      ...patch,
      start: nextStart,
      duration: nextDuration,
      pitch: clamp(Math.round(patch.pitch ?? note.pitch), 0, 127),
      velocity: clamp(Math.round(patch.velocity ?? note.velocity), 1, 127),
    });
  };

  const updateSelected = (patch: Partial<MidiNote>) => {
    if (!selectedNote) return;
    applyNotePatch(selectedNote, patch);
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!drag || !rect || duration <= 0) return;

      const dx = event.clientX - drag.startX;
      const xDeltaSeconds = (dx / contentWidth) * duration;

      const rowIndex = clamp(
        Math.floor((event.clientY - rect.top) / ROW_HEIGHT_PX),
        0,
        pitchRange - 1,
      );
      const targetPitch = pitchForRow(rowIndex);
      const pitchDelta = targetPitch - drag.anchorPitch;

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
        applyNotePatch(originalNote, {
          start: clamp(
            snappedStart,
            0,
            Math.max(0, duration - originalNote.duration),
          ),
          duration: originalNote.duration,
          pitch: clamp(originalNote.pitch + pitchDelta, 0, 127),
        });
      });

      drag.rippleOriginals.forEach((originalNote) => {
        const targetStart = isRippleMode
          ? originalNote.start + rippleDelta
          : originalNote.start;
        applyNotePatch(originalNote, {
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

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [contentWidth, duration, onChangeNote, pitchRange, snap]);

  const eventToTime = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return 0;
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    return clamp((x / contentWidth) * duration, 0, duration);
  };

  const addNoteAt = (time: number, pitch: number) => {
    const snappedStart = snapTime(time);
    onAddNotes([
      {
        id: crypto.randomUUID(),
        trackId: selectedTrackId,
        start: clamp(snappedStart, 0, duration),
        duration: DEFAULT_NOTE_DURATION,
        velocity: 96,
        pitch: clamp(pitch, 0, 127),
        techniques: {},
      },
    ]);
  };

  const handleGridClick = (event: React.MouseEvent<HTMLDivElement>) => {
    onSeek(eventToTime(event));
  };

  const handleGridDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const time = eventToTime(event);
    if (event.shiftKey || event.altKey) {
      onAddSyncPointAt?.(time);
      return;
    }
    const rowIndex = clamp(
      Math.floor((event.clientY - rect.top) / ROW_HEIGHT_PX),
      0,
      pitchRange - 1,
    );
    addNoteAt(time, pitchForRow(rowIndex));
  };

  return (
    <section className="panel pianoRoll">
      <div className="panelHeader tabEditorHeader">
        <h2>Piano roll editor</h2>
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
        </div>
      </div>

      <div className="pianoRollViewport" ref={scrollerRef}>
        <div className="pianoRollCanvas" style={{ height: `${gridHeight}px` }}>
          <div className="pianoKeyLane" style={{ width: `${KEY_LANE_WIDTH_PX}px`, height: `${gridHeight}px` }}>
            {rowPitches.map((pitch, row) => (
              <div
                key={`key-${pitch}-${row}`}
                className={`pianoKeyRow ${isBlackKey(pitch) ? 'black' : 'white'} ${pitch % 12 === 0 ? 'octave' : ''}`}
                style={{ top: `${row * ROW_HEIGHT_PX}px`, height: `${ROW_HEIGHT_PX}px` }}
                title={`${midiToName(pitch)} (${pitch})`}
              >
                <span className="pianoKeyName">{midiToName(pitch)}</span>
                {pitch % 12 === 0 ? <span className="pianoKeyOctave">Octave</span> : null}
              </div>
            ))}
          </div>

          <div
            className="pianoRollGrid"
            ref={gridRef}
            onClick={handleGridClick}
            onDoubleClick={handleGridDoubleClick}
            style={{ width: `${contentWidth}px`, height: `${gridHeight}px` }}
          >
            {rowPitches.map((pitch, row) => (
              <div
                className={`pitchLine ${pitch % 12 === 0 ? 'octaveLine' : ''}`}
                key={`line-${pitch}-${row}`}
                style={{
                  top: `${row * ROW_HEIGHT_PX}px`,
                }}
              />
            ))}

          {syncPoints.map((point) => {
            const selected = point.id === selectedSyncPointId;
            return (
              <button
                key={point.id}
                type="button"
                className={`syncMarker tabSyncMarker ${selected ? 'selected' : ''}`}
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
                  const nextTime = Number(clientXToTime(event.clientX).toFixed(3));
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

          {visibleNotes.map((note) => {
            const left = timeToPx(note.start);
            const width = Math.max(timeToPx(note.duration), 18);
            const top = topForPitch(note.pitch);
            const techniques = Object.entries(note.techniques ?? {})
              .filter(([, value]) => value)
              .map(([key]) => key.slice(0, 2).toUpperCase())
              .join(' ');
            return (
              <button
                key={note.id}
                type="button"
                className={`noteBlock ${note.selected ? 'selected' : ''}`}
                style={{ left: `${left}px`, width: `${width}px`, top: `${top}px` }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setActiveEditorNoteId(note.id);
                  onSelectNote(note.id);
                  const chordOriginals = visibleNotes.filter(
                    (candidate) =>
                      Math.abs(candidate.start - note.start) <= CHORD_SELECTION_TOLERANCE,
                  );
                  const chordIds = new Set(chordOriginals.map((item) => item.id));
                  const chordStart = chordOriginals.length
                    ? Math.min(...chordOriginals.map((item) => item.start))
                    : note.start;
                  const rippleOriginals = visibleNotes.filter(
                    (candidate) =>
                      !chordIds.has(candidate.id) &&
                      candidate.start > chordStart + CHORD_SELECTION_TOLERANCE,
                  );
                  dragRef.current = {
                    id: note.id,
                    startX: event.clientX,
                    original: note,
                    chordOriginals,
                    rippleOriginals,
                    chordStart,
                    anchorPitch: note.pitch,
                  };
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  updateSelected({ pitch: note.pitch + 1 });
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDeleteNote(note.id);
                }}
                title="Drag left/right to move in time. Drag up/down to change pitch. Ctrl+drag: ripple all following notes/chords. Double-click: +1 semitone. Right-click: delete note."
              >
                {noteLabel(note)}
                {techniques ? <em>{techniques}</em> : null}
              </button>
            );
          })}

            <div className="playhead" style={{ left: `${timeToPx(currentTime)}px` }} />
          </div>
        </div>
      </div>

      <div className="tabEditorBottom">
        <section className="selectedNotePanel noteAndChordPanel">
          <div className="subHeader">Selected note / chord</div>
          {!selectedNote ? (
            <p className="hint slimHint">
              Double-click the grid to add a note. Shift+double-click adds a sync point. Select a note to edit it.
            </p>
          ) : (
            <div className="noteEditGrid">
              <label>
                Pitch
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={selectedNote.pitch}
                  onChange={(event) =>
                    updateSelected({ pitch: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Start
                <input
                  type="number"
                  step={0.001}
                  min={0}
                  max={duration}
                  value={selectedNote.start}
                  onChange={(event) =>
                    updateSelected({ start: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Duration
                <input
                  type="number"
                  step={0.125}
                  min={MIN_NOTE_DURATION}
                  max={duration}
                  value={selectedNote.duration}
                  onChange={(event) =>
                    updateSelected({ duration: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Velocity
                <input
                  type="number"
                  min={1}
                  max={127}
                  value={selectedNote.velocity}
                  onChange={(event) =>
                    updateSelected({ velocity: Number(event.target.value) })
                  }
                />
              </label>

              <div className="noteButtons">
                <button
                  type="button"
                  className="smallButton"
                  onClick={() =>
                    updateSelected({
                      start: Number((selectedNote.start - nudge).toFixed(4)),
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
                      start: Number((selectedNote.start + nudge).toFixed(4)),
                    })
                  }
                >
                  →
                </button>
                <button
                  type="button"
                  className="smallButton"
                  onClick={() => updateSelected({ pitch: selectedNote.pitch + 1 })}
                >
                  +1 st
                </button>
                <button
                  type="button"
                  className="smallButton"
                  onClick={() => updateSelected({ pitch: selectedNote.pitch - 1 })}
                >
                  -1 st
                </button>
                <button
                  type="button"
                  className="smallButton"
                  onClick={() =>
                    updateSelected({
                      duration: selectedNote.duration + snap,
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
                      duration: selectedNote.duration - snap,
                    })
                  }
                >
                  Shorten
                </button>
                <button
                  type="button"
                  className="dangerButton"
                  onClick={() => onDeleteNote(selectedNote.id)}
                >
                  Delete
                </button>
              </div>

              <div className="chordMemberEditor">
                <div className="chordMemberHeader">
                  <strong>Chord notes at {selectedNote.start.toFixed(3)}s</strong>
                </div>
                <div className="chordMemberList">
                  {selectedChordNotes.map((note, index) => (
                    <div
                      key={note.id}
                      className={`chordMemberRow ${note.id === selectedNote.id ? 'active' : ''}`}
                    >
                      <button
                        type="button"
                        className="smallButton chordMemberTag"
                        onClick={() => {
                          setActiveEditorNoteId(note.id);
                          onSelectNote(note.id);
                        }}
                        title="Focus this note"
                      >
                        {index + 1}. {noteLabel(note)}
                      </button>
                      <label>
                        Pitch
                        <input
                          type="number"
                          min={0}
                          max={127}
                          value={note.pitch}
                          onChange={(event) =>
                            applyNotePatch(note, {
                              pitch: Number(event.target.value),
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
        </section>

        <section className="chordPanel">
          <div className="subHeader">Quick insert</div>
          <button
            type="button"
            className="secondaryButton"
            onClick={() => addNoteAt(currentTime, 60)}
          >
            Add note at playhead
          </button>
        </section>
      </div>

      <p className="hint">
        Double-click the grid to add a note. Shift+double-click adds a sync point. Drag a note to move it in time or pitch. If you select one note in a chord, all notes sharing the same start are selected. Ctrl+drag applies ripple to following notes.
      </p>
    </section>
  );
}
