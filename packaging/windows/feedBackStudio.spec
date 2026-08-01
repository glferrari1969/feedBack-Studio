import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata


SPEC_DIR = Path(SPECPATH).resolve()
ROOT = SPEC_DIR.parents[1]
BACKEND = ROOT / "backend"
CONSOLE_BUILD = os.environ.get("FEEDBACK_STUDIO_CONSOLE_BUILD", "") == "1"

datas = [
    (str(ROOT / "dist"), "dist"),
    (str(BACKEND / "lib"), "lib"),
    (str(BACKEND / "tools"), "tools"),
    (str(ROOT / "LICENSE"), "."),
]
binaries = []
hiddenimports = collect_submodules("app")

for package in (
    "webview",
    "uvicorn",
    "fastapi",
    "multipart",
    "imageio_ffmpeg",
    "librosa",
    "reportlab",
    "svglib",
):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

for distribution in (
    "fastapi",
    "uvicorn",
    "python-multipart",
    "pywebview",
    "imageio-ffmpeg",
    "librosa",
):
    try:
        datas += copy_metadata(distribution, recursive=True)
    except Exception:
        pass

hiddenimports += [
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
]

a = Analysis(
    [str(BACKEND / "desktop_app.py")],
    pathex=[str(BACKEND), str(BACKEND / "lib")],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "pytest",
        "torch",
        "torchaudio",
        "torchcodec",
        "demucs",
        "whisperx",
        "lyrics_transcriber",
        "transformers",
        "faster_whisper",
        "ctranslate2",
        "onnxruntime",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="feedBackStudio",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=CONSOLE_BUILD,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(SPEC_DIR / "feedBackStudio.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="feedBackStudio",
)
