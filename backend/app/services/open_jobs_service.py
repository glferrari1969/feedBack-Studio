from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class OpenJobsDeps:
    jobs: dict[str, dict[str, Any]]
    projects_by_id: dict[str, Path]
    sloppack_input_suffixes: set[str] | list[str]
    make_backend_project_dir: Callable[[str], Path]
    resolve_final_output_base: Callable[[Path, str, str], Path]
    sanitize_windows_name: Callable[[str, str], str]
    convert_psarc_to_sloppak: Callable[..., Any]
    extract_meta: Callable[[Path], dict]
    read_audio_tags: Callable[[Path], dict]
    conversion_folder_name_from_metadata: Callable[[dict, Path], str]
    resolve_converted_save_target: Callable[[Path, dict, Path, str, str], Path]
    get_preferred_output_name_pattern: Callable[[], str]
    create_mp3_sloppack: Callable[..., Path]
    split_sloppak_stems: Callable[..., Any]
    unpack_sloppack: Callable[[Path, Path], Path]
    ensure_full_ogg_for_single_mix: Callable[..., Any]
    generate_mp3_sync_files: Callable[..., Any]
    pack_sloppack: Callable[[Path, Path], Any]
    pack_working_sloppack: Callable[..., Path]
    remember_save_path: Callable[[Path, Path], None]
    remember_working_save_path: Callable[[Path, Path], None]
    build_project: Callable[..., dict]
    metadata_from_manifest: Callable[[Path], dict]
    read_json_if_exists: Callable[..., Any]
    project_original_save_path: Callable[..., Path]
    progress_factory: Callable[[dict[str, Any], int, int], Callable[..., Any]]


