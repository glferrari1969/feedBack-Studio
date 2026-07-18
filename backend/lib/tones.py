"""Tone helpers for PSARC extraction and sloppak playback.

This module supports two paths:
1) Lifting tone data out of an unpacked PSARC during conversion.
2) Reading the embedded tone block from arrangement JSON during playback.
"""

from __future__ import annotations

import json
import logging
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

log = logging.getLogger("feedBack.lib.tones")

# Arrangement names that never carry guitar tones.
_NON_TONE_ARRANGEMENTS = {"vocals", "showlights", "jvocals"}


def tokens(s: str) -> set[str]:
    """Split a name or file stem into lowercased alphanumeric tokens.

    Used for fuzzy arrangement↔XML matching: arrangement names carry spaces
    ("Bonus Lead") while file stems are underscored ("song_bonus_lead"), and a
    plain substring check is ambiguous ("lead" is a substring of "bonuslead").
    Shared with the playback path in `server.py` so the two stay consistent.
    """
    return {t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if t}


def _manifest_tone_data(
    json_files: list[Path], arr_name: str
) -> tuple[list[dict], dict[int, str], str | None]:
    """Find manifest tone definitions and Tone_A..D mapping for one arrangement."""
    target = (arr_name or "").strip().lower()
    for jf in json_files:
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            continue
        if not isinstance(data, dict):
            continue
        entries = data.get("Entries")
        if not isinstance(entries, dict):
            continue

        for entry in entries.values():
            if not isinstance(entry, dict):
                continue
            attrs = entry.get("Attributes")
            if not isinstance(attrs, dict):
                continue
            raw_name = attrs.get("ArrangementName")
            name = raw_name.strip() if isinstance(raw_name, str) else ""
            if not name or name.lower() != target:
                continue

            definitions: list[dict] = []
            seen: set[str] = set()
            raw_tones = attrs.get("Tones")
            if not isinstance(raw_tones, list):
                raw_tones = []
            for tone in raw_tones:
                if not isinstance(tone, dict):
                    continue
                key = tone.get("Key", "")
                if isinstance(key, str) and key:
                    if key in seen:
                        continue
                    seen.add(key)
                definitions.append(tone)

            id_name_map: dict[int, str] = {}
            for idx, key in enumerate(("Tone_A", "Tone_B", "Tone_C", "Tone_D")):
                val = attrs.get(key)
                if isinstance(val, str) and val:
                    id_name_map[idx] = val

            return definitions, id_name_map, jf.stem.lower()

    return [], {}, None


def _xml_tone_changes(
    xml_path: Path, id_name_map: dict[int, str]
) -> tuple[str, list[dict]]:
    """Parse base tone and tone-change timeline from arrangement XML."""
    try:
        root = ET.parse(xml_path).getroot()
    except (ET.ParseError, OSError):
        return "", []
    if root.tag != "song":
        return "", []

    base = ""
    tonebase = root.find("tonebase")
    if tonebase is not None and tonebase.text:
        base = tonebase.text.strip()

    changes: list[dict] = []
    tones_el = root.find("tones")
    if tones_el is not None:
        for t in tones_el.findall("tone"):
            tc_time = t.get("time")
            tc_name = t.get("name", "")
            tc_id = t.get("id", "")
            if (not tc_name or tc_name == "N/A") and tc_id:
                try:
                    tc_name = id_name_map.get(int(tc_id), f"Tone {tc_id}")
                except ValueError:
                    pass
            if tc_time and tc_name:
                try:
                    t_val = float(tc_time)
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(t_val):
                    continue
                changes.append({"t": round(t_val, 3), "name": tc_name})
    return base, changes


