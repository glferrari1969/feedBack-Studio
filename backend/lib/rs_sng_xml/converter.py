from __future__ import annotations

from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring, indent

from .crypto import Platform, decrypt_sng
from .model import Song

FIRST_BEAT_OF_MEASURE = 1
UINT32_MAX = 0xFFFFFFFF

# RS2014 SNG note mask bits used by the original toolkit family.
NOTE_MASKS = {
    "accent": 0x00000002,
    "bend": 0x00000004,
    "hammerOn": 0x00000008,
    "harmonic": 0x00000010,
    "ignore": 0x00000020,
    "leftHand": 0x00000040,
    "linkNext": 0x00000080,
    "mute": 0x00000100,
    "palmMute": 0x00000200,
    "pinchHarmonic": 0x00000400,
    "pluck": 0x00000800,
    "pullOff": 0x00001000,
    "rightHand": 0x00002000,
    "slide": 0x00004000,
    "slap": 0x00008000,
    "sustain": 0x00010000,
    "tap": 0x00020000,
    "tremolo": 0x00040000,
    "vibrato": 0x00080000,
    "fretHandMute": 0x00100000,
    "highDensity": 0x00200000,
    "slideUnpitchTo": 0x00400000,
    "single": 0x00800000,
    "chord": 0x01000000,
    "chordNotes": 0x02000000,
}

CHORD_ONLY_ATTRS = ["accent", "fretHandMute", "highDensity", "ignore", "palmMute", "linkNext"]
NOTE_ATTRS = [
    "accent", "bend", "hammerOn", "harmonic", "ignore", "linkNext", "palmMute",
    "pinchHarmonic", "pluck", "pullOff", "rightHand", "slap", "tap", "tremolo",
]


def _fmt(v: float | int) -> str:
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".") if v else "0"
    return str(v)


def _sbyte(v: int) -> str:
    return str(v)


def _bool_attrs(mask: int, names: list[str]) -> dict[str, str]:
    return {name: "1" for name in names if mask & NOTE_MASKS.get(name, 0)}


def _max_bend(bends) -> str | None:
    vals = [b.step for b in bends or []]
    return _fmt(max(vals)) if vals else None


def _is_chord(note) -> bool:
    return note.chordId != UINT32_MAX and note.chordId >= 0


def _add_bend_values(parent: Element, bends) -> None:
    if not bends:
        return
    node = SubElement(parent, "bendValues", {"count": str(len(bends))})
    for b in bends:
        SubElement(node, "bendValue", {"time": _fmt(b.time), "step": _fmt(b.step)})


def _note_attrs(note) -> dict[str, str]:
    attrs = {
        "time": _fmt(note.time),
        "string": _sbyte(note.string),
        "fret": _sbyte(note.fret),
        "sustain": _fmt(note.sustain),
    }
    attrs.update(_bool_attrs(note.mask, NOTE_ATTRS))
    if note.vibrato:
        attrs["vibrato"] = str(note.vibrato)
    if note.slideTo != -1:
        attrs["slideTo"] = str(note.slideTo)
    if note.slideUnpitchTo != -1:
        attrs["slideUnpitchTo"] = str(note.slideUnpitchTo)
    if note.leftHand != -1:
        attrs["leftHand"] = str(note.leftHand)
    if note.tap not in (-1, 0):
        attrs["tap"] = str(note.tap)
    if note.pickDirection:
        attrs["pickDirection"] = str(note.pickDirection)
    mb = _max_bend(note.bends)
    if mb is not None:
        attrs["bend"] = "1"
        attrs["bendValue"] = mb
    return attrs


def parse_sng(data: bytes, platform: Platform | str = Platform.PC):
    return Song.parse(decrypt_sng(data, platform))


