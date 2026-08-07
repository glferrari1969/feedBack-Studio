from __future__ import annotations

import uuid
import zipfile
from pathlib import Path

from app.runtime_state import UPLOADS

try:
    import mido  # type: ignore
except Exception:
    mido = None


def make_empty_wire(name: str, instrument: str) -> dict:
    tuning = [0, 0, 0, 0] if instrument == "bass" else [0, 0, 0, 0, 0, 0]
    return {
        "name": name,
        "instrument": instrument,
        "tuning": tuning,
        "capo": 0,
        "notes": [],
        "chords": [],
        "anchors": [],
        "handshapes": [],
        "templates": [],
    }


def _standard_open_midis(instrument: str) -> list[int]:
    """Resolve canonical open-string MIDI notes for import mapping.

    Tunings are sourced from the integrated lib/tunings module when available,
    with static fallbacks to keep the importer robust in constrained runtimes.
    """
    key = "bass-4" if instrument == "bass" else "guitar-6"
    try:
        from tunings import STANDARD_OPEN_MIDIS  # type: ignore

        values = STANDARD_OPEN_MIDIS.get(key)
        if isinstance(values, list) and values:
            return [int(v) for v in values]
    except Exception:
        pass
    return [28, 33, 38, 43] if instrument == "bass" else [40, 45, 50, 55, 59, 64]


def _normalize_open_midis(values: list[int], instrument: str) -> list[int]:
    """Return normalized open-string MIDI notes in low-to-high order."""
    default = _standard_open_midis(instrument)
    cleaned: list[int] = []
    for raw in values:
        try:
            midi = int(raw)
        except Exception:
            continue
        if 0 <= midi <= 127:
            cleaned.append(midi)

    if not cleaned:
        return default

    # GP strings are often stored high-to-low (string 1 first). Our wire format
    # stores low-to-high for consistent string/fret math across the app.
    if len(cleaned) >= 2 and cleaned[0] > cleaned[-1]:
        cleaned = list(reversed(cleaned))

    valid_lengths = {4, 5} if instrument == "bass" else {6, 7}
    if len(cleaned) not in valid_lengths:
        return default
    return cleaned


def _extract_gp_track_open_midis(track: object, instrument: str) -> list[int]:
    """Extract selected GP track tuning as open-string MIDI notes."""
    values: list[int] = []
    for item in list(getattr(track, "strings", []) or []):
        try:
            midi = int(getattr(item, "value", 0) or 0)
        except Exception:
            continue
        if 0 <= midi <= 127:
            values.append(midi)
    return _normalize_open_midis(values, instrument)


def _pick_string_and_fret(pitch: int, open_midis: list[int]) -> tuple[int, int]:
    """Map a MIDI pitch to the closest playable (string, fret) pair."""
    candidates: list[tuple[int, int]] = []
    for string_index, open_midi in enumerate(open_midis):
        fret = pitch - open_midi
        if 0 <= fret <= 24:
            candidates.append((fret, string_index))

    if candidates:
        # Prefer lower fret positions; at equal fret prefer higher strings.
        fret, string_index = min(candidates, key=lambda item: (item[0], -item[1]))
        return string_index, fret

    if pitch < min(open_midis):
        lowest_string = int(open_midis.index(min(open_midis)))
        return lowest_string, 0

    highest_string = int(open_midis.index(max(open_midis)))
    return highest_string, 24


_GP_QUARTER_TICKS = 960


def _gp_note_type_name(note: object) -> str:
    note_type = getattr(note, "type", None)
    name = getattr(note_type, "name", None)
    if isinstance(name, str) and name:
        return name.lower()
    return str(note_type).lower()


def _gp_beat_duration_ticks(beat: object) -> int:
    duration = getattr(beat, "duration", None)
    value = getattr(duration, "time", 0) if duration is not None else 0
    try:
        ticks = int(round(float(value or 0)))
    except Exception:
        ticks = 0
    return max(1, ticks)


