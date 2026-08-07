from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Callable, Optional


PITCH_CLASS_NAMES: list[tuple[str, int | None]] = [
    ("C", None),
    ("C", 1),
    ("D", None),
    ("D", 1),
    ("E", None),
    ("F", None),
    ("F", 1),
    ("G", None),
    ("G", 1),
    ("A", None),
    ("A", 1),
    ("B", None),
]


CHORD_PATTERNS: list[dict[str, Any]] = [
    {"suffix": "maj7", "required": {0, 4, 11}, "optional": {2, 5, 7, 9}, "forbidden": {10}, "kind": "major-seventh", "priority": 140},
    {"suffix": "7", "required": {0, 4, 10}, "optional": {1, 2, 3, 5, 6, 7, 8, 9}, "kind": "dominant", "priority": 139},
    {"suffix": "m7", "required": {0, 3, 10}, "optional": {1, 2, 5, 6, 7, 8, 9}, "kind": "minor-seventh", "priority": 138},
    {"suffix": "m7b5", "required": {0, 3, 6, 10}, "optional": {1, 2, 5, 8, 9}, "kind": "half-diminished", "priority": 137},
    {"suffix": "dim7", "required": {0, 3, 6, 9}, "optional": {1, 2, 5, 8, 10}, "kind": "diminished-seventh", "priority": 136},
    {"suffix": "6", "required": {0, 4, 9}, "optional": {2, 5, 7}, "forbidden": {10, 11}, "kind": "major-sixth", "priority": 132},
    {"suffix": "m6", "required": {0, 3, 9}, "optional": {2, 5, 7}, "forbidden": {10, 11}, "kind": "minor-sixth", "priority": 131},
    {"suffix": "sus4", "required": {0, 5, 7}, "optional": {2, 9}, "forbidden": {3, 4, 10, 11}, "kind": "suspended-fourth", "priority": 128},
    {"suffix": "sus2", "required": {0, 2, 7}, "optional": {5, 9}, "forbidden": {3, 4, 10, 11}, "kind": "suspended-second", "priority": 127},
    {"suffix": "aug", "required": {0, 4, 8}, "optional": {2, 6, 10}, "forbidden": {3, 7}, "kind": "augmented", "priority": 126},
    {"suffix": "dim", "required": {0, 3, 6}, "optional": {2, 5, 9}, "forbidden": {4, 7, 8}, "kind": "diminished", "priority": 125},
    {"suffix": "", "required": {0, 4}, "optional": {2, 5, 7, 9}, "forbidden": {3}, "kind": "major", "priority": 124},
    {"suffix": "m", "required": {0, 3}, "optional": {2, 5, 7, 9}, "forbidden": {4}, "kind": "minor", "priority": 123},
    {"suffix": "5", "required": {0, 7}, "optional": set(), "forbidden": {1, 2, 3, 4, 5, 6, 8, 9, 10, 11}, "kind": "power", "priority": 110},
]


def _pitch_class(pitch: int) -> int:
    return ((int(pitch) % 12) + 12) % 12


def _pitch_class_xml(pc: int) -> tuple[str, int | None]:
    return PITCH_CLASS_NAMES[pc % 12]


def _intervals_for_root(root_pc: int, pcs: set[int]) -> set[int]:
    return {((pc - root_pc) + 12) % 12 for pc in pcs}


def _matches_chord_pattern(intervals: set[int], pattern: dict[str, Any]) -> bool:
    required = pattern["required"]
    optional = pattern.get("optional")
    forbidden = pattern.get("forbidden")

    if not required.issubset(intervals):
        return False
    if forbidden and any(interval in intervals for interval in forbidden):
        return False
    if optional is not None:
        allowed = set(required) | set(optional)
        if any(interval not in allowed for interval in intervals):
            return False
    return True


def _detect_chord_harmony(notes: list[dict]) -> dict[str, Any] | None:
    if not notes:
        return None
    notes_sorted = sorted(notes, key=lambda n: int(n.get("pitch", 0)))
    bass_pc = _pitch_class(int(notes_sorted[0].get("pitch", 0)))
    pcs = {_pitch_class(int(n.get("pitch", 0))) for n in notes_sorted}
    if not pcs:
        return None

    pc_counts: dict[int, int] = {}
    for pc in (_pitch_class(int(n.get("pitch", 0))) for n in notes_sorted):
        pc_counts[pc] = pc_counts.get(pc, 0) + 1

    candidates: list[dict[str, Any]] = []
    for root_pc in sorted(pcs):
        intervals = _intervals_for_root(root_pc, pcs)
        for pattern in CHORD_PATTERNS:
            if _matches_chord_pattern(intervals, pattern):
                candidates.append(
                    {
                        "root_pc": root_pc,
                        "bass_pc": bass_pc,
                        "suffix": pattern["suffix"],
                        "kind": pattern["kind"],
                        "priority": int(pattern["priority"]),
                        "interval_count": len(intervals),
                        "root_count": pc_counts.get(root_pc, 0),
                        "is_bass_root": root_pc == bass_pc,
                    }
                )
                break

    if not candidates:
        return None

    candidates.sort(
        key=lambda candidate: (
            -candidate["priority"],
            -candidate["interval_count"],
            -candidate["root_count"],
            0 if candidate["is_bass_root"] else 1,
            candidate["root_pc"],
        )
    )
    return candidates[0]


