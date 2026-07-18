from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from app.runtime_state import LIB_ROOT
from app.services.sync_analysis_service import median_bpm_from_times

if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

try:
    from tunings import (  # type: ignore
        STANDARD_OPEN_MIDIS,
        TUNING_PRESET_MIDIS,
        tuning_name as tuning_name_from_offsets,
        tuning_offsets_from_midis,
    )
except Exception:
    STANDARD_OPEN_MIDIS = {}
    TUNING_PRESET_MIDIS = {}
    tuning_name_from_offsets = None
    tuning_offsets_from_midis = None


NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def _first_manifest_value(manifest: dict, keys: list[str]) -> Any:
    for key in keys:
        value = manifest.get(key)
        if value not in (None, ""):
            return value
    nested = manifest.get("metadata")
    if isinstance(nested, dict):
        for key in keys:
            value = nested.get(key)
            if value not in (None, ""):
                return value
    return ""


def extract_project_metadata(
    manifest: dict,
    *,
    clean_metadata_value: Callable[[Any], str],
    removed_user_metadata_keys: set[str],
) -> dict:
    alias_groups = {
        "title": ["title", "song", "name", "songName", "song_title"],
        "artist": ["artist", "artistName", "artist_name", "artistSort"],
        "album": ["album", "albumName", "album_name"],
        "year": ["year", "date", "releaseYear", "release_year", "releaseDate", "release_date"],
        "genre": ["genre", "songGenre", "song_genre"],
        "albumArtist": ["albumArtist", "album_artist", "albumartist", "AlbumArtist", "AlbumArtistName"],
        "composer": ["composer", "writer", "songwriter", "Composer", "Songwriter"],
        "trackNumber": ["trackNumber", "tracknumber", "track", "TrackNumber", "TRCK", "trkn"],
        "discNumber": ["discNumber", "discnumber", "disc", "DiscNumber", "TPOS", "disk"],
        "isrc": ["isrc", "ISRC", "TSRC"],
        "copyright": ["copyright", "Copyright", "TCOP", "cprt"],
        "source": ["source", "Source", "importSource", "ImportSource"],
        "platform": ["platform", "Platform"],
        "dlcKey": ["dlcKey", "dlc_key", "DLCKey", "persistentID", "persistentId", "PersistentID"],
        "originalFile": ["originalFile", "original_file", "OriginalFile", "inputFile", "InputFile"],
        "charter": ["charter", "author", "creator"],
        "version": ["version", "revision"],
        "notes": ["notes", "remarks", "comment"],
    }
    known_aliases = {alias for aliases in alias_groups.values() for alias in aliases}
    structural = {
        "stems",
        "arrangements",
        "sync",
        "duration",
        "bpm",
        "meter",
        "tone",
        "tones",
        "ebeats",
        "beatgrid",
        "tempoMap",
        "tempo_map",
        "stem_separation",
        "lyrics",
        "lyrics_source",
        "vocals",
        "sections",
        "phrases",
        "cover",
        "drum_tab",
    }
    extras: dict[str, str] = {}
    nested = manifest.get("metadata")
    if isinstance(nested, dict):
        for key, value in nested.items():
            if str(key) in removed_user_metadata_keys:
                continue
            if isinstance(value, (str, int, float, bool)) and str(value).strip():
                extras[str(key)] = clean_metadata_value(value)
    for field, aliases in alias_groups.items():
        if field in ["title", "artist", "album", "year"]:
            continue
        value = clean_metadata_value(_first_manifest_value(manifest, aliases))
        if value:
            extras[field] = value
    for key, value in manifest.items():
        if key in known_aliases or key in removed_user_metadata_keys or key in structural or key == "metadata":
            continue
        if isinstance(value, (str, int, float, bool)) and str(value).strip():
            extras[str(key)] = clean_metadata_value(value)
    return {
        "title": clean_metadata_value(_first_manifest_value(manifest, alias_groups["title"])) or "Untitled",
        "artist": clean_metadata_value(_first_manifest_value(manifest, alias_groups["artist"])),
        "album": clean_metadata_value(_first_manifest_value(manifest, alias_groups["album"])),
        "year": clean_metadata_value(_first_manifest_value(manifest, alias_groups["year"])),
        "metadata": extras,
    }


