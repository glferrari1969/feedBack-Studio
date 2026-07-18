from __future__ import annotations

import json
from pathlib import Path


DEFAULT_OUTPUT_DIR_KEY = "default_output_dir"
OUTPUT_NAME_PATTERN_KEY = "output_name_pattern"
DEFAULT_OUTPUT_NAME_PATTERN = r"<Artist>\<Album>\<Artist>-<Album>-<Name>-<Version>"


def read_settings(settings_path: Path) -> dict:
    if not settings_path.exists():
        return {}
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def write_settings(settings_path: Path, data: dict) -> None:
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get_default_output_dir(settings_path: Path) -> str:
    data = read_settings(settings_path)
    value = data.get(DEFAULT_OUTPUT_DIR_KEY)
    if not isinstance(value, str):
        return ""
    return value.strip()


def set_default_output_dir(settings_path: Path, output_dir: str) -> str:
    cleaned = str(output_dir or "").strip()
    if cleaned:
        path = Path(cleaned).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        cleaned = str(path)

    data = read_settings(settings_path)
    data[DEFAULT_OUTPUT_DIR_KEY] = cleaned
    write_settings(settings_path, data)
    return cleaned


def get_output_name_pattern(settings_path: Path) -> str:
    data = read_settings(settings_path)
    value = data.get(OUTPUT_NAME_PATTERN_KEY)
    if not isinstance(value, str):
        return DEFAULT_OUTPUT_NAME_PATTERN
    return value.strip() or DEFAULT_OUTPUT_NAME_PATTERN


def set_output_name_pattern(settings_path: Path, pattern: str) -> str:
    cleaned = str(pattern or "").strip() or DEFAULT_OUTPUT_NAME_PATTERN
    data = read_settings(settings_path)
    data[OUTPUT_NAME_PATTERN_KEY] = cleaned
    write_settings(settings_path, data)
    return cleaned