def frontend_notes_to_wire(
    project: dict,
    arrangement_id: str,
    fallback_name: str,
    fallback_instrument: str,
    source_wire: Optional[dict] = None,
    *,
    make_empty_wire: Callable[[str, str], dict],
) -> dict:
    """Convert the frontend's editable note list back to arrangement wire JSON."""
    wire = dict(source_wire or make_empty_wire(fallback_name, fallback_instrument))
    wire["name"] = str(wire.get("name") or fallback_name)
    wire.setdefault("tuning", [0, 0, 0, 0] if fallback_instrument == "bass" else [0, 0, 0, 0, 0, 0])
    wire.setdefault("capo", 0)
    converted = []
    for note in project.get("notes", []) or []:
        if str(note.get("trackId")) != str(arrangement_id):
            continue
        techniques = note.get("techniques") or {}
        string_number = int(note.get("string") or 1)
        fret = int(note.get("fret") or 0)
        converted.append(
            {
                "t": round(float(note.get("start", 0) or 0), 4),
                "s": max(0, string_number - 1),
                "f": max(0, fret),
                "sus": round(max(0.05, float(note.get("duration", 0.2) or 0.2)), 4),
                "velocity": int(note.get("velocity", 96) or 96),
                "pitch": int(note.get("pitch", 0) or 0),
                "sl": -1,
                "slu": -1,
                "bn": 1 if techniques.get("bend") else 0,
                "ho": bool(techniques.get("hammerOn")),
                "po": bool(techniques.get("pullOff")),
                "hm": bool(techniques.get("harmonic")),
                "hp": False,
                "pm": bool(techniques.get("palmMute")),
                "mt": False,
                "vb": bool(techniques.get("vibrato")),
                "tr": False,
                "ac": False,
                "tp": False,
            }
        )
    wire["notes"] = sorted(converted, key=lambda n: (n.get("t", 0), n.get("s", 0), n.get("f", 0)))
    wire["chords"] = []
    return wire


def write_midi_from_frontend_notes(
    project: dict,
    arrangement_id: str,
    out_file: Path,
    *,
    mido_module: Any,
) -> None:
    if mido_module is None:
        raise RuntimeError("mido is not installed")
    bpm = float(project.get("bpm") or 120.0)
    ticks_per_beat = 480
    tempo = mido_module.bpm2tempo(bpm)
    mid = mido_module.MidiFile(ticks_per_beat=ticks_per_beat)
    track = mido_module.MidiTrack()
    mid.tracks.append(track)
    track.append(mido_module.MetaMessage("set_tempo", tempo=tempo, time=0))
    track.append(mido_module.MetaMessage("track_name", name=str(project.get("selectedArrangementId") or arrangement_id), time=0))

    def sec_to_tick(seconds: float) -> int:
        return max(0, int(round(seconds * 1_000_000 * ticks_per_beat / tempo)))

    events: list[tuple[int, int, Any]] = []
    for note in project.get("notes", []) or []:
        if str(note.get("trackId")) != str(arrangement_id):
            continue
        pitch = max(0, min(127, int(note.get("pitch", 60) or 60)))
        start = max(0.0, float(note.get("start", 0) or 0))
        duration = max(0.05, float(note.get("duration", 0.2) or 0.2))
        velocity = max(1, min(127, int(note.get("velocity", 96) or 96)))
        start_tick = sec_to_tick(start)
        end_tick = max(start_tick + 1, sec_to_tick(start + duration))
        events.append((start_tick, 0, mido_module.Message("note_on", note=pitch, velocity=velocity, time=0)))
        events.append((end_tick, 1, mido_module.Message("note_off", note=pitch, velocity=0, time=0)))
    events.sort(key=lambda item: (item[0], item[1]))
    previous = 0
    for tick, _order, msg in events:
        msg.time = max(0, tick - previous)
        track.append(msg)
        previous = tick
    track.append(mido_module.MetaMessage("end_of_track", time=0))
    out_file.parent.mkdir(parents=True, exist_ok=True)
    mid.save(str(out_file))


