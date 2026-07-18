from __future__ import annotations

import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.api_models import JobResponse, LyricsTextSyncRequest, LyricsTranscriptionRequest, StemArrangementRequest, StemToneGenerationRequest
from app.runtime_state import PROJECTS_ROOT, UPLOADS, cleanup_backend_working_directory
from app.services.jobs_service import create_queued_job


@dataclass(frozen=True)
class JobsRouterDeps:
    process_open_job: Callable[..., None]
    process_demucs_job: Callable[..., None]
    process_batch_psarc_job: Callable[..., None]
    process_lyrics_transcription_job: Callable[..., None]
    process_lyrics_text_sync_job: Callable[..., None]
    process_stem_arrangement_job: Callable[..., None]
    process_stem_tone_job: Callable[..., None]
    choose_local_input_file: Callable[[str], Path | None]
    choose_local_output_dir: Callable[[str], Path | None]
    choose_local_batch_psarc_dir: Callable[[], Path | None]
    get_preferred_output_dir: Callable[[], str]
    set_preferred_output_dir: Callable[[str], str]
    get_preferred_output_name_pattern: Callable[[], str]
    set_preferred_output_name_pattern: Callable[[str], str]


def create_jobs_router(deps: JobsRouterDeps) -> APIRouter:
    router = APIRouter()

    @router.get("/api/settings/output-dir")
    async def get_output_dir_setting() -> dict:
        return {"output_dir": deps.get_preferred_output_dir()}

    @router.post("/api/settings/output-dir")
    async def set_output_dir_setting(output_dir: str = Form("")) -> dict:
        stored = deps.set_preferred_output_dir(output_dir)
        return {"output_dir": stored}

    @router.post("/api/settings/output-dir/browse")
    async def browse_output_dir_setting() -> dict:
        selected = deps.choose_local_output_dir(deps.get_preferred_output_dir())
        if selected is None:
            raise HTTPException(status_code=400, detail="Folder selection cancelled")
        stored = deps.set_preferred_output_dir(str(selected))
        return {"output_dir": stored}

    @router.get("/api/settings/output-name-pattern")
    async def get_output_name_pattern_setting() -> dict:
        return {"pattern": deps.get_preferred_output_name_pattern()}

    @router.post("/api/settings/output-name-pattern")
    async def set_output_name_pattern_setting(pattern: str = Form("")) -> dict:
        stored = deps.set_preferred_output_name_pattern(pattern)
        return {"pattern": stored}

    @router.post("/api/jobs/open", response_model=JobResponse)
    async def create_open_job(
        input_file: UploadFile = File(...),
        output_dir: str = Form(""),
        original_path: str = Form(""),
    ) -> JobResponse:
        job_id = create_queued_job()
        suffix = Path(input_file.filename or "input").suffix or ".bin"
        upload = UPLOADS / f"{job_id}{suffix}"
        with upload.open("wb") as f:
            shutil.copyfileobj(input_file.file, f)

        requested_output_dir = output_dir.strip()
        if requested_output_dir:
            requested_output_dir = deps.set_preferred_output_dir(requested_output_dir)
        else:
            requested_output_dir = deps.get_preferred_output_dir().strip()

        source_parent = ""
        if not requested_output_dir and original_path.strip():
            try:
                original_candidate = Path(original_path).expanduser().resolve()
                if original_candidate.exists() and original_candidate.is_file():
                    source_parent = str(original_candidate.parent)
            except Exception:
                source_parent = ""

        cleanup_backend_working_directory()
        out = PROJECTS_ROOT
        threading.Thread(
            target=deps.process_open_job,
            args=(job_id, upload, out, original_path, requested_output_dir or source_parent),
            daemon=True,
        ).start()
        return JobResponse(job_id=job_id)

    @router.post("/api/jobs/open-local", response_model=JobResponse)
    async def create_open_local_job(
        mode: str = Form("sloppack"),
        output_dir: str = Form(""),
    ) -> JobResponse:
        selected = deps.choose_local_input_file(mode)
        if selected is None:
            raise HTTPException(status_code=400, detail="File selection cancelled")

        requested_output_dir = output_dir.strip()
        if requested_output_dir:
            requested_output_dir = deps.set_preferred_output_dir(requested_output_dir)
        else:
            requested_output_dir = deps.get_preferred_output_dir().strip()

        cleanup_backend_working_directory()
        job_id = create_queued_job()
        source_parent = str(selected.parent) if not requested_output_dir else ""
        out = PROJECTS_ROOT
        threading.Thread(
            target=deps.process_open_job,
            args=(job_id, selected, out, str(selected), requested_output_dir or source_parent),
            daemon=True,
        ).start()
        return JobResponse(job_id=job_id)

    @router.post("/api/jobs/batch-convert-psarc-local", response_model=JobResponse)
    async def create_batch_convert_psarc_local_job(
        output_dir: str = Form(""),
    ) -> JobResponse:
        selected_dir = deps.choose_local_batch_psarc_dir()
        if selected_dir is None:
            raise HTTPException(status_code=400, detail="Folder selection cancelled")

        requested_output_dir = output_dir.strip()
        if requested_output_dir:
            requested_output_dir = deps.set_preferred_output_dir(requested_output_dir)
        else:
            requested_output_dir = deps.get_preferred_output_dir().strip()

        job_id = create_queued_job()
        threading.Thread(
            target=deps.process_batch_psarc_job,
            args=(job_id, selected_dir, requested_output_dir or str(selected_dir)),
            daemon=True,
        ).start()
        return JobResponse(job_id=job_id)

    @router.post("/api/jobs/demucs", response_model=JobResponse)
    async def create_demucs_job(project_id: str = Form(...)) -> JobResponse:
        job_id = create_queued_job()
        threading.Thread(target=deps.process_demucs_job, args=(job_id, project_id), daemon=True).start()
        return JobResponse(job_id=job_id)

    @router.post("/api/jobs/lyrics/transcribe", response_model=JobResponse)
    async def create_lyrics_transcription_job(request: LyricsTranscriptionRequest) -> JobResponse:
        job_id = create_queued_job()
        threading.Thread(
            target=deps.process_lyrics_transcription_job,
            args=(job_id, request.project_id, request.stem_id, request.model_size, request.language, request.min_word_score),
            daemon=True,
        ).start()
        return JobResponse(job_id=job_id)

    @router.post("/api/jobs/stems/to-arrangement", response_model=JobResponse)
    async def create_stem_arrangement_job(request: StemArrangementRequest) -> JobResponse:
        job_id = create_queued_job()
        threading.Thread(
            target=deps.process_stem_arrangement_job,
            args=(
                job_id,
                request.project_id,
                request.stem_id,
                request.arrangement_name,
                request.instrument,
            ),
            daemon=True,
        ).start()
        return JobResponse(job_id=job_id)

    @router.post("/api/jobs/lyrics/text-sync", response_model=JobResponse)
    async def create_lyrics_text_sync_job(request: LyricsTextSyncRequest) -> JobResponse:
        job_id = create_queued_job()
        threading.Thread(
            target=deps.process_lyrics_text_sync_job,
            args=(job_id, request.project_id, request.lyrics_text, request.stem_id),
            daemon=True,
        ).start()
        return JobResponse(job_id=job_id)

    @router.post("/api/jobs/stems/to-tones", response_model=JobResponse)
    async def create_stem_tone_job(request: StemToneGenerationRequest) -> JobResponse:
        job_id = create_queued_job()
        threading.Thread(
            target=deps.process_stem_tone_job,
            args=(job_id, request.project_id, request.stem_id, request.arrangement_label),
            daemon=True,
        ).start()
        return JobResponse(job_id=job_id)

    return router
