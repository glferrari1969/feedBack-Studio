import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectState } from '../types/music';
import { importArrangement, listGpTracks, type GpTrackInfo } from '../api/backend';

interface Props {
  project?: ProjectState;
  onProjectReady: (project: ProjectState) => void;
  allowedInstruments?: Array<'guitar' | 'bass' | 'keys' | 'drums'>;
  defaultInstrument?: 'guitar' | 'bass' | 'keys' | 'drums';
}

const GP_FILE_RE = /\.(gp5|gp4|gp3|gpx)$/i;

function isGpFile(file: File | null): boolean {
  if (!file) return false;
  return GP_FILE_RE.test(file.name || '');
}

function chooseDefaultTrackIndex(tracks: GpTrackInfo[], instrument: 'guitar' | 'bass' | 'keys'): number {
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

export function AddArrangementPanel({
  project,
  onProjectReady,
  allowedInstruments,
  defaultInstrument,
}: Props) {
  const resolvedInstruments = useMemo<Array<'guitar' | 'bass' | 'keys' | 'drums'>>(
    () =>
      allowedInstruments && allowedInstruments.length
        ? allowedInstruments
        : ['guitar', 'bass', 'keys', 'drums'],
    [allowedInstruments],
  );
  const initialInstrument =
    defaultInstrument && resolvedInstruments.includes(defaultInstrument)
      ? defaultInstrument
      : resolvedInstruments[0];
  const [file, setFile] = useState<File | null>(null);
  const [instrument, setInstrument] = useState<'guitar' | 'bass' | 'keys' | 'drums'>(initialInstrument);
  const [name, setName] = useState(
    initialInstrument === 'drums'
      ? 'Imported Drums'
      : initialInstrument === 'keys'
        ? 'Imported Keys'
      : initialInstrument === 'bass'
        ? 'Imported Bass'
        : 'Imported Guitar',
  );
  const [gpTracks, setGpTracks] = useState<GpTrackInfo[]>([]);
  const [gpTrackIndex, setGpTrackIndex] = useState<number>(-1);
  const [tracksBusy, setTracksBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!resolvedInstruments.includes(instrument)) {
      setInstrument(initialInstrument);
    }
  }, [initialInstrument, instrument, resolvedInstruments]);

  const handleFileChange = async (nextFile: File | null) => {
    setFile(nextFile);
    setGpTracks([]);
    setGpTrackIndex(-1);
    if (!nextFile || !isGpFile(nextFile)) return;
    if (instrument === 'drums') {
      setError('Drum import from Guitar Pro is not supported yet. Use a MIDI file with drum channel data.');
      return;
    }
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
    if (instrument === 'drums' && isGpFile(file)) {
      setError('Drum import from Guitar Pro is not supported yet. Use a MIDI file with drum channel data.');
      return;
    }
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
      <label className="field">
        <span>MIDI or Guitar Pro 5/4/3/GPX</span>
        <div className="filePickerRow">
          <input
            ref={fileInputRef}
            className="hiddenInput"
            type="file"
            accept=".mid,.midi,.gp5,.gp4,.gp3,.gpx"
            onChange={(e) => { void handleFileChange(e.target.files?.[0] ?? null); }}
          />
          <button
            type="button"
            className="secondaryButton filePickerButton"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </button>
          <span className="filePickerName">{file?.name ?? 'No file selected'}</span>
        </div>
      </label>
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
      {resolvedInstruments.length > 1 ? (
        <label className="field"><span>Type</span><select value={instrument} onChange={(e) => {
          const next = e.target.value as 'guitar' | 'bass' | 'keys' | 'drums';
          if (!resolvedInstruments.includes(next)) return;
          setInstrument(next);
          if (gpTracks.length > 0 && next !== 'drums') {
            setGpTrackIndex(chooseDefaultTrackIndex(gpTracks, next));
          }
        }}>{resolvedInstruments.includes('guitar') ? <option value="guitar">Guitar</option> : null}{resolvedInstruments.includes('bass') ? <option value="bass">Bass</option> : null}{resolvedInstruments.includes('keys') ? <option value="keys">Keys</option> : null}{resolvedInstruments.includes('drums') ? <option value="drums">Drums (drum_tab)</option> : null}</select></label>
      ) : (
        <p className="hint slimHint">
          Import target: {instrument === 'drums' ? 'Drums (drum_tab)' : instrument === 'bass' ? 'Bass' : instrument === 'keys' ? 'Keys' : 'Guitar'}
        </p>
      )}
      <button className="primaryButton" disabled={!project || !file || busy} onClick={submit}>{busy ? 'Importing...' : 'Import arrangement'}</button>
      {error && <pre className="errorBox">{error}</pre>}
    </section>
  );
}
