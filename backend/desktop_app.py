from __future__ import annotations

import os
import multiprocessing
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from app.optional_runtime import configure_optional_ai_runtime, resolve_data_root

HOST = "127.0.0.1"
PORT = int(os.environ.get("FEEDBACK_STUDIO_PORT", "8000"))


def log(message: str) -> None:
    """Write diagnostics only when the process has an attached console."""
    if sys.stdout is not None:
        print(message)


def ensure_standard_streams() -> None:
    """Give logging libraries valid streams in a windowed PyInstaller app."""
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")


def run_embedded_python_command() -> int | None:
    """Support internal ``sys.executable -c`` workers in frozen builds.

    Demucs and lyrics-transcriber deliberately run in child processes. A
    PyInstaller executable is not a normal Python interpreter, so dispatch the
    small bootstrap snippets explicitly when the packaged executable is invoked
    with Python's ``-c`` convention.
    """
    if len(sys.argv) < 3 or sys.argv[1] != "-c":
        return None
    code = sys.argv[2]
    sys.argv = ["-c", *sys.argv[3:]]
    namespace = {"__name__": "__main__", "__file__": "<string>"}
    try:
        exec(compile(code, "<string>", "exec"), namespace, namespace)
        return 0
    except SystemExit as exc:
        return int(exc.code or 0)


def wait_for_server(host: str, port: int, timeout_seconds: float = 30.0) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def port_is_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def pick_free_port(host: str, preferred_port: int, *, max_checks: int = 20) -> int:
    for candidate in range(preferred_port, preferred_port + max_checks):
        if port_is_available(host, candidate):
            return candidate
    raise RuntimeError(f"No free TCP port found in range {preferred_port}-{preferred_port + max_checks - 1}")


def main() -> int:
    server: uvicorn.Server | None = None
    thread: threading.Thread | None = None

    # Keep this import inside the normal launcher path so PyInstaller can see
    # the backend entrypoint without loading it in optional AI worker processes.
    from app.main import app as backend_app

    try:
        run_port = pick_free_port(HOST, PORT)
    except Exception as exc:
        log(f"Cannot find a free local port: {exc}")
        return 1

    if run_port != PORT:
        log(f"Port {PORT} is busy; launching a fresh backend on port {run_port}.")

    config = uvicorn.Config(backend_app, host=HOST, port=run_port, reload=False, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    if not wait_for_server(HOST, run_port):
        log("Backend did not start in time.")
        if server is not None:
            server.should_exit = True
        if thread is not None:
            thread.join(timeout=3)
        return 1

    if "--smoke-test" in sys.argv:
        try:
            with urllib.request.urlopen(f"http://{HOST}:{run_port}/api/health", timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError(f"Unexpected health status: {response.status}")
            log("feedBack Studio packaged smoke test passed.")
        except Exception as exc:
            log(f"Packaged smoke test failed: {exc}")
            server.should_exit = True
            thread.join(timeout=5)
            return 1
        server.should_exit = True
        thread.join(timeout=5)
        return 0

    cache_buster = int(time.time())
    url = f"http://{HOST}:{run_port}/?v={cache_buster}"
    try:
        import webview  # type: ignore

        webview.create_window("feedBack Studio", url, min_size=(1200, 760))
        webview.start()
    except Exception as exc:
        log(f"Desktop webview not available ({exc}). Opening browser instead: {url}")
        webbrowser.open(url)
        log("Press Ctrl+C to close.")
        try:
            while thread.is_alive():
                thread.join(timeout=1)
        except KeyboardInterrupt:
            pass

    if server is not None:
        server.should_exit = True
        if thread is not None:
            thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    ensure_standard_streams()
    multiprocessing.freeze_support()
    configure_optional_ai_runtime(resolve_data_root(Path(__file__).resolve().parent))
    embedded_result = run_embedded_python_command()
    raise SystemExit(main() if embedded_result is None else embedded_result)
