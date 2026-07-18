import { useState } from 'react';
import type { ProjectState } from '../types/music';
import { importArrangement, listGpTracks, type GpTrackInfo } from '../api/backend';

interface Props {
  project?: ProjectState;
  onProjectReady: (project: ProjectState) => void;
}

const GP_FILE_RE = /\.(gp5|gp4|gp3|gpx|gp)$/i;

function isGpFile(file: File | null): boolean {
  if (!file) return false;
  return GP_FILE_RE.test(file.name || '');
}

function chooseDefaultTrackIndex(tracks: GpTrackInfo[], instrument: 'guitar' | 'bass'): number {
  if (!tracks.length) return -1;
  const bassByName = (track: GpTrackInfo) => /bass/i.test(track.name || '');
  const preferred = instrument === 'bass'
    ? tracks.find((track) => track.is_bass || bassByName(track))
    : tracks.find((track) => !track.is_bass && !bassByName(track));
  return (preferred ?? tracks[0]).index;
}

function trackOptionLabel(track: GpTrackInfo): string {
  const hints = [`${track.notes} notes`, `${track.strings} strings`];
  if (track.is_bass) hints.push('bass-like');
  if (track.instrument >= 0) hints.push(`GM ${track.instrument}`);
  return `#${track.index + 1} ${track.name} (${hints.join(', ')})`;
}

export function AddArrangementPanel({ project, onProjectReady }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [instrument, setInstrument] = useState<'guitar' | 'bass'>('guitar');
  const [name, setName] = useState('Imported Guitar');
  const [gpTracks, setGpTracks] = useState<GpTrackInfo[]>([]);
  const [gpTrackIndex, setGpTrackIndex] = useState<number>(-1);
  const [tracksBusy, setTracksBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFileChange = async (nextFile: File | null) => {
    setFile(nextFile);
    setGpTracks([]);
    setGpTrackIndex(-1);
    if (!nextFile || !isGpFile(nextFile)) return;
    setTracksBusy(true);
    setError(null);
    try {
      const tracks = await listGpTracks(nextFile);
      const melodic = tracks.filter((track) => !track.is_percussion && track.notes > 0);
      setGpTracks(melodic);
      if (melodic.length > 0) {
        setGpTrackIndex(chooseDefaultTrackIndex(melodic, instrument));
      } else {
        setError('No melodic GP track found in this file.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTracksBusy(false);
    }
  };

  const submit = async () => {
    if (!project || !file) return;
    if (isGpFile(file) && gpTrackIndex < 0) {
      setError('Select a GP track before importing.');
      return;
    }
    setBusy(true); setError(null);
    try {
      onProjectReady(await importArrangement(
        project.id,
        file,
        instrument,
        name,
        isGpFile(file) ? gpTrackIndex : undefined,
      ));
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel importPanel">
      <div className="panelHeader"><h2>Add arrangment</h2></div>
      <label className="field"><span>MIDI o Guitar Pro 5/4/3/GPX</span><input type="file" accept=".mid,.midi,.gp5,.gp4,.gp3,.gpx,.gp" onChange={(e) => { void handleFileChange(e.target.files?.[0] ?? null); }} /></label>
      {isGpFile(file) ? (
        <label className="field">
          <span>Guitar Pro track</span>
          <select value={gpTrackIndex} disabled={tracksBusy || gpTracks.length === 0} onChange={(e) => setGpTrackIndex(Number(e.target.value))}>
            {gpTracks.length === 0 ? (
              <option value={-1}>{tracksBusy ? 'Reading tracks...' : 'No selectable tracks'}</option>
            ) : gpTracks.map((track) => (
              <option key={track.index} value={track.index}>
                {trackOptionLabel(track)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field"><span>Arrangement name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Type</span><select value={instrument} onChange={(e) => {
        const next = e.target.value as 'guitar' | 'bass';
        setInstrument(next);
        if (gpTracks.length > 0) {
          setGpTrackIndex(chooseDefaultTrackIndex(gpTracks, next));
        }
      }}><option value="guitar">Guitar</option><option value="bass">Bass</option></select></label>
      <button className="primaryButton" disabled={!project || !file || busy} onClick={submit}>{busy ? 'Importing...' : 'Import arrangement'}</button>
      {error && <pre className="errorBox">{error}</pre>}
    </section>
  );
}
