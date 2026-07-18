import type { ProjectState } from '../types/music';
import { AlbumArtEditor } from './AlbumArtEditor';

interface SongMetadataEditorProps {
  project: ProjectState;
  onChange: (project: ProjectState) => void;
}

type ExtraField = {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  aliases?: string[];
  projectKey?: keyof Pick<ProjectState, 'lyricsSource'>;
};

const MAIN_FIELDS: Array<{ key: keyof Pick<ProjectState, 'artist' | 'album' | 'title' | 'year'>; label: string; placeholder: string }> = [
  { key: 'artist', label: 'Artist', placeholder: 'Artist' },
  { key: 'album', label: 'Album', placeholder: 'Album' },
  { key: 'title', label: 'Title', placeholder: 'Song title' },
  { key: 'year', label: 'Year', placeholder: 'Year' },
];

const EXTRA_SECTIONS: Array<{
  title: string;
  fields: ExtraField[];
}> = [
  {
    title: 'Catalog',
    fields: [
      { key: 'genre', label: 'Genre' },
      { key: 'lyricsSource', label: 'Lyrics source', projectKey: 'lyricsSource' },
      { key: 'source', label: 'Source', aliases: ['importSource'] },
      { key: 'platform', label: 'Platform' },
    ],
  },
  {
    title: 'Authoring',
    fields: [
      { key: 'charter', label: 'Chart author' },
      { key: 'version', label: 'Version' },
      { key: 'notes', label: 'Notes', multiline: true },
    ],
  },
  {
    title: 'Credits & Release',
    fields: [
      { key: 'albumArtist', label: 'Album artist', aliases: ['album_artist', 'albumartist'] },
      { key: 'composer', label: 'Composer', aliases: ['writer', 'songwriter'] },
      { key: 'trackNumber', label: 'Track number', aliases: ['tracknumber', 'track'] },
      { key: 'discNumber', label: 'Disc number', aliases: ['discnumber', 'disc'] },
      { key: 'isrc', label: 'ISRC', aliases: ['ISRC'] },
      { key: 'copyright', label: 'Copyright' },
    ],
  },
  {
    title: 'Identifiers',
    fields: [
      { key: 'dlcKey', label: 'DLC key', aliases: ['dlc_key', 'DLCKey', 'persistentID', 'persistentId'] },
      { key: 'originalFile', label: 'Original file', aliases: ['original_file', 'inputFile'] },
    ],
  },
];

const EXTRA_FIELD_KEYS = new Set(
  EXTRA_SECTIONS.flatMap((section) =>
    section.fields.flatMap((field) => [field.key, ...(field.aliases ?? [])]),
  ),
);

const RESERVED_EXTRA_KEYS = new Set([
  ...EXTRA_FIELD_KEYS,
]);

function metadataEntries(project: ProjectState) {
  return Object.entries(project.metadata ?? {}).filter(
    ([key, value]) => !RESERVED_EXTRA_KEYS.has(key) && value !== undefined && value !== null,
  );
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function meterToText(meter: [number, number] | undefined) {
  if (!meter || meter.length < 2) return '4/4';
  return `${meter[0]}/${meter[1]}`;
}

function parseMeter(value: string, fallback: [number, number]): [number, number] {
  const [top, bottom] = value.split('/').map((part) => Number(part.trim()));
  if (Number.isFinite(top) && Number.isFinite(bottom) && top > 0 && bottom > 0) {
    return [Math.round(top), Math.round(bottom)];
  }
  return fallback;
}

function readExtraValue(project: ProjectState, field: ExtraField): string {
  if (field.projectKey) {
    const direct = project[field.projectKey];
    if (typeof direct === 'string' && direct.trim()) return direct;
  }
  const metadata = project.metadata ?? {};
  const keys = [field.key, ...(field.aliases ?? [])];
  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null) return String(value);
  }
  return '';
}

