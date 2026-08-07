from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class ArrangementAutoSyncJobsDeps:
    jobs: dict[str, dict[str, Any]]
    projects_by_id: dict[str, Path]
    load_manifest: Callable[[Path], dict]
    write_manifest: Callable[[Path, dict], None]
    load_arrangement_wire: Callable[[Path, str], dict]
    project_stem_path: Callable[[Path, dict, str | None], tuple[Path | None, str]]
    read_json_if_exists: Callable[[Path, Any], Any]
    pack_working_sloppack: Callable[..., Path]
    build_project: Callable[..., dict]
    project_original_save_path: Callable[..., Path]
    librosa_module: Any
    numpy_module: Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except Exception:
        return default
    if not math.isfinite(out):
        return default
    return out


def _compress_onsets(onsets: list[float], min_separation: float = 0.06) -> list[float]:
    if not onsets:
        return []
    cleaned = sorted(t for t in onsets if t >= 0.0)
    out: list[float] = []
    last = -1e9
    for t in cleaned:
        if t - last >= min_separation:
            out.append(t)
            last = t
    return out


def _collect_arrangement_onsets(arrangement_wire: dict) -> list[float]:
    onsets: list[float] = []
    for note in arrangement_wire.get("notes", []) or []:
        if not isinstance(note, dict):
            continue
        onsets.append(_safe_float(note.get("t"), -1.0))
    for chord in arrangement_wire.get("chords", []) or []:
        if not isinstance(chord, dict):
            continue
        onsets.append(_safe_float(chord.get("t"), -1.0))
    return _compress_onsets(onsets)


def _alignment_candidates(reference_onsets: list[float], duration: float) -> tuple[list[float], list[float]]:
    search_seconds = max(2.0, min(10.0, duration * 0.08))
    # Small tempo drift helps when arrangement timing and stem tracking differ.
    scales = [0.97 + i * 0.005 for i in range(13)]
    shifts = [(-search_seconds + i * 0.04) for i in range(int((search_seconds * 2) / 0.04) + 1)]
    # When references are sparse, keep a tighter shift search to avoid false positives.
    if len(reference_onsets) < 24:
        shifts = [(-search_seconds + i * 0.02) for i in range(int((search_seconds * 2) / 0.02) + 1)]
    return scales, shifts


def _estimate_scale_and_shift(
    reference_onsets: list[float],
    onset_envelope: Any,
    frame_seconds: float,
    duration: float,
    *,
    numpy_module: Any,
) -> tuple[float, float, float]:
    np = numpy_module
    env = np.asarray(onset_envelope, dtype=np.float32)
    if env.size < 16:
        raise RuntimeError("Stem onset analysis produced too few samples")

    env = np.maximum(env, 0.0)
    p95 = float(np.percentile(env, 95)) if env.size else 0.0
    if p95 <= 1e-9:
        raise RuntimeError("Stem onset analysis has no usable signal")
    env = env / p95

    scales, shifts = _alignment_candidates(reference_onsets, duration)
    min_hits = max(8, min(len(reference_onsets), int(len(reference_onsets) * 0.22)))

    best_score = -1e9
    best_scale = 1.0
    best_shift = 0.0

    for scale in scales:
        scaled = np.asarray(reference_onsets, dtype=np.float32) * float(scale)
        for shift in shifts:
            mapped = scaled + float(shift)
            valid = mapped[(mapped >= 0.0) & (mapped <= duration)]
            if valid.size < min_hits:
                continue

            indices = np.rint(valid / frame_seconds).astype(np.int32)
            indices = np.clip(indices, 0, env.size - 1)
            left = np.clip(indices - 1, 0, env.size - 1)
            right = np.clip(indices + 1, 0, env.size - 1)
            strength = np.maximum(env[indices], np.maximum(env[left], env[right]))

            score = float(np.mean(strength))
            score -= abs(float(shift)) * 0.003
            score -= abs(float(scale) - 1.0) * 0.2

            if score > best_score:
                best_score = score
                best_scale = float(scale)
                best_shift = float(shift)

    if best_score <= -1e8:
        raise RuntimeError("Could not align arrangement onsets to the selected stem")

    return best_scale, best_shift, best_score


def _transform_time(value: Any, scale: float, shift: float) -> float:
    t = _safe_float(value, 0.0)
    return round(max(0.0, t * scale + shift), 3)


