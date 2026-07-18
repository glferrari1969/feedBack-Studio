from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import uuid
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable


def parse_lrc_or_plain_text(text: str) -> tuple[list[dict], list[str]]:
    """Return timed LRC lines when present, otherwise plain lyric lines."""
    timed: list[dict] = []
    plain: list[str] = []
    lrc_re = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)")
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        matches = list(lrc_re.finditer(line))
        if matches:
            lyric_text = matches[-1].group(4).strip()
            midico_match = re.match(r"^\d+:(/)?(.*)$", lyric_text)
            starts_segment = False
            if midico_match:
                starts_segment = bool(midico_match.group(1))
                lyric_text = midico_match.group(2).strip()
            if starts_segment and timed:
                previous_text = str(timed[-1].get("w", ""))
                if previous_text and not previous_text.endswith("+"):
                    timed[-1]["w"] = previous_text + "+"
            if not lyric_text:
                continue
            for match in matches:
                mins = int(match.group(1))
                secs = int(match.group(2))
                frac = match.group(3) or "0"
                frac_seconds = float(f"0.{frac.ljust(3, '0')[:3]}")
                timed.append(
                    {
                        "id": f"lyric-{uuid.uuid4().hex[:8]}",
                        "t": round(mins * 60 + secs + frac_seconds, 3),
                        "d": 1.0,
                        "w": lyric_text,
                    }
                )
        else:
            cleaned = re.sub(r"\s+", " ", line).strip()
            if cleaned:
                plain.append(cleaned)
    if timed:
        timed.sort(key=lambda item: item["t"])
        for idx, item in enumerate(timed):
            if idx < len(timed) - 1:
                item["d"] = round(max(0.2, timed[idx + 1]["t"] - item["t"]), 3)
            else:
                item["d"] = max(1.0, float(item.get("d", 1.0)))
        return timed, []
    return [], plain


def _merge_intervals(intervals: list[tuple[float, float]], gap: float = 0.45) -> list[tuple[float, float]]:
    if not intervals:
        return []
    intervals = sorted(intervals)
    merged = [intervals[0]]
    for start, end in intervals[1:]:
        last_start, last_end = merged[-1]
        if start - last_end <= gap:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def detect_lyric_regions(audio_path: Path | None, duration: float, *, librosa_module: Any, numpy_module: Any) -> list[tuple[float, float]]:
    """Best-effort vocal activity regions for initial text synchronization."""
    if audio_path is None or librosa_module is None or numpy_module is None:
        return []
    try:
        y, sr = librosa_module.load(str(audio_path), sr=22050, mono=True)
        if len(y) == 0:
            return []
        intervals = librosa_module.effects.split(y, top_db=32, frame_length=2048, hop_length=512)
        out: list[tuple[float, float]] = []
        for start, end in intervals:
            t0 = float(start) / sr
            t1 = float(end) / sr
            if t1 - t0 >= 0.25:
                out.append((max(0.0, t0), min(duration, t1)))
        return _merge_intervals(out)
    except Exception:
        return []


def _sync_with_reference_transcriber(
    lines: list[str],
    audio_path: Path | None,
    manifest: dict,
) -> list[dict]:
    """Align trusted lyric text with the same engine used by recognition.

    lyrics-transcriber first recognizes the vocal performance, then uses the
    supplied text as the correction reference.  Its LRC output therefore keeps
    the recognized timing while preferring the user's exact words.
    """
    if audio_path is None or not audio_path.is_file():
        return []
    try:
        import lyrics_transcriber  # type: ignore  # noqa: F401
    except Exception:
        return []


def _reference_words(lines: list[str]) -> list[str]:
    words: list[str] = []
    for line in lines:
        line_words = re.findall(r"\S+", line.strip())
        if not line_words:
            continue
        for chunk_start in range(0, len(line_words), 10):
            chunk = line_words[chunk_start:chunk_start + 10]
            words.extend(chunk[:-1])
            words.append(chunk[-1] + "+")
    return words


def _normalized_word(value: str) -> str:
    value = value.rstrip("+-").casefold()
    return "".join(char for char in value if char.isalnum())


def _expand_timed_words(items: list[dict]) -> list[dict]:
    expanded: list[dict] = []
    for item in sorted(items, key=lambda value: float(value.get("t", 0) or 0)):
        text = str(item.get("w", "")).strip()
        tokens = re.findall(r"\S+", text)
        if not tokens:
            continue
        start = max(0.0, float(item.get("t", 0) or 0))
        duration = max(0.05, float(item.get("d", 0.5) or 0.5))
        slot = duration / len(tokens)
        for index, token in enumerate(tokens):
            expanded.append({
                "t": start + index * slot,
                "d": max(0.05, slot * 0.9),
                "w": token,
            })
    return expanded