def _collect_gp_tempo_changes(song: object) -> list[tuple[int, int]]:
    changes: list[tuple[int, int]] = []
    for track in list(getattr(song, "tracks", []) or []):
        for measure in list(getattr(track, "measures", []) or []):
            try:
                fallback_cursor = int(getattr(measure, "start", 0) or 0)
            except Exception:
                fallback_cursor = 0
            for voice in list(getattr(measure, "voices", []) or []):
                cursor = fallback_cursor
                for beat in list(getattr(voice, "beats", []) or []):
                    start = getattr(beat, "start", None)
                    if start is None:
                        beat_start = cursor
                    else:
                        try:
                            beat_start = int(start)
                        except Exception:
                            beat_start = cursor
                    cursor = max(cursor, beat_start + _gp_beat_duration_ticks(beat))

                    beat_effect = getattr(beat, "effect", None)
                    mix_change = getattr(beat_effect, "mixTableChange", None) if beat_effect is not None else None
                    tempo_item = getattr(mix_change, "tempo", None) if mix_change is not None else None
                    raw_value = getattr(tempo_item, "value", None) if tempo_item is not None else None
                    try:
                        bpm = int(raw_value or 0)
                    except Exception:
                        bpm = 0
                    if bpm > 0:
                        changes.append((beat_start, bpm))
    return changes


def _build_gp_tick_to_seconds(song: object, tick_offset: int) -> callable:
    try:
        base_bpm = int(getattr(song, "tempo", 120) or 120)
    except Exception:
        base_bpm = 120
    if base_bpm <= 0:
        base_bpm = 120

    rel_tempo_map: dict[int, int] = {0: base_bpm}
    for abs_tick, bpm in _collect_gp_tempo_changes(song):
        rel_tick = max(0, int(abs_tick) - tick_offset)
        if bpm > 0:
            rel_tempo_map[rel_tick] = bpm

    tempo_points = sorted(rel_tempo_map.items(), key=lambda item: item[0])
    segments: list[tuple[int, int | None, float, float]] = []
    cumulative_seconds = 0.0
    for idx, (start_tick, bpm) in enumerate(tempo_points):
        next_tick = tempo_points[idx + 1][0] if idx + 1 < len(tempo_points) else None
        seconds_per_tick = 60.0 / (max(1, bpm) * _GP_QUARTER_TICKS)
        segments.append((start_tick, next_tick, seconds_per_tick, cumulative_seconds))
        if next_tick is not None and next_tick > start_tick:
            cumulative_seconds += (next_tick - start_tick) * seconds_per_tick

    def to_seconds(abs_tick: int) -> float:
        rel_tick = max(0, int(abs_tick) - tick_offset)
        if not segments:
            return rel_tick * (60.0 / (base_bpm * _GP_QUARTER_TICKS))
        for start_tick, next_tick, seconds_per_tick, cumulative in segments:
            if rel_tick < start_tick:
                return cumulative
            if next_tick is None or rel_tick < next_tick:
                return cumulative + (rel_tick - start_tick) * seconds_per_tick
        last_start, _last_next, last_seconds_per_tick, last_cumulative = segments[-1]
        return last_cumulative + max(0, rel_tick - last_start) * last_seconds_per_tick

    return to_seconds


