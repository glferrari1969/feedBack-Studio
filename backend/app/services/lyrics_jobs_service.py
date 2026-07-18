from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class LyricsJobsDeps:
    jobs: dict[str, dict[str, Any]]
    projects_by_id: dict[str, Path]
    load_manifest: Callable[[Path], dict]
    project_stem_path: Callable[[Path, dict, str | None], tuple[Path | None, str]]
    vocals_has_signal: Callable[[Path], bool]
    lyrics_transcriber_available: Callable[[], bool]
    lyrics_transcriber_cli: Callable[[], str]
    default_workspace: Path
    parse_lrc_or_plain_text: Callable[[str], tuple[list[dict], list[str]]]
    sync_plain_lyrics_to_audio: Callable[[list[str], Path, dict, str | None], tuple[list[dict], str]]
    whisperx_available: Callable[[], bool]
    transcribe_vocals_local: Callable[..., list[dict]]
    progress_factory: Callable[[dict[str, Any], int, int], Callable[..., Any]]
    save_lyrics_to_project: Callable[[Path, list[dict], str], None]
    build_project: Callable[..., dict]
    pack_working_sloppack: Callable[..., Path]
    project_original_save_path: Callable[..., Path]


def _transcribe_with_lyrics_transcriber(
    deps: LyricsJobsDeps,
    audio_path: Path,
    manifest: dict,
    audio_label: str,
) -> list[dict]:
    if not deps.lyrics_transcriber_available():
        raise RuntimeError("lyrics-transcriber is not installed in the backend environment.")

    out_dir = Path(tempfile.mkdtemp(prefix="lyrics-transcriber-", dir=str(deps.default_workspace)))
    cli = deps.lyrics_transcriber_cli()
    if Path(cli).name.lower().startswith("python") or cli == sys.executable:
        cmd = [
            sys.executable,
            "-c",
            "from lyrics_transcriber.cli.cli_main import main; main()",
        ]
    else:
        cmd = [cli]
    cmd += [
        str(audio_path),
        "--output_dir", str(out_dir),
        "--skip_video",
        "--skip_cdg",
        "--skip_countdown",
        "--skip_lyrics_fetch",
    ]
    artist = str(manifest.get("artist") or "").strip()
    title = str(manifest.get("title") or "").strip()
    if artist:
        cmd += ["--artist", artist]
    if title:
        cmd += ["--title", title]

    proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    if proc.returncode != 0:
        raise RuntimeError("lyrics-transcriber failed.\n" + proc.stdout[-4000:])

    lrc_files = sorted(out_dir.rglob("*.lrc"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not lrc_files:
        raise RuntimeError("lyrics-transcriber completed but did not create an LRC file.")

    lrc_text = lrc_files[0].read_text(encoding="utf-8", errors="replace")
    timed, plain = deps.parse_lrc_or_plain_text(lrc_text)
    if timed:
        return timed
    if plain:
        duration = float(manifest.get("duration", 0) or 0)
        temp_manifest = dict(manifest)
        temp_manifest["duration"] = duration
        source_dir = audio_path.parent.parent if audio_path.parent.name == "stems" else audio_path.parent
        synced, _source = deps.sync_plain_lyrics_to_audio(plain, source_dir, temp_manifest, None)
        return synced
    raise RuntimeError("lyrics-transcriber output did not contain lyric lines.")


def build_lyrics_transcription_processor(deps: LyricsJobsDeps) -> Callable[..., None]:
    def process_lyrics_transcription_job(
        job_id: str,
        project_id: str,
        stem_id: str | None,
        model_size: str,
        language: str | None,
        min_word_score: float,
    ) -> None:
        job = deps.jobs[job_id]
        try:
            source_dir = deps.projects_by_id.get(project_id)
            if not source_dir:
                raise RuntimeError("Project not found")
            manifest = deps.load_manifest(source_dir)
            audio_path, audio_label = deps.project_stem_path(source_dir, manifest, stem_id)
            if audio_path is None:
                raise RuntimeError("No audio stem is available for lyric transcription.")
            if "vocal" in audio_label.lower() and not deps.vocals_has_signal(audio_path):
                raise RuntimeError("The selected vocal stem is almost silent; transcription was skipped to avoid hallucinated lyrics.")

            errors: list[str] = []
            lyrics: list[dict] = []
            source = f"lyrics-transcriber:{audio_label}"

            if deps.lyrics_transcriber_available():
                try:
                    job.update(status="running", step=f"Transcribing lyrics with lyrics-transcriber from {audio_label}", progress=5)
                    lyrics = _transcribe_with_lyrics_transcriber(deps, audio_path, manifest, audio_label)
                except Exception as exc:
                    errors.append(f"lyrics-transcriber: {exc}")
                    lyrics = []

            if not lyrics:
                if not deps.whisperx_available():
                    detail = " | ".join(errors) if errors else "lyrics-transcriber did not produce lyrics."
                    raise RuntimeError(
                        detail + " Install backend dependencies with: "
                        "cd backend && .venv\\Scripts\\activate && pip install -r requirements.txt"
                    )
                job.update(status="running", step=f"lyrics-transcriber unavailable/failed; falling back to WhisperX for {audio_label}", progress=7)
                lyrics = deps.transcribe_vocals_local(
                    audio_path,
                    model_size=model_size or "medium",
                    language=language or None,
                    min_word_score=float(min_word_score or 0.35),
                    progress_cb=deps.progress_factory(job, 8, 82),
                )
                source = f"whisperx:{audio_label}"

            if not lyrics:
                raise RuntimeError("No lyric words were recognized.")
            deps.save_lyrics_to_project(source_dir, lyrics, source)

            project = deps.build_project(project_id, source_dir, selected_arrangement=None)
            working_path = deps.pack_working_sloppack(source_dir, project)
            original_path = deps.project_original_save_path(source_dir, project)
            project["workingSloppackPath"] = str(working_path)
            project["sloppackPath"] = str(original_path)
            project["originalSloppackPath"] = str(original_path)
            project["hasUncommittedChanges"] = True
            (source_dir.parent / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
            job.update(status="done", step="Lyrics transcription completed", progress=100, project=project)
        except Exception as exc:
            job.update(status="error", step="Lyrics transcription failed", error=str(exc), progress=100)

    return process_lyrics_transcription_job


def build_lyrics_text_sync_processor(deps: LyricsJobsDeps) -> Callable[..., None]:
    def process_lyrics_text_sync_job(
        job_id: str,
        project_id: str,
        lyrics_text: str,
        stem_id: str | None,
    ) -> None:
        job = deps.jobs[job_id]
        try:
            source_dir = deps.projects_by_id.get(project_id)
            if not source_dir:
                raise RuntimeError("Project not found")
            if not lyrics_text.strip():
                raise RuntimeError("No lyric text was provided")

            job.update(status="running", step="Parsing supplied lyrics", progress=3)
            manifest = deps.load_manifest(source_dir)
            timed, plain = deps.parse_lrc_or_plain_text(lyrics_text)
            if timed:
                lyrics = timed
                source = "lrc-import"
                job.update(status="running", step="Using imported lyric timestamps", progress=88)
            else:
                lyrics, source = deps.sync_plain_lyrics_to_audio(
                    plain,
                    source_dir,
                    manifest,
                    stem_id,
                    progress_cb=lambda value, step: job.update(
                        status="running",
                        step=step,
                        progress=min(88, 5 + int(float(value) * 88)),
                    ),
                )

            job.update(status="running", step="Saving synchronized lyrics", progress=92)
            deps.save_lyrics_to_project(source_dir, lyrics, source)
            project = deps.build_project(project_id, source_dir, selected_arrangement=None)
            job.update(status="running", step="Updating working copy", progress=96)
            working_path = deps.pack_working_sloppack(source_dir, project)
            original_path = deps.project_original_save_path(source_dir, project)
            project["workingSloppackPath"] = str(working_path)
            project["sloppackPath"] = str(original_path)
            project["originalSloppackPath"] = str(original_path)
            project["hasUncommittedChanges"] = True
            (source_dir.parent / "project.json").write_text(
                json.dumps(project, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            job.update(status="done", step="Lyrics synchronized", progress=100, project=project)
        except Exception as exc:
            job.update(status="error", step="Lyrics synchronization failed", error=str(exc), progress=100)

    return process_lyrics_text_sync_job
