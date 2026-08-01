from __future__ import annotations

import base64
import datetime
import io
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.api_models import (
    DuplicateArrangementRequest,
    ExportArrangementRequest,
    NotationPdfExportRequest,
    RenameArrangementRequest,
)
from app.runtime_state import UPLOADS, projects_by_id


DRUM_TAB_ARRANGEMENT_ID = "__drum_tab__"
DEFAULT_DRUM_TAB_REL = "drum_tab.json"
MIDI_SUFFIXES = {".mid", ".midi"}
GP_SUFFIXES = {".gp5", ".gp4", ".gp3", ".gpx", ".gp"}


@dataclass(frozen=True)
class ProjectsRouterDeps:
    parse_lrc_or_plain_text: Callable[..., Any]
    sync_plain_lyrics_to_audio: Callable[..., Any]
    save_lyrics_to_project: Callable[..., Any]
    build_project: Callable[..., Any]
    pack_working_sloppack: Callable[..., Any]
    project_original_save_path: Callable[..., Any]
    persist_project_to_workdir: Callable[..., Any]
    pack_current_sloppack: Callable[..., Any]
    unpack_sloppack: Callable[..., Any]
    remember_save_path: Callable[..., Any]
    remember_working_save_path: Callable[..., Any]
    gp_to_wire_direct: Callable[..., Any]
    simple_midi_to_wire: Callable[..., Any]
    current_arrangement_entry: Callable[..., Any]
    infer_arrangement_type: Callable[..., Any]
    load_arrangement_wire: Callable[..., Any]
    sanitize_windows_name: Callable[..., Any]
    write_midi_from_frontend_notes: Callable[..., Any]
    write_musicxml_from_frontend_notes: Callable[..., Any]
    read_json_if_exists: Callable[..., Any]
    load_manifest: Callable[..., Any]
    write_manifest: Callable[..., Any]


def _resolve_source_relative_path(source_dir: Path, rel: str) -> Path | None:
    if not rel:
        return None
    try:
        target = (source_dir / rel).resolve()
        target.relative_to(source_dir.resolve())
        return target
    except Exception:
        return None


def _midi_to_drum_tab(midi_path: Path, name: str, track_index: int = -1) -> dict:
    try:
        from midi_import import convert_drum_track_from_midi, list_drum_tracks  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"Drum MIDI conversion is unavailable: {exc}")

    tracks = list_drum_tracks(str(midi_path))
    if not tracks:
        raise RuntimeError("No drum track found in MIDI file (channel 10).")

    selected_index = int(track_index) if int(track_index) >= 0 else int(tracks[0].get("index", 0))
    if int(track_index) >= 0 and not any(int(item.get("index", -1)) == selected_index for item in tracks):
        raise RuntimeError("Selected track does not contain drum notes.")

    return convert_drum_track_from_midi(
        str(midi_path),
        selected_index,
        name=(name or "Drums").strip() or "Drums",
    )


def _load_existing_drum_tab(source_dir: Path, manifest: dict) -> tuple[str, dict]:
    rel = str(manifest.get("drum_tab") or DEFAULT_DRUM_TAB_REL).strip() or DEFAULT_DRUM_TAB_REL
    payload: dict = {}
    path = _resolve_source_relative_path(source_dir, rel)
    if path is not None and path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                payload = raw
        except Exception:
            payload = {}
    return rel, payload