export function SongMetadataEditor({ project, onChange }: SongMetadataEditorProps) {
  const updateMain = (key: keyof Pick<ProjectState, 'artist' | 'album' | 'title' | 'year'>, value: string) => {
    onChange({ ...project, [key]: value });
  };

  const updateExtra = (field: ExtraField, value: string) => {
    const next = { ...(project.metadata ?? {}) };
    // Keep a single canonical key for each known field.
    (field.aliases ?? []).forEach((alias) => delete next[alias]);
    if (value.trim()) next[field.key] = value;
    else delete next[field.key];
    const nextProject: ProjectState = { ...project, metadata: next };
    if (field.projectKey) {
      nextProject[field.projectKey] = value.trim() || undefined;
    }
    onChange(nextProject);
  };

  const updateCustomExtra = (key: string, value: string) => {
    const next = { ...(project.metadata ?? {}) };
    if (value.trim()) next[key] = value;
    else delete next[key];
    onChange({ ...project, metadata: next });
  };

  const updateDuration = (value: string) => {
    onChange({ ...project, duration: parseNumber(value, project.duration) });
  };

  const updateBpm = (value: string) => {
    onChange({ ...project, bpm: parseNumber(value, project.bpm) });
  };

  const updateMeter = (value: string) => {
    onChange({ ...project, meter: parseMeter(value, project.meter) });
  };

  const addExtra = () => {
    const base = 'reference';
    let index = 1;
    let key = base;
    const current = project.metadata ?? {};
    while (Object.prototype.hasOwnProperty.call(current, key)) {
      index += 1;
      key = `${base}${index}`;
    }
    onChange({ ...project, metadata: { ...current, [key]: '' } });
  };

  const renameExtra = (oldKey: string, newKey: string) => {
    const cleanKey = newKey.trim();
    if (!cleanKey || cleanKey === oldKey) return;
    const current = { ...(project.metadata ?? {}) };
    const value = current[oldKey];
    delete current[oldKey];
    current[cleanKey] = value ?? '';
    onChange({ ...project, metadata: current });
  };

  const removeExtra = (key: string) => {
    const current = { ...(project.metadata ?? {}) };
    delete current[key];
    onChange({ ...project, metadata: current });
  };

  return (
    <section className="metadataBar panel">
      <AlbumArtEditor project={project} onChange={onChange} />

      <div className="metadataBlock">
        <div className="metadataBlockTitle">Main metadata</div>
        <div className="metadataGrid">
          {MAIN_FIELDS.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                value={String(project[field.key] ?? '')}
                placeholder={field.placeholder}
                onChange={(event) => updateMain(field.key, event.target.value)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="metadataBlock">
        <div className="metadataBlockTitle">Technical metadata</div>
        <div className="metadataGrid metadataCompactGrid">
          <label>
            Duration, seconds
            <input value={Number(project.duration || 0).toFixed(3)} onChange={(event) => updateDuration(event.target.value)} />
          </label>
          <label>
            BPM
            <input value={String(project.bpm ?? '')} onChange={(event) => updateBpm(event.target.value)} />
          </label>
          <label>
            Meter
            <input value={meterToText(project.meter)} placeholder="4/4" onChange={(event) => updateMeter(event.target.value)} />
          </label>
        </div>
      </div>

      <div className="metadataAdvancedGrid">
        {EXTRA_SECTIONS.map((section) => (
          <div className="metadataBlock" key={section.title}>
            <div className="metadataBlockTitle">{section.title}</div>
            <div className="metadataExtraGrid fixedMetadataGrid">
              {section.fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {field.multiline ? (
                    <textarea
                      rows={2}
                      value={readExtraValue(project, field)}
                      placeholder={field.placeholder ?? field.label}
                      onChange={(event) => updateExtra(field, event.target.value)}
                    />
                  ) : (
                    <input
                      value={readExtraValue(project, field)}
                      placeholder={field.placeholder ?? field.label}
                      onChange={(event) => updateExtra(field, event.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {metadataEntries(project).length ? (
        <div className="metadataBlock metadataCustomBlock">
          <div className="metadataBlockTitle">Additional references</div>
          <div className="metadataExtraGrid">
            {metadataEntries(project).map(([key, value]) => (
              <div className="metadataExtraRow" key={key}>
                <input
                  className="metadataKeyInput"
                  value={key}
                  aria-label="Reference name"
                  onChange={(event) => renameExtra(key, event.target.value)}
                />
                <input
                  value={String(value ?? '')}
                  aria-label={`Reference ${key}`}
                  onChange={(event) => updateCustomExtra(key, event.target.value)}
                />
                <button type="button" className="dangerButton miniButton" onClick={() => removeExtra(key)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="metadataFooter">
        <span>Metadata is saved into the feedpak manifest. Non-core fields are stored under <code>metadata</code>.</span>
        <button type="button" className="smallButton" onClick={addExtra}>Add reference</button>
      </div>
    </section>
  );
}
