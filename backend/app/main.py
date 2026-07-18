from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
import time
import yaml
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.native_tools import configure_native_tools_env, find_ffmpeg
from app.arrangement_import import (
    gp_to_wire_direct,
    make_empty_wire,
    simple_midi_to_wire,
)
from app.routers.health_api import router as health_api_router
from app.routers.jobs_api import JobsRouterDeps, create_jobs_router
from app.routers.misc_api import router as misc_api_router
from app.routers.projects_api import ProjectsRouterDeps, create_projects_router
from app.routers.frontend import router as frontend_router
from app.runtime_state import (
    DEFAULT_WORKSPACE,
    FILE_DIALOG_TYPES,
    LIB_ROOT,
    PROJECTS_ROOT,
    SLOPPAK_INPUT_SUFFIXES,
    UPLOADS,
    cleanup_backend_workspace_on_startup,
    jobs,
    make_backend_project_dir,
    projects_by_id,
)
from app.services.lyrics_engine_service import lyrics_transcriber_available, lyrics_transcriber_cli
from app.services.lyrics_jobs_service import LyricsJobsDeps, build_lyrics_text_sync_processor, build_lyrics_transcription_processor
from app.services.lyrics_sync_service import (
    detect_lyric_regions as detect_lyric_regions_service,
    parse_lrc_or_plain_text as parse_lrc_or_plain_text_service,
    save_lyrics_to_project as save_lyrics_to_project_service,
    sync_plain_lyrics_to_audio as sync_plain_lyrics_to_audio_service,
)
from app.services.arrangement_export_service import (
    frontend_notes_to_wire as frontend_notes_to_wire_service,
    write_midi_from_frontend_notes as write_midi_from_frontend_notes_service,
    write_musicxml_from_frontend_notes as write_musicxml_from_frontend_notes_service,
)
from app.services.audio_import_service import create_mp3_sloppack as create_mp3_sloppack_service
from app.services.audio_metadata_service import (
    audio_duration_seconds as audio_duration_seconds_service,
    extract_audio_cover as extract_audio_cover_service,
    read_audio_lyrics as read_audio_lyrics_service,
    read_audio_tags as read_audio_tags_service,
)
from app.services.path_naming_service import (
    conversion_folder_name_from_metadata as conversion_folder_name_from_metadata_service,
    resolve_converted_save_target as resolve_converted_save_target_service,
    resolve_final_output_base as resolve_final_output_base_service,
    sanitize_windows_name as sanitize_windows_name_service,
)
from app.services.project_persistence_service import (
    REMOVED_USER_METADATA_KEYS,
    clean_metadata_value,
    persist_project_to_workdir as persist_project_to_workdir_service,
)
from app.services.project_view_service import (
    build_project as build_project_service,
    infer_arrangement_type as infer_arrangement_type_service,
    load_arrangement_wire as load_arrangement_wire_service,
    metadata_from_manifest as metadata_from_manifest_service,
)
from app.services.storage_service import (
    pack_current_sloppack as pack_current_sloppack_service,
    pack_sloppack as pack_sloppack_service,
    pack_working_sloppack as pack_working_sloppack_service,
    project_original_save_path as project_original_save_path_service,
    project_save_path as project_save_path_service,
    project_working_save_path as project_working_save_path_service,
    remember_save_path as remember_save_path_service,
    remember_working_save_path as remember_working_save_path_service,
    safe_output_dir as safe_output_dir_service,
    unpack_sloppack as unpack_sloppack_service,
)
from app.services.open_jobs_service import OpenJobsDeps, build_open_jobs_processors
from app.services.stem_arrangement_jobs_service import StemArrangementJobsDeps, build_stem_arrangement_processor, build_stem_tone_processor
from app.services.sync_analysis_service import (
    generate_mp3_sync_files as generate_mp3_sync_files_service,
    sync_structures_from_beat_times,
)
from app.services.user_settings_service import (
    get_default_output_dir as get_default_output_dir_service,
    get_output_name_pattern as get_output_name_pattern_service,
    set_default_output_dir as set_default_output_dir_service,
    set_output_name_pattern as set_output_name_pattern_service,
)


configure_native_tools_env()
sys.path.insert(0, str(LIB_ROOT))

