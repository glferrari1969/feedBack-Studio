import { useMemo } from 'react';
import type { StemTrack } from '../types/music';

interface AudioSourceSelectorProps {
  stems: StemTrack[];
  selectedStemId?: string;
  onSelectStem: (stemId: string) => void;
}

function isOggStem(stem: StemTrack) {
  return stem.url?.toLowerCase().includes('.ogg') ?? false;
}

export function AudioSourceSelector({ stems, selectedStemId, onSelectStem }: AudioSourceSelectorProps) {
  const oggStems = useMemo(() => stems.filter(isOggStem), [stems]);
  const playableStems = oggStems.length ? oggStems : stems.filter((stem) => Boolean(stem.url));
  const selected = playableStems.find((stem) => stem.id === selectedStemId)
    ?? playableStems.find((stem) => stem.id === 'full')
    ?? playableStems.find((stem) => stem.kind === 'mix' || stem.kind === 'full')
    ?? playableStems[0];

  return (
    <section className="panel audioSourcePanel">
      <div className="panelHeader withAction">
        <span>Audio / stem</span>
        <span className="miniMeta">{playableStems.length} file</span>
      </div>
      <div className="audioSourceBody">
        <label>
          Audio file to play
          <select value={selected?.id ?? ''} onChange={(event) => onSelectStem(event.target.value)} disabled={!playableStems.length}>
            {!playableStems.length ? <option value="">No audio</option> : null}
            {playableStems.map((stem) => (
              <option key={stem.id} value={stem.id}>
                {stem.id === 'full' ? 'full.ogg / full audio' : stem.name} {stem.url?.toLowerCase().endsWith('.ogg') ? '' : '(not ogg)'}
              </option>
            ))}
          </select>
        </label>
        <p className="hint slimHint">
          The main Play button uses this file. Changing it reloads both waveform and playback.
        </p>
      </div>
    </section>
  );
}