def _write_drum_tab(source_dir: Path, manifest: dict, rel: str, payload: dict) -> None:
    path = _resolve_source_relative_path(source_dir, rel)
    if path is None:
        raise RuntimeError("Invalid drum_tab path in manifest")
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_payload = payload if isinstance(payload, dict) else {}
    safe_payload.setdefault("version", 1)
    safe_payload.setdefault("name", "Drums")
    if not isinstance(safe_payload.get("kit"), list):
        safe_payload["kit"] = []
    if not isinstance(safe_payload.get("hits"), list):
        safe_payload["hits"] = []
    path.write_text(json.dumps(safe_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    manifest["drum_tab"] = rel


def _is_virtual_drum_arrangement(arrangement_id: str) -> bool:
    return str(arrangement_id) == DRUM_TAB_ARRANGEMENT_ID


def create_projects_router(deps: ProjectsRouterDeps) -> APIRouter:
    router = APIRouter()

    @router.post("/api/projects/{project_id}/lyrics/import-text-sync")
    async def import_text_lyrics_sync(
        project_id: str,
        lyrics_file: UploadFile | None = File(None),
        lyrics_text: str = Form(""),
        stem_id: str = Form(""),
    ) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        text = lyrics_text or ""
        if lyrics_file is not None:
            raw = await lyrics_file.read()
            for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
                try:
                    text = raw.decode(encoding)
                    break
                except Exception:
                    continue
        if not text.strip():
            raise HTTPException(status_code=400, detail="No lyric text was provided.")

        manifest = deps.load_manifest(source_dir)
        timed, plain = deps.parse_lrc_or_plain_text(text)
        if timed:
            lyrics = timed
            source = "lrc-import"
        else:
            lyrics, source = deps.sync_plain_lyrics_to_audio(plain, source_dir, manifest, stem_id or None)
        deps.save_lyrics_to_project(source_dir, lyrics, source)

        # Lyrics import/re-sync must only update the backend working copy.
        # It must never write directly to the original sloppack on disk.
        project = deps.build_project(project_id, source_dir, selected_arrangement=None)
        working_path = deps.pack_working_sloppack(source_dir, project)
        original_path = deps.project_original_save_path(source_dir, project)
        project["workingSloppackPath"] = str(working_path)
        project["sloppackPath"] = str(original_path)
        project["originalSloppackPath"] = str(original_path)
        project["hasUncommittedChanges"] = True
        (source_dir.parent / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
        return project

    @router.get("/api/projects/{project_id}/arrangements/{arrangement_id}")
    def get_arrangement(project_id: str, arrangement_id: str) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")
        return deps.build_project(project_id, source_dir, selected_arrangement=arrangement_id)

    @router.post("/api/projects/{project_id}/save")
    async def save_project(project_id: str, project: dict) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")
        deps.persist_project_to_workdir(source_dir, project)
        working_path = deps.pack_working_sloppack(source_dir, project)
        original_path = deps.project_original_save_path(source_dir, project)
        project["workingSloppackPath"] = str(working_path)
        project["sloppackPath"] = str(original_path)
        project["originalSloppackPath"] = str(original_path)
        project["hasUncommittedChanges"] = True
        (source_dir.parent / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
        return project

    @router.post("/api/projects/{project_id}/commit")
    async def commit_project(project_id: str, project: dict) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")
        deps.persist_project_to_workdir(source_dir, project)
        working_path = deps.pack_working_sloppack(source_dir, project)
        original_path = deps.pack_current_sloppack(source_dir, project)
        project["workingSloppackPath"] = str(working_path)
        project["sloppackPath"] = str(original_path)
        project["originalSloppackPath"] = str(original_path)
        project["hasUncommittedChanges"] = False
        (source_dir.parent / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
        return project

    @router.post("/api/projects/{project_id}/discard")
    async def discard_project_changes(project_id: str, project: dict) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        project_dir = source_dir.parent
        original_path = deps.project_original_save_path(source_dir, project)
        if not original_path.exists():
            raise HTTPException(status_code=404, detail=f"Original sloppack not found: {original_path}")

        # Keep only the original target marker and, if the fallback target lives
        # inside the project folder, the original sloppack itself. Remove all
        # working artifacts before rebuilding the working directory from disk.
        try:
            original_resolved = original_path.resolve()
        except Exception:
            original_resolved = original_path
        for child in list(project_dir.iterdir()):
            try:
                child_resolved = child.resolve()
            except Exception:
                child_resolved = child
            if child.name == "save_target.txt" or child_resolved == original_resolved:
                continue
            try:
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    child.unlink(missing_ok=True)
            except Exception:
                pass

        source_dir = deps.unpack_sloppack(original_path, project_dir)
        working_path = project_dir / "working.sloppack"
        deps.remember_save_path(source_dir, original_path)
        deps.remember_working_save_path(source_dir, working_path)
        deps.pack_working_sloppack(source_dir)
        projects_by_id[project_id] = source_dir

        selected_arrangement = project.get("selectedArrangementId") if isinstance(project, dict) else None
        restored = deps.build_project(project_id, source_dir, selected_arrangement=selected_arrangement)
        restored["workingSloppackPath"] = str(working_path)
        restored["sloppackPath"] = str(original_path)
        restored["originalSloppackPath"] = str(original_path)
        restored["hasUncommittedChanges"] = False
        (project_dir / "project.json").write_text(json.dumps(restored, indent=2, ensure_ascii=False), encoding="utf-8")
        return restored

    @router.post("/api/projects/{project_id}/arrangements/import")
    async def import_arrangement(
        project_id: str,
        arrangement_file: UploadFile = File(...),
        instrument: str = Form("guitar"),
        name: str = Form("Imported"),
        gp_track_index: int = Form(-1),
    ) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        selected_arrangement = ""
        instrument_kind = str(instrument or "guitar").strip().lower()
        if instrument_kind not in {"guitar", "bass", "keys", "drums"}:
            raise HTTPException(status_code=400, detail="Instrument must be guitar, bass, keys or drums")

        suffix = Path(arrangement_file.filename or "arr").suffix.lower()
        temp = UPLOADS / f"{uuid.uuid4()}{suffix}"
        with temp.open("wb") as f:
            shutil.copyfileobj(arrangement_file.file, f)

        try:
            manifest = deps.load_manifest(source_dir)
            if instrument_kind == "drums":
                if suffix in GP_SUFFIXES:
                    raise HTTPException(status_code=400, detail="Drum import from Guitar Pro is not supported yet. Use MIDI drum tracks.")
                if suffix not in MIDI_SUFFIXES:
                    raise HTTPException(status_code=400, detail="Unsupported drum import format. Use MIDI.")

                drum_rel, existing_tab = _load_existing_drum_tab(source_dir, manifest)
                drum_name = str(existing_tab.get("name") or name or "Drums").strip() or "Drums"
                try:
                    drum_tab = _midi_to_drum_tab(temp, drum_name, gp_track_index)
                except RuntimeError as exc:
                    raise HTTPException(status_code=400, detail=str(exc))
                _write_drum_tab(source_dir, manifest, drum_rel, drum_tab)
                deps.write_manifest(source_dir, manifest)
                selected_arrangement = DRUM_TAB_ARRANGEMENT_ID
            else:
                aid = (name or f"Imported {instrument_kind}").lower().replace(" ", "_") + "_" + uuid.uuid4().hex[:6]
                arr_dir = source_dir / "arrangements"
                arr_dir.mkdir(parents=True, exist_ok=True)
                wire_instrument = "bass" if instrument_kind == "bass" else "guitar"
                if suffix in GP_SUFFIXES:
                    track_index = gp_track_index if gp_track_index >= 0 else None
                    wire = deps.gp_to_wire_direct(temp, name or f"Imported {instrument_kind}", wire_instrument, gp_track_index=track_index)
                elif suffix in MIDI_SUFFIXES:
                    wire = deps.simple_midi_to_wire(temp, name or f"Imported {instrument_kind}", wire_instrument)
                else:
                    raise HTTPException(status_code=400, detail="Unsupported arrangement format. Use MIDI or Guitar Pro 5/4/3/GPX.")

                arr_rel = f"arrangements/{aid}.json"
                (source_dir / arr_rel).write_text(json.dumps(wire, separators=(",", ":")), encoding="utf-8")
                arrs = manifest.setdefault("arrangements", [])
                tuning = wire.get("tuning", [0, 0, 0, 0, 0, 0])
                arrs.append({"id": aid, "name": wire.get("name", name), "file": arr_rel, "tuning": tuning, "capo": wire.get("capo", 0), "type": instrument_kind})
                deps.write_manifest(source_dir, manifest)
                selected_arrangement = aid
        finally:
            try:
                temp.unlink(missing_ok=True)
            except Exception:
                pass

        previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
        working_path = deps.pack_working_sloppack(source_dir, previous_project if isinstance(previous_project, dict) else None)
        updated = deps.build_project(project_id, source_dir, selected_arrangement=selected_arrangement)
        original_path = deps.project_original_save_path(source_dir, previous_project if isinstance(previous_project, dict) else None)
        updated["sloppackPath"] = str(original_path)
        updated["originalSloppackPath"] = str(original_path)
        updated["workingSloppackPath"] = str(working_path)
        updated["hasUncommittedChanges"] = True
        (source_dir.parent / "project.json").write_text(json.dumps(updated, indent=2, ensure_ascii=False), encoding="utf-8")
        return updated

    @router.post("/api/projects/{project_id}/arrangements/{arrangement_id}/export")
    async def export_arrangement(project_id: str, arrangement_id: str, request: ExportArrangementRequest) -> FileResponse:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        fmt = request.format.lower().strip()
        project = request.project or {}
        if _is_virtual_drum_arrangement(arrangement_id):
            manifest = deps.load_manifest(source_dir)
            _drum_rel, drum_tab = _load_existing_drum_tab(source_dir, manifest)
            entry = {"name": str(drum_tab.get("name") or "Drums"), "type": "drums"}
        else:
            _manifest, entry, rel = deps.current_arrangement_entry(source_dir, arrangement_id)
            _arrangement_type = deps.infer_arrangement_type(entry, deps.load_arrangement_wire(source_dir, rel))
        safe_name = deps.sanitize_windows_name(str(entry.get("name") or arrangement_id), "arrangement")
        export_dir = source_dir.parent / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)

        if fmt in ("midi", "mid"):
            out_file = export_dir / f"{safe_name}.mid"
            deps.write_midi_from_frontend_notes(project, arrangement_id, out_file)
            return FileResponse(str(out_file), media_type="audio/midi", filename=out_file.name)
        if fmt in ("musicxml", "xml", "mxl"):
            out_file = export_dir / f"{safe_name}.musicxml"
            deps.write_musicxml_from_frontend_notes(project, arrangement_id, out_file, str(entry.get("name") or safe_name))
            return FileResponse(str(out_file), media_type="application/vnd.recordare.musicxml+xml", filename=out_file.name)
        if fmt in ("guitarpro", "gp", "gp5"):
            raise HTTPException(status_code=400, detail="Native Guitar Pro export is not available in the bundled libraries. Use Export MIDI or Export MusicXML and import it into Guitar Pro.")
        raise HTTPException(status_code=400, detail="Unsupported export format")

    @router.post("/api/projects/{project_id}/arrangements/{arrangement_id}/notation-pdf")
    async def export_notation_pdf(project_id: str, arrangement_id: str, request: NotationPdfExportRequest) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        if not request.score_svgs:
            raise HTTPException(status_code=400, detail="No score SVG pages provided for PDF export")

        try:
            from reportlab.graphics import renderPDF
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.units import mm
            from reportlab.lib.utils import ImageReader
            from reportlab.pdfgen import canvas as pdf_canvas
            from svglib.svglib import svg2rlg
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=(
                    "PDF dependencies are missing. Install reportlab and svglib in backend environment. "
                    f"({exc})"
                ),
            )

        if _is_virtual_drum_arrangement(arrangement_id):
            manifest = deps.load_manifest(source_dir)
            _drum_rel, drum_tab = _load_existing_drum_tab(source_dir, manifest)
            entry = {"name": str(drum_tab.get("name") or "Drums")}
        else:
            _manifest, entry, _rel = deps.current_arrangement_entry(source_dir, arrangement_id)
        safe_name = deps.sanitize_windows_name(str(entry.get("name") or arrangement_id), "arrangement")
        export_dir = source_dir.parent / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        out_file = export_dir / f"{safe_name}-{stamp}.pdf"

        page_width, page_height = A4
        margin = 2.5 * mm
        printable_width = page_width - (2 * margin)
        printable_height = page_height - (2 * margin)
        gap = 2.5 * mm

        pdf = pdf_canvas.Canvas(str(out_file), pagesize=A4, pageCompression=1)
        cursor_y = page_height - margin

        def normalize_score_svg(raw_markup: str) -> str:
            markup = (raw_markup or "").strip()
            if not markup or "<svg" not in markup:
                return ""
            if "xmlns=" not in markup:
                markup = markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
            return markup

        def _collect_leaf_y_bounds(node: Any, out: list[tuple[float, float]], max_y: float) -> None:
            children = getattr(node, "contents", None)
            if children:
                for child in children:
                    _collect_leaf_y_bounds(child, out, max_y)
                return
            get_bounds = getattr(node, "getBounds", None)
            if not callable(get_bounds):
                return
            try:
                bounds = get_bounds()
            except Exception:
                return
            if not bounds or len(bounds) != 4:
                return
            _x1, y1, _x2, y2 = bounds
            lo = max(0.0, float(min(y1, y2)))
            hi = min(max_y, float(max(y1, y2)))
            if hi - lo > 0.3:
                out.append((lo, hi))

        def _merge_intervals(intervals: list[tuple[float, float]], eps: float = 0.7) -> list[tuple[float, float]]:
            if not intervals:
                return []
            ordered = sorted(intervals, key=lambda item: item[0])
            merged: list[tuple[float, float]] = []
            cur_lo, cur_hi = ordered[0]
            for lo, hi in ordered[1:]:
                if lo <= cur_hi + eps:
                    cur_hi = max(cur_hi, hi)
                else:
                    merged.append((cur_lo, cur_hi))
                    cur_lo, cur_hi = lo, hi
            merged.append((cur_lo, cur_hi))
            return merged

        def detect_system_groups(drawing: Any, src_h: float) -> tuple[list[tuple[float, float]], dict[str, Any]]:
            debug: dict[str, Any] = {
                "srcHeight": round(float(src_h), 3),
                "bandCount": 0,
                "groupCount": 0,
                "fallback": "none",
            }
            intervals: list[tuple[float, float]] = []
            _collect_leaf_y_bounds(drawing, intervals, src_h)
            merged = _merge_intervals(intervals)
            if not merged:
                debug["fallback"] = "no-merged-intervals"
                return [], debug

            min_band_h = max(3.0, src_h * 0.004)
            bands = [(lo, hi) for lo, hi in merged if (hi - lo) >= min_band_h]
            debug["bandCount"] = len(bands)
            if len(bands) < 2:
                debug["fallback"] = "single-band"
                return [(0.0, src_h)], debug

            gaps = [max(0.0, bands[i + 1][0] - bands[i][1]) for i in range(len(bands) - 1)]
            positive_gaps = [gap for gap in gaps if gap > 0.0]
            if not positive_gaps:
                debug["fallback"] = "no-positive-gaps"
                return [(0.0, src_h)], debug

            median_gap = statistics.median(positive_gaps)
            # Separate systems on gaps moderately larger than the typical intra-system spacing.
            gap_threshold = max(6.0, median_gap * 1.25)
            debug["medianGap"] = round(float(median_gap), 3)
            debug["gapThreshold"] = round(float(gap_threshold), 3)

            groups: list[tuple[float, float]] = []
            cur_lo, cur_hi = bands[0]
            for idx in range(1, len(bands)):
                lo, hi = bands[idx]
                gap = lo - cur_hi
                if gap >= gap_threshold:
                    groups.append((cur_lo, cur_hi))
                    cur_lo, cur_hi = lo, hi
                else:
                    cur_hi = max(cur_hi, hi)
            groups.append((cur_lo, cur_hi))

            # Recovery path: if heuristic collapses to a single large group,
            # split it on strongest vertical gaps to avoid false full-page blocks.
            if len(groups) == 1 and len(bands) >= 4:
                indexed_gaps = sorted(
                    ((gap, idx) for idx, gap in enumerate(gaps)),
                    key=lambda item: item[0],
                    reverse=True,
                )
                sep_threshold = max(6.0, median_gap * 1.1)
                separators = sorted(idx for gap, idx in indexed_gaps if gap >= sep_threshold)
                if not separators:
                    top_n = min(3, len(indexed_gaps))
                    separators = sorted(idx for _gap, idx in indexed_gaps[:top_n])

                if separators:
                    rebuilt: list[tuple[float, float]] = []
                    start = 0
                    for sep_idx in separators:
                        rebuilt.append((bands[start][0], bands[sep_idx][1]))
                        start = sep_idx + 1
                    rebuilt.append((bands[start][0], bands[-1][1]))
                    groups = rebuilt
                    debug["fallback"] = "largest-gap-split"
                    debug["separatorCount"] = len(separators)

            # If heuristic is noisy, coarsen by merging nearest neighboring groups
            # instead of collapsing into a single giant block.
            while len(groups) > 8:
                smallest_gap = float("inf")
                merge_index = -1
                for idx in range(len(groups) - 1):
                    gap = groups[idx + 1][0] - groups[idx][1]
                    if gap < smallest_gap:
                        smallest_gap = gap
                        merge_index = idx
                if merge_index < 0:
                    break
                lo = groups[merge_index][0]
                hi = groups[merge_index + 1][1]
                groups = groups[:merge_index] + [(lo, hi)] + groups[merge_index + 2:]

            min_group_h = max(10.0, src_h * 0.12)
            normalized = [(max(0.0, lo), min(src_h, hi)) for lo, hi in groups if (hi - lo) >= min_group_h]
            if not normalized:
                debug["fallback"] = "no-normalized-groups"
                return [(0.0, src_h)], debug

            debug["groupCount"] = len(normalized)
            debug["groupHeights"] = [round(float(hi - lo), 3) for lo, hi in normalized]
            return normalized, debug

        def build_system_segments(
            groups_top_to_bottom: list[tuple[float, float]],
            src_h: float,
            first_page_max_src_h: float,
            full_page_max_src_h: float,
        ) -> tuple[list[tuple[float, float]], dict[str, Any]]:
            debug: dict[str, Any] = {
                "pairingApplied": False,
                "unitCount": 0,
            }
            if not groups_top_to_bottom:
                return [(0.0, src_h)], debug

            # If detector yields many short bands, they are usually staff/tab halves.
            # Pair consecutive bands to enforce notation+TAB atomicity.
            group_heights = [max(0.0, hi - lo) for lo, hi in groups_top_to_bottom]
            median_group_h = statistics.median(group_heights) if group_heights else src_h
            should_pair = len(groups_top_to_bottom) >= 4 and median_group_h < (src_h * 0.20)

            units: list[tuple[float, float]] = []
            if should_pair:
                debug["pairingApplied"] = True
                idx = 0
                while idx < len(groups_top_to_bottom):
                    lo_a, hi_a = groups_top_to_bottom[idx]
                    if idx + 1 < len(groups_top_to_bottom):
                        lo_b, hi_b = groups_top_to_bottom[idx + 1]
                        units.append((min(lo_a, lo_b), max(hi_a, hi_b)))
                        idx += 2
                    else:
                        if units:
                            prev_lo, prev_hi = units[-1]
                            units[-1] = (min(prev_lo, lo_a), max(prev_hi, hi_a))
                        else:
                            units.append((lo_a, hi_a))
                        idx += 1
            else:
                units = [(lo, hi) for lo, hi in groups_top_to_bottom]

            if not units:
                return [(0.0, src_h)], debug
            debug["unitCount"] = len(units)
            debug["unitHeights"] = [round(float(max(0.0, hi - lo)), 3) for lo, hi in units]

            segments: list[tuple[float, float]] = []
            i = 0
            while i < len(units):
                max_src_h = first_page_max_src_h if not segments else full_page_max_src_h
                max_src_h = max(1.0, float(max_src_h))

                j = i
                chosen_j = i
                while j < len(units):
                    segment_top = units[i][1]
                    segment_bottom = units[j][0]
                    segment_h = max(0.0, segment_top - segment_bottom)
                    if segment_h <= max_src_h + 0.01 or j == i:
                        chosen_j = j
                        j += 1
                        continue
                    break

                segment_top = units[i][1]
                segment_bottom = units[chosen_j][0]
                segments.append((segment_bottom, segment_top))
                i = chosen_j + 1

            return (segments or [(0.0, src_h)]), debug

        def draw_svg_slice(
            drawing: Any,
            *,
            scale: float,
            draw_x: float,
            render_w: float,
            cursor_top_y: float,
            slice_bottom_src: float,
            slice_top_src: float,
        ) -> float:
            src_h_slice = max(0.0, slice_top_src - slice_bottom_src)
            render_h_slice = src_h_slice * scale
            draw_y = cursor_top_y - render_h_slice

            pdf.saveState()
            clip_path = pdf.beginPath()
            clip_path.rect(draw_x, draw_y, render_w, render_h_slice)
            pdf.clipPath(clip_path, stroke=0, fill=0)
            pdf.translate(draw_x, draw_y - (slice_bottom_src * scale))
            pdf.scale(scale, scale)
            renderPDF.draw(drawing, pdf, 0, 0)
            pdf.restoreState()
            return render_h_slice

        def ensure_room(required_height: float) -> None:
            nonlocal cursor_y
            if cursor_y - required_height < margin:
                pdf.showPage()
                cursor_y = page_height - margin

        def draw_centered_text(text: str, size: int, bold: bool = False) -> None:
            nonlocal cursor_y
            if not text.strip():
                return
            font = "Helvetica-Bold" if bold else "Helvetica"
            line_height = max(9, int(size * 1.2))
            ensure_room(line_height)
            pdf.setFont(font, size)
            pdf.drawCentredString(page_width / 2, cursor_y - line_height + 2, text.strip())
            cursor_y -= line_height

        def draw_header_block() -> None:
            nonlocal cursor_y
            title = (request.title or "Untitled").strip()
            album = (request.album or "").strip()
            year = (request.year or "").strip()
            arrangement_label = (request.arrangement_name or "").strip()
            bpm_text = f"Tempo {int(round(request.bpm or 0))} BPM" if request.bpm else ""
            meter_text = ""
            if request.meter and len(request.meter) >= 2:
                meter_text = f"Meter {request.meter[0]}/{request.meter[1]}"

            draw_centered_text(title, 14, bold=True)
            if album or year:
                album_row = album
                if year:
                    album_row = f"{album_row} ({year})" if album_row else year
                draw_centered_text(album_row, 7, bold=False)

            meta_parts = [part for part in [arrangement_label, bpm_text, meter_text] if part]
            if meta_parts:
                draw_centered_text("   |   ".join(meta_parts), 7, bold=False)
            cursor_y -= 1 * mm

        def draw_header_image(data_url: str) -> None:
            nonlocal cursor_y
            match = re.match(r"^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$", data_url)
            if not match:
                return
            try:
                raw = base64.b64decode(match.group(1), validate=True)
                image = ImageReader(io.BytesIO(raw))
                img_w, img_h = image.getSize()
                if img_w <= 0 or img_h <= 0:
                    return
                draw_w = printable_width
                draw_h = draw_w * (img_h / img_w)
                # Keep chord diagrams at a fixed visual size, independent from notation zoom.
                max_h = printable_height * 0.50
                if draw_h > max_h:
                    scale = max_h / draw_h
                    draw_w *= scale
                    draw_h *= scale
                ensure_room(draw_h + gap)
                x = margin + (printable_width - draw_w) / 2
                y = cursor_y - draw_h
                pdf.drawImage(image, x, y, width=draw_w, height=draw_h, preserveAspectRatio=True, anchor="sw")
                cursor_y -= draw_h + gap
            except Exception:
                return

        draw_header_block()
        if request.header_png_data_url:
            draw_header_image(request.header_png_data_url)

        debug_pages: list[dict[str, Any]] = []
        score_pages = list(request.score_svgs)
        global_fit_ratio: float | None = None
        for page_index, svg_markup in enumerate(score_pages):
            markup = normalize_score_svg(svg_markup)
            if not markup:
                continue

            drawing = svg2rlg(io.StringIO(markup))
            if drawing is None:
                continue

            src_w = float(getattr(drawing, "width", 0) or 0)
            src_h = float(getattr(drawing, "height", 0) or 0)
            if src_w <= 0 or src_h <= 0:
                continue

            # Deterministic flow: render each incoming SVG atomically and optionally
            # shrink it to fit the currently available space (e.g. below chord block).
            base_scale = printable_width / src_w
            base_render_w = printable_width
            base_render_h = src_h * base_scale

            available_h = cursor_y - margin
            forced_page_break_before = False

            if global_fit_ratio is None:
                if available_h < printable_height - 0.1:
                    global_fit_ratio = min(1.0, available_h / max(base_render_h, 1e-6))
                else:
                    global_fit_ratio = 1.0

            target_fit_ratio = max(0.1, float(global_fit_ratio or 1.0))
            target_render_h = base_render_h * target_fit_ratio
            if target_render_h > available_h + 0.1:
                pdf.showPage()
                cursor_y = page_height - margin
                available_h = cursor_y - margin
                forced_page_break_before = True
            fit_ratio = target_fit_ratio
            if base_render_h * fit_ratio > available_h + 0.1:
                fit_ratio = max(0.1, available_h / max(base_render_h, 1e-6))

            # Keep horizontal margins identical to chord diagrams; only compress vertically.
            use_scale_x = base_scale
            use_scale_y = base_scale * max(0.1, fit_ratio)
            use_render_w = src_w * use_scale_x
            use_render_h = src_h * use_scale_y

            draw_x = margin + (printable_width - use_render_w) / 2
            draw_y = cursor_y - use_render_h
            pdf.saveState()
            clip_path = pdf.beginPath()
            clip_path.rect(draw_x, draw_y, use_render_w, use_render_h)
            pdf.clipPath(clip_path, stroke=0, fill=0)
            pdf.translate(draw_x, draw_y)
            pdf.scale(use_scale_x, use_scale_y)
            renderPDF.draw(drawing, pdf, 0, 0)
            pdf.restoreState()
            cursor_y -= use_render_h

            debug_pages.append({
                "pageIndex": len(debug_pages),
                "sourcePageIndex": page_index,
                "availableHeightPt": round(float(available_h), 3),
                "scale": round(float(use_scale_x), 6),
                "firstPageLimitSrc": round(float(max(1.0, available_h / max(use_scale_y, 1e-6))), 3),
                "groupCount": 1,
                "segmentCount": 1,
                "segmentHeightsSrc": [round(float(src_h), 3)],
                "pairingApplied": True,
                "unitCount": 1,
                "fallback": "atomic-svg-fit",
                "forcedPageBreakBefore": forced_page_break_before,
                "fitRatio": round(float(max(0.1, fit_ratio)), 4),
                "globalFitRatio": round(float(max(0.1, target_fit_ratio)), 4),
                "yScale": round(float(use_scale_y), 6),
            })

        if debug_pages:
            cursor_y -= gap

        pdf.save()

        opened = False
        open_error = ""
        if request.open_after_export:
            try:
                if os.name == "nt":
                    os.startfile(str(out_file))  # type: ignore[attr-defined]
                elif sys.platform == "darwin":
                    subprocess.Popen(["open", str(out_file)])
                else:
                    subprocess.Popen(["xdg-open", str(out_file)])
                opened = True
            except Exception as exc:
                open_error = str(exc)

        return {
            "filename": out_file.name,
            "path": str(out_file),
            "opened": opened,
            "openError": open_error,
            "debug": {
                "marginPt": round(float(margin), 3),
                "printableWidthPt": round(float(printable_width), 3),
                "printableHeightPt": round(float(printable_height), 3),
                "pages": debug_pages,
            },
        }

    @router.post("/api/projects/{project_id}/arrangements/{arrangement_id}/replace")
    async def replace_arrangement(
        project_id: str,
        arrangement_id: str,
        arrangement_file: UploadFile = File(...),
        instrument: str = Form(""),
        gp_track_index: int = Form(-1),
    ) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        if _is_virtual_drum_arrangement(arrangement_id):
            manifest = deps.load_manifest(source_dir)
            suffix = Path(arrangement_file.filename or "arr").suffix.lower()
            temp = UPLOADS / f"{uuid.uuid4()}{suffix}"
            with temp.open("wb") as f:
                shutil.copyfileobj(arrangement_file.file, f)
            try:
                if suffix in GP_SUFFIXES:
                    raise HTTPException(status_code=400, detail="Drum replace from Guitar Pro is not supported yet. Use MIDI drum tracks.")
                if suffix not in MIDI_SUFFIXES:
                    raise HTTPException(status_code=400, detail="Unsupported drum replace format. Use MIDI.")
                drum_rel, existing_tab = _load_existing_drum_tab(source_dir, manifest)
                drum_name = str(existing_tab.get("name") or "Drums").strip() or "Drums"
                try:
                    drum_tab = _midi_to_drum_tab(temp, drum_name, gp_track_index)
                except RuntimeError as exc:
                    raise HTTPException(status_code=400, detail=str(exc))
                _write_drum_tab(source_dir, manifest, drum_rel, drum_tab)
                deps.write_manifest(source_dir, manifest)
            finally:
                try:
                    temp.unlink(missing_ok=True)
                except Exception:
                    pass

            previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
            working_path = deps.pack_working_sloppack(source_dir, previous_project if isinstance(previous_project, dict) else None)
            updated = deps.build_project(project_id, source_dir, selected_arrangement=DRUM_TAB_ARRANGEMENT_ID)
            original_path = deps.project_original_save_path(source_dir, previous_project if isinstance(previous_project, dict) else None)
            updated["sloppackPath"] = str(original_path)
            updated["originalSloppackPath"] = str(original_path)
            updated["workingSloppackPath"] = str(working_path)
            updated["hasUncommittedChanges"] = True
            (source_dir.parent / "project.json").write_text(json.dumps(updated, indent=2, ensure_ascii=False), encoding="utf-8")
            return updated

        manifest, entry, rel = deps.current_arrangement_entry(source_dir, arrangement_id)
        current_data = deps.load_arrangement_wire(source_dir, rel)
        current_type = instrument or deps.infer_arrangement_type(entry, current_data)
        normalized_type = str(current_type or "").strip().lower()
        if normalized_type == "piano":
            normalized_type = "keys"
        if normalized_type not in ("guitar", "bass", "keys"):
            normalized_type = "guitar"
        wire_instrument = "bass" if normalized_type == "bass" else "guitar"

        suffix = Path(arrangement_file.filename or "arr").suffix.lower()
        temp = UPLOADS / f"{uuid.uuid4()}{suffix}"
        with temp.open("wb") as f:
            shutil.copyfileobj(arrangement_file.file, f)
        try:
            name = str(entry.get("name") or arrangement_id)
            if suffix in [".gp5", ".gp4", ".gp3", ".gpx", ".gp"]:
                track_index = gp_track_index if gp_track_index >= 0 else None
                wire = deps.gp_to_wire_direct(temp, name, wire_instrument, gp_track_index=track_index)
            elif suffix in [".mid", ".midi"]:
                wire = deps.simple_midi_to_wire(temp, name, wire_instrument)
            else:
                raise HTTPException(status_code=400, detail="Unsupported arrangement format. Use MIDI or Guitar Pro 5/4/3/GPX/GP.")

            arr_rel = rel or f"arrangements/{arrangement_id}.json"
            (source_dir / arr_rel).parent.mkdir(parents=True, exist_ok=True)
            (source_dir / arr_rel).write_text(json.dumps(wire, separators=(",", ":")), encoding="utf-8")
            entry["file"] = arr_rel
            entry["name"] = name
            entry["tuning"] = wire.get("tuning", entry.get("tuning", [0, 0, 0, 0, 0, 0]))
            entry["capo"] = wire.get("capo", entry.get("capo", 0))
            if normalized_type in ("guitar", "bass", "keys"):
                entry["type"] = normalized_type
            deps.write_manifest(source_dir, manifest)
        finally:
            try:
                temp.unlink(missing_ok=True)
            except Exception:
                pass

        previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
        working_path = deps.pack_working_sloppack(source_dir, previous_project if isinstance(previous_project, dict) else None)
        updated = deps.build_project(project_id, source_dir, selected_arrangement=arrangement_id)
        original_path = deps.project_original_save_path(source_dir, previous_project if isinstance(previous_project, dict) else None)
        updated["sloppackPath"] = str(original_path)
        updated["originalSloppackPath"] = str(original_path)
        updated["workingSloppackPath"] = str(working_path)
        updated["hasUncommittedChanges"] = True
        (source_dir.parent / "project.json").write_text(json.dumps(updated, indent=2, ensure_ascii=False), encoding="utf-8")
        return updated

    @router.post("/api/projects/{project_id}/arrangements/{arrangement_id}/rename")
    async def rename_arrangement(
        project_id: str,
        arrangement_id: str,
        request: RenameArrangementRequest,
    ) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        name = request.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Arrangement name is required")

        if _is_virtual_drum_arrangement(arrangement_id):
            manifest = deps.load_manifest(source_dir)
            drum_rel, drum_tab = _load_existing_drum_tab(source_dir, manifest)
            drum_tab["name"] = name
            _write_drum_tab(source_dir, manifest, drum_rel, drum_tab)
            deps.write_manifest(source_dir, manifest)

            previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
            working_path = deps.pack_working_sloppack(
                source_dir,
                previous_project if isinstance(previous_project, dict) else None,
            )
            updated = deps.build_project(
                project_id,
                source_dir,
                selected_arrangement=DRUM_TAB_ARRANGEMENT_ID,
            )
            original_path = deps.project_original_save_path(
                source_dir,
                previous_project if isinstance(previous_project, dict) else None,
            )
            updated["sloppackPath"] = str(original_path)
            updated["originalSloppackPath"] = str(original_path)
            updated["workingSloppackPath"] = str(working_path)
            updated["hasUncommittedChanges"] = True
            (source_dir.parent / "project.json").write_text(
                json.dumps(updated, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            return updated

        manifest, entry, rel = deps.current_arrangement_entry(source_dir, arrangement_id)
        wire = deps.load_arrangement_wire(source_dir, rel)
        if not isinstance(wire, dict):
            raise HTTPException(status_code=400, detail="Arrangement data is invalid")

        entry["name"] = name
        wire["name"] = name
        arrangement_rel = rel or f"arrangements/{arrangement_id}.json"
        entry["file"] = arrangement_rel
        arrangement_path = source_dir / arrangement_rel
        arrangement_path.parent.mkdir(parents=True, exist_ok=True)
        arrangement_path.write_text(
            json.dumps(wire, separators=(",", ":"), ensure_ascii=False),
            encoding="utf-8",
        )
        deps.write_manifest(source_dir, manifest)

        previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
        working_path = deps.pack_working_sloppack(
            source_dir,
            previous_project if isinstance(previous_project, dict) else None,
        )
        updated = deps.build_project(
            project_id,
            source_dir,
            selected_arrangement=arrangement_id,
        )
        original_path = deps.project_original_save_path(
            source_dir,
            previous_project if isinstance(previous_project, dict) else None,
        )
        updated["sloppackPath"] = str(original_path)
        updated["originalSloppackPath"] = str(original_path)
        updated["workingSloppackPath"] = str(working_path)
        updated["hasUncommittedChanges"] = True
        (source_dir.parent / "project.json").write_text(
            json.dumps(updated, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return updated

    @router.post("/api/projects/{project_id}/arrangements/{arrangement_id}/duplicate")
    async def duplicate_arrangement(
        project_id: str,
        arrangement_id: str,
        request: DuplicateArrangementRequest,
    ) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        name = request.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Arrangement name is required")

        if _is_virtual_drum_arrangement(arrangement_id):
            raise HTTPException(
                status_code=400,
                detail="Drum arrangement uses a single drum_tab file and cannot be duplicated.",
            )

        manifest, entry, rel = deps.current_arrangement_entry(source_dir, arrangement_id)
        arrangements = manifest.get("arrangements")
        if not isinstance(arrangements, list):
            raise HTTPException(status_code=400, detail="Project manifest has invalid arrangements list")

        wire = deps.load_arrangement_wire(source_dir, rel)
        if not isinstance(wire, dict):
            raise HTTPException(status_code=400, detail="Arrangement data is invalid")

        id_base = "".join(
            char.lower() if char.isalnum() else "_"
            for char in name
        ).strip("_") or "arrangement"
        duplicate_id = f"{id_base}_{uuid.uuid4().hex[:6]}"
        duplicate_rel = f"arrangements/{duplicate_id}.json"

        duplicate_wire = json.loads(json.dumps(wire))
        duplicate_wire["name"] = name
        if "id" in duplicate_wire:
            duplicate_wire["id"] = duplicate_id
        duplicate_path = source_dir / duplicate_rel
        duplicate_path.parent.mkdir(parents=True, exist_ok=True)
        duplicate_path.write_text(
            json.dumps(duplicate_wire, separators=(",", ":"), ensure_ascii=False),
            encoding="utf-8",
        )

        duplicate_entry = json.loads(json.dumps(entry))
        duplicate_entry["id"] = duplicate_id
        duplicate_entry["name"] = name
        duplicate_entry["file"] = duplicate_rel
        arrangements.append(duplicate_entry)
        manifest["arrangements"] = arrangements
        deps.write_manifest(source_dir, manifest)

        previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
        working_path = deps.pack_working_sloppack(
            source_dir,
            previous_project if isinstance(previous_project, dict) else None,
        )
        updated = deps.build_project(
            project_id,
            source_dir,
            selected_arrangement=duplicate_id,
        )
        original_path = deps.project_original_save_path(
            source_dir,
            previous_project if isinstance(previous_project, dict) else None,
        )
        updated["sloppackPath"] = str(original_path)
        updated["originalSloppackPath"] = str(original_path)
        updated["workingSloppackPath"] = str(working_path)
        updated["hasUncommittedChanges"] = True
        (source_dir.parent / "project.json").write_text(
            json.dumps(updated, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return updated

    @router.delete("/api/projects/{project_id}/arrangements/{arrangement_id}")
    async def delete_arrangement(project_id: str, arrangement_id: str) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        manifest = deps.load_manifest(source_dir)
        if _is_virtual_drum_arrangement(arrangement_id):
            drum_rel = str(manifest.get("drum_tab") or "").strip()
            if not drum_rel:
                raise HTTPException(status_code=404, detail="Drum arrangement not found")
            manifest.pop("drum_tab", None)
            deps.write_manifest(source_dir, manifest)

            drum_path = _resolve_source_relative_path(source_dir, drum_rel)
            if drum_path is not None and drum_path.exists() and drum_path.is_file():
                try:
                    drum_path.unlink(missing_ok=True)
                except Exception:
                    pass

            arrangements_after = manifest.get("arrangements") or []
            selected_after_delete = None
            if isinstance(arrangements_after, list) and arrangements_after:
                selected_after_delete = str((arrangements_after[0] or {}).get("id") or "") or None

            previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
            working_path = deps.pack_working_sloppack(
                source_dir,
                previous_project if isinstance(previous_project, dict) else None,
            )
            updated = deps.build_project(
                project_id,
                source_dir,
                selected_arrangement=selected_after_delete,
            )
            original_path = deps.project_original_save_path(
                source_dir,
                previous_project if isinstance(previous_project, dict) else None,
            )
            updated["sloppackPath"] = str(original_path)
            updated["originalSloppackPath"] = str(original_path)
            updated["workingSloppackPath"] = str(working_path)
            updated["hasUncommittedChanges"] = True
            (source_dir.parent / "project.json").write_text(
                json.dumps(updated, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            return updated

        arrangements = manifest.get("arrangements") or []
        if not isinstance(arrangements, list):
            raise HTTPException(status_code=400, detail="Project manifest has invalid arrangements list")

        entry_index = next(
            (index for index, item in enumerate(arrangements) if str((item or {}).get("id")) == arrangement_id),
            None,
        )
        if entry_index is None:
            raise HTTPException(status_code=404, detail="Arrangement not found")

        removed_entry = arrangements.pop(entry_index)
        removed_rel = str((removed_entry or {}).get("file") or "")
        manifest["arrangements"] = arrangements
        deps.write_manifest(source_dir, manifest)

        if removed_rel:
            file_still_referenced = any(
                str((item or {}).get("file") or "") == removed_rel for item in arrangements
            )
            if not file_still_referenced:
                target = (source_dir / removed_rel).resolve()
                try:
                    target.relative_to(source_dir.resolve())
                    if target.exists() and target.is_file():
                        target.unlink(missing_ok=True)
                except Exception:
                    # Ignore unsafe or non-removable paths and continue.
                    pass

        selected_after_delete = None
        if arrangements:
            fallback_index = min(entry_index, len(arrangements) - 1)
            selected_after_delete = str((arrangements[fallback_index] or {}).get("id") or "") or None

        previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
        working_path = deps.pack_working_sloppack(
            source_dir,
            previous_project if isinstance(previous_project, dict) else None,
        )
        updated = deps.build_project(
            project_id,
            source_dir,
            selected_arrangement=selected_after_delete,
        )
        original_path = deps.project_original_save_path(
            source_dir,
            previous_project if isinstance(previous_project, dict) else None,
        )
        updated["sloppackPath"] = str(original_path)
        updated["originalSloppackPath"] = str(original_path)
        updated["workingSloppackPath"] = str(working_path)
        updated["hasUncommittedChanges"] = True
        (source_dir.parent / "project.json").write_text(
            json.dumps(updated, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return updated

    @router.post("/api/projects/{project_id}/cover")
    async def upload_cover(project_id: str, cover_file: UploadFile = File(...)) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        suffix = Path(cover_file.filename or "cover.jpg").suffix.lower()
        if suffix not in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".dds"]:
            suffix = ".jpg"
        rel = f"cover{suffix}"
        target = source_dir / rel
        with target.open("wb") as f:
            shutil.copyfileobj(cover_file.file, f)
        manifest = deps.load_manifest(source_dir)
        manifest["cover"] = rel
        deps.write_manifest(source_dir, manifest)
        return {"coverUrl": f"/api/projects/{project_id}/asset/{rel}", "coverPath": rel}

    return router