from sloppak import extract_meta, load_manifest  # type: ignore
from sloppak_convert import convert_psarc_to_sloppak, split_sloppak_stems  # type: ignore
from tones import annotate_tone_block_with_vst  # type: ignore
from lyrics_transcribe import transcribe_vocals_local, whisperx_available, vocals_has_signal  # type: ignore

try:
    import mido
except Exception:
    mido = None

try:
    from mutagen import File as MutagenFile  # type: ignore
except Exception:
    MutagenFile = None

try:
    import librosa  # type: ignore
except Exception:
    librosa = None

try:
    import numpy as np  # type: ignore
except Exception:
    np = None

app = FastAPI(title="feedBack Studio Backend", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_api_router)
app.include_router(misc_api_router)


# Keep runtime workspace clean across launches.
cleanup_backend_workspace_on_startup()
APP_SETTINGS_PATH = DEFAULT_WORKSPACE.parent / "app_settings.json"


def get_preferred_output_dir() -> str:
    return get_default_output_dir_service(APP_SETTINGS_PATH)


def set_preferred_output_dir(output_dir: str) -> str:
    return set_default_output_dir_service(APP_SETTINGS_PATH, output_dir)


def get_preferred_output_name_pattern() -> str:
    return get_output_name_pattern_service(APP_SETTINGS_PATH)


def set_preferred_output_name_pattern(pattern: str) -> str:
    return set_output_name_pattern_service(APP_SETTINGS_PATH, pattern)


def resolve_final_output_base(input_file: Path, output_dir: str | None, original_input_path: str | None = None) -> Path:
    return resolve_final_output_base_service(
        input_file,
        output_dir,
        original_input_path,
        safe_output_dir=safe_output_dir,
    )


def choose_local_input_file(mode: str) -> Path | None:
    """Open a native file picker from the local backend process.

    A standard browser file input intentionally hides the real path, so it
    cannot be used to overwrite C:\\...\\song.sloppack later. feedBack Studio is a
    local app, so the reliable workflow is: ask the backend to open the native
    dialog, keep the selected absolute path, and commit back to that exact path.
    """
    if mode not in FILE_DIALOG_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported input mode")
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Native file dialog is not available: {exc}")
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askopenfilename(
            title={
                "sloppack": "Open sloppack",
                "psarc": "Convert PSARC",
                "audio": "Create sloppack from audio",
            }.get(mode, "Open file"),
            filetypes=FILE_DIALOG_TYPES[mode],
        )
        root.update()
        root.destroy()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not open native file dialog: {exc}")
    if not selected:
        return None
    path = Path(selected).expanduser().resolve()
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Selected file was not found")
    return path


def choose_local_output_dir(initial_dir: str = "") -> Path | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Native folder dialog is not available: {exc}")

    start_dir = ""
    candidate = str(initial_dir or "").strip() or get_preferred_output_dir()
    if candidate:
        try:
            resolved = Path(candidate).expanduser().resolve()
            if resolved.exists() and resolved.is_dir():
                start_dir = str(resolved)
        except Exception:
            start_dir = ""

    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            title="Select output folder",
            initialdir=start_dir,
            mustexist=True,
        )
        root.update()
        root.destroy()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not open native folder dialog: {exc}")

    if not selected:
        return None
    path = Path(selected).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Selected folder was not found")
    return path


def choose_local_batch_psarc_dir() -> Path | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Native folder dialog is not available: {exc}")

    start_dir = ""
    candidate = get_preferred_output_dir()
    if candidate:
        try:
            resolved = Path(candidate).expanduser().resolve()
            if resolved.exists() and resolved.is_dir():
                start_dir = str(resolved)
        except Exception:
            start_dir = ""

    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            title="Select folder containing PSARC files",
            initialdir=start_dir,
            mustexist=True,
        )
        root.update()
        root.destroy()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not open native folder dialog: {exc}")

    if not selected:
        return None
    path = Path(selected).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Selected folder was not found")
    return path


STEM_ORDER = ["vocals", "drums", "bass", "guitar", "piano", "other", "full"]


