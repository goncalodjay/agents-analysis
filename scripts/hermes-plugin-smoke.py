#!/usr/bin/env python3
"""End-to-end smoke test for the agents-analysis Hermes plugin.

Loads the plugin from the installed path using the same pattern Hermes'
plugin_loader.py uses (see plugin_loader.py:_new_module), drives every
hook with a synthetic scenario, then verifies the daemon received a
wire-valid consultation.completed event with all expected fields.

Run from the repo root after `npm run test`:
  python3 scripts/hermes-plugin-smoke.py

Exits 0 on success, prints the captured event to stdout on success and
non-zero on any failure.
"""
from __future__ import annotations

import importlib.util
import json
import os
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any


PLUGIN_DIR = Path(
    os.environ.get("HERMES_PLUGIN_DIR")
    or os.path.expanduser("~/.hermes/plugins/agents-analysis")
)


class _Daemon:
    """Minimal Unix-socket daemon that mirrors the agents-analysis wire
    protocol: one JSON event per connection, replies with
    `{accepted: bool, id?: str, reason?: str}`. All received events are
    stashed in `received` for the test to assert on.
    """

    def __init__(self, socket_path: str) -> None:
        self.socket_path = socket_path
        self.received: list[dict[str, Any]] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._server: socket.socket | None = None

    def start(self) -> None:
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)
        self._server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._server.bind(self.socket_path)
        self._server.listen(8)
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()
        # Wait until the socket is actually connectable. We connect with
        # a sentinel payload so the daemon's JSON parser is satisfied and
        # the startup probe doesn't show up in the daemon's error log.
        deadline = time.time() + 5.0
        last_error: OSError | None = None
        while time.time() < deadline:
            try:
                s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                s.settimeout(0.05)
                s.connect(self.socket_path)
                # A real agents-analysis event; the daemon will accept it
                # and add it to received — we then pop it before the
                # assertions run so the test only sees real events.
                s.sendall(b'{"probe":true}\n')
                s.close()
                # Wait for the daemon thread to record the probe before
                # returning, so the assertion below sees only the test's
                # own events, not the probe.
                time.sleep(0.05)
                self.received.clear()
                return
            except OSError as exc:
                last_error = exc
                time.sleep(0.02)
        raise RuntimeError(f"daemon never became ready: {last_error}")

    def _serve(self) -> None:
        assert self._server is not None
        try:
            while not self._stop.is_set():
                try:
                    conn, _ = self._server.accept()
                except OSError:
                    return
                self._handle(conn)
        except Exception as e:  # pragma: no cover - background thread
            print(f"daemon _serve crashed: {e}", file=sys.stderr, flush=True)

    def _handle(self, conn: socket.socket) -> None:
        try:
            data = b""
            # Read until the client closes (mirrors the real daemon's
            # behaviour — see src/capture/daemon.ts).
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                data += chunk
            event = json.loads(data.decode("utf-8").strip())
            # The startup probe sends a sentinel without an "id" — accept
            # silently rather than log. The probe is a single connection
            # round-trip and not part of the assertion list.
            if "id" not in event:
                conn.sendall(b'{"accepted":true}\n')
                return
            self.received.append(event)
            reply = json.dumps({"accepted": True, "id": event["id"]}).encode("utf-8")
            conn.sendall(reply + b"\n")
        except OSError as exc:
            # Broken pipe is benign — the client closed before the daemon
            # finished writing its reply. Same race the real daemon sees
            # every turn. Log only non-broken-pipe errors.
            if exc.errno not in (32,):  # EPIPE
                print(f"daemon handler OSError: {exc}", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"daemon handler error: {exc}", file=sys.stderr, flush=True)
            try:
                conn.sendall(json.dumps({"accepted": False, "reason": str(exc)}).encode("utf-8"))
            except OSError:
                pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def stop(self) -> None:
        self._stop.set()
        if self._server is not None:
            try:
                self._server.close()
            except OSError:
                pass
        if self._thread is not None:
            self._thread.join(timeout=2.0)


def _load_plugin(plugin_dir: Path, module_name: str) -> Any:
    """Mirror plugin_loader.py:_new_module + the sibling preload loop.
    Reserves the module name in sys.modules, pre-loads *.py siblings so
    `from .state import ...` resolves, then executes __init__.py.
    """
    init_file = plugin_dir / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        module_name, str(init_file), submodule_search_locations=[str(plugin_dir)]
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load plugin at {plugin_dir}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    for sub in plugin_dir.glob("*.py"):
        if sub.name == "__init__.py":
            continue
        sub_name = f"{module_name}.{sub.stem}"
        sub_spec = importlib.util.spec_from_file_location(sub_name, str(sub))
        if sub_spec is None or sub_spec.loader is None:
            continue
        sub_mod = importlib.util.module_from_spec(sub_spec)
        sys.modules[sub_name] = sub_mod
        sub_spec.loader.exec_module(sub_mod)
        setattr(mod, sub.stem, sub_mod)
    spec.loader.exec_module(mod)
    return mod


