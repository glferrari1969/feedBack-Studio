from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.api_models import ExportArrangementRequest
from app.runtime_state import UPLOADS, projects_by_id


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

        suffix = Path(arrangement_file.filename or "arr").suffix.lower()
        temp = UPLOADS / f"{uuid.uuid4()}{suffix}"
        with temp.open("wb") as f:
            shutil.copyfileobj(arrangement_file.file, f)

        aid = (name or f"Imported {instrument}").lower().replace(" ", "_") + "_" + uuid.uuid4().hex[:6]
        arr_dir = source_dir / "arrangements"
        arr_dir.mkdir(parents=True, exist_ok=True)
        if suffix in [".gp5", ".gp4", ".gp3", ".gpx", ".gp"]:
            track_index = gp_track_index if gp_track_index >= 0 else None
            wire = deps.gp_to_wire_direct(temp, name or f"Imported {instrument}", instrument, gp_track_index=track_index)
        elif suffix in [".mid", ".midi"]:
            wire = deps.simple_midi_to_wire(temp, name or f"Imported {instrument}", instrument)
        else:
            raise RuntimeError("Unsupported arrangement format. Use MIDI or Guitar Pro 5/4/3/GPX.")

        arr_rel = f"arrangements/{aid}.json"
        (source_dir / arr_rel).write_text(json.dumps(wire, separators=(",", ":")), encoding="utf-8")
        manifest = deps.load_manifest(source_dir)
        arrs = manifest.setdefault("arrangements", [])
        tuning = wire.get("tuning", [0, 0, 0, 0, 0, 0])
        arrs.append({"id": aid, "name": wire.get("name", name), "file": arr_rel, "tuning": tuning, "capo": wire.get("capo", 0), "type": instrument})
        deps.write_manifest(source_dir, manifest)

        previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
        working_path = deps.pack_working_sloppack(source_dir, previous_project if isinstance(previous_project, dict) else None)
        updated = deps.build_project(project_id, source_dir, selected_arrangement=aid)
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

        manifest, entry, rel = deps.current_arrangement_entry(source_dir, arrangement_id)
        current_data = deps.load_arrangement_wire(source_dir, rel)
        current_type = instrument or deps.infer_arrangement_type(entry, current_data)
        if current_type not in ("guitar", "bass"):
            current_type = "guitar"

        suffix = Path(arrangement_file.filename or "arr").suffix.lower()
        temp = UPLOADS / f"{uuid.uuid4()}{suffix}"
        with temp.open("wb") as f:
            shutil.copyfileobj(arrangement_file.file, f)
        name = str(entry.get("name") or arrangement_id)
        if suffix in [".gp5", ".gp4", ".gp3", ".gpx", ".gp"]:
            track_index = gp_track_index if gp_track_index >= 0 else None
            wire = deps.gp_to_wire_direct(temp, name, current_type, gp_track_index=track_index)
        elif suffix in [".mid", ".midi"]:
            wire = deps.simple_midi_to_wire(temp, name, current_type)
        else:
            raise RuntimeError("Unsupported arrangement format. Use MIDI or Guitar Pro 5/4/3/GPX/GP.")

        arr_rel = rel or f"arrangements/{arrangement_id}.json"
        (source_dir / arr_rel).parent.mkdir(parents=True, exist_ok=True)
        (source_dir / arr_rel).write_text(json.dumps(wire, separators=(",", ":")), encoding="utf-8")
        entry["file"] = arr_rel
        entry["name"] = name
        entry["tuning"] = wire.get("tuning", entry.get("tuning", [0, 0, 0, 0, 0, 0]))
        entry["capo"] = wire.get("capo", entry.get("capo", 0))
        if current_type in ("guitar", "bass"):
            entry["type"] = current_type
        deps.write_manifest(source_dir, manifest)

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

    @router.delete("/api/projects/{project_id}/arrangements/{arrangement_id}")
    async def delete_arrangement(project_id: str, arrangement_id: str) -> dict:
        source_dir = projects_by_id.get(project_id)
        if not source_dir:
            raise HTTPException(status_code=404, detail="Project not found")

        manifest = deps.load_manifest(source_dir)
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
