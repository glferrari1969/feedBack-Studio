from __future__ import annotations

import json
import os
import platform
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
TOOLS_ROOT = APP_ROOT / "tools"
FFMPEG_DIR = TOOLS_ROOT / "ffmpeg" / "bin"
VGMSTREAM_DIR = TOOLS_ROOT / "vgmstream"


def log(message: str) -> None:
    print(f"[setup_tools] {message}")


def is_windows() -> bool:
    return platform.system().lower().startswith("win")


def existing_exe(path: Path) -> bool:
    return path.exists() and path.is_file()


def ensure_ffmpeg() -> bool:
    """Install a local ffmpeg executable when it is not already available.

    ffmpeg is provided by the Python package imageio-ffmpeg. We copy its binary
    into backend/tools/ffmpeg/bin so both the backend and bundled libraries can
    find it without editing the global Windows PATH.
    """
    exe_name = "ffmpeg.exe" if is_windows() else "ffmpeg"
    local = FFMPEG_DIR / exe_name
    if existing_exe(local):
        log(f"ffmpeg gia' presente: {local}")
        return True

    try:
        import imageio_ffmpeg  # type: ignore
    except Exception as exc:
        log(f"imageio-ffmpeg non disponibile: {exc}")
        on_path = shutil.which("ffmpeg")
        if on_path:
            log(f"ffmpeg trovato nel PATH: {on_path}")
            return True
        return False

    try:
        source = Path(imageio_ffmpeg.get_ffmpeg_exe())
        if not source.exists():
            log(f"imageio-ffmpeg non ha restituito un eseguibile valido: {source}")
            return False
        FFMPEG_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, local)
        if not is_windows():
            local.chmod(local.stat().st_mode | 0o111)
        log(f"ffmpeg installato localmente: {local}")
        return True
    except Exception as exc:
        log(f"installazione ffmpeg fallita: {exc}")
        on_path = shutil.which("ffmpeg")
        if on_path:
            log(f"uso ffmpeg dal PATH come fallback: {on_path}")
            return True
        return False


def github_latest_assets(repo: str) -> list[dict]:
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "music-sync-frontend-setup"})
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return list(payload.get("assets", []))


def download(url: str, target: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "music-sync-frontend-setup"})
    with urllib.request.urlopen(req, timeout=180) as response, target.open("wb") as f:
        shutil.copyfileobj(response, f)


def ensure_vgmstream() -> bool:
    """Install vgmstream-cli locally on Windows.

    The PSARC import path uses vgmstream-cli to decode Rocksmith .wem audio.
    There is no normal pip package that installs this native executable, so we
    download the official prebuilt command-line archive from GitHub releases.
    """
    exe_name = "vgmstream-cli.exe" if is_windows() else "vgmstream-cli"
    local = VGMSTREAM_DIR / exe_name
    if existing_exe(local):
        log(f"vgmstream-cli gia' presente: {local}")
        return True

    env = os.environ.get("VGMSTREAM_CLI", "").strip()
    if env and existing_exe(Path(env)):
        log(f"vgmstream-cli trovato in VGMSTREAM_CLI: {env}")
        return True

    on_path = shutil.which("vgmstream-cli")
    if on_path:
        log(f"vgmstream-cli trovato nel PATH: {on_path}")
        return True

    if not is_windows():
        log("download automatico di vgmstream configurato per Windows; installalo manualmente o imposta VGMSTREAM_CLI")
        return False

    try:
        assets = github_latest_assets("vgmstream/vgmstream-releases")
        asset = next((a for a in assets if str(a.get("name", "")).lower() == "vgmstream-win64.zip"), None)
        if asset is None:
            asset = next((a for a in assets if "win64" in str(a.get("name", "")).lower() and str(a.get("name", "")).lower().endswith(".zip")), None)
        if asset is None:
            log("asset vgmstream-win64.zip non trovato nella release GitHub")
            return False
        url = str(asset.get("browser_download_url"))
        if not url:
            log("URL download vgmstream non valido")
            return False
        VGMSTREAM_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "vgmstream-win64.zip"
            log("scarico vgmstream-cli...")
            download(url, archive)
            with zipfile.ZipFile(archive, "r") as zf:
                zf.extractall(VGMSTREAM_DIR)
        found = next(VGMSTREAM_DIR.rglob("vgmstream-cli.exe"), None)
        if found is None:
            log("download completato, ma vgmstream-cli.exe non e' stato trovato nello ZIP")
            return False
        if found.resolve() != local.resolve():
            # Keep DLLs in their extracted positions, but also copy the CLI to
            # the expected root. If the original needs adjacent DLLs, backend
            # PATH includes the whole vgmstream directory and common layouts.
            shutil.copy2(found, local)
        log(f"vgmstream-cli installato localmente: {local}")
        return True
    except Exception as exc:
        log(f"installazione vgmstream-cli fallita: {exc}")
        return False


def main() -> int:
    TOOLS_ROOT.mkdir(parents=True, exist_ok=True)
    ok_ffmpeg = ensure_ffmpeg()
    ok_vgmstream = ensure_vgmstream()
    if ok_ffmpeg and ok_vgmstream:
        log("tool nativi pronti")
        return 0
    log("alcuni tool non sono stati installati automaticamente; il backend partira', ma alcune conversioni potrebbero fallire")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