def _align_reference_to_timing(
    lines: list[str],
    timed_items: list[dict],
    duration: float,
) -> list[dict]:
    reference = _reference_words(lines)
    recognized = _expand_timed_words(timed_items)
    if not reference or len(recognized) < 4:
        return []
    timing_span = max(item["t"] + item["d"] for item in recognized) - min(item["t"] for item in recognized)
    if duration > 30 and timing_span < duration * 0.2:
        return []

    recognized_norm = [_normalized_word(item["w"]) for item in recognized]
    reference_norm = [_normalized_word(word) for word in reference]
    matcher = SequenceMatcher(None, recognized_norm, reference_norm, autojunk=False)
    aligned: list[dict | None] = [None] * len(reference)

    def distribute(ref_start: int, ref_end: int, start: float, end: float) -> None:
        count = ref_end - ref_start
        if count <= 0:
            return
        safe_end = max(start + count * 0.05, end)
        weights = [max(1, len(reference_norm[index])) for index in range(ref_start, ref_end)]
        total_weight = float(sum(weights))
        cursor = start
        for offset, weight in enumerate(weights):
            share = (safe_end - start) * weight / total_weight
            index = ref_start + offset
            aligned[index] = {
                "id": f"lyric-{uuid.uuid4().hex[:8]}",
                "t": round(max(0.0, cursor), 3),
                "d": round(max(0.05, share * 0.9), 3),
                "w": reference[index],
            }
            cursor += share

    for tag, rec_start, rec_end, ref_start, ref_end in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(ref_end - ref_start):
                timing = recognized[rec_start + offset]
                aligned[ref_start + offset] = {
                    "id": f"lyric-{uuid.uuid4().hex[:8]}",
                    "t": round(float(timing["t"]), 3),
                    "d": round(max(0.05, float(timing["d"])), 3),
                    "w": reference[ref_start + offset],
                }
            continue
        if ref_end <= ref_start:
            continue
        if rec_end > rec_start:
            block_start = float(recognized[rec_start]["t"])
            last = recognized[rec_end - 1]
            block_end = float(last["t"]) + float(last["d"])
        else:
            block_start = (
                float(recognized[rec_start - 1]["t"]) + float(recognized[rec_start - 1]["d"])
                if rec_start > 0 else 0.0
            )
            block_end = float(recognized[rec_start]["t"]) if rec_start < len(recognized) else duration
        distribute(ref_start, ref_end, block_start, block_end)

    return [item for item in aligned if item is not None]


