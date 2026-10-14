"""agents-analysis — Hermes observer plugin that forwards every Hermes turn
to the agents-analysis daemon, so the existing TUI shows Hermes sessions
alongside Pi, opencode, and Claude Code.

The plugin is fail-open: every hook callback is wrapped to swallow
exceptions (Hermes would do the same, but doing it ourselves keeps the
log message targeted and prevents telemetry problems from looking like
agent failures in the user's CLI). It registers only the observer hooks
documented at hermes-agent.nousresearch.com/docs/observability — nothing
in here rewrites requests or tool arguments.

The daemon speaks a tiny Unix-socket protocol (one JSON event per
connection); the same outbox+retry machinery used by the other adapters
keeps events durable across restarts.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterable

from .state import TurnAccumulator, _to_ms

logger = logging.getLogger("agents_analysis.hermes")

# ---------------------------------------------------------------------------
# Wire protocol — mirrors extensions/agents-analysis/outbox.ts. Kept as a
# tiny self-contained implementation here because Hermes plugins run from
# ~/.hermes/plugins/agents-analysis/, which is *not* on Python's import
# path for this repo's TypeScript outbox; copying the contract is cheaper
# (and less coupled) than teaching the plugin to shell out to node.
# ---------------------------------------------------------------------------

ENV_DAEMON = "AGENTS_ANALYSIS_DAEMON"
ENV_OUTBOX = "AGENTS_ANALYSIS_HERMES_OUTBOX"
ENV_ENABLED = "AGENTS_ANALYSIS_HERMES_ENABLED"

DEFAULT_DAEMON_ADDRESS = "unix://~/.local/share/agents-analysis/daemon.sock"
DEFAULT_OUTBOX_PATH = "~/.local/share/agents-analysis/hermes-outbox.json"

# Bounded so a long-lived Hermes session can't grow the in-memory map
# without bound. Keyed by (session_id, turn_id); oldest entry evicted
# once the cap is reached. Matches the cap used by opencode's
# SystemPrompts (see extensions/opencode/plugin.ts).
_MAX_TRACKED_TURNS = 64


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def _home() -> str:
    return os.environ.get("HERMES_HOME") or os.path.expanduser("~")


def _resolve(path: str) -> str:
    """Resolve a leading ~/ against $HERMES_HOME when set, else ~."""
    if path == "~":
        return _home()
    if path.startswith("~/"):
        return str(Path(_home(), path[2:]))
    return path


def _socket_path(address: str) -> str:
    """`unix://~/.local/share/...` -> absolute socket path.

    Non-unix addresses are rejected because the daemon only listens on
    Unix sockets — same constraint the TypeScript outbox enforces.
    """
    if address.startswith("unix://"):
        return _resolve(address[len("unix://"):])
    raise ValueError(f"daemon address must use unix:// scheme, got {address!r}")


def _is_enabled() -> bool:
    raw = os.environ.get(ENV_ENABLED, "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _config() -> tuple[str, str]:
    address = os.environ.get(ENV_DAEMON) or DEFAULT_DAEMON_ADDRESS
    outbox = os.environ.get(ENV_OUTBOX) or DEFAULT_OUTBOX_PATH
    return _socket_path(address), _resolve(outbox)


# ---------------------------------------------------------------------------
# Outbox: append-and-rename on the daemon's outbox.json, plus a retry loop
# that flushes pending entries on every hook fire and on atexit.
# ---------------------------------------------------------------------------


_OUTBOX_LOCK = threading.Lock()
_OUTBOX_STATE: dict[str, Any] | None = None  # lazily loaded


def _outbox_path() -> str:
    return _config()[1]


def _read_outbox() -> dict[str, Any]:
    global _OUTBOX_STATE
    if _OUTBOX_STATE is not None:
        return _OUTBOX_STATE
    path = _outbox_path()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        data = {"pending": [], "delivered": []}
    except (json.JSONDecodeError, OSError) as exc:
        logger.debug("outbox read failed (%s); starting fresh", exc)
        data = {"pending": [], "delivered": []}
    pending = data.get("pending")
    delivered = data.get("delivered")
    _OUTBOX_STATE = {
        "pending": [e for e in pending if isinstance(e, dict)] if isinstance(pending, list) else [],
        "delivered": [e for e in delivered if isinstance(e, str)] if isinstance(delivered, list) else [],
    }
    return _OUTBOX_STATE


def _write_outbox(state: dict[str, Any]) -> None:
    path = _outbox_path()
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False)
        fh.write("\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def _enqueue_outbox(event: dict[str, Any]) -> None:
    with _OUTBOX_LOCK:
        state = _read_outbox()
        event_id = event.get("id")
        if not isinstance(event_id, str) or not event_id:
            return
        if event_id in state["delivered"]:
            return
        if any(e.get("id") == event_id for e in state["pending"]):
            return
        state["pending"].append(event)
        _write_outbox(state)


def _mark_delivered(event_id: str) -> None:
    with _OUTBOX_LOCK:
        state = _read_outbox()
        state["pending"] = [e for e in state["pending"] if e.get("id") != event_id]
        delivered = [e for e in state["delivered"] if e != event_id]
        delivered.append(event_id)
        # Bound the delivered list, mirroring the TypeScript outbox (last 1000).
        state["delivered"] = delivered[-1000:]
        _write_outbox(state)


def _send_to_daemon(event: dict[str, Any]) -> bool:
    socket_path, _ = _config()
    payload = f"{json.dumps(event, ensure_ascii=False)}\n".encode("utf-8")
    # Unix-domain sockets can't use socket.create_connection() (it tries to
    # unpack host/port); construct the socket directly. AF_UNIX is implied
    # when no host/port is given on Linux but we set it explicitly for
    # portability.
    sock: socket.socket | None = None
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(2.0)
        sock.connect(socket_path)
        sock.sendall(payload)
        # Half-close the write side so the daemon's read loop sees EOF and
        # proceeds to write its reply. Without this, the daemon can hang on
        # its read() until our timeout, and we race its write with our
        # close — net effect: we never see the reply and the event looks
        # rejected when it was actually accepted.
        sock.shutdown(socket.SHUT_WR)
        chunks: list[bytes] = []
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
        reply = b"".join(chunks).decode("utf-8", errors="replace").strip()
        try:
            parsed = json.loads(reply) if reply else {}
        except json.JSONDecodeError:
            parsed = {}
        # If the daemon never replied but the socket was healthy, assume
        # success: the real agents-analysis daemon always replies, so a
        # silent close most likely means it accepted and crashed on the
        # way out. Better to mark delivered than to retry forever.
        return bool(parsed.get("accepted")) if reply else True
    except (OSError, socket.timeout) as exc:
        logger.debug("daemon send failed (%s); keeping event in outbox", exc)
        return False
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


def _flush_outbox() -> None:
    """Try to deliver every pending event. Stops at the first failure so a
    down daemon does not waste cycles retrying the same broken socket.
    Re-reads pending after each delivery so an event that another concurrent
    caller already shipped is not re-sent.
    """
    for _ in range(64):  # bounded; same cap as the outbox's delivered list
        with _OUTBOX_LOCK:
            pending = _read_outbox().get("pending", [])
            event = pending[0] if pending else None
            event_id = str(event.get("id") or "") if event else ""
        if not event:
            return
        if not _send_to_daemon(event):
            return
        _mark_delivered(event_id)


# ---------------------------------------------------------------------------
# Per-turn state + dispatcher
# ---------------------------------------------------------------------------


# (session_id, turn_id) -> TurnAccumulator
_TURNS: dict[tuple[str, str], TurnAccumulator] = {}
_TURNS_LOCK = threading.Lock()


def _evict_oldest() -> None:
    """Bound the in-memory map: drop the oldest accumulator when full.

    Python dicts are insertion-ordered (3.7+), so the first key is the
    oldest one — the same heuristic opencode uses for its SystemPrompts
    cache (see extensions/opencode/plugin.ts).
    """
    while len(_TURNS) >= _MAX_TRACKED_TURNS:
        oldest_key = next(iter(_TURNS))
        _TURNS.pop(oldest_key, None)


def _get_or_create(session_id: str, turn_id: str) -> TurnAccumulator:
    key = (session_id, turn_id)
    with _TURNS_LOCK:
        acc = _TURNS.get(key)
        if acc is not None:
            return acc
        evict = len(_TURNS) >= _MAX_TRACKED_TURNS
    if evict:
        _evict_oldest()
    with _TURNS_LOCK:
        acc = _TURNS.get(key)
        if acc is not None:
            return acc
        acc = TurnAccumulator(session_id=session_id, turn_id=turn_id, started_at_ms=_now_ms())
        _TURNS[key] = acc
        return acc


def _drop_turn(session_id: str, turn_id: str) -> None:
    with _TURNS_LOCK:
        _TURNS.pop((session_id, turn_id), None)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _is_wire_valid(event: dict[str, Any]) -> bool:
    """Mirror the daemon's `hasRequiredIdentity` so we don't even try to
    ship an event the validator will reject. The validator is the
    canonical contract (see src/capture/event.ts); duplicating it here
    means the daemon never has to bounce a Hermes event back as
    `identidad obligatoria`, which would just be one extra socket round
    trip per turn on the unhappy path.
    """
    identity = event.get("identity") or {}
    required = ("sessionId", "turnId", "provider", "model")
    if not all(isinstance(identity.get(key), str) and identity.get(key) for key in required):
        return False
    usage = event.get("usage") or {}
    for key in ("input", "prompt", "thinking", "output", "cacheRead", "cacheWrite"):
        value = usage.get(key)
        if not isinstance(value, (int, float)) or value < 0:
            return False
    duration = event.get("durationMs")
    if not isinstance(duration, (int, float)) or duration < 0:
        return False
    if event.get("type") != "consultation.completed" or event.get("version") != 1:
        return False
    if not event.get("agent") or not event.get("id"):
        return False
    return True


def _emit(event: dict[str, Any]) -> None:
    if not _is_wire_valid(event):
        # Match the daemon's rejection language so the user sees the same
        # message in the outbox log whether the rejection came from us or
        # from the daemon itself.
        logger.debug("agents-analysis: skipping invalid event %s (provider/model missing?)", event.get("id"))
        return
    _enqueue_outbox(event)
    # Best-effort inline flush; if it fails the outbox keeps the event
    # and a later hook fire (or atexit hook) will retry.
    try:
        _flush_outbox()
    except Exception as exc:  # pragma: no cover - fail-open
        logger.debug("flush failed: %s", exc)


# ---------------------------------------------------------------------------
# Hook wrappers — the only thing `register(ctx)` hands to Hermes.
# Every wrapper is fail-open: exceptions are logged at debug level and
# swallowed. Hermes would also swallow them, but doing it here keeps the
# log message specific.
# ---------------------------------------------------------------------------


def _safe(label: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def wrap(fn: Callable[..., Any]) -> Callable[..., Any]:
        def inner(*args: Any, **kwargs: Any) -> Any:
            try:
                return fn(*args, **kwargs)
            except Exception as exc:  # pragma: no cover - fail-open
                logger.debug("agents-analysis %s hook failed: %s", label, exc)
        return inner
    return wrap


@_safe("pre_api_request")
def _on_pre_api_request(**kwargs: Any) -> None:
    session_id = str(kwargs.get("session_id") or "")
    turn_id = str(kwargs.get("turn_id") or "")
    if not session_id or not turn_id:
        return
    acc = _get_or_create(session_id, turn_id)
    acc.on_session_start(session_id=session_id, started_at_ms=_to_ms(kwargs.get("started_at")))
    acc.on_pre_api_request(kwargs)


@_safe("post_api_request")
def _on_post_api_request(**kwargs: Any) -> None:
    session_id = str(kwargs.get("session_id") or "")
    turn_id = str(kwargs.get("turn_id") or "")
    if not session_id or not turn_id:
        return
    acc = _get_or_create(session_id, turn_id)
    acc.on_post_api_request(kwargs)


@_safe("api_request_error")
def _on_api_request_error(**kwargs: Any) -> None:
    session_id = str(kwargs.get("session_id") or "")
    turn_id = str(kwargs.get("turn_id") or "")
    if not session_id or not turn_id:
        return
    acc = _get_or_create(session_id, turn_id)
    acc.on_api_request_error(kwargs)


@_safe("pre_tool_call")
def _on_pre_tool_call(**kwargs: Any) -> None:
    session_id = str(kwargs.get("session_id") or "")
    turn_id = str(kwargs.get("turn_id") or "")
    if not session_id or not turn_id:
        return
    acc = _get_or_create(session_id, turn_id)
    acc.on_pre_tool_call(kwargs)


@_safe("post_tool_call")
def _on_post_tool_call(**kwargs: Any) -> None:
    session_id = str(kwargs.get("session_id") or "")
    turn_id = str(kwargs.get("turn_id") or "")
    if not session_id or not turn_id:
        return
    acc = _get_or_create(session_id, turn_id)
    acc.on_post_tool_call(kwargs)


@_safe("subagent_start")
def _on_subagent_start(**kwargs: Any) -> None:
    # Subagent hooks carry parent_turn_id but not the parent's turn_id in
    # the same key — fall back to parent_turn_id from the payload.
    session_id = str(kwargs.get("parent_session_id") or kwargs.get("session_id") or "")
    turn_id = str(kwargs.get("parent_turn_id") or kwargs.get("turn_id") or "")
    if not session_id or not turn_id:
        return
    acc = _get_or_create(session_id, turn_id)
    acc.on_subagent_start(kwargs)


@_safe("subagent_stop")
def _on_subagent_stop(**kwargs: Any) -> None:
    session_id = str(kwargs.get("parent_session_id") or kwargs.get("session_id") or "")
    turn_id = str(kwargs.get("parent_turn_id") or kwargs.get("turn_id") or "")
    if not session_id or not turn_id:
        return
    acc = _get_or_create(session_id, turn_id)
    acc.on_subagent_stop(kwargs)


@_safe("post_llm_call")
def _on_post_llm_call(**kwargs: Any) -> None:
    session_id = str(kwargs.get("session_id") or "")
    turn_id = str(kwargs.get("turn_id") or "")
    if not session_id or not turn_id:
        return
    acc = _get_or_create(session_id, turn_id)
    acc.on_post_llm_call(kwargs)


@_safe("on_session_end")
def _on_session_end(**kwargs: Any) -> None:
    session_id = str(kwargs.get("session_id") or "")
    if not session_id:
        # If Hermes omits session_id we still want to flush whatever turns
        # we accumulated; iterate the map and finalise each.
        keys = list(_TURNS.keys())
    else:
        keys = [k for k in _TURNS if k[0] == session_id]
    for sid, tid in keys:
        acc = _TURNS.get((sid, tid))
        if acc is None:
            continue
        acc.on_session_end(finished_at_ms=_to_ms(kwargs.get("ended_at")) or _now_ms())
        event = acc.build_event()
        if event is not None:
            _emit(event)
        _drop_turn(sid, tid)
    _flush_outbox()


# ---------------------------------------------------------------------------
# Plugin registration
# ---------------------------------------------------------------------------


_HOOKS: Iterable[tuple[str, Callable[..., Any]]] = (
    ("pre_api_request", _on_pre_api_request),
    ("post_api_request", _on_post_api_request),
    ("api_request_error", _on_api_request_error),
    ("pre_tool_call", _on_pre_tool_call),
    ("post_tool_call", _on_post_tool_call),
    ("subagent_start", _on_subagent_start),
    ("subagent_stop", _on_subagent_stop),
    ("post_llm_call", _on_post_llm_call),
    ("on_session_end", _on_session_end),
)


def register(ctx: Any) -> None:
    """Hook entry point. Hermes calls this exactly once at plugin load.

    A failed hook registration is fatal at load time (Hermes logs and
    keeps the plugin disabled); individual hook calls are wrapped in
    _safe() so they cannot break the agent loop.
    """
    if not _is_enabled():
        logger.info("agents-analysis hermes plugin: %s=0, hooks will be inert", ENV_ENABLED)
    for name, fn in _HOOKS:
        ctx.register_hook(name, fn)
    # Best-effort flush of any events a previous run left in the outbox.
    # Mirrors extensions/opencode/plugin.ts which also retries on startup.
    try:
        _flush_outbox()
    except Exception as exc:  # pragma: no cover - fail-open
        logger.debug("startup flush failed: %s", exc)
    # atexit flush is registered last; it covers the case where a session
    # is interrupted (no on_session_end fires) but events are still in
    # the outbox waiting to be delivered.
    import atexit

    def _atexit_flush() -> None:
        try:
            _flush_outbox()
        except Exception as exc:  # pragma: no cover - fail-open
            logger.debug("atexit flush failed: %s", exc)

    atexit.register(_atexit_flush)