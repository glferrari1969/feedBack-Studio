import { useRef, useState } from 'react';
import type { ArrangementInfo, ProjectState } from '../types/music';
import { exportArrangement, listGpTracks, replaceArrangement, type GpTrackInfo } from '../api/backend';

interface Props {
  project: ProjectState;
  arrangement?: ArrangementInfo;
  onProjectReady: (project: ProjectState) => void;
  strictArrangement?: boolean;
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

function inferInstrument(arrangement?: ArrangementInfo): 'guitar' | 'bass' | 'keys' | 'drums' {
  if (arrangement?.type === 'drums') return 'drums';
  if (arrangement?.type === 'keys' || arrangement?.type === 'piano') return 'keys';
  if (arrangement?.type === 'bass') return 'bass';
  if (arrangement?.tuning?.length === 4 || arrangement?.tuning?.length === 5) return 'bass';
  return 'guitar';
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ArrangementTransferPanel({
  project,
  arrangement,
  onProjectReady,
  strictArrangement = false,
}: Props) {
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [gpTracks, setGpTracks] = useState<GpTrackInfo[]>([]);
  const [gpTrackIndex, setGpTrackIndex] = useState<number>(-1);
  const [tracksBusy, setTracksBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);

  const arrangementId = strictArrangement
    ? arrangement?.id
    : arrangement?.id ?? project.selectedArrangementId;
  const disabled = !arrangementId;
  const targetInstrument = inferInstrument(arrangement);

  const exportCurrent = async (format: 'midi' | 'musicxml') => {
    if (!arrangementId) return;
    setBusy(format);
    setError(null);
    try {
      const result = await exportArrangement(project, arrangementId, format);
      downloadBlob(result.blob, result.filename);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const replaceCurrent = async () => {
    if (!arrangementId || !replaceFile) return;
    if (targetInstrument === 'drums' && isGpFile(replaceFile)) {
      setError('Drum replace from Guitar Pro is not supported yet. Use a MIDI file with drum channel data.');
      return;
    }
    if (isGpFile(replaceFile) && gpTrackIndex < 0) {
      setError('Select a GP track before replacing.');
      return;
    }
    const confirmed = window.confirm('Replace the current arrangement with the selected file? Current notes will be overwritten.');
    if (!confirmed) return;
    setBusy('replace');
    setError(null);
    try {
      const next = await replaceArrangement(
        project.id,
        arrangementId,
        replaceFile,
        targetInstrument,
        isGpFile(replaceFile) ? gpTrackIndex : undefined,
      );
      onProjectReady(next);
      setReplaceFile(null);
      setGpTracks([]);
      setGpTrackIndex(-1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const onReplaceFileChange = async (nextFile: File | null) => {
    setReplaceFile(nextFile);
    setGpTracks([]);
    setGpTrackIndex(-1);
    if (!nextFile || !isGpFile(nextFile)) return;
    if (targetInstrument === 'drums') {
      setError('Drum replace from Guitar Pro is not supported yet. Use a MIDI file with drum channel data.');
      return;
    }
    setTracksBusy(true);
    setError(null);
    try {
      const tracks = await listGpTracks(nextFile);
      const melodic = tracks.filter((track) => !track.is_percussion && track.notes > 0);
      setGpTracks(melodic);
      if (melodic.length > 0) {
        setGpTrackIndex(chooseDefaultTrackIndex(melodic, targetInstrument));
      } else {
        setError('No melodic GP track found in this file.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTracksBusy(false);
    }
  };

  return (
    <section className="panel compactPanel transferPanel">
      <div className="panelHeader">Arrangement import/export</div>
      <p className="hint">Available exports: MIDI and MusicXML. Native GP5 export is not provided by the bundled libraries; Guitar Pro can import both formats.</p>
      <div className="buttonRow stackedButtons">
        <button disabled={disabled || busy !== null} onClick={() => exportCurrent('midi')}>
          {busy === 'midi' ? 'Exporting MIDI...' : 'Export MIDI'}
        </button>
        <button disabled={disabled || busy !== null} onClick={() => exportCurrent('musicxml')}>
          {busy === 'musicxml' ? 'Exporting MusicXML...' : 'Export MusicXML'}
        </button>
      </div>
      <label className="field">
        <span>Replace current from MIDI or Guitar Pro</span>
        <div className="filePickerRow">
          <input
            ref={replaceFileInputRef}
            className="hiddenInput"
            type="file"
            accept=".mid,.midi,.gp5,.gp4,.gp3,.gpx"
            onChange={(event) => { void onReplaceFileChange(event.target.files?.[0] ?? null); }}
          />
          <button
            type="button"
            className="secondaryButton filePickerButton"
            onClick={() => replaceFileInputRef.current?.click()}
          >
            Choose file
          </button>
          <span className="filePickerName">{replaceFile?.name ?? 'No file selected'}</span>
        </div>
      </label>
      {isGpFile(replaceFile) ? (
        <label className="field">
          <span>Guitar Pro track</span>
          <select
            value={gpTrackIndex}
            disabled={tracksBusy || gpTracks.length === 0}
            onChange={(event) => setGpTrackIndex(Number(event.target.value))}
          >
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
      <button className="dangerButton" disabled={disabled || !replaceFile || busy !== null} onClick={replaceCurrent}>
        {busy === 'replace' ? 'Replacing...' : 'Import and replace current'}
      </button>
      {error && <pre className="errorBox">{error}</pre>}
    </section>
  );
}
