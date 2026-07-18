from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Optional


def median_bpm_from_times(times: list[float], fallback: float = 120.0) -> float:
    diffs = [b - a for a, b in zip(times, times[1:]) if 0.12 <= (b - a) <= 3.0]
    if not diffs:
        return fallback
    diffs_sorted = sorted(diffs)
    median = diffs_sorted[len(diffs_sorted) // 2]
    if median <= 0:
        return fallback
    return round(60.0 / median, 3)


def sync_structures_from_beat_times(
    beat_times: list[float],
    beats_per_bar: int = 4,
) -> tuple[list[dict], list[dict], list[dict], float]:
    clean_times = [round(float(t), 6) for t in beat_times if float(t) >= 0]
    bpm = median_bpm_from_times(clean_times)
    beatgrid: list[dict] = []
    sync_points: list[dict] = []
    tempo_map: list[dict] = []

    for idx, t in enumerate(clean_times):
        beat_in_bar = (idx % beats_per_bar) + 1
        bar = (idx // beats_per_bar) + 1
        beatgrid.append(
            {
                "id": f"beat-{idx + 1}",
                "beatIndex": idx + 1,
                "bar": bar,
                "beat": beat_in_bar,
                "time": round(t, 3),
            }
        )
        if beat_in_bar == 1:
            sync_points.append({"id": f"bar-{bar}", "bar": bar, "beat": 1, "time": round(t, 3)})
        if idx < len(clean_times) - 1:
            gap = clean_times[idx + 1] - t
            local_bpm = round(60.0 / gap, 3) if gap > 0 else bpm
            tempo_map.append(
                {
                    "id": f"tempo-{idx + 1}",
                    "beatIndex": idx + 1,
                    "bar": bar,
                    "beat": beat_in_bar,
                    "time": round(t, 3),
                    "bpm": local_bpm,
                }
            )

    if clean_times and not sync_points:
        sync_points = [{"id": "bar-1", "bar": 1, "beat": 1, "time": round(clean_times[0], 3)}]
    if not clean_times:
        beatgrid = [{"id": "beat-1", "beatIndex": 1, "bar": 1, "beat": 1, "time": 0.0}]
        sync_points = [{"id": "bar-1", "bar": 1, "beat": 1, "time": 0.0}]
        tempo_map = [{"id": "tempo-1", "beatIndex": 1, "bar": 1, "beat": 1, "time": 0.0, "bpm": bpm}]

    return beatgrid, sync_points, tempo_map, bpm


def choose_audio_for_mp3_sync(source_dir: Path) -> tuple[Path | None, str]:
    """Use drums stem for beat tracking when available; otherwise use full mix."""
    candidates = [
        ("drums", source_dir / "stems" / "drums.ogg"),
        ("drums", source_dir / "stems" / "drums.wav"),
        ("full", source_dir / "stems" / "full.ogg"),
        ("full", source_dir / "stems" / "full.wav"),
        ("full", source_dir / "audio.ogg"),
        ("full", source_dir / "audio.wav"),
    ]
    for label, path in candidates:
        if path.exists() and path.is_file() and path.stat().st_size > 100:
            return path, label
    return None, "none"


def generate_mp3_sync_files(
    source_dir: Path,
    *,
    estimate_duration: Callable[[Path], float],
    load_manifest: Callable[[Path], dict],
    write_manifest: Callable[[Path, dict], None],
    librosa_module: Any,
    numpy_module: Any,
    job: Optional[dict[str, Any]] = None,
    beats_per_bar: int = 4,
) -> dict:
    sync_dir = source_dir / "sync"
    sync_dir.mkdir(parents=True, exist_ok=True)

    audio_path, source_label = choose_audio_for_mp3_sync(source_dir)
    fallback_duration = estimate_duration(source_dir)
    warning = ""
    beat_times: list[float] = []

    if audio_path is None:
        warning = "No audio was found to estimate synchronization. A 120 BPM fallback grid was created."
    elif librosa_module is None or numpy_module is None:
        warning = "librosa/numpy non installati. Creata griglia fallback a 120 BPM."
    else:
        try:
            if job:
                job.update(step=f"Analizzo beat su {source_label}.ogg", progress=max(int(job.get("progress", 0)), 88))
            y, sr = librosa_module.load(str(audio_path), sr=22050, mono=True)
            duration = float(librosa_module.get_duration(y=y, sr=sr) or fallback_duration)
            if len(y) > 0:
                onset_env = librosa_module.onset.onset_strength(y=y, sr=sr)
                tempo, beat_frames = librosa_module.beat.beat_track(y=y, sr=sr, onset_envelope=onset_env, units="frames")
                times = librosa_module.frames_to_time(beat_frames, sr=sr)
                beat_times = [float(t) for t in times if 0 <= float(t) <= max(duration, fallback_duration) + 0.5]
                if len(beat_times) < 4:
                    warning = "Beat tracking automatico debole: creata griglia fallback a BPM stimato."
                    tempo_value = float(tempo[0] if hasattr(tempo, "__len__") else tempo) if tempo else 120.0
                    step = 60.0 / max(1.0, tempo_value)
                    beat_times = [round(i * step, 6) for i in range(max(1, int(duration / step)))]
        except Exception as exc:
            warning = f"Beat tracking non riuscito ({exc}). Creata griglia fallback a 120 BPM."

    if not beat_times:
        step = 60.0 / 120.0
        beat_times = [round(i * step, 6) for i in range(max(1, int(fallback_duration / step)))]

    beatgrid, sync_points, tempo_map, bpm = sync_structures_from_beat_times(beat_times, beats_per_bar=beats_per_bar)
    payload = {
        "source": source_label,
        "algorithm": "librosa.beat_track" if not warning and source_label != "none" else "fallback-fixed-grid",
        "warning": warning,
        "bpm": bpm,
        "beatsPerBar": beats_per_bar,
        "beatgrid": beatgrid,
        "syncPoints": sync_points[:400],
        "tempoMap": tempo_map,
    }

    (sync_dir / "beatgrid.json").write_text(json.dumps(beatgrid, indent=2), encoding="utf-8")
    (sync_dir / "syncpoints.json").write_text(json.dumps(sync_points[:400], indent=2), encoding="utf-8")
    (sync_dir / "tempoMap.json").write_text(json.dumps(tempo_map, indent=2), encoding="utf-8")
    (sync_dir / "analysis.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    try:
        manifest = load_manifest(source_dir)
        manifest["bpm"] = bpm
        manifest["sync"] = {
            "mode": "auto-mp3-beat-tracking",
            "source": source_label,
            "beatgrid": "sync/beatgrid.json",
            "syncPoints": "sync/syncpoints.json",
            "tempoMap": "sync/tempoMap.json",
            "analysis": "sync/analysis.json",
            "warning": warning,
        }
        write_manifest(source_dir, manifest)
    except Exception:
        pass

    return payload