def _midi_pitch_to_musicxml_pitch(pitch: int) -> tuple[str, int, int | None]:
    names = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"]
    alters = [None, 1, None, 1, None, None, 1, None, 1, None, 1, None]
    step = names[pitch % 12]
    alter = alters[pitch % 12]
    octave = int(pitch // 12) - 1
    return step, octave, alter


def _duration_type(duration_divisions: int, divisions: int) -> str:
    quarter = max(1, divisions)
    ratio = duration_divisions / quarter
    if ratio >= 3.5:
        return "whole"
    if ratio >= 1.75:
        return "half"
    if ratio >= 0.875:
        return "quarter"
    if ratio >= 0.4375:
        return "eighth"
    if ratio >= 0.21875:
        return "16th"
    if ratio >= 0.109375:
        return "32nd"
    return "64th"


def _duration_notation(duration_divisions: int, divisions: int) -> tuple[str, int, int | None, int | None]:
    """Return the closest symbolic notation, including simple tuplet metadata.

    Tuplets currently focus on 3:2 triplets, which covers the most common case
    used in arrangements and improves rendering fidelity in OSMD.
    """
    quarter = max(1, divisions)
    target = max(int(duration_divisions), 1)
    candidates: list[tuple[int, str, int, int | None, int | None]] = [
        (quarter * 4, "whole", 0, None, None),
        (quarter * 3, "half", 1, None, None),
        (quarter * 2, "half", 0, None, None),
        (int(round(quarter * 4 / 3)), "half", 0, 3, 2),
        (int(round(quarter * 3 / 2)), "quarter", 1, None, None),
        (quarter, "quarter", 0, None, None),
        (int(round(quarter * 2 / 3)), "quarter", 0, 3, 2),
        (int(round(quarter * 3 / 4)), "eighth", 1, None, None),
        (quarter // 2, "eighth", 0, None, None),
        (int(round(quarter / 3)), "eighth", 0, 3, 2),
        (int(round(quarter * 3 / 8)), "16th", 1, None, None),
        (quarter // 4, "16th", 0, None, None),
        (int(round(quarter / 6)), "16th", 0, 3, 2),
        (int(round(quarter * 3 / 16)), "32nd", 1, None, None),
        (quarter // 8, "32nd", 0, None, None),
        (int(round(quarter / 12)), "32nd", 0, 3, 2),
        (quarter // 16, "64th", 0, None, None),
        (int(round(quarter / 24)), "64th", 0, 3, 2),
    ]

    def score(candidate: tuple[int, str, int, int | None, int | None]) -> float:
        duration = max(candidate[0], 1)
        return abs(math.log(target / duration))

    nearest = min(candidates, key=score)
    return nearest[1], nearest[2], nearest[3], nearest[4]


def _split_duration_chunks(duration_divisions: int, quantum: int, divisions: int) -> list[int]:
    """Split duration into canonical binary + triplet-friendly chunks.

    This preserves triplet values (e.g. 160 at 480 divisions) instead of
    coercing everything to binary-only durations.
    """
    safe_quantum = max(1, int(quantum))
    remaining = max(safe_quantum, int(duration_divisions))
    quarter = max(1, int(divisions))
    ratios: list[tuple[int, int]] = [
        (4, 1),
        (3, 1),
        (2, 1),
        (3, 2),
        (1, 1),
        (2, 3),
        (3, 4),
        (1, 2),
        (1, 3),
        (3, 8),
        (1, 4),
        (1, 6),
        (3, 16),
        (1, 8),
        (1, 12),
        (1, 16),
        (1, 24),
    ]
    canonical = {
        max(safe_quantum, int(round((quarter * numerator) / denominator)))
        for numerator, denominator in ratios
    }
    usable = sorted(
        [value for value in canonical if value >= safe_quantum and value % safe_quantum == 0],
        reverse=True,
    )
    if not usable:
        return [remaining]

    chunks: list[int] = []
    for value in usable:
        while remaining >= value:
            chunks.append(value)
            remaining -= value

    if remaining > 0:
        chunks.append(max(safe_quantum, remaining))
    return chunks or [safe_quantum]


def _coerce_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except Exception:
        return None
    return parsed


def _normalize_tuning(raw_tuning: Any) -> list[int]:
    if not isinstance(raw_tuning, list):
        return []
    normalized: list[int] = []
    for item in raw_tuning:
        value = _coerce_int(item)
        if value is None:
            continue
        if value < 0 or value > 127:
            continue
        normalized.append(value)
    return normalized


def _infer_tab_position(
    pitch: int,
    string_number: int | None,
    fret: int | None,
    tuning: list[int],
) -> tuple[int | None, int | None]:
    string_count = len(tuning)
    if string_number is not None and string_number > 0:
        effective_string = string_number if string_count <= 0 else min(string_number, string_count)
        effective_fret = fret
        if effective_fret is None and string_count > 0:
            guessed = pitch - tuning[effective_string - 1]
            if guessed >= 0:
                effective_fret = guessed
        if effective_fret is not None and effective_fret >= 0:
            return effective_string, effective_fret

    if string_count > 0:
        candidates: list[tuple[int, int]] = []
        for index, open_pitch in enumerate(tuning):
            candidate_fret = pitch - open_pitch
            if 0 <= candidate_fret <= 36:
                candidates.append((index + 1, candidate_fret))
        if candidates:
            chosen_string, chosen_fret = min(candidates, key=lambda item: (abs(item[1] - 5), item[1]))
            return chosen_string, chosen_fret

    return None, None


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _extract_techniques(note: dict) -> dict[str, bool]:
    raw = note.get("techniques") if isinstance(note.get("techniques"), dict) else {}
    return {
        "palmMute": _to_bool(raw.get("palmMute") or note.get("pm")),
        "hammerOn": _to_bool(raw.get("hammerOn") or note.get("ho")),
        "pullOff": _to_bool(raw.get("pullOff") or note.get("po")),
        "slide": _to_bool(raw.get("slide") or note.get("sl")),
        "bend": _to_bool(raw.get("bend") or note.get("bn")),
        "vibrato": _to_bool(raw.get("vibrato") or note.get("vb")),
        "harmonic": _to_bool(raw.get("harmonic") or note.get("hm")),
    }


def write_musicxml_from_frontend_notes(project: dict, arrangement_id: str, out_file: Path, arrangement_name: str) -> None:
    """Write a simple, import-friendly MusicXML file for the selected arrangement."""
    import html

    raw_bpm = float(project.get("bpm") or 120.0)
    bpm = raw_bpm if math.isfinite(raw_bpm) and raw_bpm > 0 else 120.0

    meter = project.get("meter") or [4, 4]
    beats = int(meter[0] if len(meter) > 0 else 4)
    beat_type = int(meter[1] if len(meter) > 1 else 4)
    if beats <= 0:
        beats = 4
    if beat_type <= 0:
        beat_type = 4

    divisions = 480
    ticks_per_second = divisions * bpm / 60.0
    measure_ticks = max(1, int(divisions * beats * 4 / beat_type))
    # Quantize to a rhythm grid that supports both binary and 3:2 triplet
    # durations (20 ticks at 480 divisions).
    rhythm_quantum = max(1, divisions // 24)

    def quantize_tick(value: int) -> int:
        return max(0, int(round(value / rhythm_quantum) * rhythm_quantum))

    arrangement_type = str(project.get("arrangementType") or "").strip().lower()
    if arrangement_type == "bass":
        fallback_tuning = [28, 33, 38, 43]
    else:
        fallback_tuning = [40, 45, 50, 55, 59, 64]
    tuning = _normalize_tuning(project.get("arrangementTuning")) or fallback_tuning
    string_count = max(1, len(tuning))
    inferred_bass = arrangement_type == "bass" or (arrangement_type not in {"guitar", "bass"} and string_count <= 5)
    arrangement_text = f"{arrangement_id} {arrangement_name} {arrangement_type}".strip().lower()
    include_tab_staff = arrangement_type in {"guitar", "bass", "lead", "rhythm", "combo"}
    if not include_tab_staff:
        fretted_hint = any(word in arrangement_text for word in {"lead", "rhythm", "combo", "guitar", "bass", "chitarra"})
        non_fretted_hint = any(word in arrangement_text for word in {"keys", "piano", "keyboard", "drum", "percussion", "vocals"})
        include_tab_staff = fretted_hint and not non_fretted_hint
    standard_clef_sign = "F" if inferred_bass else "G"
    standard_clef_line = 4 if inferred_bass else 2
    written_pitch_offset = 0 if inferred_bass else 12
    arrangement_capo_raw = project.get("arrangementCapo", project.get("capo", 0))
    arrangement_capo = max(0, _coerce_int(arrangement_capo_raw) or 0)

    selected = []
    for note in project.get("notes", []) or []:
        if str(note.get("trackId")) != str(arrangement_id):
            continue
        start_tick = quantize_tick(int(round(float(note.get("start", 0) or 0) * ticks_per_second)))
        duration_tick = max(rhythm_quantum, quantize_tick(int(round(float(note.get("duration", 0.25) or 0.25) * ticks_per_second))))
        source_pitch = max(0, min(127, int(note.get("pitch", 60) or 60)))
        raw_string = _coerce_int(note.get("string"))
        raw_fret = _coerce_int(note.get("fret"))
        inferred_string, inferred_fret = _infer_tab_position(source_pitch, raw_string, raw_fret, tuning)
        if (
            inferred_string is not None
            and inferred_fret is not None
            and 1 <= inferred_string <= len(tuning)
            and inferred_fret >= 0
        ):
            pitch = max(0, min(127, int(tuning[inferred_string - 1]) + int(inferred_fret)))
        else:
            pitch = source_pitch
        selected.append(
            {
                "start": start_tick,
                "duration": duration_tick,
                "pitch": pitch,
                "string": inferred_string,
                "fret": inferred_fret,
                "techniques": note.get("techniques") if isinstance(note.get("techniques"), dict) else {},
            }
        )
    selected.sort(key=lambda n: (n["start"], n["pitch"]))

    grouped: dict[int, list[dict]] = {}
    for note in selected:
        grouped.setdefault(note["start"], []).append(note)

    title = html.escape(str(project.get("title") or "Feedpak arrangement"))
    creator = html.escape(str(project.get("artist") or ""))
    part_name = html.escape(arrangement_name or "Arrangement")
    tab_part_name = f"{part_name} TAB"

    lines: list[str] = []
    lines.append('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
    lines.append('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">')
    lines.append('<score-partwise version="3.1">')
    lines.append(f"  <work><work-title>{title}</work-title></work>")
    if creator:
        lines.append(f"  <identification><creator type=\"composer\">{creator}</creator></identification>")
    lines.append("  <part-list>")
    if include_tab_staff:
        lines.append(f"    <score-part id=\"P1\"><part-name>{part_name}</part-name><part-abbreviation>{tab_part_name}</part-abbreviation></score-part>")
    else:
        lines.append(f"    <score-part id=\"P1\"><part-name>{part_name}</part-name></score-part>")
    lines.append("  </part-list>")

    part_lines: list[str] = ['  <part id="P1">']

    current_tick = 0
    measure_no = 1
    measure_open = False
    last_harmony_signature: tuple[int, str, int, str] | None = None
    measure_standard_events: list[str] = []
    measure_tab_events: list[str] = []
    measure_standard_duration = 0
    measure_tab_duration = 0

    def open_measure() -> None:
        nonlocal measure_open, measure_no, measure_standard_events, measure_tab_events
        nonlocal measure_standard_duration, measure_tab_duration
        if measure_open:
            return
        part_lines.append(f"    <measure number=\"{measure_no}\">")
        measure_standard_events = []
        measure_tab_events = []
        measure_standard_duration = 0
        measure_tab_duration = 0
        if measure_no == 1:
            part_lines.append("      <attributes>")
            part_lines.append(f"        <divisions>{divisions}</divisions>")
            part_lines.append("        <key><fifths>0</fifths></key>")
            part_lines.append(f"        <time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>")
            part_lines.append(f"        <staves>{2 if include_tab_staff else 1}</staves>")
            part_lines.append(f"        <clef number=\"1\"><sign>{standard_clef_sign}</sign><line>{standard_clef_line}</line></clef>")
            if include_tab_staff:
                part_lines.append("        <staff-details number=\"2\">")
                part_lines.append(f"          <staff-lines>{string_count}</staff-lines>")
                for line_number, open_pitch in enumerate(reversed(tuning), start=1):
                    step, octave, alter = _midi_pitch_to_musicxml_pitch(open_pitch)
                    part_lines.append(f"          <staff-tuning line=\"{line_number}\">")
                    part_lines.append(f"            <tuning-step>{step}</tuning-step>")
                    if alter is not None:
                        part_lines.append(f"            <tuning-alter>{alter}</tuning-alter>")
                    part_lines.append(f"            <tuning-octave>{octave}</tuning-octave>")
                    part_lines.append("          </staff-tuning>")
                if arrangement_capo > 0:
                    part_lines.append(f"          <capo>{arrangement_capo}</capo>")
                part_lines.append("        </staff-details>")
                part_lines.append("        <clef number=\"2\"><sign>TAB</sign><line>5</line></clef>")
            part_lines.append("      </attributes>")
            part_lines.append(
                f"      <direction placement=\"above\"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{int(round(bpm))}</per-minute></metronome></direction-type><sound tempo=\"{bpm:.3f}\"/></direction>"
            )
        measure_open = True

    def close_measure() -> None:
        nonlocal measure_open, measure_no
        nonlocal measure_standard_duration, measure_tab_duration
        if not measure_open:
            return
        part_lines.extend(measure_standard_events)
        backup_duration = max(0, int(measure_standard_duration))
        if include_tab_staff and measure_tab_events and backup_duration > 0:
            part_lines.append("      <backup>")
            part_lines.append(f"        <duration>{backup_duration}</duration>")
            part_lines.append("      </backup>")
        if include_tab_staff:
            part_lines.extend(measure_tab_events)
        part_lines.append("    </measure>")
        measure_open = False
        measure_no += 1

    def emit_rest(duration: int, default_x: float) -> None:
        nonlocal measure_standard_duration, measure_tab_duration
        if duration <= 0:
            return
        type_name, dot_count, actual_notes, normal_notes = _duration_notation(duration, divisions)

        measure_standard_events.append(f"      <note default-x=\"{default_x:.2f}\">")
        measure_standard_events.append("        <rest/>")
        measure_standard_events.append(f"        <duration>{duration}</duration>")
        measure_standard_events.append("        <voice>1</voice>")
        measure_standard_events.append("        <staff>1</staff>")
        measure_standard_events.append(f"        <type>{type_name}</type>")
        for _ in range(dot_count):
            measure_standard_events.append("        <dot/>")
        if actual_notes is not None and normal_notes is not None:
            measure_standard_events.append("        <time-modification>")
            measure_standard_events.append(f"          <actual-notes>{actual_notes}</actual-notes>")
            measure_standard_events.append(f"          <normal-notes>{normal_notes}</normal-notes>")
            measure_standard_events.append("        </time-modification>")
        measure_standard_events.append("      </note>")

        if include_tab_staff:
            measure_tab_events.append(f"      <note default-x=\"{default_x:.2f}\">")
            measure_tab_events.append("        <rest/>")
            measure_tab_events.append(f"        <duration>{duration}</duration>")
            measure_tab_events.append("        <voice>1</voice>")
            measure_tab_events.append("        <staff>2</staff>")
            measure_tab_events.append(f"        <type>{type_name}</type>")
            for _ in range(dot_count):
                measure_tab_events.append("        <dot/>")
            if actual_notes is not None and normal_notes is not None:
                measure_tab_events.append("        <time-modification>")
                measure_tab_events.append(f"          <actual-notes>{actual_notes}</actual-notes>")
                measure_tab_events.append(f"          <normal-notes>{normal_notes}</normal-notes>")
                measure_tab_events.append("        </time-modification>")
            measure_tab_events.append("      </note>")
        measure_standard_duration += duration
        if include_tab_staff:
            measure_tab_duration += duration

    def emit_harmony(notes_at_start: list[dict], default_x: float) -> None:
        nonlocal last_harmony_signature
        harmony = _detect_chord_harmony(notes_at_start)
        if not harmony:
            return

        root_step, root_alter = _pitch_class_xml(int(harmony["root_pc"]))
        bass_step, bass_alter = _pitch_class_xml(int(harmony["bass_pc"]))
        suffix = str(harmony.get("suffix") or "")
        kind = str(harmony.get("kind") or "major")
        signature = (int(harmony["root_pc"]), kind, int(harmony["bass_pc"]), suffix)
        if signature == last_harmony_signature:
            return
        symbol_text = f"{root_step}{'#' if root_alter else ''}{suffix}"

        measure_standard_events.append(f"      <harmony default-x=\"{default_x:.2f}\">")
        measure_standard_events.append("        <root>")
        measure_standard_events.append(f"          <root-step>{root_step}</root-step>")
        if root_alter is not None:
            measure_standard_events.append(f"          <root-alter>{root_alter}</root-alter>")
        measure_standard_events.append("        </root>")
        measure_standard_events.append(f"        <kind text=\"{symbol_text}\">{kind}</kind>")
        if int(harmony["root_pc"]) != int(harmony["bass_pc"]):
            measure_standard_events.append("        <bass>")
            measure_standard_events.append(f"          <bass-step>{bass_step}</bass-step>")
            if bass_alter is not None:
                measure_standard_events.append(f"          <bass-alter>{bass_alter}</bass-alter>")
            measure_standard_events.append("        </bass>")
        measure_standard_events.append("      </harmony>")
        last_harmony_signature = signature

    def emit_standard_pitch(
        note: dict,
        *,
        chord: bool,
        duration_override: int,
        default_x: float,
        tie_start: bool,
        tie_stop: bool,
    ) -> None:
        nonlocal measure_standard_duration
        written_pitch = max(0, min(127, int(note["pitch"]) + written_pitch_offset))
        step, octave, alter = _midi_pitch_to_musicxml_pitch(written_pitch)
        note_duration = max(1, int(duration_override))
        type_name, dot_count, actual_notes, normal_notes = _duration_notation(note_duration, divisions)
        techniques = _extract_techniques(note)

        measure_standard_events.append(f"      <note default-x=\"{default_x:.2f}\">")
        if chord:
            measure_standard_events.append("        <chord/>")
        measure_standard_events.append("        <pitch>")
        measure_standard_events.append(f"          <step>{step}</step>")
        if alter is not None:
            measure_standard_events.append(f"          <alter>{alter}</alter>")
        measure_standard_events.append(f"          <octave>{octave}</octave>")
        measure_standard_events.append("        </pitch>")
        measure_standard_events.append(f"        <duration>{note_duration}</duration>")
        measure_standard_events.append("        <voice>1</voice>")
        measure_standard_events.append("        <staff>1</staff>")
        measure_standard_events.append(f"        <type>{type_name}</type>")
        for _ in range(dot_count):
            measure_standard_events.append("        <dot/>")
        if actual_notes is not None and normal_notes is not None:
            measure_standard_events.append("        <time-modification>")
            measure_standard_events.append(f"          <actual-notes>{actual_notes}</actual-notes>")
            measure_standard_events.append(f"          <normal-notes>{normal_notes}</normal-notes>")
            measure_standard_events.append("        </time-modification>")
        if tie_stop:
            measure_standard_events.append("        <tie type=\"stop\"/>")
        if tie_start:
            measure_standard_events.append("        <tie type=\"start\"/>")
        standard_technical_lines: list[str] = []
        if techniques["hammerOn"]:
            standard_technical_lines.append("            <hammer-on type=\"start\">H</hammer-on>")
        if techniques["pullOff"]:
            standard_technical_lines.append("            <pull-off type=\"start\">P</pull-off>")
        if techniques["harmonic"]:
            standard_technical_lines.append("            <harmonic><natural/></harmonic>")
        if techniques["bend"]:
            standard_technical_lines.append("            <bend><bend-alter>1</bend-alter></bend>")
        if techniques["palmMute"]:
            standard_technical_lines.append("            <palm-mute>yes</palm-mute>")
        if techniques["vibrato"]:
            standard_technical_lines.append("            <other-technical>vibrato</other-technical>")

        has_slide = techniques["slide"]
        if tie_start or tie_stop or has_slide or standard_technical_lines:
            measure_standard_events.append("        <notations>")
            if tie_stop:
                measure_standard_events.append("          <tied type=\"stop\"/>")
            if tie_start:
                measure_standard_events.append("          <tied type=\"start\"/>")
            if has_slide:
                measure_standard_events.append("          <slide type=\"start\" number=\"1\"/>")
            if standard_technical_lines:
                measure_standard_events.append("          <technical>")
                measure_standard_events.extend(standard_technical_lines)
                measure_standard_events.append("          </technical>")
            measure_standard_events.append("        </notations>")
        measure_standard_events.append("      </note>")
        if not chord:
            measure_standard_duration += note_duration

    def emit_tab_pitch(
        note: dict,
        *,
        chord: bool,
        duration_override: int,
        default_x: float,
        tie_start: bool,
        tie_stop: bool,
    ) -> None:
        nonlocal measure_tab_duration
        step, octave, alter = _midi_pitch_to_musicxml_pitch(note["pitch"])
        string_number = _coerce_int(note.get("string"))
        fret = _coerce_int(note.get("fret"))
        note_duration = max(1, int(duration_override))
        type_name, dot_count, actual_notes, normal_notes = _duration_notation(note_duration, divisions)
        techniques = _extract_techniques(note)

        measure_tab_events.append(f"      <note default-x=\"{default_x:.2f}\">")
        if chord:
            measure_tab_events.append("        <chord/>")
        measure_tab_events.append("        <pitch>")
        measure_tab_events.append(f"          <step>{step}</step>")
        if alter is not None:
            measure_tab_events.append(f"          <alter>{alter}</alter>")
        measure_tab_events.append(f"          <octave>{octave}</octave>")
        measure_tab_events.append("        </pitch>")
        measure_tab_events.append(f"        <duration>{note_duration}</duration>")
        measure_tab_events.append("        <voice>1</voice>")
        measure_tab_events.append("        <staff>2</staff>")
        measure_tab_events.append(f"        <type>{type_name}</type>")
        for _ in range(dot_count):
            measure_tab_events.append("        <dot/>")
        if actual_notes is not None and normal_notes is not None:
            measure_tab_events.append("        <time-modification>")
            measure_tab_events.append(f"          <actual-notes>{actual_notes}</actual-notes>")
            measure_tab_events.append(f"          <normal-notes>{normal_notes}</normal-notes>")
            measure_tab_events.append("        </time-modification>")
        if tie_stop:
            measure_tab_events.append("        <tie type=\"stop\"/>")
        if tie_start:
            measure_tab_events.append("        <tie type=\"start\"/>")
        xml_string: int | None = None
        if string_number is not None and fret is not None:
            # Internal note.string is low->high (1 = lowest). MusicXML TAB string is high->low (1 = highest).
            xml_string = max(1, min(string_count, string_count - string_number + 1))
        tab_technical_lines: list[str] = []
        if xml_string is not None and fret is not None:
            tab_technical_lines.append(f"            <string>{xml_string}</string>")
            tab_technical_lines.append(f"            <fret>{max(0, fret)}</fret>")
        if techniques["hammerOn"]:
            tab_technical_lines.append("            <hammer-on type=\"start\">H</hammer-on>")
        if techniques["pullOff"]:
            tab_technical_lines.append("            <pull-off type=\"start\">P</pull-off>")
        if techniques["harmonic"]:
            tab_technical_lines.append("            <harmonic><natural/></harmonic>")
        if techniques["bend"]:
            tab_technical_lines.append("            <bend><bend-alter>1</bend-alter></bend>")
        if techniques["palmMute"]:
            tab_technical_lines.append("            <palm-mute>yes</palm-mute>")
        if techniques["vibrato"]:
            tab_technical_lines.append("            <other-technical>vibrato</other-technical>")

        has_slide = techniques["slide"]
        if tie_start or tie_stop or has_slide or tab_technical_lines:
            measure_tab_events.append("        <notations>")
            if tie_stop:
                measure_tab_events.append("          <tied type=\"stop\"/>")
            if tie_start:
                measure_tab_events.append("          <tied type=\"start\"/>")
            if has_slide:
                measure_tab_events.append("          <slide type=\"start\" number=\"1\"/>")
            if tab_technical_lines:
                measure_tab_events.append("          <technical>")
                measure_tab_events.extend(tab_technical_lines)
                measure_tab_events.append("          </technical>")
            measure_tab_events.append("        </notations>")
        measure_tab_events.append("      </note>")
        if not chord:
            measure_tab_duration += note_duration

    starts = sorted(grouped)
    default_x_span = 240.0
    for start_index, start in enumerate(starts):
        while current_tick >= measure_no * measure_ticks:
            # If no measure is open yet, open/close to advance measure_no safely.
            if not measure_open:
                open_measure()
            close_measure()
        while start >= measure_no * measure_ticks:
            if not measure_open:
                open_measure()
            # Keep timeline in sync when fast-forwarding over empty measures.
            current_tick = max(current_tick, measure_no * measure_ticks)
            close_measure()
        open_measure()
        gap = start - current_tick
        while gap > 0:
            remaining_in_measure = measure_no * measure_ticks - current_tick
            if remaining_in_measure <= 0:
                close_measure()
                open_measure()
                continue
            chunk = min(gap, remaining_in_measure)
            if chunk <= 0:
                break
            # Keep rests rhythmically canonical to avoid renderer-dependent
            # positioning artifacts across zoom levels.
            rest_chunks = _split_duration_chunks(chunk, rhythm_quantum, divisions)
            for rest_duration in rest_chunks:
                gap_measure_start_tick = max(0, (measure_no - 1) * measure_ticks)
                gap_onset_in_measure = max(0, min(measure_ticks, current_tick - gap_measure_start_tick))
                gap_default_x = 10.0 + (gap_onset_in_measure / max(1, measure_ticks)) * default_x_span
                emit_rest(rest_duration, default_x=gap_default_x)
                current_tick += rest_duration
                gap -= rest_duration
            if current_tick >= measure_no * measure_ticks and gap > 0:
                close_measure()
                open_measure()
        notes_at_start = grouped[start]
        raw_group_duration = max(1, max(int(n["duration"]) for n in notes_at_start))
        next_start = starts[start_index + 1] if start_index + 1 < len(starts) else None
        remaining_in_measure = measure_no * measure_ticks - current_tick
        if remaining_in_measure <= 0:
            close_measure()
            open_measure()
            remaining_in_measure = measure_no * measure_ticks - current_tick
        if remaining_in_measure <= 0:
            remaining_in_measure = measure_ticks
        # Rhythmic value should primarily follow onset spacing.
        # In many imported arrangements raw durations are almost constant,
        # while starts carry the real rhythm against the bar grid.
        group_duration = raw_group_duration
        if next_start is not None:
            next_gap = next_start - start
            if next_gap > 0:
                group_duration = min(next_gap, remaining_in_measure)
            else:
                group_duration = min(group_duration, remaining_in_measure)
        else:
            group_duration = min(group_duration, remaining_in_measure)
        group_duration = max(1, quantize_tick(group_duration))
        if group_duration > remaining_in_measure:
            group_duration = remaining_in_measure
        chunks = _split_duration_chunks(group_duration, rhythm_quantum, divisions)
        chunk_start_tick = start
        for chunk_index, chunk_duration in enumerate(chunks):
            measure_start_tick = max(0, (measure_no - 1) * measure_ticks)
            onset_in_measure = max(0, min(measure_ticks, chunk_start_tick - measure_start_tick))
            default_x = 10.0 + (onset_in_measure / max(1, measure_ticks)) * default_x_span
            tie_start = chunk_index < len(chunks) - 1
            tie_stop = chunk_index > 0
            if chunk_index == 0:
                emit_harmony(notes_at_start, default_x=default_x)
            for index, note in enumerate(notes_at_start):
                emit_standard_pitch(
                    note,
                    chord=index > 0,
                    duration_override=chunk_duration,
                    default_x=default_x,
                    tie_start=tie_start,
                    tie_stop=tie_stop,
                )
            if include_tab_staff:
                for index, note in enumerate(notes_at_start):
                    emit_tab_pitch(
                        note,
                        chord=index > 0,
                        duration_override=chunk_duration,
                        default_x=default_x,
                        tie_start=tie_start,
                        tie_stop=tie_stop,
                    )
            chunk_start_tick += chunk_duration
        current_tick = max(current_tick, start + group_duration)

    if not measure_open:
        open_measure()
    close_measure()
    part_lines.append("  </part>")

    lines.extend(part_lines)
    lines.append("</score-partwise>")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
