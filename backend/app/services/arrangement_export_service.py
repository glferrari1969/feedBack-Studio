from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional


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


def write_musicxml_from_frontend_notes(project: dict, arrangement_id: str, out_file: Path, arrangement_name: str) -> None:
    """Write a simple, import-friendly MusicXML file for the selected arrangement."""
    import html

    bpm = float(project.get("bpm") or 120.0)
    meter = project.get("meter") or [4, 4]
    beats = int(meter[0] if len(meter) > 0 else 4)
    beat_type = int(meter[1] if len(meter) > 1 else 4)
    divisions = 480
    ticks_per_second = divisions * bpm / 60.0
    measure_ticks = int(divisions * beats * 4 / beat_type)
    selected = []
    for note in project.get("notes", []) or []:
        if str(note.get("trackId")) != str(arrangement_id):
            continue
        start_tick = max(0, int(round(float(note.get("start", 0) or 0) * ticks_per_second)))
        duration_tick = max(1, int(round(float(note.get("duration", 0.25) or 0.25) * ticks_per_second)))
        pitch = max(0, min(127, int(note.get("pitch", 60) or 60)))
        selected.append({"start": start_tick, "duration": duration_tick, "pitch": pitch})
    selected.sort(key=lambda n: (n["start"], n["pitch"]))

    grouped: dict[int, list[dict]] = {}
    for note in selected:
        grouped.setdefault(note["start"], []).append(note)

    title = html.escape(str(project.get("title") or "Sloppack arrangement"))
    creator = html.escape(str(project.get("artist") or ""))
    part_name = html.escape(arrangement_name or "Arrangement")
    lines: list[str] = []
    lines.append('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
    lines.append('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">')
    lines.append('<score-partwise version="3.1">')
    lines.append(f"  <work><work-title>{title}</work-title></work>")
    if creator:
        lines.append(f"  <identification><creator type=\"composer\">{creator}</creator></identification>")
    lines.append("  <part-list>")
    lines.append(f"    <score-part id=\"P1\"><part-name>{part_name}</part-name></score-part>")
    lines.append("  </part-list>")
    lines.append('  <part id="P1">')

    current_tick = 0
    measure_no = 1
    measure_open = False

    def open_measure() -> None:
        nonlocal measure_open, measure_no
        if measure_open:
            return
        lines.append(f"    <measure number=\"{measure_no}\">")
        if measure_no == 1:
            lines.append("      <attributes>")
            lines.append(f"        <divisions>{divisions}</divisions>")
            lines.append("        <key><fifths>0</fifths></key>")
            lines.append(f"        <time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>")
            lines.append("        <clef><sign>TAB</sign><line>5</line></clef>")
            lines.append("      </attributes>")
            lines.append(
                f"      <direction placement=\"above\"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{int(round(bpm))}</per-minute></metronome></direction-type><sound tempo=\"{bpm:.3f}\"/></direction>"
            )
        measure_open = True

    def close_measure() -> None:
        nonlocal measure_open, measure_no
        if measure_open:
            lines.append("    </measure>")
            measure_open = False
            measure_no += 1

    def emit_rest(duration: int) -> None:
        if duration <= 0:
            return
        lines.append("      <note>")
        lines.append("        <rest/>")
        lines.append(f"        <duration>{duration}</duration>")
        lines.append("        <voice>1</voice>")
        lines.append(f"        <type>{_duration_type(duration, divisions)}</type>")
        lines.append("      </note>")

    def emit_pitch(note: dict, chord: bool = False) -> None:
        step, octave, alter = _midi_pitch_to_musicxml_pitch(note["pitch"])
        lines.append("      <note>")
        if chord:
            lines.append("        <chord/>")
        lines.append("        <pitch>")
        lines.append(f"          <step>{step}</step>")
        if alter is not None:
            lines.append(f"          <alter>{alter}</alter>")
        lines.append(f"          <octave>{octave}</octave>")
        lines.append("        </pitch>")
        lines.append(f"        <duration>{note['duration']}</duration>")
        lines.append("        <voice>1</voice>")
        lines.append(f"        <type>{_duration_type(note['duration'], divisions)}</type>")
        lines.append("      </note>")

    for start in sorted(grouped):
        while current_tick >= measure_no * measure_ticks:
            close_measure()
        open_measure()
        gap = start - current_tick
        while gap > 0:
            remaining_in_measure = measure_no * measure_ticks - current_tick
            chunk = min(gap, remaining_in_measure)
            emit_rest(chunk)
            current_tick += chunk
            gap -= chunk
            if current_tick >= measure_no * measure_ticks and gap > 0:
                close_measure()
                open_measure()
        notes_at_start = grouped[start]
        for index, note in enumerate(notes_at_start):
            emit_pitch(note, chord=index > 0)
        current_tick = max(current_tick, start + max(n["duration"] for n in notes_at_start))

    if not measure_open:
        open_measure()
    close_measure()
    lines.append("  </part>")
    lines.append("</score-partwise>")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