def _drive(plugin: Any, socket_path: str, outbox_path: str) -> None:
    os.environ["AGENTS_ANALYSIS_DAEMON"] = f"unix://{socket_path}"
    os.environ["AGENTS_ANALYSIS_HERMES_OUTBOX"] = outbox_path
    os.environ["AGENTS_ANALYSIS_HERMES_ENABLED"] = "1"

    hooks: dict[str, Any] = {}

    class _Ctx:
        def register_hook(self, name: str, fn: Any) -> None:
            hooks[name] = fn

    plugin.register(_Ctx())

    hooks["pre_api_request"](
        session_id="ses-smoke",
        turn_id="turn-smoke",
        api_request_id="req-smoke-1",
        provider="anthropic",
        model="claude-sonnet-4.5",
        reasoning_level="",
        started_at="2026-01-01T00:00:00.000Z",
        request={
            "system": "be brief",
            "messages": [{"role": "user", "content": "summarise"}],
        },
    )
    hooks["post_api_request"](
        session_id="ses-smoke",
        turn_id="turn-smoke",
        api_request_id="req-smoke-1",
        provider="anthropic",
        model="claude-sonnet-4.5",
        started_at="2026-01-01T00:00:00.000Z",
        ended_at="2026-01-01T00:00:01.000Z",
        usage={"input_tokens": 100, "output_tokens": 50, "reasoning_tokens": 10, "cache_read_tokens": 40},
        response={"content": [{"type": "text", "text": "summary"}]},
    )
    hooks["pre_tool_call"](
        session_id="ses-smoke",
        turn_id="turn-smoke",
        tool_call_id="call-smoke",
        tool_name="terminal",
        args={"command": "ls"},
        started_at="2026-01-01T00:00:00.000Z",
    )
    hooks["post_tool_call"](
        session_id="ses-smoke",
        turn_id="turn-smoke",
        tool_call_id="call-smoke",
        tool_name="terminal",
        status="ok",
        result="file1\nfile2",
        ended_at="2026-01-01T00:00:00.500Z",
    )
    hooks["on_session_end"](session_id="ses-smoke")


def _verify(events: list[dict[str, Any]]) -> dict[str, Any]:
    assert len(events) == 1, f"expected one event, got {len(events)}"
    event = events[0]
    assert event["type"] == "consultation.completed"
    assert event["version"] == 1
    assert event["agent"] == "hermes"
    assert event["identity"]["provider"] == "anthropic"
    assert event["identity"]["model"] == "claude-sonnet-4.5"
    assert event["content"]["systemPrompt"] == "be brief"
    assert event["content"]["userPrompt"] == "summarise"
    assert event["content"]["response"] == "summary"
    assert event["usage"] == {
        "input": 100,
        "prompt": 40,
        "thinking": 10,
        "output": 50,
        "cacheRead": 40,
        "cacheWrite": 0,
    }
    assert len(event["tools"]) == 1
    assert event["tools"][0]["name"] == "terminal"
    assert event["tools"][0]["input"] == {"command": "ls"}
    assert event["tools"][0]["output"] == "file1\nfile2"
    return event


def main() -> int:
    if not PLUGIN_DIR.exists():
        print(f"plugin not installed at {PLUGIN_DIR}; run scripts/install-hermes-plugin first", file=sys.stderr)
        return 2

    # Enable plugin debug logging when DEBUG=1 (default) so a failure shows
    # what the plugin tried before timing out. Set DEBUG=0 to silence.
    import logging
    if os.environ.get("DEBUG", "1") != "0":
        logging.basicConfig(level=logging.DEBUG, format="%(levelname)s:%(name)s:%(message)s", stream=sys.stderr)

    with tempfile.TemporaryDirectory(prefix="agents-analysis-hermes-smoke-") as td:
        socket_path = os.path.join(td, "daemon.sock")
        outbox_path = os.path.join(td, "outbox.json")
        daemon = _Daemon(socket_path)
        daemon.start()
        try:
            plugin = _load_plugin(PLUGIN_DIR, "agents_analysis_smoke")
            _drive(plugin, socket_path, outbox_path)
            # Best-effort: the outbox flushes inline, but yield once so
            # the daemon thread observes the close.
            time.sleep(0.05)
            assert len(daemon.received) == 1, f"expected one event, got {len(daemon.received)}"
            event = _verify(daemon.received)
            print(f"smoke ok: id={event['id']} model={event['identity']['model']} usage={event['usage']}")
            return 0
        finally:
            daemon.stop()


if __name__ == "__main__":
    sys.exit(main())