def metadata_from_manifest(
    source_dir: Path,
    *,
    load_manifest: Callable[[Path], dict],
    clean_metadata_value: Callable[[Any], str],
    removed_user_metadata_keys: set[str],
) -> dict:
    try:
        manifest = load_manifest(source_dir)
    except Exception:
        return {}
    extracted = extract_project_metadata(
        manifest,
        clean_metadata_value=clean_metadata_value,
        removed_user_metadata_keys=removed_user_metadata_keys,
    )
    return {
        "artist": extracted.get("artist"),
        "album": extracted.get("album"),
        "title": extracted.get("title"),
        "year": extracted.get("year"),
        "metadata": extracted.get("metadata") or {},
    }


def normalize_stem_id(value: str, stem_order: list[str]) -> str:
    lowered = value.lower()
    for key in stem_order:
        if key in lowered:
            return key
    return Path(lowered).stem.lower().replace(" ", "_")


def build_stems(project_id: str, source_dir: Path, manifest: dict, *, stem_order: list[str]) -> list[dict]:
    stems = []
    for entry in manifest.get("stems", []) or []:
        if not isinstance(entry, dict):
            continue
        sid = str(entry.get("id") or normalize_stem_id(str(entry.get("file", "stem")), stem_order))
        rel = str(entry.get("file") or "")
        if not rel or not (source_dir / rel).exists():
            continue
        kind = sid if sid in ["vocals", "drums", "bass", "guitar", "piano", "other", "full"] else "mix"
        stems.append(
            {
                "id": sid,
                "name": sid.capitalize() if sid != "full" else "Full mix",
                "kind": kind,
                "url": f"/api/projects/{project_id}/asset/{rel}",
                "muted": False,
                "solo": False,
                "volume": 0.9,
            }
        )
    if not stems:
        for p in sorted((source_dir / "stems").glob("*")) if (source_dir / "stems").exists() else []:
            if p.suffix.lower() not in [".wav", ".ogg", ".mp3", ".flac"]:
                continue
            sid = normalize_stem_id(p.name, stem_order)
            kind = sid if sid in ["vocals", "drums", "bass", "guitar", "piano", "other", "full"] else "mix"
            rel = p.relative_to(source_dir).as_posix()
            stems.append(
                {
                    "id": sid,
                    "name": sid.capitalize(),
                    "kind": kind,
                    "url": f"/api/projects/{project_id}/asset/{rel}",
                    "muted": False,
                    "solo": False,
                    "volume": 0.9,
                }
            )
    return stems


def infer_arrangement_type(entry: dict, data: Optional[dict] = None) -> str:
    raw = " ".join(
        str(x or "")
        for x in [entry.get("id"), entry.get("name"), entry.get("file"), entry.get("type"), entry.get("arrangement")]
    ).lower()
    if "bass" in raw:
        return "bass"
    if any(x in raw for x in ["lead", "rhythm", "combo", "guitar", "chitarra"]):
        return "guitar"
    if any(x in raw for x in ["vocal", "lyrics"]):
        return "vocals"
    if any(x in raw for x in ["piano", "keys", "keyboard"]):
        return "piano"
    if any(x in raw for x in ["drum"]):
        return "drums"
    if data:
        tuning = data.get("tuning")
        if isinstance(tuning, list):
            if len(tuning) in (4, 5):
                return "bass"
            if len(tuning) in (6, 7):
                return "guitar"
    return "unknown"