def _note_technique_flags(note: object, beat: object) -> dict[str, int | bool]:
    effect = getattr(note, "effect", None)
    note_type = _gp_note_type_name(note)

    is_bend = bool(getattr(effect, "isBend", False)) if effect is not None else False
    is_hammer = bool(getattr(effect, "hammer", False)) if effect is not None else False
    is_harmonic = bool(getattr(effect, "isHarmonic", False)) if effect is not None else False
    is_palm_mute = bool(getattr(effect, "palmMute", False)) if effect is not None else False
    has_vibrato = bool(getattr(effect, "vibrato", False)) if effect is not None else False
    has_trill = bool(getattr(effect, "isTrill", False)) if effect is not None else False
    has_slide = bool(getattr(effect, "slides", [])) if effect is not None else False
    accented = bool(getattr(effect, "accentuatedNote", False)) if effect is not None else False
    heavily_accented = bool(getattr(effect, "heavyAccentuatedNote", False)) if effect is not None else False

    beat_effect = getattr(beat, "effect", None)
    slap_effect = getattr(beat_effect, "slapEffect", None) if beat_effect is not None else None
    slap_name = str(getattr(slap_effect, "name", slap_effect)).lower() if slap_effect is not None else ""
    has_tap = slap_name == "tapping"

    return {
        "sl": 1 if has_slide else -1,
        "slu": -1,
        "bn": 1 if is_bend else 0,
        "ho": is_hammer,
        "po": False,
        "hm": is_harmonic,
        "hp": False,
        "pm": is_palm_mute,
        "mt": note_type == "dead",
        "vb": has_vibrato or bool(getattr(beat, "hasVibrato", False)),
        "tr": has_trill,
        "ac": accented or heavily_accented,
        "tp": has_tap,
    }


def _gp_track_to_wire(
    song: object,
    track: object,
    name: str,
    instrument: str,
    open_midis: list[int],
) -> dict:
    resolved_open_midis = _normalize_open_midis(open_midis, instrument)
    string_count = len(resolved_open_midis)

    measure_headers = list(getattr(song, "measureHeaders", []) or [])
    if measure_headers:
        try:
            tick_offset = int(min(int(getattr(header, "start", 0) or 0) for header in measure_headers))
        except Exception:
            tick_offset = 0
    else:
        tick_offset = 0

    tick_to_seconds = _build_gp_tick_to_seconds(song, tick_offset)
    fallback_fret_by_string: dict[int, int] = {}
    notes: list[dict] = []

    for measure in list(getattr(track, "measures", []) or []):
        try:
            measure_start = int(getattr(measure, "start", 0) or 0)
        except Exception:
            measure_start = 0

        for voice in list(getattr(measure, "voices", []) or []):
            cursor = measure_start
            for beat in list(getattr(voice, "beats", []) or []):
                raw_start = getattr(beat, "start", None)
                if raw_start is None:
                    beat_start = cursor
                else:
                    try:
                        beat_start = int(raw_start)
                    except Exception:
                        beat_start = cursor
                beat_duration_ticks = _gp_beat_duration_ticks(beat)
                cursor = max(cursor, beat_start + beat_duration_ticks)

                for note in list(getattr(beat, "notes", []) or []):
                    note_type = _gp_note_type_name(note)
                    if note_type == "rest":
                        continue

                    try:
                        gp_string = int(getattr(note, "string", 0) or 0)
                    except Exception:
                        gp_string = 0
                    if gp_string < 1 or gp_string > string_count:
                        continue

                    try:
                        raw_fret = int(getattr(note, "value", 0) or 0)
                    except Exception:
                        raw_fret = 0

                    if note_type == "tie" and gp_string in fallback_fret_by_string:
                        raw_fret = fallback_fret_by_string[gp_string]
                    else:
                        fallback_fret_by_string[gp_string] = raw_fret

                    fret = max(0, min(24, raw_fret))

                    try:
                        pitch = int(getattr(note, "realValue", 0) or 0)
                    except Exception:
                        pitch = 0
                    if pitch <= 0:
                        open_midi = resolved_open_midis[string_count - gp_string]
                        pitch = max(0, min(127, open_midi + fret))

                    try:
                        duration_percent = float(getattr(note, "durationPercent", 1.0) or 1.0)
                    except Exception:
                        duration_percent = 1.0
                    duration_percent = max(0.05, duration_percent)
                    note_ticks = max(1, int(round(beat_duration_ticks * duration_percent)))

                    start_seconds = tick_to_seconds(beat_start)
                    end_seconds = tick_to_seconds(beat_start + note_ticks)
                    sustain_seconds = max(0.05, end_seconds - start_seconds)

                    string_index = string_count - gp_string
                    flags = _note_technique_flags(note, beat)
                    notes.append({
                        "t": round(start_seconds, 3),
                        "s": string_index,
                        "f": fret,
                        "sus": round(sustain_seconds, 3),
                        "pitch": max(0, min(127, pitch)),
                        "velocity": int(getattr(note, "velocity", 96) or 96),
                        **flags,
                    })

    notes.sort(key=lambda item: (item.get("t", 0), item.get("s", 0), item.get("f", 0), item.get("pitch", 0)))

    wire = make_empty_wire(name, instrument)
    wire["tuning"] = resolved_open_midis
    wire["notes"] = notes[:5000]
    return wire


