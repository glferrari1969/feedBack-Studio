from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.runtime_state import FRONTEND_INDEX
from app.services.assets_service import resolve_frontend_asset

router = APIRouter()


@router.get("/", include_in_schema=False)
def serve_frontend_index() -> FileResponse:
    if not FRONTEND_INDEX.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found. Run 'npm run build' from the project root.")
    return FileResponse(str(FRONTEND_INDEX))


@router.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_asset_or_index(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    asset = resolve_frontend_asset(full_path)
    if asset is not None:
        return FileResponse(str(asset))

    if FRONTEND_INDEX.exists():
        return FileResponse(str(FRONTEND_INDEX))

    raise HTTPException(status_code=404, detail="Frontend build not found. Run 'npm run build' from the project root.")