def song_to_xml_element(song, *, arrangement: str = "Lead", title: str = "") -> Element:
    root = Element("song", {"version": "7"})
    SubElement(root, "title").text = title
    SubElement(root, "arrangement").text = arrangement

    md = song.metadata
    SubElement(root, "songLength").text = _fmt(md.songLength)
    SubElement(root, "startBeat").text = _fmt(md.startTime)
    SubElement(root, "averageTempo").text = "0"
    SubElement(root, "capo").text = str(md.capo)
    tuning = SubElement(root, "tuning")
    for i, value in enumerate(list(md.tuning)[:6]):
        tuning.set(f"string{i}", str(value))

    ebeats = SubElement(root, "ebeats", {"count": str(len(song.beats))})
    for b in song.beats:
        measure = str(b.measure) if (b.mask & FIRST_BEAT_OF_MEASURE) else "-1"
        SubElement(ebeats, "ebeat", {"time": _fmt(b.time), "measure": measure})

    phrases = SubElement(root, "phrases", {"count": str(len(song.phrases))})
    for p in song.phrases:
        attrs = {"name": p.name, "maxDifficulty": str(p.maxDifficulty)}
        if p.solo: attrs["solo"] = "1"
        if p.disparity: attrs["disparity"] = "1"
        if p.ignore: attrs["ignore"] = "1"
        SubElement(phrases, "phrase", attrs)

    chord_templates = SubElement(root, "chordTemplates", {"count": str(len(song.chordTemplates))})
    for c in song.chordTemplates:
        attrs = {"chordName": c.name, "displayName": c.name}
        for i, fret in enumerate(c.frets): attrs[f"fret{i}"] = str(fret)
        for i, finger in enumerate(c.fingers): attrs[f"finger{i}"] = str(finger)
        SubElement(chord_templates, "chordTemplate", attrs)

    vocals = SubElement(root, "vocals", {"count": str(len(song.vocals))})
    for v in song.vocals:
        SubElement(vocals, "vocal", {"time": _fmt(v.time), "note": str(v.note), "length": _fmt(v.length), "lyric": v.lyrics})

    phrase_iterations = SubElement(root, "phraseIterations", {"count": str(len(song.phraseIterations))})
    for pi in song.phraseIterations:
        attrs = {"time": _fmt(pi.time), "phraseId": str(pi.phraseId)}
        if pi.difficulty:
            attrs["variation"] = str(pi.difficulty[0])
        SubElement(phrase_iterations, "phraseIteration", attrs)

    phrase_props = SubElement(root, "phraseProperties", {"count": str(len(song.phraseExtraInfos))})
    for pe in song.phraseExtraInfos:
        SubElement(phrase_props, "phraseProperty", {
            "phraseId": str(pe.phraseId), "difficulty": str(pe.difficulty),
            "empty": str(pe.empty), "levelJump": str(pe.levelJump), "redundant": str(pe.redundant),
        })

    nlds = SubElement(root, "newLinkedDiffs", {"count": str(len(song.newLinkedDiffs))})
    for nld in song.newLinkedDiffs:
        nd = SubElement(nlds, "newLinkedDiff", {"levelBreak": str(nld.levelBreak), "count": str(len(nld.nld_phrase))})
        for phrase_id in nld.nld_phrase:
            SubElement(nd, "nld_phrase", {"id": str(phrase_id)})

    events = SubElement(root, "events", {"count": str(len(song.events))})
    for e in song.events:
        SubElement(events, "event", {"time": _fmt(e.time), "code": e.name})

    tones = SubElement(root, "tones", {"count": str(len(song.tones))})
    for t in song.tones:
        SubElement(tones, "tone", {"time": _fmt(t.time), "id": str(t.id), "name": f"tone{t.id}"})

    sections = SubElement(root, "sections", {"count": str(len(song.sections))})
    for s in song.sections:
        SubElement(sections, "section", {"name": s.name, "number": str(s.number), "startTime": _fmt(s.startTime)})

    levels = SubElement(root, "levels", {"count": str(len(song.levels))})
    for lvl in song.levels:
        level = SubElement(levels, "level", {"difficulty": str(lvl.difficulty)})
        anchors = SubElement(level, "anchors", {"count": str(len(lvl.anchors))})
        for a in lvl.anchors:
            SubElement(anchors, "anchor", {"time": _fmt(a.time), "fret": str(a.fret), "width": str(a.width)})

        handshapes_data = sorted(list(lvl.fingerprints[0]) + list(lvl.fingerprints[1]), key=lambda x: x.startTime)
        handshapes = SubElement(level, "handShapes", {"count": str(len(handshapes_data))})
        for fp in handshapes_data:
            SubElement(handshapes, "handShape", {"chordId": str(fp.chordId), "startTime": _fmt(fp.startTime), "endTime": _fmt(fp.endTime)})

        notes_data = [n for n in lvl.notes if not _is_chord(n)]
        chords_data = [n for n in lvl.notes if _is_chord(n)]
        notes = SubElement(level, "notes", {"count": str(len(notes_data))})
        for n in notes_data:
            node = SubElement(notes, "note", _note_attrs(n))
            _add_bend_values(node, n.bends)

        chords = SubElement(level, "chords", {"count": str(len(chords_data))})
        for ch in chords_data:
            attrs = {"time": _fmt(ch.time), "chordId": str(ch.chordId)}
            attrs.update(_bool_attrs(ch.mask, CHORD_ONLY_ATTRS))
            if ch.sustain:
                attrs["sustain"] = _fmt(ch.sustain)
            SubElement(chords, "chord", attrs)

    return root


def sng_to_xml(data: bytes, platform: Platform | str = Platform.PC, *, arrangement: str = "Lead", title: str = "") -> bytes:
    song = parse_sng(data, platform)
    root = song_to_xml_element(song, arrangement=arrangement, title=title)
    indent(root, space="  ")
    return b'<?xml version="1.0" encoding="utf-8"?>\n' + tostring(root, encoding="utf-8") + b"\n"


def sng_to_xml_file(input_path: str | Path, output_path: str | Path, platform: Platform | str = Platform.PC, *, arrangement: str = "Lead", title: str = "") -> None:
    data = Path(input_path).read_bytes()
    Path(output_path).write_bytes(sng_to_xml(data, platform, arrangement=arrangement, title=title))