def _existing_timing_reference(source_dir: Path, duration: float) -> list[dict]:
    path = source_dir / "lyrics.json"
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return []
        expanded = _expand_timed_words([item for item in data if isinstance(item, dict)])
        if len(expanded) < 4:
            return []
        span = max(item["t"] + item["d"] for item in expanded) - min(item["t"] for item in expanded)
        return data if duration <= 30 or span >= duration * 0.2 else []
    except Exception:
        return []

    try:
        with tempfile.TemporaryDirectory(prefix="lyrics-reference-sync-") as temp_name:
            temp_dir = Path(temp_name)
            reference_path = temp_dir / "lyrics.txt"
            output_dir = temp_dir / "output"
            output_dir.mkdir()
            reference_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

            command = [
                sys.executable,
                "-c",
                "from lyrics_transcriber.cli.cli_main import main; main()",
                str(audio_path),
                "--output_dir",
                str(output_dir),
                "--lyrics_file",
                str(reference_path),
                "--skip_video",
                "--skip_cdg",
                "--skip_countdown",
                "--skip_lyrics_fetch",
            ]
            artist = str(manifest.get("artist") or "").strip()
            title = str(manifest.get("title") or "").strip()
            if artist:
                command += ["--artist", artist]
            if title:
                command += ["--title", title]

            result = subprocess.run(
                command,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )
            if result.returncode != 0:
                return []

            lrc_files = sorted(
                output_dir.rglob("*.lrc"),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
            if not lrc_files:
                return []
            timed, _plain = parse_lrc_or_plain_text(
                lrc_files[0].read_text(encoding="utf-8", errors="replace")
            )
            return timed
    except Exception:
        return []


def sync_plain_lyrics_to_audio(
    lines: list[str],
    source_dir: Path,
    manifest: dict,
    stem_id: str | None = None,
    *,
    estimate_duration: Callable[[Path], float],
    project_stem_path: Callable[[Path, dict, str | None], tuple[Path | None, str]],
    librosa_module: Any,
    numpy_module: Any,
    whisperx_available: Callable[[], bool] | None = None,
    transcribe_vocals_local: Callable[..., list[dict]] | None = None,
    progress_cb: Callable[[float, str], None] | None = None,
) -> tuple[list[dict], str]:
    def progress(value: float, step: str) -> None:
        if progress_cb is not None:
            progress_cb(max(0.0, min(1.0, value)), step)

    duration = float(manifest.get("duration", 0) or estimate_duration(source_dir))
    audio_path, audio_label = project_stem_path(source_dir, manifest, stem_id)
    lyrics: list[dict] = []

    if not lines:
        return [], "text"

    progress(0.08, "Checking existing lyric timing")
    existing_timing = _existing_timing_reference(source_dir, duration)
    aligned = _align_reference_to_timing(lines, existing_timing, duration)
    if aligned:
        progress(0.9, "Existing timing aligned to supplied text")
        return aligned, f"text-reference-sync:{audio_label}:existing-timing"

    progress(0.18, "Aligning supplied text with lyrics-transcriber")
    aligned = _sync_with_reference_transcriber(lines, audio_path, manifest)
    if aligned:
        progress(0.9, "Reference lyrics aligned")
        return aligned, f"text-reference-sync:{audio_label}:lyrics-transcriber"

    if (
        audio_path is not None
        and whisperx_available is not None
        and transcribe_vocals_local is not None
        and whisperx_available()
    ):
        try:
            progress(0.3, "Loading WhisperX for advanced lyric sync")

            def whisper_progress(value: float, _phase: str, detail: str) -> None:
                progress(0.3 + max(0.0, min(1.0, value)) * 0.55, detail)

            recognized = transcribe_vocals_local(
                audio_path,
                model_size="medium",
                min_word_score=0.35,
                progress_cb=whisper_progress,
            )
            progress(0.87, "Matching supplied words to recognized timing")
            aligned = _align_reference_to_timing(lines, recognized, duration)
            if aligned:
                progress(0.92, "Advanced lyric sync completed")
                return aligned, f"text-reference-sync:{audio_label}:whisperx"
        except Exception:
            pass

    progress(0.72, "Advanced alignment unavailable; analysing vocal regions")
    regions = detect_lyric_regions(audio_path, duration, librosa_module=librosa_module, numpy_module=numpy_module)
    if len(regions) >= max(1, min(len(lines), 4)):
        for index, line in enumerate(lines):
            region_index = min(len(regions) - 1, int(index * len(regions) / len(lines)))
            r0, r1 = regions[region_index]
            same_region_total = max(1, round(len(lines) / len(regions)))
            same_region_pos = index - int(region_index * len(lines) / len(regions))
            span = max(0.5, r1 - r0)
            t = r0 + min(0.95, same_region_pos / same_region_total) * span
            lyrics.append(
                {
                    "id": f"lyric-{uuid.uuid4().hex[:8]}",
                    "t": round(min(t, duration), 3),
                    "d": round(max(0.5, min(4.0, span / max(1, same_region_total))), 3),
                    "w": line,
                }
            )
        source = f"text-auto-sync:{audio_label}:vocal-regions"
    else:
        start = 0.0 if duration < 20 else min(8.0, duration * 0.06)
        end = max(start + 1, duration - (0.0 if duration < 20 else min(8.0, duration * 0.04)))
        slot = (end - start) / max(1, len(lines))
        for index, line in enumerate(lines):
            t = start + index * slot
            lyrics.append(
                {
                    "id": f"lyric-{uuid.uuid4().hex[:8]}",
                    "t": round(t, 3),
                    "d": round(max(0.75, min(4.0, slot * 0.85)), 3),
                    "w": line,
                }
            )
        source = "text-auto-sync:even-spread"

    progress(0.9, "Initial vocal-region sync completed")
    return sorted(lyrics, key=lambda item: item["t"]), source


def save_lyrics_to_project(
    source_dir: Path,
    lyrics: list[dict],
    source: str,
    *,
    load_manifest: Callable[[Path], dict],
    write_manifest: Callable[[Path, dict], None],
) -> None:
    manifest = load_manifest(source_dir)
    cleaned: list[dict] = []
    for idx, item in enumerate(lyrics):
        try:
            t = round(max(0.0, float(item.get("t", 0) or 0)), 3)
            d = round(max(0.05, float(item.get("d", 0.5) or 0.5)), 3)
        except Exception:
            continue
        text = str(item.get("w", "")).strip()
        if text:
            cleaned.append({"id": str(item.get("id") or f"lyric-{idx}"), "t": t, "d": d, "w": text})
    if cleaned:
        (source_dir / "lyrics.json").write_text(json.dumps(cleaned, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        manifest["lyrics"] = "lyrics.json"
        manifest["lyrics_source"] = source
    else:
        manifest.pop("lyrics", None)
        manifest.pop("lyrics_source", None)
    write_manifest(source_dir, manifest)