def normalize_tuning(raw_tuning: Any, arrangement_type: str) -> list[int] | None:
    if not isinstance(raw_tuning, list) or not raw_tuning:
        return None
    try:
        values = [int(x) for x in raw_tuning]
    except Exception:
        return None

    if arrangement_type == "bass" and len(values) >= 6:
        # RS XML stores 6 tuning slots for bass and pads unused strings with zeros.
        # Normalize to 4/5 strings so frontend defaults are stable.
        if values[4] == 0 and values[5] == 0:
            values = values[:4]
        elif values[5] == 0:
            values = values[:5]

    if values and max(abs(v) for v in values) <= 12:
        if arrangement_type == "bass" or len(values) in (4, 5):
            base = [28, 33, 38, 43] if len(values) == 4 else [23, 28, 33, 38, 43]
        else:
            base = [40, 45, 50, 55, 59, 64]
        return [base[i] + values[i] for i in range(min(len(base), len(values)))]
    return values


def _candidate_instrument_keys(arrangement_type: str, string_count: int) -> list[str]:
    if string_count <= 0:
        return []
    keys: list[str] = []
    preferred = "bass" if arrangement_type == "bass" else "guitar" if arrangement_type == "guitar" else None
    if preferred:
        keys.append(f"{preferred}-{string_count}")
    for family in ["guitar", "bass"]:
        key = f"{family}-{string_count}"
        if key not in keys:
            keys.append(key)
    return [key for key in keys if key in STANDARD_OPEN_MIDIS]


def _display_preset_name(raw_name: str, open_midis: list[int]) -> str:
    if raw_name == "Standard" and open_midis:
        return f"{NOTE_NAMES[open_midis[0] % 12]} Standard"
    return raw_name


def nominal_tuning_name(open_midis: list[int], arrangement_type: str) -> str | None:
    if not open_midis or not STANDARD_OPEN_MIDIS:
        return None

    string_count = len(open_midis)
    keys = _candidate_instrument_keys(arrangement_type, string_count)
    if not keys:
        return None

    values = [int(v) for v in open_midis]
    fallback_custom = None
    for key in keys:
        presets = TUNING_PRESET_MIDIS.get(key, {})
        for preset_name, preset_midis in presets.items():
            if values == [int(v) for v in preset_midis]:
                return _display_preset_name(str(preset_name), values)

        offsets = tuning_offsets_from_midis(key, values) if tuning_offsets_from_midis else None
        if offsets is None:
            continue

        if key == "guitar-6" and tuning_name_from_offsets:
            inferred = str(tuning_name_from_offsets(offsets))
            if inferred not in ("", "Unknown", "Custom Tuning"):
                return inferred

        if offsets and all(offset == offsets[0] for offset in offsets):
            return f"{NOTE_NAMES[values[0] % 12]} Standard"

        if len(offsets) >= 4 and offsets[0] == (offsets[1] - 2) and all(offset == offsets[1] for offset in offsets[1:]):
            return f"Drop {NOTE_NAMES[values[0] % 12]}"

        fallback_custom = "Custom Tuning"

    return fallback_custom


def load_arrangement_wire(source_dir: Path, rel: str) -> dict:
    if not rel:
        return {}
    path = source_dir / rel
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def arrangement_infos(source_dir: Path, manifest: dict) -> list[dict]:
    out = []
    for i, entry in enumerate(manifest.get("arrangements", []) or []):
        aid = str(entry.get("id") or f"arr-{i}")
        name = str(entry.get("name") or aid)
        rel = str(entry.get("file") or "")
        data = load_arrangement_wire(source_dir, rel)
        note_count = len(data.get("notes", []) or []) + len(data.get("chords", []) or []) if data else 0
        typ = infer_arrangement_type(entry, data)
        tuning = normalize_tuning(entry.get("tuning") or data.get("tuning"), typ)
        tuning_name = nominal_tuning_name(tuning, typ) if tuning else None
        info = {"id": aid, "name": name, "type": typ, "file": rel, "noteCount": note_count}
        tones = data.get("tones") if isinstance(data, dict) else None
        if isinstance(tones, dict) and tones:
            info["tones"] = tones
        if tuning:
            info["tuning"] = tuning
        if tuning_name:
            info["tuningName"] = tuning_name
        capo = entry.get("capo", data.get("capo") if data else None)
        if capo not in (None, ""):
            try:
                info["capo"] = int(capo)
            except Exception:
                pass
        out.append(info)
    return out


