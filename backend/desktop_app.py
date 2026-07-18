from __future__ import annotations

import os
import socket
import threading
import time
import webbrowser

import uvicorn

HOST = "127.0.0.1"
PORT = int(os.environ.get("FEEDBACK_STUDIO_PORT", "8000"))


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


def main() -> int:
    server: uvicorn.Server | None = None
    thread: threading.Thread | None = None

    if port_is_available(HOST, PORT):
        config = uvicorn.Config("app.main:app", host=HOST, port=PORT, reload=False, log_level="info")
        server = uvicorn.Server(config)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()

        if not wait_for_server(HOST, PORT):
            print("Backend did not start in time.")
            if server is not None:
                server.should_exit = True
            if thread is not None:
                thread.join(timeout=3)
            return 1
    else:
        if not wait_for_server(HOST, PORT):
            print(f"Port {PORT} is already in use, but the backend did not become reachable in time.")
            return 1
        print(f"Port {PORT} is already in use; reusing the existing backend server.")

    url = f"http://{HOST}:{PORT}"
    try:
        import webview  # type: ignore

        webview.create_window("feedBack Studio", url, min_size=(1200, 760))
        webview.start()
    except Exception as exc:
        print(f"Desktop webview not available ({exc}). Opening browser instead: {url}")
        webbrowser.open(url)
        print("Press Ctrl+C to close.")
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
    raise SystemExit(main())
