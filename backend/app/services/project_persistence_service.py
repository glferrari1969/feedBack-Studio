from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

REMOVED_USER_METADATA_KEYS = {
    # Kept for compatibility; additional metadata fields are now editable and
    # persisted from the Metadata page, so this set intentionally stays empty.
}


def clean_metadata_value(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def persist_project_metadata_to_manifest(
    source_dir: Path,
    project: dict,
    *,
    load_manifest: Callable[[Path], dict],
    write_manifest: Callable[[Path, dict], None],
) -> None:
    manifest = load_manifest(source_dir)
    manifest["title"] = clean_metadata_value(project.get("title")) or manifest.get("title") or "Untitled"
    manifest["artist"] = clean_metadata_value(project.get("artist"))
    manifest["album"] = clean_metadata_value(project.get("album"))
    manifest["year"] = clean_metadata_value(project.get("year"))
    try:
        if project.get("duration") not in (None, ""):
            manifest["duration"] = round(float(project.get("duration")), 3)
    except Exception:
        pass
    try:
        if project.get("bpm") not in (None, ""):
            manifest["bpm"] = round(float(project.get("bpm")), 3)
    except Exception:
        pass

    meter = project.get("meter")
    if isinstance(meter, list) and len(meter) >= 2:
        try:
            manifest["meter"] = [int(meter[0]), int(meter[1])]
        except Exception:
            pass

    incoming = project.get("metadata")
    if isinstance(incoming, dict):
        cleaned = {
            str(k).strip(): clean_metadata_value(v)
            for k, v in incoming.items()
            if str(k).strip() and str(k).strip() not in REMOVED_USER_METADATA_KEYS and clean_metadata_value(v)
        }
        if cleaned:
            manifest["metadata"] = cleaned
        else:
            manifest.pop("metadata", None)

    cover_path = clean_metadata_value(project.get("coverPath"))
    if cover_path:
        manifest["cover"] = cover_path
    elif project.get("coverUrl") in (None, ""):
        manifest.pop("cover", None)

    lyrics = project.get("lyrics")
    if isinstance(lyrics, list) and lyrics:
        cleaned_lyrics = []
        for idx, item in enumerate(lyrics):
            if not isinstance(item, dict):
                continue
            text = str(item.get("w", ""))
            try:
                t = round(float(item.get("t", 0) or 0), 3)
                d = round(max(0.01, float(item.get("d", 0.5) or 0.5)), 3)
            except Exception:
                continue
            cleaned_lyrics.append({"id": str(item.get("id") or f"lyric-{idx}"), "t": t, "d": d, "w": text})
        if cleaned_lyrics:
            (source_dir / "lyrics.json").write_text(json.dumps(cleaned_lyrics, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            manifest["lyrics"] = "lyrics.json"
            manifest["lyrics_source"] = clean_metadata_value(project.get("lyricsSource")) or "user"
        else:
            manifest.pop("lyrics", None)
            manifest.pop("lyrics_source", None)
    elif lyrics == []:
        manifest.pop("lyrics", None)
        manifest.pop("lyrics_source", None)

    write_manifest(source_dir, manifest)


def persist_project_tones_to_sloppack(
    source_dir: Path,
    project: dict,
    *,
    load_manifest: Callable[[Path], dict],
    annotate_tone_block_with_vst: Callable[[dict], dict],
) -> None:
    """Persist edited tone blocks back into arrangement JSON files."""
    manifest = load_manifest(source_dir)
    entries = manifest.get("arrangements", []) or []
    by_id = {str(item.get("id")): item for item in project.get("arrangements", []) or [] if isinstance(item, dict)}
    by_name = {str(item.get("name")): item for item in project.get("arrangements", []) or [] if isinstance(item, dict)}

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        arr_id = str(entry.get("id") or "")
        arr_name = str(entry.get("name") or "")
        frontend_arr = by_id.get(arr_id) or by_name.get(arr_name)
        if not isinstance(frontend_arr, dict) or "tones" not in frontend_arr:
            continue
        rel = str(entry.get("file") or "")
        if not rel:
            continue
        path = source_dir / rel
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        tones = frontend_arr.get("tones")
        if isinstance(tones, dict) and tones:
            data["tones"] = annotate_tone_block_with_vst(tones)
        else:
            data.pop("tones", None)
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def persist_project_to_workdir(
    source_dir: Path,
    project: dict,
    *,
    load_manifest: Callable[[Path], dict],
    write_manifest: Callable[[Path, dict], None],
    annotate_tone_block_with_vst: Callable[[dict], dict],
) -> None:
    (source_dir.parent / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
    (source_dir / "syncpoints.json").write_text(json.dumps(project.get("syncPoints", []), indent=2, ensure_ascii=False), encoding="utf-8")
    persist_project_metadata_to_manifest(
        source_dir,
        project,
        load_manifest=load_manifest,
        write_manifest=write_manifest,
    )
    persist_project_tones_to_sloppack(
        source_dir,
        project,
        load_manifest=load_manifest,
        annotate_tone_block_with_vst=annotate_tone_block_with_vst,
    )