def technique_flags(raw: dict) -> dict:
    return {
        "palmMute": bool(raw.get("pm") or raw.get("palmMute")),
        "hammerOn": bool(raw.get("ho") or raw.get("hammerOn")),
        "pullOff": bool(raw.get("po") or raw.get("pullOff")),
        "slide": bool(raw.get("sl", -1) not in (-1, None, "") or raw.get("slide")),
        "bend": bool(raw.get("bn") or raw.get("bend")),
        "vibrato": bool(raw.get("vb") or raw.get("vibrato")),
        "harmonic": bool(raw.get("hm") or raw.get("harmonic")),
    }


def extract_notes_from_arrangement(source_dir: Path, manifest: dict, arrangement_id: str) -> list[dict]:
    entry = next((a for a in manifest.get("arrangements", []) or [] if str(a.get("id")) == arrangement_id), None)
    if not entry:
        return []
    rel = str(entry.get("file") or "")
    data = load_arrangement_wire(source_dir, rel)
    if not data:
        return []
    typ = infer_arrangement_type(entry, data)
    tuning = normalize_tuning(entry.get("tuning") or data.get("tuning"), typ)
    if not tuning:
        tuning = [28, 33, 38, 43] if typ == "bass" else [40, 45, 50, 55, 59, 64]

    def to_note(raw: dict, start_override: Optional[float] = None) -> dict:
        raw_string = int(raw.get("s", raw.get("string", 0)) or 0)
        string_number = raw_string + 1 if raw_string < len(tuning) else max(1, min(len(tuning), raw_string))
        fret = int(raw.get("f", raw.get("fret", 0)) or 0)
        open_pitch = tuning[string_number - 1] if 0 <= string_number - 1 < len(tuning) else tuning[0]
        pitch = max(0, min(127, int(raw.get("pitch", open_pitch + fret) or (open_pitch + fret))))
        start = float(start_override if start_override is not None else raw.get("t", raw.get("time", 0)) or 0)
        dur = max(0.05, float(raw.get("sus", raw.get("duration", 0.2)) or 0.2))
        return {
            "id": str(uuid.uuid4()),
            "trackId": arrangement_id,
            "pitch": pitch,
            "start": round(start, 4),
            "duration": round(dur, 4),
            "velocity": int(raw.get("velocity", 96) or 96),
            "string": string_number,
            "fret": fret,
            "techniques": technique_flags(raw),
        }

    notes = [to_note(n) for n in data.get("notes", []) or []]
    for c in data.get("chords", []) or []:
        start = float(c.get("t", c.get("time", 0)) or 0)
        chord_notes = c.get("notes", []) or []
        for cn in chord_notes:
            notes.append(to_note(cn, start_override=start))
    return sorted(notes, key=lambda x: (x["start"], x["pitch"]))[:8000]


def read_project_lyrics(
    source_dir: Path,
    manifest: dict,
    *,
    read_json_if_exists: Callable[[Path, Any], Any],
) -> tuple[list[dict], str]:
    rel = manifest.get("lyrics")
    if not isinstance(rel, str) or not rel:
        return [], ""
    path = (source_dir / rel).resolve()
    try:
        path.relative_to(source_dir.resolve())
    except Exception:
        return [], ""
    raw = read_json_if_exists(path, [])
    if not isinstance(raw, list):
        return [], ""
    lyrics = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        try:
            lyrics.append(
                {
                    "id": str(item.get("id") or f"lyric-{idx}"),
                    "t": round(float(item.get("t", 0) or 0), 3),
                    "d": round(max(0.01, float(item.get("d", 0.5) or 0.5)), 3),
                    "w": str(item.get("w", "")),
                }
            )
        except Exception:
            continue
    return sorted(lyrics, key=lambda x: x["t"]), str(manifest.get("lyrics_source") or "")


