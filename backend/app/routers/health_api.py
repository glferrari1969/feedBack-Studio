from __future__ import annotations

from fastapi import APIRouter

from app.services.health_service import build_health_payload

router = APIRouter()


@router.get("/api/health")
def health() -> dict:
    return build_health_payload()