def _progress(job: Dict[str, Any], base: int, span: int):
    def cb(frac: float, stage: str, msg: str) -> None:
        job.update(step=f"{stage}: {msg}", progress=min(99, base + int(frac * span)))
    return cb


def run_command(command: List[str], cwd: Optional[Path] = None) -> str:
    proc = subprocess.run(command, cwd=str(cwd) if cwd else None, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    if proc.returncode != 0:
        raise RuntimeError("Command failed: " + " ".join(command) + "\n\n" + proc.stdout)
    return proc.stdout


def ffmpeg_executable() -> str:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found. Run start_backend.bat: it will automatically install a local ffmpeg with imageio-ffmpeg.")
    return str(ffmpeg)


def write_manifest(source_dir: Path, manifest: dict) -> None:
    mf = source_dir / "manifest.yaml"
    if not mf.exists() and (source_dir / "manifest.yml").exists():
        mf = source_dir / "manifest.yml"
    mf.write_text(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _is_audio_file(path: Path) -> bool:
    return path.suffix.lower() in {".ogg", ".wav", ".mp3", ".flac", ".m4a", ".aac", ".wem"}


def ensure_full_ogg_for_single_mix(source_dir: Path, job: Optional[Dict[str, Any]] = None) -> None:
    """Ensure a non-split project has stems/full.ogg.

    When the user does not request Demucs, the editor still needs a playable
    single audio stream. PSARC and MP3 conversions normally create
    stems/full.ogg already, but imported sloppacks or older packages may store
    the same full mix under another filename. This function normalizes that
    case without creating per-instrument stems.
    """
    manifest = load_manifest(source_dir)
    stems_dir = source_dir / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)
    full_ogg = stems_dir / "full.ogg"

    stems = manifest.get("stems") or []
    if full_ogg.exists() and full_ogg.stat().st_size > 100:
        # Make sure the manifest actually exposes the full mix.
        found = False
        if isinstance(stems, list):
            for s in stems:
                if isinstance(s, dict) and s.get("id") == "full":
                    s["file"] = "stems/full.ogg"
                    s.setdefault("default", "on")
                    found = True
                    break
        else:
            stems = []
        if not found:
            stems = [{"id": "full", "file": "stems/full.ogg", "default": "on"}]
        manifest["stems"] = stems
        write_manifest(source_dir, manifest)
        return

    source_audio: Path | None = None
    # Prefer the manifest's declared full/sole mix.
    if isinstance(stems, list):
        candidates = []
        for entry in stems:
            if not isinstance(entry, dict):
                continue
            rel = entry.get("file")
            if not isinstance(rel, str) or not rel:
                continue
            if entry.get("id") == "full" or len(stems) == 1:
                candidates.append(source_dir / rel)
        for cand in candidates:
            try:
                resolved = cand.resolve()
                resolved.relative_to(source_dir.resolve())
            except Exception:
                continue
            if resolved.exists() and resolved.is_file() and _is_audio_file(resolved):
                source_audio = resolved
                break

    # Common legacy/source locations.
    if source_audio is None:
        for rel in [
            "audio.ogg", "audio.wav", "audio.mp3", "original.ogg", "original.wav", "original.mp3",
            "stems/full.wav", "stems/audio.ogg", "stems/audio.wav", "stems/audio.mp3",
        ]:
            cand = source_dir / rel
            if cand.exists() and cand.is_file():
                source_audio = cand
                break

    # Last resort: use the first non-preview audio file in the package.
    if source_audio is None:
        audio_files = [p for p in source_dir.rglob("*") if p.is_file() and _is_audio_file(p) and "preview" not in p.name.lower()]
        if audio_files:
            source_audio = sorted(audio_files, key=lambda p: p.stat().st_size, reverse=True)[0]

    if source_audio is None:
        raise RuntimeError("Impossibile creare stems/full.ogg: nessun audio full/mix trovato nello sloppack.")

    if job is not None:
        job.update(step="Creating full.ogg without stem separation", progress=max(int(job.get("progress", 0)), 82))

    if source_audio.resolve() == full_ogg.resolve():
        pass
    elif source_audio.suffix.lower() == ".ogg":
        shutil.copyfile(source_audio, full_ogg)
    else:
        run_command([ffmpeg_executable(), "-y", "-i", str(source_audio), "-vn", "-c:a", "libvorbis", "-q:a", "5", str(full_ogg)])

    manifest["stems"] = [{"id": "full", "file": "stems/full.ogg", "default": "on"}]
    manifest.pop("stem_separation", None)
    write_manifest(source_dir, manifest)



def read_audio_tags(audio_path: Path) -> dict:
    return read_audio_tags_service(
        audio_path,
        mutagen_file=MutagenFile,
        clean_metadata_value=clean_metadata_value,
    )



def extract_audio_cover(audio_path: Path, out_file: Path) -> bool:
    return extract_audio_cover_service(audio_path, out_file, mutagen_file=MutagenFile)


def audio_duration_seconds(audio_path: Path) -> float | None:
    return audio_duration_seconds_service(
        audio_path,
        mutagen_file=MutagenFile,
        find_ffmpeg=find_ffmpeg,
    )


def read_audio_lyrics(audio_path: Path) -> tuple[list[dict], str | None]:
    return read_audio_lyrics_service(audio_path, mutagen_file=MutagenFile)

def sanitize_windows_name(value: str, fallback: str = "untitled") -> str:
    return sanitize_windows_name_service(value, fallback, clean_metadata_value=clean_metadata_value)


def conversion_folder_name_from_metadata(metadata: dict, input_file: Path) -> str:
    return conversion_folder_name_from_metadata_service(
        metadata,
        input_file,
        sanitize_windows_name=sanitize_windows_name,
        clean_metadata_value=clean_metadata_value,
    )


def resolve_converted_save_target(
    output_base: Path,
    metadata: dict,
    input_file: Path,
    fallback_folder_name: str,
    output_name_pattern: str,
) -> Path:
    return resolve_converted_save_target_service(
        output_base,
        metadata,
        input_file,
        fallback_folder_name,
        output_name_pattern,
        sanitize_windows_name=sanitize_windows_name,
        clean_metadata_value=clean_metadata_value,
    )


def _project_stem_path(source_dir: Path, manifest: dict, stem_id: str | None = None) -> tuple[Path | None, str]:
    """Resolve a sloppack stem path by id, preferring vocals for lyric work."""
    stems = manifest.get("stems") or []
    candidates: list[tuple[str, Path]] = []
    if isinstance(stems, list):
        for entry in stems:
            if not isinstance(entry, dict):
                continue
            sid = str(entry.get("id") or "").strip()
            rel = str(entry.get("file") or "").strip()
            if not rel:
                continue
            path = source_dir / rel
            if path.exists() and path.is_file():
                candidates.append((sid, path))
    if stem_id:
        for sid, path in candidates:
            if sid == stem_id:
                return path, sid
    for preferred in ("vocals", "vocal", "voice"):
        for sid, path in candidates:
            if preferred in sid.lower():
                return path, sid
    for preferred in ("full", "mix"):
        for sid, path in candidates:
            if preferred in sid.lower():
                return path, sid
    return (candidates[0][1], candidates[0][0]) if candidates else (None, "none")


def parse_lrc_or_plain_text(text: str) -> tuple[list[dict], list[str]]:
    return parse_lrc_or_plain_text_service(text)


def detect_lyric_regions(audio_path: Path | None, duration: float) -> list[tuple[float, float]]:
    return detect_lyric_regions_service(audio_path, duration, librosa_module=librosa, numpy_module=np)


def sync_plain_lyrics_to_audio(
    lines: list[str],
    source_dir: Path,
    manifest: dict,
    stem_id: str | None = None,
    progress_cb=None,
) -> tuple[list[dict], str]:
    return sync_plain_lyrics_to_audio_service(
        lines,
        source_dir,
        manifest,
        stem_id,
        estimate_duration=estimate_duration,
        project_stem_path=_project_stem_path,
        librosa_module=librosa,
        numpy_module=np,
        whisperx_available=whisperx_available,
        transcribe_vocals_local=transcribe_vocals_local,
        progress_cb=progress_cb,
    )


def save_lyrics_to_project(source_dir: Path, lyrics: list[dict], source: str) -> None:
    save_lyrics_to_project_service(
        source_dir,
        lyrics,
        source,
        load_manifest=load_manifest,
        write_manifest=write_manifest,
    )


def generate_mp3_sync_files(source_dir: Path, job: Optional[Dict[str, Any]] = None, beats_per_bar: int = 4) -> dict:
    return generate_mp3_sync_files_service(
        source_dir,
        estimate_duration=estimate_duration,
        load_manifest=load_manifest,
        write_manifest=write_manifest,
        librosa_module=librosa,
        numpy_module=np,
        job=job,
        beats_per_bar=beats_per_bar,
    )


def read_json_if_exists(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default

def metadata_from_manifest(source_dir: Path) -> dict:
    return metadata_from_manifest_service(
        source_dir,
        load_manifest=load_manifest,
        clean_metadata_value=clean_metadata_value,
        removed_user_metadata_keys=REMOVED_USER_METADATA_KEYS,
    )


def infer_arrangement_type(entry: dict, data: Optional[dict] = None) -> str:
    return infer_arrangement_type_service(entry, data)


def load_arrangement_wire(source_dir: Path, rel: str) -> dict:
    return load_arrangement_wire_service(source_dir, rel)


def safe_output_dir(output_dir: str | None) -> Path:
    return safe_output_dir_service(output_dir, default_workspace=DEFAULT_WORKSPACE)


def unpack_sloppack(sloppack: Path, project_dir: Path) -> Path:
    return unpack_sloppack_service(sloppack, project_dir)


def pack_sloppack(source_dir: Path, out_file: Path) -> None:
    pack_sloppack_service(source_dir, out_file)


def project_original_save_path(source_dir: Path, project: dict | None = None) -> Path:
    return project_original_save_path_service(source_dir, project)


def project_working_save_path(source_dir: Path, project: dict | None = None) -> Path:
    return project_working_save_path_service(source_dir, project)


def project_save_path(source_dir: Path, project: dict | None = None) -> Path:
    return project_save_path_service(source_dir, project)


def remember_save_path(source_dir: Path, save_path: Path) -> None:
    remember_save_path_service(source_dir, save_path)


def remember_working_save_path(source_dir: Path, save_path: Path) -> None:
    remember_working_save_path_service(source_dir, save_path)


def pack_working_sloppack(source_dir: Path, project: dict | None = None) -> Path:
    return pack_working_sloppack_service(source_dir, project)


def pack_current_sloppack(source_dir: Path, project: dict | None = None) -> Path:
    return pack_current_sloppack_service(source_dir, project)


def estimate_duration(source_dir: Path, fallback: float = 180.0) -> float:
    manifest = load_manifest(source_dir)
    dur = float(manifest.get("duration", 0) or 0)
    if dur > 0:
        return round(dur, 3)
    for rel in ["stems/full.ogg", "stems/full.wav", "audio.wav", "original.wav"]:
        p = source_dir / rel
        if p.exists():
            duration = audio_duration_seconds(p)
            if duration:
                return round(duration, 3)
    return fallback
def build_project(project_id: str, source_dir: Path, selected_arrangement: str | None = None, bpm: float = 120.0) -> dict:
    return build_project_service(
        project_id,
        source_dir,
        load_manifest=load_manifest,
        read_json_if_exists=read_json_if_exists,
        estimate_duration=estimate_duration,
        sync_structures_from_beat_times=sync_structures_from_beat_times,
        project_original_save_path=project_original_save_path,
        project_working_save_path=project_working_save_path,
        clean_metadata_value=clean_metadata_value,
        removed_user_metadata_keys=REMOVED_USER_METADATA_KEYS,
        stem_order=STEM_ORDER,
        selected_arrangement=selected_arrangement,
        bpm=bpm,
    )

def frontend_notes_to_wire(project: dict, arrangement_id: str, fallback_name: str, fallback_instrument: str, source_wire: Optional[dict] = None) -> dict:
    return frontend_notes_to_wire_service(
        project,
        arrangement_id,
        fallback_name,
        fallback_instrument,
        source_wire,
        make_empty_wire=make_empty_wire,
    )


def write_midi_from_frontend_notes(project: dict, arrangement_id: str, out_file: Path) -> None:
    write_midi_from_frontend_notes_service(project, arrangement_id, out_file, mido_module=mido)


def write_musicxml_from_frontend_notes(project: dict, arrangement_id: str, out_file: Path, arrangement_name: str) -> None:
    write_musicxml_from_frontend_notes_service(project, arrangement_id, out_file, arrangement_name)


def guitar_pro_writer_available() -> bool:
    """Return whether this runtime exposes a safe native GP writer.

    The bundled libraries provide Guitar Pro import/conversion helpers but no
    project-level .gp5 writer. Some pyguitarpro builds expose a low-level
    write() function, but this app does not have a safe arrangement-to-GP5
    serializer wired in, so native GP export remains disabled.
    """
    return False


def current_arrangement_entry(source_dir: Path, arrangement_id: str) -> tuple[dict, dict, str]:
    manifest = load_manifest(source_dir)
    entry = next((a for a in manifest.get("arrangements", []) or [] if str(a.get("id")) == str(arrangement_id)), None)
    if not entry:
        raise RuntimeError("Current arrangement not found")
    rel = str(entry.get("file") or "")
    data = load_arrangement_wire(source_dir, rel) if rel else {}
    return manifest, entry, rel


def create_mp3_sloppack(audio_path: Path, out_path: Path, metadata: dict, job: Dict[str, Any]) -> Path:
    return create_mp3_sloppack_service(
        audio_path,
        out_path,
        metadata,
        job,
        ffmpeg_executable=ffmpeg_executable,
        run_command=run_command,
        audio_duration_seconds=audio_duration_seconds,
        clean_metadata_value=clean_metadata_value,
        extract_audio_cover=extract_audio_cover,
        read_audio_lyrics=read_audio_lyrics,
        pack_sloppack=pack_sloppack,
        removed_user_metadata_keys=REMOVED_USER_METADATA_KEYS,
    )


process_open_job, process_demucs_job, process_batch_psarc_job = build_open_jobs_processors(
    OpenJobsDeps(
        jobs=jobs,
        projects_by_id=projects_by_id,
        sloppack_input_suffixes=SLOPPAK_INPUT_SUFFIXES,
        make_backend_project_dir=make_backend_project_dir,
        resolve_final_output_base=resolve_final_output_base,
        sanitize_windows_name=sanitize_windows_name,
        convert_psarc_to_sloppak=convert_psarc_to_sloppak,
        extract_meta=extract_meta,
        read_audio_tags=read_audio_tags,
        conversion_folder_name_from_metadata=conversion_folder_name_from_metadata,
        resolve_converted_save_target=resolve_converted_save_target,
        get_preferred_output_name_pattern=get_preferred_output_name_pattern,
        create_mp3_sloppack=create_mp3_sloppack,
        split_sloppak_stems=split_sloppak_stems,
        unpack_sloppack=unpack_sloppack,
        ensure_full_ogg_for_single_mix=ensure_full_ogg_for_single_mix,
        generate_mp3_sync_files=generate_mp3_sync_files,
        pack_sloppack=pack_sloppack,
        pack_working_sloppack=pack_working_sloppack,
        remember_save_path=remember_save_path,
        remember_working_save_path=remember_working_save_path,
        build_project=build_project,
        metadata_from_manifest=metadata_from_manifest,
        read_json_if_exists=read_json_if_exists,
        project_original_save_path=project_original_save_path,
        progress_factory=_progress,
    )
)

lyrics_jobs_deps = LyricsJobsDeps(
        jobs=jobs,
        projects_by_id=projects_by_id,
        load_manifest=load_manifest,
        project_stem_path=_project_stem_path,
        vocals_has_signal=vocals_has_signal,
        lyrics_transcriber_available=lyrics_transcriber_available,
        lyrics_transcriber_cli=lyrics_transcriber_cli,
        default_workspace=DEFAULT_WORKSPACE,
        parse_lrc_or_plain_text=parse_lrc_or_plain_text,
        sync_plain_lyrics_to_audio=sync_plain_lyrics_to_audio,
        whisperx_available=whisperx_available,
        transcribe_vocals_local=transcribe_vocals_local,
        progress_factory=_progress,
        save_lyrics_to_project=save_lyrics_to_project,
        build_project=build_project,
        pack_working_sloppack=pack_working_sloppack,
        project_original_save_path=project_original_save_path,
    )

process_lyrics_transcription_job = build_lyrics_transcription_processor(lyrics_jobs_deps)
process_lyrics_text_sync_job = build_lyrics_text_sync_processor(lyrics_jobs_deps)

process_stem_arrangement_job = build_stem_arrangement_processor(
    StemArrangementJobsDeps(
        jobs=jobs,
        projects_by_id=projects_by_id,
        load_manifest=load_manifest,
        project_stem_path=_project_stem_path,
        simple_midi_to_wire=simple_midi_to_wire,
        read_json_if_exists=read_json_if_exists,
        pack_working_sloppack=pack_working_sloppack,
        build_project=build_project,
        project_original_save_path=project_original_save_path,
        write_manifest=write_manifest,
        annotate_tone_block_with_vst=annotate_tone_block_with_vst,
        librosa_module=librosa,
        numpy_module=np,
        mido_module=mido,
    )
)

process_stem_tone_job = build_stem_tone_processor(
    StemArrangementJobsDeps(
        jobs=jobs,
        projects_by_id=projects_by_id,
        load_manifest=load_manifest,
        project_stem_path=_project_stem_path,
        simple_midi_to_wire=simple_midi_to_wire,
        read_json_if_exists=read_json_if_exists,
        pack_working_sloppack=pack_working_sloppack,
        build_project=build_project,
        project_original_save_path=project_original_save_path,
        write_manifest=write_manifest,
        annotate_tone_block_with_vst=annotate_tone_block_with_vst,
        librosa_module=librosa,
        numpy_module=np,
        mido_module=mido,
    )
)


def persist_project_to_workdir(source_dir: Path, project: dict) -> None:
    persist_project_to_workdir_service(
        source_dir,
        project,
        load_manifest=load_manifest,
        write_manifest=write_manifest,
        annotate_tone_block_with_vst=annotate_tone_block_with_vst,
    )


app.include_router(
    create_projects_router(ProjectsRouterDeps(
        parse_lrc_or_plain_text=parse_lrc_or_plain_text,
        sync_plain_lyrics_to_audio=sync_plain_lyrics_to_audio,
        save_lyrics_to_project=save_lyrics_to_project,
        build_project=build_project,
        pack_working_sloppack=pack_working_sloppack,
        project_original_save_path=project_original_save_path,
        persist_project_to_workdir=persist_project_to_workdir,
        pack_current_sloppack=pack_current_sloppack,
        unpack_sloppack=unpack_sloppack,
        remember_save_path=remember_save_path,
        remember_working_save_path=remember_working_save_path,
        gp_to_wire_direct=gp_to_wire_direct,
        simple_midi_to_wire=simple_midi_to_wire,
        current_arrangement_entry=current_arrangement_entry,
        infer_arrangement_type=infer_arrangement_type,
        load_arrangement_wire=load_arrangement_wire,
        sanitize_windows_name=sanitize_windows_name,
        write_midi_from_frontend_notes=write_midi_from_frontend_notes,
        write_musicxml_from_frontend_notes=write_musicxml_from_frontend_notes,
        read_json_if_exists=read_json_if_exists,
        load_manifest=load_manifest,
        write_manifest=write_manifest,
    ))
)


app.include_router(
    create_jobs_router(JobsRouterDeps(
        process_open_job=process_open_job,
        process_demucs_job=process_demucs_job,
        process_batch_psarc_job=process_batch_psarc_job,
        process_lyrics_transcription_job=process_lyrics_transcription_job,
        process_lyrics_text_sync_job=process_lyrics_text_sync_job,
        process_stem_arrangement_job=process_stem_arrangement_job,
        process_stem_tone_job=process_stem_tone_job,
        choose_local_input_file=choose_local_input_file,
        choose_local_output_dir=choose_local_output_dir,
        choose_local_batch_psarc_dir=choose_local_batch_psarc_dir,
        get_preferred_output_dir=get_preferred_output_dir,
        set_preferred_output_dir=set_preferred_output_dir,
        get_preferred_output_name_pattern=get_preferred_output_name_pattern,
        set_preferred_output_name_pattern=set_preferred_output_name_pattern,
    ))
)

app.include_router(frontend_router)