def cover_url_from_manifest(project_id: str, source_dir: Path, manifest: dict) -> tuple[str | None, str | None]:
    rel = manifest.get("cover") or manifest.get("albumArt") or manifest.get("album_art")
    if not isinstance(rel, str) or not rel:
        return None, None
    path = (source_dir / rel).resolve()
    try:
        path.relative_to(source_dir.resolve())
    except Exception:
        return None, None
    if not path.exists():
        return None, None
    rel_clean = path.relative_to(source_dir).as_posix()
    return f"/api/projects/{project_id}/asset/{rel_clean}", rel_clean


def find_arrangement_beats(source_dir: Path, manifest: dict, selected: str | None) -> list[dict]:
    entries = manifest.get("arrangements", []) or []
    ordered = []
    if selected:
        ordered.extend([a for a in entries if str(a.get("id")) == str(selected)])
    ordered.extend([a for a in entries if str(a.get("id")) != str(selected)])
    for entry in ordered:
        rel = str(entry.get("file") or "")
        if not rel or not (source_dir / rel).exists():
            continue
        try:
            data = json.loads((source_dir / rel).read_text(encoding="utf-8"))
            beats = data.get("beats", []) or data.get("ebeats", []) or []
            if beats:
                return beats
        except Exception:
            continue
    return []


def sync_from_ebeats(beats: list[dict], beats_per_bar: int = 4) -> tuple[list[dict], list[dict], list[dict], float]:
    times: list[float] = []
    beatgrid: list[dict] = []
    sync_points: list[dict] = []
    current_bar = 1
    current_beat = 0
    previous_measure: int | None = None
    measure_offset: int | None = None
    for idx, raw in enumerate(beats):
        try:
            t = round(float(raw.get("time", 0)), 3)
        except Exception:
            continue
        measure_raw = raw.get("measure", None)
        try:
            measure = int(measure_raw) if measure_raw is not None else -1
        except Exception:
            measure = -1
        if measure >= 0:
            if measure_offset is None:
                measure_offset = 1 if measure == 0 else 0
            current_bar = max(1, measure + measure_offset)
            if previous_measure != measure:
                current_beat = 1
                sync_points.append({"id": f"bar-{current_bar}", "bar": current_bar, "beat": 1, "time": t})
            else:
                current_beat += 1
            previous_measure = measure
        else:
            current_beat += 1
            if current_beat > beats_per_bar:
                current_bar += 1
                current_beat = 1
                sync_points.append({"id": f"bar-{current_bar}", "bar": current_bar, "beat": 1, "time": t})
            previous_measure = None
        times.append(t)
        beatgrid.append({"id": f"beat-{idx + 1}", "beatIndex": idx + 1, "bar": current_bar, "beat": current_beat, "time": t})
    if not sync_points and beatgrid:
        sync_points = [{"id": "bar-1", "bar": 1, "beat": 1, "time": beatgrid[0]["time"]}]
    tempo_map = []
    bpm = median_bpm_from_times(times)
    for idx, item in enumerate(beatgrid[:-1]):
        gap = beatgrid[idx + 1]["time"] - item["time"]
        local_bpm = round(60.0 / gap, 3) if gap > 0 else bpm
        tempo_map.append(
            {
                "id": f"tempo-{idx + 1}",
                "beatIndex": item["beatIndex"],
                "bar": item["bar"],
                "beat": item["beat"],
                "time": item["time"],
                "bpm": local_bpm,
            }
        )
    return beatgrid, sync_points[:400], tempo_map, bpm


