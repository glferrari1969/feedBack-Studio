import { useEffect, useRef, useState } from 'react';
import type { ProjectState } from '../types/music';
import {
  browseOutputDir,
  checkBackend,
  createBatchConvertPsarcLocalJob,
  createOpenLocalJob,
  getPreferredOutputNamePattern,
  getPreferredOutputDir,
  getProcessingJob,
  setPreferredOutputNamePattern,
  setPreferredOutputDir,
  type ProcessingJob,
} from '../api/backend';

interface Props {
  project: ProjectState;
  onProjectReady: (project: ProjectState) => void;
  onSave?: () => void;
  saving?: boolean;
  hideSave?: boolean;
  landing?: boolean;
}

type InputMode = 'sloppack' | 'psarc' | 'audio';
const OUTPUT_DIR_STORAGE_KEY = 'feedbackStudio.outputDir';
const OUTPUT_NAME_PATTERN_STORAGE_KEY = 'feedbackStudio.outputNamePattern';
const DEFAULT_OUTPUT_NAME_PATTERN = String.raw`<Artist>\<Album>\<Artist>-<Album>-<Name>-<Version>`;


export function MainActions({
  project,
  onProjectReady,
  onSave,
  saving = false,
  hideSave = false,
  landing = false,
}: Props) {
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [outputDir, setOutputDir] = useState('');
  const [outputNamePattern, setOutputNamePattern] = useState(DEFAULT_OUTPUT_NAME_PATTERN);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);

  const rememberOutputDirLocally = (value: string) => {
    const cleaned = value.trim();
    try {
      if (cleaned) {
        window.localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, cleaned);
      } else {
        window.localStorage.removeItem(OUTPUT_DIR_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors in restricted environments.
    }
  };

  const rememberOutputNamePatternLocally = (value: string) => {
    const cleaned = value.trim();
    try {
      if (cleaned) {
        window.localStorage.setItem(OUTPUT_NAME_PATTERN_STORAGE_KEY, cleaned);
      } else {
        window.localStorage.removeItem(OUTPUT_NAME_PATTERN_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors in restricted environments.
    }
  };

  const persistOutputDirPreference = async (value: string): Promise<string> => {
    const cleaned = value.trim();
    rememberOutputDirLocally(cleaned);
    if (!backendOnline) return cleaned;
    const stored = await setPreferredOutputDir(cleaned);
    rememberOutputDirLocally(stored);
    setOutputDir(stored);
    return stored;
  };

  const persistOutputNamePatternPreference = async (value: string): Promise<string> => {
    const cleaned = value.trim();
    rememberOutputNamePatternLocally(cleaned);
    if (!backendOnline) return cleaned;
    const stored = await setPreferredOutputNamePattern(cleaned);
    rememberOutputNamePatternLocally(stored);
    setOutputNamePattern(stored);
    return stored;
  };

  useEffect(() => {
    let active = true;
    try {
      const saved = window.localStorage.getItem(OUTPUT_DIR_STORAGE_KEY) ?? '';
      if (saved.trim()) {
        setOutputDir(saved.trim());
      }
      const savedPattern = window.localStorage.getItem(OUTPUT_NAME_PATTERN_STORAGE_KEY) ?? '';
      if (savedPattern.trim()) {
        setOutputNamePattern(savedPattern.trim());
      }
    } catch {
      // Ignore storage errors in restricted environments.
    }

    checkBackend()
      .then(async (online) => {
        if (!active) return;
        setBackendOnline(online);
        if (!online) return;
        try {
          const [preferredOutputDir, preferredPattern] = await Promise.all([
            getPreferredOutputDir(),
            getPreferredOutputNamePattern(),
          ]);
          if (!active) return;
          if (preferredOutputDir) {
            setOutputDir(preferredOutputDir);
            rememberOutputDirLocally(preferredOutputDir);
          }
          if (preferredPattern) {
            setOutputNamePattern(preferredPattern);
            rememberOutputNamePatternLocally(preferredPattern);
          }
        } catch {
          // Keep local value when backend settings are temporarily unavailable.
        }
      })
      .catch(() => {
        if (!active) return;
        setBackendOnline(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!jobId) return;
    if (pollingRef.current) window.clearInterval(pollingRef.current);

    const poll = async () => {
      try {
        const next = await getProcessingJob(jobId);
        setJob(next);
        if (next.status === 'done') {
          if (next.project) {
            onProjectReady(next.project);
          }
          setJobId(null);
          if (pollingRef.current) window.clearInterval(pollingRef.current);
          return;
        }
        if (next.status === 'error') {
          setJobId(null);
          if (pollingRef.current) window.clearInterval(pollingRef.current);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setJobId(null);
        if (pollingRef.current) window.clearInterval(pollingRef.current);
      }
    };

    poll();
    pollingRef.current = window.setInterval(poll, 1200);
    return () => { if (pollingRef.current) window.clearInterval(pollingRef.current); };
  }, [jobId, onProjectReady]);

  const requestFile = async (mode: InputMode) => {
    setError(null);
    setJob(null);
    try {
      let preferredOutputDir = outputDir.trim();
      try {
        const [storedOutputDir] = await Promise.all([
          persistOutputDirPreference(preferredOutputDir),
          persistOutputNamePatternPreference(outputNamePattern.trim()),
        ]);
        preferredOutputDir = storedOutputDir;
      } catch {
        // Continue using the in-memory value if settings persistence fails.
      }
      const id = await createOpenLocalJob({ mode, outputDir: preferredOutputDir });
      setJobId(id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!message.toLowerCase().includes('cancelled')) setError(message);
    }
  };

  const browseForOutputDir = async () => {
    setError(null);
    try {
      const selected = await browseOutputDir();
      setOutputDir(selected);
      rememberOutputDirLocally(selected);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!message.toLowerCase().includes('cancelled')) setError(message);
    }
  };

  const requestBatchConversion = async () => {
    setError(null);
    setJob(null);
    try {
      let preferredOutputDir = outputDir.trim();
      try {
        const [storedOutputDir] = await Promise.all([
          persistOutputDirPreference(preferredOutputDir),
          persistOutputNamePatternPreference(outputNamePattern.trim()),
        ]);
        preferredOutputDir = storedOutputDir;
      } catch {
        // Continue using the in-memory value if settings persistence fails.
      }
      const id = await createBatchConvertPsarcLocalJob({ outputDir: preferredOutputDir });
      setJobId(id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!message.toLowerCase().includes('cancelled')) setError(message);
    }
  };

  const busy = Boolean(jobId);

  return (
    <section className={landing ? "actionBar landingActionBar" : "actionBar"}>
      <div className="actionStatus">
        <strong>{landing ? 'Choose a project input' : `${project.artist ? `${project.artist} - ` : ''}${project.title}`}</strong>
        <span className={backendOnline ? 'pill ok' : 'pill warn'}>
          {backendOnline === null ? 'Checking backend...' : backendOnline ? 'Backend online' : 'Backend offline'}
        </span>
      </div>

      <div className="actionOptions">
        <label>
          Output folder
          <div className="outputFolderPicker">
            <input
              value={outputDir}
              placeholder="Blank uses the folder of the selected file"
              onChange={(e) => setOutputDir(e.target.value)}
              onBlur={() => {
                void persistOutputDirPreference(outputDir);
              }}
            />
            <button
              type="button"
              className="secondaryButton"
              disabled={!backendOnline || busy}
              onClick={() => {
                void browseForOutputDir();
              }}
            >
              Browse
            </button>
          </div>
          <span className="miniMeta">Blank uses the folder of the file selected in the native dialog.</span>
        </label>
        <label>
          Output naming convention
          <input
            value={outputNamePattern}
            placeholder={DEFAULT_OUTPUT_NAME_PATTERN}
            onChange={(e) => setOutputNamePattern(e.target.value)}
            onBlur={() => {
              void persistOutputNamePatternPreference(outputNamePattern);
            }}
          />
          <span className="miniMeta">Use tags: &lt;Artist&gt;, &lt;Album&gt;, &lt;Year&gt;, &lt;Name&gt; (or &lt;Title&gt;), &lt;Version&gt;. Use backslash (\) to create output subfolders.</span>
        </label>
      </div>

      <div className="mainButtons">
        <button disabled={!backendOnline || busy} onClick={() => requestFile('sloppack')}>Open feedpak</button>
        <button disabled={!backendOnline || busy} onClick={() => requestFile('psarc')}>Convert PSARC</button>
        <button disabled={!backendOnline || busy} onClick={() => { void requestBatchConversion(); }}>Batch conversion</button>
        <button disabled={!backendOnline || busy} onClick={() => requestFile('audio')}>Create feedpak from MP3</button>
        {!hideSave && onSave ? (
          <button className="saveButton" disabled={!backendOnline || busy || saving} onClick={onSave}>Save changes</button>
        ) : null}
      </div>

      {job && <div className="jobBox compactJob"><div className="jobTopLine"><strong>{job.step}</strong><span>{job.progress}%</span></div><div className="progressTrack"><div className="progressFill" style={{ width: `${job.progress}%` }} /></div><p>Status: {job.status}</p>{job.status === 'error' && <pre className="errorBox">{job.error}</pre>}</div>}
      {error && <pre className="errorBox">{error}</pre>}
      {!backendOnline && <p className="hint">Start <code>start_backend.bat</code> first. The frontend sends all conversions to the local backend.</p>}
    </section>
  );
}
