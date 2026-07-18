from __future__ import annotations

import os
import shutil
from pathlib import Path

from app.runtime_state import APP_ROOT


def find_local_tool(*parts: str) -> Path | None:
    candidate = APP_ROOT.joinpath("tools", *parts)
    try:
        if candidate.exists() and candidate.is_file():
            return candidate.resolve()
    except Exception:
        return None
    return None


def configure_native_tools_env() -> None:
    """Expose bundled/native helper tools to subprocesses and bundled libraries.

    requirements.txt can install Python packages only. Tools such as ffmpeg and
    vgmstream-cli are native executables, so setup_tools.py installs them below
    backend/tools and this function makes them discoverable without requiring
    the user to edit the Windows PATH manually.
    """
    tool_dirs: list[Path] = []
    ffmpeg_dir = APP_ROOT / "tools" / "ffmpeg" / "bin"
    vgmstream_dir = APP_ROOT / "tools" / "vgmstream"
    for d in (ffmpeg_dir, vgmstream_dir):
        if d.exists() and d.is_dir():
            tool_dirs.append(d.resolve())
    if tool_dirs:
        current = os.environ.get("PATH", "")
        os.environ["PATH"] = os.pathsep.join([str(d) for d in tool_dirs] + ([current] if current else []))
    vgm = find_local_tool("vgmstream", "vgmstream-cli.exe") or find_local_tool("vgmstream", "vgmstream-cli")
    if vgm and "VGMSTREAM_CLI" not in os.environ:
        os.environ["VGMSTREAM_CLI"] = str(vgm)


def find_ffmpeg() -> Path | None:
    local = find_local_tool("ffmpeg", "bin", "ffmpeg.exe") or find_local_tool("ffmpeg", "bin", "ffmpeg")
    if local:
        return local
    found = shutil.which("ffmpeg")
    return Path(found).resolve() if found else None


def find_vgmstream() -> Path | None:
    local = find_local_tool("vgmstream", "vgmstream-cli.exe") or find_local_tool("vgmstream", "vgmstream-cli")
    if local:
        return local
    env = os.environ.get("VGMSTREAM_CLI", "").strip()
    if env and Path(env).exists():
        return Path(env).resolve()
    found = shutil.which("vgmstream-cli")
    return Path(found).resolve() if found else None
