from __future__ import annotations

import time
import uuid

from fastapi import HTTPException

from app.runtime_state import jobs


def create_queued_job() -> str:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "step": "Queued",
        "progress": 0,
        "created_at": time.time(),
    }
    return job_id


def get_job_or_404(job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