def build_project(
    project_id: str,
    source_dir: Path,
    *,
    load_manifest: Callable[[Path], dict],
    read_json_if_exists: Callable[[Path, Any], Any],
    estimate_duration: Callable[[Path, float], float],
    sync_structures_from_beat_times: Callable[[list[float], int], tuple[list[dict], list[dict], list[dict], float]],
    project_original_save_path: Callable[[Path], Path],
    project_working_save_path: Callable[[Path], Path],
    clean_metadata_value: Callable[[Any], str],
    removed_user_metadata_keys: set[str],
    stem_order: list[str],
    selected_arrangement: str | None = None,
    bpm: float = 120.0,
) -> dict:
    manifest = load_manifest(source_dir)
    arrs = arrangement_infos(source_dir, manifest)
    selected = selected_arrangement or (arrs[0]["id"] if arrs else None)
    beats_per_bar = 4
    try:
        meter = manifest.get("meter") or manifest.get("timeSignature") or [4, 4]
        if isinstance(meter, str) and "/" in meter:
            beats_per_bar = int(meter.split("/", 1)[0])
        elif isinstance(meter, list) and meter:
            beats_per_bar = int(meter[0])
    except Exception:
        beats_per_bar = 4

    beatgrid: list[dict] = []
    sync_points: list[dict] = []
    tempo_map: list[dict] = []
    sync_source = "fallback"
    sync_warning = ""

    beats = find_arrangement_beats(source_dir, manifest, selected)
    if beats:
        beatgrid, sync_points, tempo_map, bpm_from_beats = sync_from_ebeats(beats, beats_per_bar=beats_per_bar)
        bpm = bpm_from_beats
        sync_source = "ebeats"
    else:
        beatgrid = read_json_if_exists(source_dir / "sync" / "beatgrid.json", [])
        sync_points = read_json_if_exists(source_dir / "sync" / "syncpoints.json", [])
        tempo_map = read_json_if_exists(source_dir / "sync" / "tempoMap.json", [])
        analysis = read_json_if_exists(source_dir / "sync" / "analysis.json", {})
        if isinstance(analysis, dict):
            sync_source = str(analysis.get("source") or manifest.get("sync", {}).get("source") or "auto")
            sync_warning = str(analysis.get("warning") or "")
            try:
                bpm = float(analysis.get("bpm") or manifest.get("bpm") or bpm)
            except Exception:
                pass
        elif manifest.get("sync"):
            sync_source = str((manifest.get("sync") or {}).get("source") or "auto")
            sync_warning = str((manifest.get("sync") or {}).get("warning") or "")
            try:
                bpm = float(manifest.get("bpm") or bpm)
            except Exception:
                pass

    if not sync_points:
        sync_points = [{"id": "bar-1", "bar": 1, "beat": 1, "time": 0}]
    if not beatgrid:
        beatgrid, fallback_points, tempo_map, bpm = sync_structures_from_beat_times([0.0], beats_per_bar)
        if not sync_points:
            sync_points = fallback_points

    meta = extract_project_metadata(
        manifest,
        clean_metadata_value=clean_metadata_value,
        removed_user_metadata_keys=removed_user_metadata_keys,
    )
    cover_url, cover_path = cover_url_from_manifest(project_id, source_dir, manifest)
    lyrics, lyrics_source = read_project_lyrics(source_dir, manifest, read_json_if_exists=read_json_if_exists)

    return {
        "id": project_id,
        "title": meta["title"],
        "artist": meta["artist"],
        "album": meta["album"],
        "year": meta["year"],
        "metadata": meta["metadata"],
        "coverUrl": cover_url,
        "coverPath": cover_path,
        "lyrics": lyrics,
        "lyricsSource": lyrics_source,
        "bpm": round(float(bpm), 3),
        "meter": [beats_per_bar, 4],
        "duration": round(float(manifest.get("duration") or estimate_duration(source_dir, 180.0)), 3),
        "stems": build_stems(project_id, source_dir, manifest, stem_order=stem_order),
        "arrangements": arrs,
        "selectedArrangementId": selected,
        "notes": extract_notes_from_arrangement(source_dir, manifest, selected) if selected else [],
        "syncPoints": sync_points[:400],
        "beatgrid": beatgrid[:20000],
        "tempoMap": tempo_map[:20000],
        "syncSource": sync_source,
        "syncWarning": sync_warning,
        "musicXml": None,
        "outputPath": str(source_dir.parent),
        "sloppackPath": str(project_original_save_path(source_dir)),
        "originalSloppackPath": str(project_original_save_path(source_dir)),
        "workingSloppackPath": str(project_working_save_path(source_dir)),
        "hasUncommittedChanges": False,
    }
