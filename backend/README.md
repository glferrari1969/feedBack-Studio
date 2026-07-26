# feedBack Studio Backend

Local FastAPI backend for feedBack Studio.

## Install

Use a single requirements file that includes all backend dependencies:

```powershell
cd backend
.venv\Scripts\activate
pip install -r requirements.txt
```

## Endpoints

- `GET /api/health`: reports Python/native tool availability.
- `POST /api/jobs/open`: opens feedpak, converts PSARC, or creates a feedpak from audio.
- `GET /api/jobs/{job_id}`: returns job status and progress.
- `GET /api/projects/{project_id}/arrangements/{arrangement_id}`: loads an arrangement.
- `POST /api/projects/{project_id}/save`: saves project metadata, sync points, lyrics, tone data, and packs the backend working feedpak.
- `POST /api/projects/{project_id}/commit`: writes the current working project to the original/final feedpak target.
- `POST /api/projects/{project_id}/arrangements/import`: imports a new MIDI/Guitar Pro arrangement.
- `POST /api/projects/{project_id}/arrangements/{arrangement_id}/replace`: replaces the current arrangement from MIDI/Guitar Pro.
- `POST /api/projects/{project_id}/arrangements/{arrangement_id}/duplicate`: duplicates the current arrangement with a new name.
- `POST /api/projects/{project_id}/arrangements/{arrangement_id}/rename`: renames the current arrangement.
- `POST /api/projects/{project_id}/arrangements/{arrangement_id}/export`: exports MIDI or MusicXML.


## Saving behavior

The backend keeps two targets per project:

- `working_target.txt` points to `backend/workspace/projects/<project-id>/working.feedpak`, updated by page-level Save buttons.
- `save_target.txt` points to the original/final feedpak target updated only by the explicit commit endpoint.
- `backend/workspace/projects` is fully cleaned before a new file is opened or converted.

The frontend exposes **Write to original feedpak** as its only save action. When the current project has changes, that action calls `/api/projects/{project_id}/commit`, persists the complete current state, refreshes `working.feedpak`, and overwrites the original/final package target.

Opening files through `/api/jobs/open-local` uses the backend native picker, so the backend knows the real selected path. Existing feedpaks are unpacked into `backend/workspace/projects/<project-id>` and never create working folders beside the original. For converted PSARC/audio packages, the final output goes beside the source file when no output folder is specified, while the editable working project still stays in `backend/workspace/projects`.

## Metadata

The backend exposes and persists song metadata from the feedpak manifest:

- artist
- album
- title
- year
- duration
- bpm
- meter
- supported scalar references under `metadata`, currently genre, lyrics source, chart author, version, and notes when present.

Audio imports read supported tags with Mutagen. PSARC imports preserve compatible supported metadata exposed by the converted feedpak manifest.

When converting MP3/audio or PSARC, the default output naming convention is:

```text
<Artist>\<Album>\<Artist>-<Album>-<Name>-<Version>
```

`<Name>` is an alias for the song title. The convention can be changed in the frontend.

## Synchronization

- PSARC imports use `ebeats` when available.
- MP3/audio imports create `full.ogg` and generate automatic `beatgrid.json`, `tempoMap.json`, and `syncpoints.json`.
- If Demucs is enabled and `drums.ogg` exists, beat tracking uses that stem; otherwise it uses `full.ogg`.

## Tone data

Tone definitions are preserved in the feedpak arrangement JSON as an opaque but editable block:

```json
{
  "tones": {
    "base": "Clean",
    "changes": [{ "t": 35.2, "name": "Lead" }],
    "definitions": [{ "Name": "Clean", "GearList": [] }]
  }
}
```

The frontend graphical tone chain reads and writes `tones.definitions[].GearList` without changing the bundled libraries.


## Feedpak artwork and lyrics

The backend reads and writes the feedpak manifest `cover`, `lyrics`, and `lyrics_source` fields. PSARC conversion already extracts cover art and Rocksmith vocals when available. Audio imports try to read embedded cover artwork and tag lyrics with Mutagen.

Edited lyrics are saved as `lyrics.json`. Uploaded artwork is saved as `cover.<ext>` and referenced by the manifest.


## Lyrics transcription

`lyrics-transcriber` and WhisperX are included in `requirements.txt`. The Lyrics / karaoke page uses `lyrics-transcriber` as the primary engine and can fall back to WhisperX when needed.

The backend health endpoint reports both `lyricsTranscriberAvailable` and `whisperxAvailable`.


## Native file dialog

The backend exposes `/api/jobs/open-local`, which opens a native file picker with `tkinter`. This lets feedBack Studio remember the real local file path, for example `C:\temp\song.feedpak`, so the final commit can overwrite that exact file. A browser `<input type="file">` cannot provide that path.


## Working copy and commit behavior

Opening or converting a file cleans `backend/workspace/projects/` and creates a fresh internal working copy. The `/api/projects/{project_id}/commit` endpoint receives the complete current project, updates `working.feedpak`, and writes it to the original feedpak target. The `/api/projects/{project_id}/discard` endpoint deletes pending working-copy edits and reloads the project from the original feedpak on disk.