def simple_midi_to_wire(
    midi_path: Path,
    name: str,
    instrument: str,
    open_midis: list[int] | None = None,
) -> dict:
    if mido is None:
        raise RuntimeError("mido is not installed")
    midi = mido.MidiFile(str(midi_path))
    tempo = 500000
    ticks_per_beat = midi.ticks_per_beat
    events = []
    for track in midi.tracks:
        abs_tick = 0
        open_notes: dict[int, int] = {}
        for msg in track:
            abs_tick += msg.time
            if msg.type == "set_tempo":
                tempo = int(msg.tempo)
            if msg.type == "note_on" and getattr(msg, "velocity", 0) > 0:
                open_notes[int(msg.note)] = abs_tick
            elif msg.type in ["note_off", "note_on"] and int(getattr(msg, "note", -1)) in open_notes:
                pitch = int(msg.note)
                st = open_notes.pop(pitch)
                events.append((st, abs_tick, pitch))

    def tick_to_sec(t: int) -> float:
        return t * (tempo / 1_000_000.0) / ticks_per_beat

    resolved_open_midis = _normalize_open_midis(open_midis or _standard_open_midis(instrument), instrument)
    notes = []
    for st, en, pitch in events[:5000]:
        string_index, fret = _pick_string_and_fret(pitch, resolved_open_midis)
        notes.append({
            "t": round(tick_to_sec(st), 3),
            "s": string_index,
            "f": fret,
            "sus": round(max(0.05, tick_to_sec(en - st)), 3),
            "sl": -1,
            "slu": -1,
            "bn": 0,
            "ho": False,
            "po": False,
            "hm": False,
            "hp": False,
            "pm": False,
            "mt": False,
            "vb": False,
            "tr": False,
            "ac": False,
            "tp": False,
        })
    wire = make_empty_wire(name, instrument)
    wire["tuning"] = resolved_open_midis
    wire["notes"] = notes
    return wire


def list_gp_tracks_direct(gp_path: Path) -> list[dict]:
    """Return GP track descriptors for explicit user selection in the UI."""
    try:
        import guitarpro  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"Guitar Pro parser is not available: {exc}")

    try:
        song = guitarpro.parse(str(gp_path))
    except Exception as exc:
        try:
            # GP7/GP8 often use a zipped .gp container that embeds score.gpif.
            # The bundled parser supports GP3/4/5/GPX but not this container.
            if gp_path.suffix.lower() == ".gp" and zipfile.is_zipfile(gp_path):
                with zipfile.ZipFile(gp_path, "r") as zf:
                    has_gpif = any(str(name).lower().endswith("score.gpif") for name in zf.namelist())
                if has_gpif:
                    raise RuntimeError(
                        "This .gp file is a Guitar Pro 7/8 package and is not supported by the current importer. "
                        "Please export it as GP5/GPX or MIDI from Guitar Pro, then import that file."
                    ) from exc
        except RuntimeError:
            raise
        except Exception:
            pass
        raise RuntimeError(f"Could not parse Guitar Pro file: {exc}")

    tracks: list[dict] = []
    for idx, track in enumerate(song.tracks):
        note_count = 0
        for measure in getattr(track, "measures", []):
            for voice in getattr(measure, "voices", []):
                for beat in getattr(voice, "beats", []):
                    note_count += len(getattr(beat, "notes", []) or [])

        strings = list(getattr(track, "strings", []) or [])
        top_string_midi = max((int(getattr(s, "value", 0) or 0) for s in strings), default=0)
        is_percussion = bool(getattr(track, "isPercussionTrack", False))
        is_bass = (not is_percussion) and top_string_midi <= 48 and len(strings) >= 4

        channel = getattr(track, "channel", None)
        midi_program = int(getattr(channel, "instrument", -1)) if channel is not None else -1
        track_name = str(getattr(track, "name", "") or f"Track {idx + 1}")

        tracks.append({
            "index": idx,
            "name": track_name,
            "strings": len(strings),
            "is_percussion": is_percussion,
            "is_bass": is_bass,
            "instrument": midi_program,
            "notes": note_count,
        })

    return tracks


