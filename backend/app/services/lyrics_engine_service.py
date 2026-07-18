from __future__ import annotations

import shutil
import sys


def lyrics_transcriber_available() -> bool:
    """Return True when the installed lyrics-transcriber package/CLI is available."""
    try:
        import lyrics_transcriber  # type: ignore  # noqa: F401
        return True
    except Exception:
        return shutil.which("lyrics-transcriber") is not None


def lyrics_transcriber_cli() -> str:
    cli = shutil.which("lyrics-transcriber")
    if cli:
        return cli
    # The caller invokes cli_main with this interpreter when no launcher is on PATH.
    return sys.executable
