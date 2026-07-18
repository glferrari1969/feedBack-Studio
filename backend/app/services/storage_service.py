from __future__ import annotations

import shutil
import zipfile
from pathlib import Path


def safe_output_dir(output_dir: str | None, *, default_workspace: Path) -> Path:
    path = Path(output_dir).expanduser().resolve() if output_dir and output_dir.strip() else default_workspace.resolve()
    path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir():
        raise ValueError("Invalid output folder")
    return path


def unpack_sloppack(sloppack: Path, project_dir: Path) -> Path:
    source = project_dir / "sloppack"
    if source.exists():
        shutil.rmtree(source)
    source.mkdir(parents=True, exist_ok=True)
    if sloppack.is_dir():
        shutil.copytree(sloppack, source, dirs_exist_ok=True)
    else:
        with zipfile.ZipFile(sloppack, "r") as zf:
            zf.extractall(source)
    return source


def pack_sloppack(source_dir: Path, out_file: Path) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_file.with_suffix(out_file.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in source_dir.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(source_dir).as_posix())
    tmp.replace(out_file)


def _read_path_marker(path: Path) -> Path | None:
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return None
    try:
        return Path(raw).expanduser().resolve()
    except Exception:
        return None


def project_original_save_path(source_dir: Path, project: dict | None = None) -> Path:
    candidate = None
    if project:
        candidate = project.get("originalSloppackPath") or project.get("sloppackPath")
    if candidate:
        try:
            return Path(str(candidate)).expanduser().resolve()
        except Exception:
            pass
    marked = _read_path_marker(source_dir.parent / "save_target.txt")
    if marked:
        return marked
    return (source_dir.parent / "source.feedpak").resolve()


def project_working_save_path(source_dir: Path, project: dict | None = None) -> Path:
    candidate = None
    if project:
        candidate = project.get("workingSloppackPath")
    if candidate:
        try:
            return Path(str(candidate)).expanduser().resolve()
        except Exception:
            pass
    marked = _read_path_marker(source_dir.parent / "working_target.txt")
    if marked:
        return marked
    return (source_dir.parent / "working.sloppack").resolve()


def project_save_path(source_dir: Path, project: dict | None = None) -> Path:
    return project_original_save_path(source_dir, project)


def remember_save_path(source_dir: Path, save_path: Path) -> None:
    try:
        (source_dir.parent / "save_target.txt").write_text(str(save_path.resolve()), encoding="utf-8")
    except Exception:
        pass


def remember_working_save_path(source_dir: Path, save_path: Path) -> None:
    try:
        (source_dir.parent / "working_target.txt").write_text(str(save_path.resolve()), encoding="utf-8")
    except Exception:
        pass


def pack_working_sloppack(source_dir: Path, project: dict | None = None) -> Path:
    target = project_working_save_path(source_dir, project)
    pack_sloppack(source_dir, target)
    remember_working_save_path(source_dir, target)
    return target


def pack_current_sloppack(source_dir: Path, project: dict | None = None) -> Path:
    target = project_original_save_path(source_dir, project)
    pack_sloppack(source_dir, target)
    remember_save_path(source_dir, target)
    return target
