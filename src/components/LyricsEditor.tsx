import type { LyricLine } from '../types/music';

interface LyricsEditorProps {
  lyrics?: LyricLine[];
  lyricsSource?: string;
  currentTime: number;
  duration: number;
  selectedLyricId?: string | null;
  onSelectLyric?: (id: string | null) => void;
  onChange: (lyrics: LyricLine[], source?: string) => void;
  onSeek: (time: number) => void;
}

function sortedLyrics(lyrics?: LyricLine[]) {
  return [...(lyrics ?? [])].sort((a, b) => Number(a.t || 0) - Number(b.t || 0));
}

function lyricId(line: LyricLine, index: number) {
  return line.id ?? `${line.t}-${index}`;
}

export function LyricsEditor({ lyrics, lyricsSource, currentTime, duration, selectedLyricId, onSelectLyric, onChange, onSeek }: LyricsEditorProps) {
  const rows = sortedLyrics(lyrics);
  const update = (index: number, patch: Partial<LyricLine>) => {
    const next = rows.map((line, i) => i === index ? { ...line, id: line.id ?? lyricId(line, i), ...patch } : line);
    onChange(next, lyricsSource || 'user');
  };
  const addAtPlayhead = () => {
    const id = crypto.randomUUID();
    const next = [...rows, { id, t: Number(currentTime.toFixed(3)), d: 1, w: '' }]
      .sort((a, b) => a.t - b.t);
    onChange(next, 'user');
    onSelectLyric?.(id);
  };
  const remove = (index: number) => {
    const removedId = lyricId(rows[index], index);
    onChange(rows.filter((_, i) => i !== index), lyricsSource || 'user');
    if (selectedLyricId === removedId) onSelectLyric?.(null);
  };

  const active = rows.findIndex((line) => currentTime >= line.t && currentTime <= line.t + Math.max(0.05, line.d));

  return (
    <section className="panel lyricsPanel">
      <div className="panelHeader withAction">
        <div>
          <h2>Lyric events</h2>
          <span className="miniMeta">{rows.length} lyric events{lyricsSource ? ` · source: ${lyricsSource}` : ''}</span>
        </div>
        <button type="button" className="smallButton" onClick={addAtPlayhead}>Add at playhead</button>
      </div>
      <div className="karaokePreview">
        {active >= 0 ? rows[active].w : 'No lyric at the current position'}
      </div>
      <div className="lyricsTable">
        <div className="lyricsRow lyricsHeader">
          <span>Time</span><span>Duration</span><span>Lyric</span><span></span>
        </div>
        {rows.map((line, index) => {
          const id = lyricId(line, index);
          return (
            <div className={`lyricsRow ${index === active ? 'active' : ''} ${selectedLyricId === id ? 'selected' : ''}`} key={id}>
              <input type="number" step="0.001" min="0" max={duration} value={Number(line.t ?? 0)} onFocus={() => { onSelectLyric?.(id); onSeek(Number(line.t || 0)); }} onChange={(event) => update(index, { t: Number(event.target.value) })} />
              <input type="number" step="0.001" min="0.01" value={Number(line.d ?? 0.5)} onFocus={() => onSelectLyric?.(id)} onChange={(event) => update(index, { d: Number(event.target.value) })} />
              <input value={line.w ?? ''} onFocus={() => { onSelectLyric?.(id); onSeek(Number(line.t || 0)); }} onChange={(event) => update(index, { w: event.target.value })} />
              <button type="button" className="miniButton dangerButton" onClick={() => remove(index)}>Delete</button>
            </div>
          );
        })}
        {!rows.length ? <div className="emptyHint">No lyrics were found. Add synced lyric events to create a karaoke track.</div> : null}
      </div>
    </section>
  );
}