def build_open_jobs_processors(deps: OpenJobsDeps) -> tuple[Callable[..., None], Callable[..., None], Callable[..., None]]:
    def process_open_job(
        job_id: str,
        input_file: Path,
        work_base: Path,
        original_input_path: str = "",
        final_output_base: str = "",
    ) -> None:
        _ = work_base  # kept for backward-compatible signature
        job = deps.jobs[job_id]
        try:
            job.update(status="running", step="Preparing project", progress=5)
            suffix = input_file.suffix.lower()
            naming_metadata: dict[str, Any] = {}
            original_file_path: Path | None = None
            if original_input_path:
                try:
                    candidate = Path(original_input_path).expanduser().resolve()
                    if candidate.exists() and candidate.is_file():
                        original_file_path = candidate
                except Exception:
                    original_file_path = None

            # Always keep the editable project under the backend workspace.
            project_dir = deps.make_backend_project_dir(job_id)
            output_base = deps.resolve_final_output_base(input_file, final_output_base, original_input_path)
            sloppack_path = project_dir / "source.feedpak"
            folder_name = deps.sanitize_windows_name(input_file.stem, "converted_project")

            if suffix == ".psarc":
                job.update(step="Converting PSARC to sloppack", progress=10)
                deps.convert_psarc_to_sloppak(
                    input_file,
                    sloppack_path,
                    as_dir=False,
                    progress_cb=deps.progress_factory(job, 10, 55),
                    split_stems=False,
                    stem_model="htdemucs_6s",
                    transcribe_lyrics=False,
                )
            elif suffix in [".mp3", ".wav", ".flac", ".m4a", ".ogg"]:
                audio_metadata = deps.read_audio_tags(input_file)
                naming_metadata = audio_metadata if isinstance(audio_metadata, dict) else {}
                folder_name = deps.conversion_folder_name_from_metadata(audio_metadata, input_file)
                sloppack_path = deps.create_mp3_sloppack(input_file, sloppack_path, audio_metadata, job)
            elif suffix in deps.sloppack_input_suffixes:
                shutil.copyfile(input_file, sloppack_path)
            else:
                raise RuntimeError("Unsupported input format. Use .sloppack/.sloppak/.feedpak, .psarc, or .mp3/.wav/.flac/.ogg audio")

            job.update(step="Extracting sloppack for editor", progress=85)
            source_dir = deps.unpack_sloppack(sloppack_path, project_dir)
            if suffix in [".psarc", ".mp3", ".wav", ".flac", ".m4a", ".ogg"]:
                deps.ensure_full_ogg_for_single_mix(source_dir, job)

            if suffix in [".mp3", ".wav", ".flac", ".m4a", ".ogg"]:
                job.update(step="Creating automatic beatgrid, tempoMap, and syncPoints", progress=88)
                deps.generate_mp3_sync_files(source_dir, job=job, beats_per_bar=4)

            if suffix in [".psarc", ".mp3", ".wav", ".flac", ".m4a", ".ogg"]:
                deps.pack_sloppack(source_dir, sloppack_path)

            if suffix == ".psarc":
                psarc_metadata = deps.metadata_from_manifest(source_dir)
                naming_metadata = psarc_metadata if isinstance(psarc_metadata, dict) else {}
                folder_name = deps.conversion_folder_name_from_metadata(naming_metadata, input_file)

            save_target = project_dir / "source.feedpak"
            if suffix == ".psarc" or suffix in [".mp3", ".wav", ".flac", ".m4a", ".ogg"]:
                output_name_pattern = deps.get_preferred_output_name_pattern()
                if not naming_metadata:
                    naming_metadata = {"title": folder_name}
                save_target = deps.resolve_converted_save_target(
                    output_base,
                    naming_metadata,
                    input_file,
                    folder_name,
                    output_name_pattern,
                )
            elif suffix in deps.sloppack_input_suffixes and original_file_path is not None:
                save_target = original_file_path

            working_target = project_dir / "working.sloppack"
            deps.remember_save_path(source_dir, save_target)
            deps.remember_working_save_path(source_dir, working_target)

            opened_existing_sloppack = suffix in deps.sloppack_input_suffixes and original_file_path is not None
            if not opened_existing_sloppack:
                deps.pack_sloppack(source_dir, save_target)
            deps.pack_working_sloppack(source_dir)

            deps.projects_by_id[job_id] = source_dir
            project = deps.build_project(job_id, source_dir)
            project["outputPath"] = str(project_dir)
            project["sloppackPath"] = str(save_target)
            project["originalSloppackPath"] = str(save_target)
            project["workingSloppackPath"] = str(working_target)
            project["hasUncommittedChanges"] = False
            (project_dir / "project.json").write_text(json.dumps(project, indent=2), encoding="utf-8")
            job.update(status="done", step="Opened in editor", progress=100, project=project)
        except Exception as exc:
            job.update(status="error", step="Error", error=str(exc), progress=100)

    def process_demucs_job(job_id: str, project_id: str) -> None:
        job = deps.jobs[job_id]
        try:
            source_dir = deps.projects_by_id.get(project_id)
            if not source_dir:
                raise RuntimeError("Project not found")
            previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
            original_path = deps.project_original_save_path(source_dir, previous_project if isinstance(previous_project, dict) else None)
            working_path = deps.pack_working_sloppack(source_dir, previous_project if isinstance(previous_project, dict) else None)
            job.update(status="running", step="Running Demucs on working sloppack", progress=10)
            deps.split_sloppak_stems(working_path, model="htdemucs_6s", progress_cb=deps.progress_factory(job, 10, 80), transcribe_lyrics=False)
            deps.unpack_sloppack(working_path, source_dir.parent)
            project = deps.build_project(project_id, source_dir)
            project["sloppackPath"] = str(original_path)
            project["originalSloppackPath"] = str(original_path)
            project["workingSloppackPath"] = str(working_path)
            project["hasUncommittedChanges"] = True
            (source_dir.parent / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
            job.update(status="done", step="Stems updated in working copy", progress=100, project=project)
        except Exception as exc:
            job.update(status="error", step="Error", error=str(exc), progress=100)

    def process_batch_psarc_job(
        job_id: str,
        input_dir: Path,
        final_output_base: str = "",
    ) -> None:
        job = deps.jobs[job_id]
        try:
            source_dir = Path(input_dir).expanduser().resolve()
            if not source_dir.exists() or not source_dir.is_dir():
                raise RuntimeError(f"Batch source folder does not exist: {source_dir}")

            psarc_files = sorted(
                file
                for file in source_dir.rglob("*")
                if file.is_file() and file.suffix.lower() == ".psarc"
            )
            if not psarc_files:
                raise RuntimeError("No .psarc files found in the selected folder.")

            # Keep temporary conversion artifacts in backend workspace.
            work_dir = deps.make_backend_project_dir(job_id)
            requested_output_base = str(final_output_base or "").strip() or str(source_dir)
            output_base = deps.resolve_final_output_base(psarc_files[0], requested_output_base, str(psarc_files[0]))
            output_name_pattern = deps.get_preferred_output_name_pattern()

            converted: list[str] = []
            failures: list[dict[str, str]] = []
            total = len(psarc_files)

            for index, psarc_file in enumerate(psarc_files, start=1):
                base_progress = 5 + int(((index - 1) / max(1, total)) * 90)
                span_progress = max(1, int(90 / max(1, total)))
                job.update(
                    status="running",
                    step=f"[{index}/{total}] Converting {psarc_file.name}",
                    progress=min(95, base_progress),
                )

                temp_feedpak = work_dir / f"batch_{index:04d}.feedpak"
                try:
                    deps.convert_psarc_to_sloppak(
                        psarc_file,
                        temp_feedpak,
                        as_dir=False,
                        progress_cb=deps.progress_factory(job, base_progress, span_progress),
                        split_stems=False,
                        stem_model="htdemucs_6s",
                        transcribe_lyrics=False,
                    )
                    metadata = deps.extract_meta(temp_feedpak)
                    if not isinstance(metadata, dict):
                        metadata = {}
                    folder_name = deps.conversion_folder_name_from_metadata(metadata, psarc_file)
                    save_target = deps.resolve_converted_save_target(
                        output_base,
                        metadata,
                        psarc_file,
                        folder_name,
                        output_name_pattern,
                    )
                    save_target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(temp_feedpak, save_target)
                    converted.append(str(save_target))
                except Exception as exc:
                    failures.append({"file": str(psarc_file), "error": str(exc)})
                finally:
                    try:
                        temp_feedpak.unlink(missing_ok=True)
                    except Exception:
                        pass

            if not converted:
                first_error = failures[0]["error"] if failures else "Unknown conversion error"
                raise RuntimeError(first_error)

            step_text = f"Batch conversion completed: {len(converted)}/{total} converted"
            if failures:
                step_text += f", {len(failures)} failed"
            job.update(
                status="done",
                step=step_text,
                progress=100,
                sourceFolder=str(source_dir),
                outputFolder=str(output_base),
                convertedCount=len(converted),
                failedCount=len(failures),
                converted=converted[:200],
                errors=failures[:200],
            )
        except Exception as exc:
            job.update(status="error", step="Error", error=str(exc), progress=100)

    return process_open_job, process_demucs_job, process_batch_psarc_job
