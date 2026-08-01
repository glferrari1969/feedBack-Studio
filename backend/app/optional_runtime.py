from __future__ import annotations

import os
import sys
from pathlib import Path


_DLL_DIRECTORY_HANDLES: list[object] = []


def resolve_data_root(source_root: Path) -> Path:
    configured = os.environ.get("FEEDBACK_STUDIO_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if getattr(sys, "frozen", False):
        local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
        if local_app_data:
            return Path(local_app_data) / "feedBack Studio"
        return Path.home() / "AppData" / "Local" / "feedBack Studio"
    return source_root


def optional_ai_python(data_root: Path) -> Path:
    return data_root / "ai-env" / "Scripts" / "python.exe"


def configure_optional_ai_runtime(data_root: Path) -> bool:
    """Expose installer-managed AI packages to the packaged interpreter."""
    site_packages = data_root / "ai-env" / "Lib" / "site-packages"
    if not site_packages.is_dir():
        return False

    site_text = str(site_packages)
    if site_text not in sys.path:
        # Keep bundled core packages authoritative while allowing optional AI
        # modules to resolve from the installer-managed environment.
        sys.path.append(site_text)

    if os.name == "nt" and hasattr(os, "add_dll_directory"):
        for relative in ("torch/lib", "torchaudio/lib", "ctranslate2"):
            dll_dir = site_packages / relative
            if not dll_dir.is_dir():
                continue
            try:
                _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(dll_dir)))
            except OSError:
                pass
    os.environ.setdefault("FEEDBACK_STUDIO_AI_PYTHON", str(optional_ai_python(data_root)))
    return True
