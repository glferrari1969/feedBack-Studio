from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class JobResponse(BaseModel):
    job_id: str


class ExportArrangementRequest(BaseModel):
    format: str
    project: dict


class NotationPdfExportRequest(BaseModel):
    title: str
    artist: str | None = None
    album: str | None = None
    year: str | None = None
    arrangement_name: str | None = None
    bpm: float | None = None
    meter: list[int] | None = None
    header_png_data_url: str | None = None
    score_svgs: list[str]
    open_after_export: bool = True


class DuplicateArrangementRequest(BaseModel):
    name: str


class RenameArrangementRequest(BaseModel):
    name: str


class LyricsTranscriptionRequest(BaseModel):
    project_id: str
    stem_id: str | None = None
    model_size: str = "medium"
    language: str | None = None
    min_word_score: float = 0.35


class LyricsTextSyncResponse(BaseModel):
    project: dict


class LyricsTextSyncRequest(BaseModel):
    project_id: str
    lyrics_text: str
    stem_id: str | None = None


class StemArrangementRequest(BaseModel):
    project_id: str
    stem_id: str
    arrangement_name: str
    instrument: Literal["bass", "guitar", "keys", "drums"]


class StemToneGenerationRequest(BaseModel):
    project_id: str
    stem_id: str
    arrangement_label: str = "Generated tones"