def _transform_beatgrid(beatgrid: list[dict], scale: float, shift: float) -> list[dict]:
    transformed: list[dict] = []
    for item in beatgrid:
        if not isinstance(item, dict):
            continue
        transformed.append(
            {
                "id": str(item.get("id") or f"beat-{len(transformed) + 1}"),
                "beatIndex": int(_safe_float(item.get("beatIndex"), len(transformed) + 1)),
                "bar": int(_safe_float(item.get("bar"), 1)),
                "beat": int(_safe_float(item.get("beat"), 1)),
                "time": _transform_time(item.get("time"), scale, shift),
            }
        )
    transformed.sort(key=lambda x: x["time"])
    return transformed[:20000]


def _transform_sync_points(sync_points: list[dict], scale: float, shift: float) -> list[dict]:
    transformed: list[dict] = []
    for item in sync_points:
        if not isinstance(item, dict):
            continue
        transformed.append(
            {
                "id": str(item.get("id") or f"bar-{len(transformed) + 1}"),
                "bar": int(_safe_float(item.get("bar"), len(transformed) + 1)),
                "beat": int(_safe_float(item.get("beat"), 1)),
                "time": _transform_time(item.get("time"), scale, shift),
            }
        )
    transformed.sort(key=lambda x: x["time"])
    return transformed[:400]


def _transform_tempo_map(tempo_map: list[dict], scale: float, shift: float) -> list[dict]:
    safe_scale = scale if abs(scale) > 1e-6 else 1.0
    transformed: list[dict] = []
    for item in tempo_map:
        if not isinstance(item, dict):
            continue
        bpm = _safe_float(item.get("bpm"), 120.0)
        transformed.append(
            {
                "id": str(item.get("id") or f"tempo-{len(transformed) + 1}"),
                "beatIndex": int(_safe_float(item.get("beatIndex"), len(transformed) + 1)),
                "bar": int(_safe_float(item.get("bar"), 1)),
                "beat": int(_safe_float(item.get("beat"), 1)),
                "time": _transform_time(item.get("time"), scale, shift),
                "bpm": round(max(1.0, bpm / safe_scale), 3),
            }
        )
    transformed.sort(key=lambda x: x["time"])
    return transformed[:20000]


