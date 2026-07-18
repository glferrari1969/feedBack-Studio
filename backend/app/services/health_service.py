from __future__ import annotations

from pathlib import Path

from app.native_tools import find_ffmpeg, find_vgmstream
from app.runtime_state import DEFAULT_WORKSPACE, PROJECTS_ROOT
from app.services.lyrics_engine_service import lyrics_transcriber_available


def build_health_payload() -> dict:
    try:
        from lyrics_transcribe import whisperx_available as _whisperx_available  # type: ignore
    except Exception:
        def _whisperx_available() -> bool:
            return False

    try:
        import rs_sng_xml  # type: ignore

        python_converter_found = True
        python_converter_path = str(Path(rs_sng_xml.__file__).resolve())
    except Exception:
        python_converter_found = False
        python_converter_path = None

    ffmpeg = find_ffmpeg()
    vgmstream = find_vgmstream()
    return {
        "status": "ok",
        "sngPythonConverterFound": python_converter_found,
        "sngPythonConverterPath": python_converter_path,
        "ffmpegFound": bool(ffmpeg),
        "ffmpegPath": str(ffmpeg) if ffmpeg else None,
        "vgmstreamFound": bool(vgmstream),
        "vgmstreamPath": str(vgmstream) if vgmstream else None,
        "lyricsTranscriberAvailable": lyrics_transcriber_available(),
        "whisperxAvailable": _whisperx_available(),
        "workspacePath": str(DEFAULT_WORKSPACE.resolve()),
        "workingProjectsPath": str(PROJECTS_ROOT.resolve()),
    }
