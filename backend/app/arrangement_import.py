from __future__ import annotations

import uuid
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


def simple_midi_to_wire(midi_path: Path, name: str, instrument: str) -> dict:
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

    open_midis = _standard_open_midis(instrument)
    notes = []
    for st, en, pitch in events[:5000]:
        string_index, fret = _pick_string_and_fret(pitch, open_midis)
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
    """Convert a Guitar Pro file directly to sloppak wire format."""
    from gp2midi import gp_to_midi  # type: ignore

    try:
        import guitarpro  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"Guitar Pro parser is not available: {exc}")

    try:
        song = guitarpro.parse(str(gp_path))
    except Exception as exc:
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

    temp_midi = UPLOADS / f"{uuid.uuid4()}.mid"
    try:
        gp_to_midi(
            str(gp_path),
            str(temp_midi),
            track_indices=[track_index],
            force_standard_tuning=False,
        )
        return simple_midi_to_wire(temp_midi, name, instrument)
    finally:
        try:
            temp_midi.unlink(missing_ok=True)
        except Exception:
            pass