def _median_bpm_from_beatgrid(beatgrid: list[dict], fallback: float) -> float:
    times = [_safe_float(item.get("time"), -1.0) for item in beatgrid if isinstance(item, dict)]
    times = [t for t in times if t >= 0.0]
    times.sort()
    diffs = [b - a for a, b in zip(times, times[1:]) if 0.12 <= (b - a) <= 3.0]
    if not diffs:
        return round(fallback, 3)
    diffs.sort()
    median = diffs[len(diffs) // 2]
    if median <= 0:
        return round(fallback, 3)
    return round(60.0 / median, 3)


def build_arrangement_autosync_processor(deps: ArrangementAutoSyncJobsDeps) -> Callable[..., None]:
    def process_arrangement_autosync_job(
        job_id: str,
        project_id: str,
        arrangement_id: str,
        stem_id: str,
    ) -> None:
        job = deps.jobs[job_id]
        try:
            source_dir = deps.projects_by_id.get(project_id)
            if not source_dir:
                raise RuntimeError("Project not found")

            if deps.librosa_module is None or deps.numpy_module is None:
                raise RuntimeError("AutoSync requires librosa and numpy in the backend runtime")

            manifest = deps.load_manifest(source_dir)

            entry = next(
                (
                    item
                    for item in (manifest.get("arrangements") or [])
                    if isinstance(item, dict) and str(item.get("id") or "") == str(arrangement_id)
                ),
                None,
            )
            if not isinstance(entry, dict):
                raise RuntimeError("Selected arrangement was not found")

            rel = str(entry.get("file") or "").strip()
            if not rel:
                raise RuntimeError("Selected arrangement has no file path")
            wire = deps.load_arrangement_wire(source_dir, rel)

            reference_onsets = _collect_arrangement_onsets(wire)
            if len(reference_onsets) < 8:
                raise RuntimeError("Selected arrangement has too few note onsets for AutoSync")

            stem_audio_path, resolved_stem_id = deps.project_stem_path(source_dir, manifest, stem_id)
            if stem_audio_path is None:
                raise RuntimeError("Selected stem was not found in the project")

            job.update(status="running", step=f"Analysing stem onsets from {resolved_stem_id}", progress=18)
            librosa = deps.librosa_module
            np = deps.numpy_module
            y, sr = librosa.load(str(stem_audio_path), sr=22050, mono=True)
            if y is None or len(y) == 0:
                raise RuntimeError("Selected stem audio is empty")

            hop_length = 512
            onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
            duration = float(librosa.get_duration(y=y, sr=sr) or 0.0)
            if duration <= 0:
                raise RuntimeError("Could not determine stem duration for AutoSync")

            frame_seconds = float(hop_length) / float(sr)
            job.update(status="running", step="Matching arrangement onsets to stem", progress=54)
            scale, shift, score = _estimate_scale_and_shift(
                reference_onsets,
                onset_env,
                frame_seconds,
                duration,
                numpy_module=np,
            )

            project_snapshot = deps.build_project(project_id, source_dir, selected_arrangement=arrangement_id)
            beatgrid = project_snapshot.get("beatgrid") if isinstance(project_snapshot, dict) else None
            sync_points = project_snapshot.get("syncPoints") if isinstance(project_snapshot, dict) else None
            tempo_map = project_snapshot.get("tempoMap") if isinstance(project_snapshot, dict) else None
            if not isinstance(beatgrid, list) or len(beatgrid) < 2:
                raise RuntimeError("AutoSync requires an existing beatgrid with at least two beats")
            if not isinstance(sync_points, list) or not sync_points:
                raise RuntimeError("AutoSync requires existing sync points")
            if not isinstance(tempo_map, list):
                tempo_map = []

            job.update(status="running", step="Applying arrangement-aware sync transform", progress=76)
            transformed_beatgrid = _transform_beatgrid(beatgrid, scale, shift)
            transformed_sync_points = _transform_sync_points(sync_points, scale, shift)
            transformed_tempo_map = _transform_tempo_map(tempo_map, scale, shift)

            if not transformed_beatgrid:
                raise RuntimeError("AutoSync produced an empty beatgrid")
            if not transformed_sync_points:
                transformed_sync_points = [
                    {
                        "id": "bar-1",
                        "bar": 1,
                        "beat": 1,
                        "time": transformed_beatgrid[0]["time"],
                    }
                ]

            sync_dir = source_dir / "sync"
            sync_dir.mkdir(parents=True, exist_ok=True)
            (sync_dir / "beatgrid.json").write_text(json.dumps(transformed_beatgrid, indent=2), encoding="utf-8")
            (sync_dir / "syncpoints.json").write_text(json.dumps(transformed_sync_points[:400], indent=2), encoding="utf-8")
            (sync_dir / "tempoMap.json").write_text(json.dumps(transformed_tempo_map, indent=2), encoding="utf-8")

            original_bpm = _safe_float(manifest.get("bpm"), 120.0)
            adjusted_bpm = _median_bpm_from_beatgrid(transformed_beatgrid, fallback=max(1.0, original_bpm / max(scale, 0.001)))

            analysis_payload = {
                "mode": "arrangement-stem-auto-sync",
                "source": resolved_stem_id,
                "arrangementId": arrangement_id,
                "arrangementName": str(entry.get("name") or arrangement_id),
                "scale": round(scale, 6),
                "offsetSeconds": round(shift, 6),
                "score": round(float(score), 6),
                "bpm": adjusted_bpm,
                "warning": "",
            }
            (sync_dir / "analysis.json").write_text(json.dumps(analysis_payload, indent=2), encoding="utf-8")

            manifest["bpm"] = adjusted_bpm
            manifest["sync"] = {
                "mode": "arrangement-stem-auto-sync",
                "source": resolved_stem_id,
                "arrangementId": arrangement_id,
                "beatgrid": "sync/beatgrid.json",
                "syncPoints": "sync/syncpoints.json",
                "tempoMap": "sync/tempoMap.json",
                "analysis": "sync/analysis.json",
                "warning": "",
            }
            deps.write_manifest(source_dir, manifest)

            previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
            working_path = deps.pack_working_sloppack(
                source_dir,
                previous_project if isinstance(previous_project, dict) else None,
            )
            updated = deps.build_project(project_id, source_dir, selected_arrangement=arrangement_id)
            original_path = deps.project_original_save_path(
                source_dir,
                previous_project if isinstance(previous_project, dict) else None,
            )
            updated["feedpakPath"] = str(original_path)
            updated["originalFeedpakPath"] = str(original_path)
            updated["workingFeedpakPath"] = str(working_path)
            updated["hasUncommittedChanges"] = True
            (source_dir.parent / "project.json").write_text(
                json.dumps(updated, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            job.update(
                status="done",
                step=f"AutoSync applied for {entry.get('name') or arrangement_id} vs {resolved_stem_id}",
                progress=100,
                project=updated,
            )
        except Exception as exc:
            job.update(status="error", step="Arrangement AutoSync failed", error=str(exc), progress=100)

    return process_arrangement_autosync_job
