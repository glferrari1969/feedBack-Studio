from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable


OUTPUT_NAME_TAG_PATTERN = re.compile(r"<\s*(artist|album|year|title|name|version)\s*>", re.IGNORECASE)


def sanitize_windows_name(
    value: str,
    fallback: str = "untitled",
    *,
    clean_metadata_value: Callable[[Any], str],
) -> str:
    cleaned = clean_metadata_value(value)
    cleaned = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', "-", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .-")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    if not cleaned or cleaned.split(".", 1)[0].upper() in reserved:
        cleaned = fallback
    return cleaned[:180].strip(" .") or fallback


def conversion_folder_name_from_metadata(
    metadata: dict,
    input_file: Path,
    *,
    sanitize_windows_name: Callable[[str, str], str],
    clean_metadata_value: Callable[[Any], str],
) -> str:
    artist = clean_metadata_value(metadata.get("artist"))
    album = clean_metadata_value(metadata.get("album"))
    title = clean_metadata_value(metadata.get("title"))
    if artist and album and title:
        return sanitize_windows_name(f"{artist} - {album} - {title}", input_file.stem)
    return sanitize_windows_name(input_file.stem, "converted_project")


def resolve_final_output_base(
    input_file: Path,
    output_dir: str | None,
    original_input_path: str | None = None,
    *,
    safe_output_dir: Callable[[str | None], Path],
) -> Path:
    """Choose where final converted packages are written."""
    if output_dir and output_dir.strip():
        return safe_output_dir(output_dir)
    candidates: list[Path] = []
    if original_input_path:
        try:
            candidates.append(Path(original_input_path).expanduser().resolve())
        except Exception:
            pass
    try:
        candidates.append(input_file.expanduser().resolve())
    except Exception:
        pass
    for candidate in candidates:
        try:
            if candidate.exists() and candidate.is_file():
                return safe_output_dir(str(candidate.parent))
        except Exception:
            continue
    return safe_output_dir("")


def _metadata_value_for_output_tag(
    metadata: dict,
    key: str,
    input_file: Path,
    *,
    clean_metadata_value: Callable[[Any], str],
) -> str:
    lowered = key.lower()
    if lowered == "name":
        lowered = "title"
    direct = clean_metadata_value(metadata.get(lowered))
    if direct:
        return direct

    nested = metadata.get("metadata")
    if isinstance(nested, dict):
        nested_value = clean_metadata_value(
            nested.get(lowered) or nested.get(lowered.capitalize()) or nested.get(lowered.upper())
        )
        if nested_value:
            return nested_value

    if lowered == "version" and isinstance(nested, dict):
        for alias in ("revision", "Revision", "REVISION"):
            value = clean_metadata_value(nested.get(alias))
            if value:
                return value

    if lowered == "title":
        return clean_metadata_value(input_file.stem)
    return ""


def _pattern_parts_from_metadata(
    output_name_pattern: str,
    metadata: dict,
    input_file: Path,
    *,
    sanitize_windows_name: Callable[[str, str], str],
    clean_metadata_value: Callable[[Any], str],
) -> list[str]:
    pattern = str(output_name_pattern or "").strip()
    if not pattern:
        return []

    def replace_tag(match: re.Match[str]) -> str:
        key = str(match.group(1) or "").lower()
        value = _metadata_value_for_output_tag(
            metadata,
            key,
            input_file,
            clean_metadata_value=clean_metadata_value,
        )
        # Metadata is untrusted path content. Sanitize each substituted value
        # before parsing the pattern separators, otherwise an artist/title
        # containing a slash or backslash could create unintended folders.
        return sanitize_windows_name(value, "untitled") if value else ""

    rendered = OUTPUT_NAME_TAG_PATTERN.sub(replace_tag, pattern).replace("/", "\\")
    raw_parts = [part.strip() for part in rendered.split("\\")]

    parts: list[str] = []
    for raw in raw_parts:
        if not raw:
            continue
        normalized = re.sub(r"\s+", " ", raw).strip(" .")
        normalized = normalized.strip(" -_.")
        if not normalized:
            continue
        parts.append(sanitize_windows_name(normalized, "untitled"))

    if parts:
        return parts
    return [sanitize_windows_name(input_file.stem, "converted_project")]


def resolve_converted_save_target(
    output_base: Path,
    metadata: dict,
    input_file: Path,
    fallback_folder_name: str,
    output_name_pattern: str,
    *,
    sanitize_windows_name: Callable[[str, str], str],
    clean_metadata_value: Callable[[Any], str],
) -> Path:
    pattern_parts = _pattern_parts_from_metadata(
        output_name_pattern,
        metadata,
        input_file,
        sanitize_windows_name=sanitize_windows_name,
        clean_metadata_value=clean_metadata_value,
    )

    if not pattern_parts:
        final_folder = output_base / sanitize_windows_name(fallback_folder_name, "converted_project")
        final_folder.mkdir(parents=True, exist_ok=True)
        return final_folder / f"{sanitize_windows_name(final_folder.name, 'feedpak')}.feedpak"

    file_stem = sanitize_windows_name(pattern_parts[-1], "feedpak")
    if len(pattern_parts) > 1:
        parent = output_base.joinpath(*pattern_parts[:-1])
    else:
        parent = output_base
    parent.mkdir(parents=True, exist_ok=True)
    return parent / f"{file_stem}.feedpak"