def _extract_one(
    arr_name: str, json_files: list[Path], xml_files: list[Path]
) -> dict | None:
    """Extract one arrangement tone block from pre-scanned PSARC file lists."""
    if (arr_name or "").strip().lower() in _NON_TONE_ARRANGEMENTS:
        return None

    definitions, id_name_map, json_stem = _manifest_tone_data(json_files, arr_name)

    xml_path: Path | None = None
    if json_stem:
        for xf in xml_files:
            if xf.stem.lower() == json_stem:
                xml_path = xf
                break
    if xml_path is None:
        target_tokens = tokens(arr_name)
        if target_tokens:
            candidates: list[tuple[int, Path]] = []
            for xf in xml_files:
                stem_tokens = tokens(xf.stem)
                if target_tokens <= stem_tokens:
                    candidates.append((len(stem_tokens - target_tokens), xf))
            if candidates:
                best_extra = min(extra for extra, _ in candidates)
                tied = [xf for extra, xf in candidates if extra == best_extra]
                if len(tied) == 1:
                    xml_path = tied[0]
                else:
                    log.debug(
                        "tones: ambiguous fallback XML for %r: %s",
                        arr_name,
                        [x.name for x in tied],
                    )

    base, changes = ("", [])
    if xml_path is not None:
        base, changes = _xml_tone_changes(xml_path, id_name_map)
    if not base and 0 in id_name_map:
        base = id_name_map[0]

    if not base and not changes and not definitions:
        return None

    result: dict = {}
    if base:
        result["base"] = base
    if changes:
        result["changes"] = sorted(changes, key=lambda c: c["t"])
    if definitions:
        result["definitions"] = definitions
    return result


def _scan(extracted_dir: Path) -> tuple[list[Path], list[Path]]:
    """Scan an unpacked PSARC once for manifest JSON and arrangement XML."""
    return (
        sorted(extracted_dir.rglob("*.json")),
        sorted(extracted_dir.rglob("*.xml")),
    )


def extract_arrangement_tones(extracted_dir, arr_name: str) -> dict | None:
    """Extract one arrangement tone block from an unpacked PSARC directory."""
    json_files, xml_files = _scan(Path(extracted_dir))
    return _extract_one(arr_name, json_files, xml_files)


def extract_tones_for_song(extracted_dir, arr_names) -> dict[str, dict]:
    """Extract tone blocks for several arrangements, scanning the tree once."""
    json_files, xml_files = _scan(Path(extracted_dir))
    out: dict[str, dict] = {}
    for name in arr_names:
        block = _extract_one(name, json_files, xml_files)
        if block:
            out[name] = block
    return out


def sloppak_tone_changes(arr_tones) -> tuple[str, list[dict]]:
    """Build the highway tone-change payload from an arrangement's tone block.

    Given ``Arrangement.tones`` (the dict embedded in the sloppak, or ``None``),
    returns ``(base, changes)`` where ``base`` is the initial tone name and
    ``changes`` is a time-sorted ``[{"t", "name"}]`` list. Non-string names,
    non-dict entries, and non-numeric / non-finite times are skipped — a
    hand-edited or third-party sloppak must not crash the highway WebSocket
    or emit NaN/inf (which the client's ``JSON.parse`` rejects).
    """
    if not isinstance(arr_tones, dict):
        return "", []
    base_val = arr_tones.get("base", "")
    base = base_val.strip() if isinstance(base_val, str) else ""

    changes: list[dict] = []
    raw_changes = arr_tones.get("changes")
    if not isinstance(raw_changes, list):
        # A truthy non-list (e.g. `1`) would raise TypeError on iteration.
        raw_changes = []
    for c in raw_changes:
        if not isinstance(c, dict):
            continue
        t = c.get("t")
        name = c.get("name")
        if t is None or not isinstance(name, str) or not name:
            continue
        try:
            t = float(t)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(t):
            continue
        changes.append({"t": round(t, 3), "name": name})
    changes.sort(key=lambda x: x["t"])
    return base, changes


def annotate_tone_block_with_vst(tone_block: dict | None) -> dict | None:
    """Compatibility hook for callers that enrich tone blocks with VST hints.

    This backend keeps tone extraction/serialization stable even when mapping
    catalogs are unavailable. Callers can safely pass through this helper.
    """
    if not isinstance(tone_block, dict):
        return tone_block
    return tone_block