def gp_to_wire_direct(gp_path: Path, name: str, instrument: str, gp_track_index: int | None = None) -> dict:
    """Convert a Guitar Pro file directly to feedpak wire format."""
    from gp2midi import gp_to_midi  # type: ignore

    try:
        import guitarpro  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"Guitar Pro parser is not available: {exc}")

    try:
        song = guitarpro.parse(str(gp_path))
    except Exception as exc:
        try:
            # GP7/GP8 often use a zipped .gp container that embeds score.gpif.
            # The bundled parser supports GP3/4/5/GPX but not this container.
            if gp_path.suffix.lower() == ".gp" and zipfile.is_zipfile(gp_path):
                with zipfile.ZipFile(gp_path, "r") as zf:
                    has_gpif = any(str(name).lower().endswith("score.gpif") for name in zf.namelist())
                if has_gpif:
                    raise RuntimeError(
                        "This .gp file is a Guitar Pro 7/8 package and is not supported by the current importer. "
                        "Please export it as GP5/GPX or MIDI from Guitar Pro, then import that file."
                    ) from exc
        except RuntimeError:
            raise
        except Exception:
            pass
        raise RuntimeError(f"Could not parse Guitar Pro file: {exc}")

    non_perc = [
        idx for idx, track in enumerate(song.tracks)
        if not bool(getattr(track, "isPercussionTrack", False))
    ]
    if not non_perc:
        raise RuntimeError("No melodic Guitar Pro track was found")

    if gp_track_index is not None and gp_track_index >= 0:
        if gp_track_index >= len(song.tracks):
            raise RuntimeError(f"Invalid GP track index: {gp_track_index}")
        selected = song.tracks[gp_track_index]
        if bool(getattr(selected, "isPercussionTrack", False)):
            raise RuntimeError("Selected GP track is percussion-only and cannot be imported as guitar/bass arrangement")
        track_index = gp_track_index
    else:
        if instrument == "bass":
            preferred = [
                idx for idx in non_perc
                if "bass" in str(getattr(song.tracks[idx], "name", "")).lower()
            ]
        else:
            preferred = [
                idx for idx in non_perc
                if "bass" not in str(getattr(song.tracks[idx], "name", "")).lower()
            ]
        track_index = (preferred or non_perc)[0]

    selected_track = song.tracks[track_index]
    selected_tuning = _extract_gp_track_open_midis(selected_track, instrument)

    # Prefer true GP parsing to preserve original string/fret positions.
    try:
        direct_wire = _gp_track_to_wire(song, selected_track, name, instrument, selected_tuning)
        if direct_wire.get("notes"):
            return direct_wire
    except Exception:
        # Keep importer resilient by falling back to the established MIDI path.
        pass

    temp_midi = UPLOADS / f"{uuid.uuid4()}.mid"
    try:
        gp_to_midi(
            str(gp_path),
            str(temp_midi),
            track_indices=[track_index],
            force_standard_tuning=False,
        )
        return simple_midi_to_wire(temp_midi, name, instrument, open_midis=selected_tuning)
    finally:
        try:
            temp_midi.unlink(missing_ok=True)
        except Exception:
            pass
