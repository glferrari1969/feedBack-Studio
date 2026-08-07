from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.arrangement_import import list_gp_tracks_direct
from app.runtime_state import UPLOADS
from app.services.assets_service import resolve_project_asset_or_404
from app.services.jobs_service import get_job_or_404

router = APIRouter()


@router.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    return get_job_or_404(job_id)


@router.post("/api/tools/gp/tracks")
async def list_gp_tracks_endpoint(gp_file: UploadFile = File(...)) -> list[dict]:
    suffix = Path(gp_file.filename or "arr").suffix.lower()
    if suffix not in [".gp5", ".gp4", ".gp3", ".gpx"]:
        raise HTTPException(status_code=400, detail="Unsupported file format. Use Guitar Pro 5/4/3/GPX.")
    temp = UPLOADS / f"{uuid.uuid4()}{suffix}"
    with temp.open("wb") as f:
        shutil.copyfileobj(gp_file.file, f)
    try:
        return list_gp_tracks_direct(temp)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        try:
            temp.unlink(missing_ok=True)
        except Exception:
            pass


@router.get("/api/projects/{project_id}/asset/{file_path:path}")
def get_asset(project_id: str, file_path: str) -> FileResponse:
    target = resolve_project_asset_or_404(project_id, file_path)
    return FileResponse(str(target))
