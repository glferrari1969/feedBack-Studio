from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Dict

APP_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = APP_ROOT / "lib"
PROJECT_ROOT = APP_ROOT.parent
FRONTEND_DIST = PROJECT_ROOT / "dist"
FRONTEND_INDEX = FRONTEND_DIST / "index.html"

DEFAULT_WORKSPACE = APP_ROOT / "workspace"
DEFAULT_WORKSPACE.mkdir(parents=True, exist_ok=True)
# feedBack Studio keeps all editable working copies inside this backend folder.
# The original user file is never used as a workspace; it is touched only by
# the explicit "Write to original sloppack" commit action.
PROJECTS_ROOT = DEFAULT_WORKSPACE / "projects"
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
UPLOADS = DEFAULT_WORKSPACE / "uploads"
UPLOADS.mkdir(parents=True, exist_ok=True)

jobs: Dict[str, Dict[str, Any]] = {}
projects_by_id: Dict[str, Path] = {}

FILE_DIALOG_TYPES = {
    "sloppack": [
        ("feedBack Studio packages", "*.sloppack *.sloppak *.feedpak *.zip"),
        ("All files", "*.*"),
    ],
    "psarc": [
        ("Rocksmith PSARC", "*.psarc"),
        ("All files", "*.*"),
    ],
    "audio": [
        ("Audio files", "*.mp3 *.wav *.flac *.m4a *.ogg"),
        ("All files", "*.*"),
    ],
}

SLOPPAK_INPUT_SUFFIXES = {".sloppack", ".sloppak", ".feedpak", ".zip"}


def cleanup_backend_workspace_on_startup() -> None:
    """Purge the whole backend runtime workspace when the app boots.

    This prevents stale temporary data from accumulating across app launches.
    """
    DEFAULT_WORKSPACE.mkdir(parents=True, exist_ok=True)
    for child in DEFAULT_WORKSPACE.iterdir():
        try:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
        except Exception:
            pass
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)
    jobs.clear()
    projects_by_id.clear()


def cleanup_backend_working_directory() -> None:
    """Remove orphaned backend working projects before opening a new file.

    This deliberately cleans only backend/workspace/projects. It does not touch
    backend/workspace/uploads, bundled tools, or any user-selected folder such as
    C:\temp. The active in-memory project map is cleared because a new open
    operation replaces the current editing session.
    """
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    for child in PROJECTS_ROOT.iterdir():
        try:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
        except Exception:
            pass
    projects_by_id.clear()


def make_backend_project_dir(job_id: str) -> Path:
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    project_dir = PROJECTS_ROOT / job_id
    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir
