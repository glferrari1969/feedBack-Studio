from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any, Callable


def _first_text_tag(tags: Any, keys: list[str]) -> str:
    if not tags:
        return ""
    for key in keys:
        try:
            value = tags.get(key)
        except Exception:
            value = None
        if value is None:
            continue
        if isinstance(value, (list, tuple)) and value:
            value = value[0]
        if hasattr(value, "text"):
            try:
                text_list = value.text
                if isinstance(text_list, (list, tuple)) and text_list:
                    value = text_list[0]
            except Exception:
                pass
        value = str(value).strip()
        if value:
            return value
    return ""


def read_audio_tags(
    audio_path: Path,
    *,
    mutagen_file: Any,
    clean_metadata_value: Callable[[Any], str],
) -> dict:
    """Read song metadata from MP3/FLAC/M4A/Ogg/WAV tags when available."""
    if mutagen_file is None:
        return {}
    try:
        audio = mutagen_file(str(audio_path), easy=True)
    except TypeError:
        try:
            audio = mutagen_file(str(audio_path))
        except Exception:
            audio = None
    except Exception:
        audio = None
    if audio is None or not getattr(audio, "tags", None):
        return {}
    tags = audio.tags
    main = {
        "artist": _first_text_tag(tags, ["artist", "albumartist", "TPE1", "TPE2", "©ART", "aART"]),
        "album": _first_text_tag(tags, ["album", "TALB", "©alb"]),
        "title": _first_text_tag(tags, ["title", "TIT2", "©nam"]),
        "year": _first_text_tag(tags, ["date", "year", "originaldate", "TDRC", "TYER", "©day"]),
    }
    extras = {
        "genre": _first_text_tag(tags, ["genre", "TCON", "©gen"]),
        "albumArtist": _first_text_tag(tags, ["albumartist", "album artist", "TPE2", "aART"]),
        "composer": _first_text_tag(tags, ["composer", "TCOM", "©wrt"]),
        "trackNumber": _first_text_tag(tags, ["tracknumber", "track", "TRCK", "trkn"]),
        "discNumber": _first_text_tag(tags, ["discnumber", "disc", "TPOS", "disk"]),
        "isrc": _first_text_tag(tags, ["isrc", "TSRC", "----:com.apple.iTunes:ISRC"]),
        "copyright": _first_text_tag(tags, ["copyright", "TCOP", "cprt", "©cpy"]),
        "comment": _first_text_tag(tags, ["comment", "COMM::eng", "desc"]),
    }
    cleaned_extras = {k: clean_metadata_value(v) for k, v in extras.items() if clean_metadata_value(v)}
    if cleaned_extras:
        main["metadata"] = cleaned_extras
    return main


def extract_audio_cover(audio_path: Path, out_file: Path, *, mutagen_file: Any) -> bool:
    """Extract embedded album art from common audio containers into out_file."""
    if mutagen_file is None:
        return False
    try:
        audio = mutagen_file(str(audio_path))
    except Exception:
        audio = None
    if audio is None:
        return False
    data = None
    try:
        if getattr(audio, "pictures", None):
            data = audio.pictures[0].data
    except Exception:
        data = None
    tags = getattr(audio, "tags", None)
    if data is None and tags:
        try:
            for key in tags.keys():
                if str(key).startswith("APIC"):
                    data = tags[key].data
                    break
        except Exception:
            pass
    if data is None and tags:
        try:
            covr = tags.get("covr")
            if covr:
                data = bytes(covr[0])
        except Exception:
            pass
    if not data:
        return False
    try:
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_bytes(data)
        return out_file.exists() and out_file.stat().st_size > 100
    except Exception:
        return False


def audio_duration_seconds(
    audio_path: Path,
    *,
    mutagen_file: Any,
    find_ffmpeg: Callable[[], Path | None],
) -> float | None:
    """Best-effort duration without requiring soundfile in the base install."""
    if mutagen_file is not None:
        try:
            audio = mutagen_file(str(audio_path))
            length = getattr(getattr(audio, "info", None), "length", None)
            if isinstance(length, (int, float)) and length > 0:
                return float(length)
        except Exception:
            pass
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        return None
    try:
        proc = subprocess.run(
            [str(ffmpeg), "-hide_banner", "-i", str(audio_path)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", proc.stdout or "")
        if match:
            hours, minutes, seconds = match.groups()
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except Exception:
        pass
    return None


def read_audio_lyrics(audio_path: Path, *, mutagen_file: Any) -> tuple[list[dict], str | None]:
    """Read unsynced lyrics from tags as a single editable karaoke line."""
    if mutagen_file is None:
        return [], None
    try:
        audio = mutagen_file(str(audio_path))
    except Exception:
        audio = None
    tags = getattr(audio, "tags", None) if audio is not None else None
    if not tags:
        return [], None
    candidates = []
    for key in ["lyrics", "unsyncedlyrics", "USLT::eng", "USLT"]:
        try:
            value = tags.get(key)
        except Exception:
            value = None
        if value:
            candidates.append(value)
    try:
        for key in tags.keys():
            if str(key).startswith("USLT"):
                candidates.append(tags[key])
    except Exception:
        pass
    for value in candidates:
        try:
            if hasattr(value, "text"):
                text = value.text
                if isinstance(text, (list, tuple)):
                    text = "\n".join(str(x) for x in text)
            elif isinstance(value, (list, tuple)):
                text = "\n".join(str(x) for x in value)
            else:
                text = str(value)
            text = text.strip()
        except Exception:
            text = ""
        if text:
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            if not lines:
                lines = [text]
            return ([{"t": float(i * 2), "d": 1.8, "w": line} for i, line in enumerate(lines)], "tag")
    return [], None
