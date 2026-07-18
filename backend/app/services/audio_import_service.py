from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Callable


def create_mp3_sloppack(
    audio_path: Path,
    out_path: Path,
    metadata: dict,
    job: dict[str, Any],
    *,
    ffmpeg_executable: Callable[[], str],
    run_command: Callable[[list[str]], str],
    audio_duration_seconds: Callable[[Path], float | None],
    clean_metadata_value: Callable[[Any], str],
    extract_audio_cover: Callable[[Path, Path], bool],
    read_audio_lyrics: Callable[[Path], tuple[list[dict], str | None]],
    pack_sloppack: Callable[[Path, Path], None],
    removed_user_metadata_keys: set[str],
) -> Path:
    work = Path(tempfile.mkdtemp(prefix="mp3_sloppack_"))
    try:
        (work / "stems").mkdir(parents=True, exist_ok=True)
        full_ogg = work / "stems" / "full.ogg"
        job.update(step="Converting audio to OGG for sloppack", progress=20)
        run_command([ffmpeg_executable(), "-y", "-i", str(audio_path), "-vn", "-c:a", "libvorbis", "-q:a", "5", str(full_ogg)])
        duration = audio_duration_seconds(audio_path) or audio_duration_seconds(full_ogg) or 180.0
        manifest = {
            "title": clean_metadata_value(metadata.get("title")) or audio_path.stem,
            "artist": clean_metadata_value(metadata.get("artist")),
            "album": clean_metadata_value(metadata.get("album")),
            "year": clean_metadata_value(metadata.get("year")),
            "duration": round(duration, 3),
            "stems": [{"id": "full", "file": "stems/full.ogg", "default": "on"}],
            "arrangements": [],
        }
        cleaned_extra_metadata: dict[str, str] = {}
        extra_metadata = metadata.get("metadata")
        if isinstance(extra_metadata, dict):
            cleaned_extra_metadata = {
                str(k).strip(): clean_metadata_value(v)
                for k, v in extra_metadata.items()
                if str(k).strip() and str(k).strip() not in removed_user_metadata_keys and clean_metadata_value(v)
            }
        if "source" not in removed_user_metadata_keys and audio_path.suffix:
            cleaned_extra_metadata.setdefault("source", audio_path.suffix.lstrip(".").lower())
        if "originalFile" not in removed_user_metadata_keys and audio_path.name:
            cleaned_extra_metadata.setdefault("originalFile", audio_path.name)
        if cleaned_extra_metadata:
            manifest["metadata"] = cleaned_extra_metadata
        if extract_audio_cover(audio_path, work / "cover.jpg"):
            manifest["cover"] = "cover.jpg"
        tag_lyrics, tag_lyrics_source = read_audio_lyrics(audio_path)
        if tag_lyrics:
            (work / "lyrics.json").write_text(json.dumps(tag_lyrics, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
            manifest["lyrics"] = "lyrics.json"
            manifest["lyrics_source"] = tag_lyrics_source or "tag"
        (work / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        pack_sloppack(work, out_path)
        return out_path
    finally:
        import shutil

        shutil.rmtree(work, ignore_errors=True)
