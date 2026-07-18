from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from app.runtime_state import FRONTEND_DIST, projects_by_id


def resolve_project_asset_or_404(project_id: str, file_path: str) -> Path:
    source_dir = projects_by_id.get(project_id)
    if not source_dir:
        raise HTTPException(status_code=404, detail="Project not found")
    target = (source_dir / file_path).resolve()
    if not str(target).startswith(str(source_dir.resolve())) or not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return target


def resolve_frontend_asset(path: str) -> Path | None:
    if not path:
        return None
    try:
        candidate = (FRONTEND_DIST / path).resolve()
        if not str(candidate).startswith(str(FRONTEND_DIST.resolve())):
            return None
        if candidate.exists() and candidate.is_file():
            return candidate
    except Exception:
        return None
    return None
