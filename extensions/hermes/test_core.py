"""Unit tests for the Hermes -> agents-analysis event builder.

Pure-Python tests; no Hermes runtime, no filesystem, no network. The goal is
to lock the wire shape we send to the agents-analysis daemon and the
aggregation rules we apply across multi-request turns.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# The repo's extensions/ directory is the source of truth; importing from
# it makes these tests independent of an installed plugin.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "extensions" / "hermes"))

import state  # noqa: E402  (path manipulation above is intentional)
from state import (  # noqa: E402
    AGENT_NAME,
    COMPLETED_EVENT_TYPE,
    COMPLETED_EVENT_VERSION,
    TurnAccumulator,
    _extract_assistant_text,
    _extract_prompts,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _accumulator(session: str = "ses-1", turn: str = "turn-1") -> TurnAccumulator:
    return TurnAccumulator(session_id=session, turn_id=turn, started_at_ms=1_700_000_000_000)


# ---------------------------------------------------------------------------
# Identity + minimal event shape
# ---------------------------------------------------------------------------


def test_event_carries_hermes_as_harness_and_completes_wire_shape():
    acc = _accumulator()
    acc.on_post_api_request({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "api_request_id": "req-1",
        "provider": "anthropic",
        "model": "claude-sonnet-4.5",
        "response_model": "claude-sonnet-4.5",
        "started_at": "2026-01-01T00:00:00.000Z",
        "ended_at": "2026-01-01T00:00:01.500Z",
        "usage": {"input_tokens": 100, "output_tokens": 50, "reasoning_tokens": 10},
        "finish_reason": "end_turn",
    })
    acc.on_session_end(finished_at_ms=1_700_000_001_500)
    event = acc.build_event()

    assert event["type"] == COMPLETED_EVENT_TYPE
    assert event["version"] == COMPLETED_EVENT_VERSION
    assert event["agent"] == AGENT_NAME == "hermes"
    assert event["id"] == "ses-1:turn-1"
    assert event["identity"] == {
        "sessionId": "ses-1",
        "turnId": "turn-1",
        "provider": "anthropic",
        "model": "claude-sonnet-4.5",
        "reasoningLevel": "",
    }
    assert event["usage"] == {
        "input": 100,
        "prompt": 0,
        "thinking": 10,
        "output": 50,
        "cacheRead": 0,
        "cacheWrite": 0,
    }
    assert event["durationMs"] == 1500
    assert event["result"] == "success"
    assert event["startedAt"].endswith("Z")
    assert event["finishedAt"].endswith("Z")


def test_unknown_provider_or_model_yields_empty_strings_not_errors():
    # The accumulator is permissive: it builds whatever it can, even
    # without a provider or model. The plugin decides whether to ship the
    # event (see _is_wire_valid in __init__.py) — a turn with no LLM
    # traffic has nothing for the daemon to store, so it short-circuits
    # rather than round-tripping an event the validator would reject.
    acc = _accumulator()
    # Once a single API request arrives (with whatever payload), the
    # event must build successfully even if individual fields are missing.
    acc.on_post_api_request({"api_request_id": "req-1"})
    event = acc.build_event()
    assert event["identity"]["provider"] == ""
    assert event["identity"]["model"] == ""
    assert event["usage"]["input"] == 0


# ---------------------------------------------------------------------------
# Prompt extraction across all three provider shapes
# ---------------------------------------------------------------------------


def test_extract_prompts_anthropic_shape():
    request = {
        "model": "claude-sonnet-4.5",
        "system": "You are a coding agent.",
        "messages": [{"role": "user", "content": "summarise this repo"}],
    }
    assert _extract_prompts(request) == ("You are a coding agent.", "summarise this repo")


def test_extract_prompts_openai_chat_completions_shape():
    request = {
        "model": "gpt-5",
        "messages": [
            {"role": "system", "content": "You are a coding agent."},
            {"role": "user", "content": "summarise this repo"},
        ],
    }
    assert _extract_prompts(request) == ("You are a coding agent.", "summarise this repo")


def test_extract_prompts_openai_responses_api_shape():
    request = {
        "model": "gpt-5",
        "instructions": "You are a coding agent.",
        "input": [{"role": "user", "content": "summarise this repo"}],
    }
    assert _extract_prompts(request) == ("You are a coding agent.", "summarise this repo")


def test_extract_prompts_recovers_user_prompt_from_messages_after_system():
    # Anthropic often omits the top-level `system` and inlines it as the
    # first message — the helper must still pick the system prompt up.
    request = {
        "messages": [
            {"role": "system", "content": "be brief"},
            {"role": "user", "content": "list files"},
        ],
    }
    assert _extract_prompts(request) == ("be brief", "list files")


def test_extract_prompts_returns_none_for_unrecognised_payload():
    # A non-dict, or a dict with no messages/instructions, must not throw;
    # it just yields nothing and the daemon falls back to "".
    assert _extract_prompts(None) is None
    assert _extract_prompts("not a dict") is None
    assert _extract_prompts({"unknown_field": 1}) is None


# ---------------------------------------------------------------------------
# Assistant text extraction
# ---------------------------------------------------------------------------


def test_extract_assistant_text_openai_chat_completions():
    response = {"choices": [{"message": {"role": "assistant", "content": "hello"}}]}
    assert _extract_assistant_text(response) == "hello"


def test_extract_assistant_text_anthropic_messages():
    response = {"content": [{"type": "text", "text": "hi from claude"}]}
    assert _extract_assistant_text(response) == "hi from claude"


def test_extract_assistant_text_responses_api():
    response = {"output": [{"content": [{"type": "output_text", "text": "hi from responses"}]}]}
    assert _extract_assistant_text(response) == "hi from responses"


# ---------------------------------------------------------------------------
# Multi-request (tool-loop) aggregation
# ---------------------------------------------------------------------------


def test_usage_is_summed_across_multiple_api_requests_in_one_turn():
    acc = _accumulator()
    # Iteration 1: tool call.
    acc.on_pre_api_request({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "api_request_id": "req-1",
        "provider": "openai",
        "model": "gpt-5",
        "started_at": "2026-01-01T00:00:00.000Z",
        "request": {
            "messages": [
                {"role": "system", "content": "be brief"},
                {"role": "user", "content": "list files"},
            ],
        },
    })
    acc.on_post_api_request({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "api_request_id": "req-1",
        "provider": "openai",
        "model": "gpt-5",
        "started_at": "2026-01-01T00:00:00.000Z",
        "ended_at": "2026-01-01T00:00:01.000Z",
        "usage": {
            "input_tokens": 100,
            "output_tokens": 30,
            "cache_read_tokens": 40,
            "cache_write_tokens": 5,
        },
        "response": {"choices": [{"message": {"content": "thinking..."}}]},
    })
    # Iteration 2: final answer.
    acc.on_pre_api_request({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "api_request_id": "req-2",
        "provider": "openai",
        "model": "gpt-5",
        "started_at": "2026-01-01T00:00:01.000Z",
    })
    acc.on_post_api_request({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "api_request_id": "req-2",
        "provider": "openai",
        "model": "gpt-5",
        "started_at": "2026-01-01T00:00:01.000Z",
        "ended_at": "2026-01-01T00:00:02.000Z",
        "usage": {
            "input_tokens": 150,
            "output_tokens": 80,
            "reasoning_tokens": 20,
            "cache_read_tokens": 50,
        },
        "response": {"choices": [{"message": {"content": "there are 3 files."}}]},
    })
    event = acc.build_event()

    # System/user prompts come from the first request only.
    assert event["content"]["systemPrompt"] == "be brief"
    assert event["content"]["userPrompt"] == "list files"
    # The final response text is the last iteration's, not the intermediate one.
    assert event["content"]["response"] == "there are 3 files."
    # Usage is summed.
    assert event["usage"] == {
        "input": 250,
        "prompt": 95,  # 40 + 5 + 50
        "thinking": 20,
        "output": 110,
        "cacheRead": 90,
        "cacheWrite": 5,
    }
    # Tools are empty — no tool calls in this scenario.
    assert event["tools"] == []
    # Cost: not reported on this turn, so the field must be omitted.
    assert "cost" not in event


def test_cost_is_summed_across_requests_when_each_reports_one():
    acc = _accumulator()
    for i, cost in enumerate((0.001, 0.002)):
        acc.on_post_api_request({
            "api_request_id": f"req-{i}",
            "provider": "openai",
            "model": "gpt-5",
            "started_at": "2026-01-01T00:00:00.000Z",
            "ended_at": "2026-01-01T00:00:01.000Z",
            "cost_usd": cost,
            "usage": {"input_tokens": 10, "output_tokens": 5},
        })
    event = acc.build_event()
    assert abs(event["cost"] - 0.003) < 1e-9


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


def test_tools_are_matched_pre_post_and_recorded_with_args_and_result():
    acc = _accumulator()
    acc.on_pre_tool_call({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "tool_call_id": "call-1",
        "tool_name": "terminal",
        "args": {"command": "ls"},
        "started_at": "2026-01-01T00:00:00.000Z",
    })
    acc.on_post_tool_call({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "tool_call_id": "call-1",
        "tool_name": "terminal",
        "status": "ok",
        "result": "file1\nfile2",
        "ended_at": "2026-01-01T00:00:00.500Z",
    })
    event = acc.build_event()
    assert event["tools"] == [{
        "id": "call-1",
        "name": "terminal",
        "input": {"command": "ls"},
        "output": "file1\nfile2",
        "isError": False,
    }]


def test_unpaired_pre_tool_call_is_recorded_as_error_on_session_end():
    # A turn that was interrupted mid-tool-call must still leave a record
    # of the call the user paid for — they want to see what was attempted.
    acc = _accumulator()
    acc.on_pre_tool_call({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "tool_call_id": "call-orphan",
        "tool_name": "terminal",
        "args": {"command": "sleep 999"},
        "started_at": "2026-01-01T00:00:00.000Z",
    })
    acc.on_session_end()
    event = acc.build_event()
    assert len(event["tools"]) == 1
    assert event["tools"][0]["name"] == "terminal"
    assert event["tools"][0]["isError"] is True
    assert "no post_tool_call" in event["tools"][0]["output"]


def test_post_only_tool_call_is_still_recorded():
    acc = _accumulator()
    acc.on_post_tool_call({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "tool_call_id": "call-late",
        "tool_name": "search_docs",
        "status": "ok",
        "result": "found 3 docs",
        "started_at": "2026-01-01T00:00:00.000Z",
        "ended_at": "2026-01-01T00:00:01.000Z",
    })
    event = acc.build_event()
    assert len(event["tools"]) == 1
    assert event["tools"][0]["name"] == "search_docs"


# ---------------------------------------------------------------------------
# Sub-agents
# ---------------------------------------------------------------------------


def test_subagent_pair_records_prompt_response_cost_and_latency():
    acc = _accumulator()
    acc.on_subagent_start({
        "parent_session_id": "ses-1",
        "parent_turn_id": "turn-1",
        "child_session_id": "ses-child",
        "child_subagent_id": "sub-1",
        "child_role": "repo-explorer",
        "child_goal": "Read all 12 feature briefs and summarise.",
        "started_at": "2026-01-01T00:00:00.000Z",
    })
    acc.on_subagent_stop({
        "parent_session_id": "ses-1",
        "parent_turn_id": "turn-1",
        "child_session_id": "ses-child",
        "child_subagent_id": "sub-1",
        "child_role": "repo-explorer",
        "status": "ok",
        "child_summary": "all 12 briefs summarised",
        "duration_ms": 90_000,
        "usage": {
            "input_tokens": 1_000,
            "output_tokens": 200,
            "reasoning_tokens": 5,
            "cache_read_tokens": 40,
        },
        "cost_usd": 0.25,
        "tool_call_history": [{"tool": "read", "outcome": "ok"}],
        "ended_at": "2026-01-01T00:01:30.000Z",
    })
    event = acc.build_event()
    assert event["subAgents"] == [{
        "id": "ses-child",
        "name": "repo-explorer",
        "description": "Read all 12 feature briefs and summarise.",
        "prompt": "Read all 12 feature briefs and summarise.",
        "response": "all 12 briefs summarised",
        "provider": "",
        "model": "",
        "usage": {"input": 1_000, "prompt": 40, "thinking": 5, "output": 200},
        "cost": 0.25,
        "durationMs": 90_000,
        "providerMetadata": {"tool_call_history": [{"tool": "read", "outcome": "ok"}]},
    }]
    # Sub-agent usage is NOT folded into the parent's totals — same rule
    # the opencode/claude-code adapters follow (see extensions/agents-analysis
    # /core.ts buildCompletedEvent — tools are NOT summed into usage).
    assert event["usage"]["input"] == 0


def test_subagent_failed_status_surfaces_as_error():
    acc = _accumulator()
    acc.on_subagent_stop({
        "parent_session_id": "ses-1",
        "parent_turn_id": "turn-1",
        "child_session_id": "ses-child",
        "status": "error",
        "child_summary": "sub-agent crashed",
        "duration_ms": 80,
    })
    event = acc.build_event()
    assert event["subAgents"][0]["error"] == "error"


# ---------------------------------------------------------------------------
# Error path
# ---------------------------------------------------------------------------


def test_api_request_error_marks_result_error_and_records_message():
    acc = _accumulator()
    acc.on_api_request_error({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "api_request_id": "req-failed",
        "provider": "anthropic",
        "model": "claude-sonnet-4.5",
        "started_at": "2026-01-01T00:00:00.000Z",
        "ended_at": "2026-01-01T00:00:01.000Z",
        "status_code": 500,
        "reason": "upstream unavailable",
        "error": {"type": "ServerError", "message": "anthropic 503"},
    })
    event = acc.build_event()
    assert event["result"] == "error"
    assert event["error"] == "anthropic 503"


# ---------------------------------------------------------------------------
# post_llm_call overrides — final assistant text wins over intermediate ones
# ---------------------------------------------------------------------------


def test_post_llm_call_overrides_response_with_runtime_final_view():
    acc = _accumulator()
    acc.on_post_api_request({
        "api_request_id": "req-1",
        "provider": "anthropic",
        "model": "claude-sonnet-4.5",
        "started_at": "2026-01-01T00:00:00.000Z",
        "ended_at": "2026-01-01T00:00:01.000Z",
        "response": {"content": [{"type": "text", "text": "intermediate scratch"}]},
    })
    acc.on_post_llm_call({
        "session_id": "ses-1",
        "turn_id": "turn-1",
        "user_message": {"role": "user", "content": "summarise"},
        "assistant_response": {"role": "assistant", "content": "the final answer"},
    })
    event = acc.build_event()
    assert event["content"]["response"] == "the final answer"
    assert event["content"]["userPrompt"] == "summarise"


# ---------------------------------------------------------------------------
# Provider metadata (request samples)
# ---------------------------------------------------------------------------


def test_request_samples_are_collected_in_provider_metadata():
    acc = _accumulator()
    acc.on_post_api_request({
        "api_request_id": "req-1",
        "provider": "anthropic",
        "model": "claude-sonnet-4.5",
        "started_at": "2026-01-01T00:00:00.000Z",
        "ended_at": "2026-01-01T00:00:01.000Z",
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "cost_usd": 0.001,
    })
    event = acc.build_event()
    samples = event["providerMetadata"]["request_samples"]
    assert len(samples) == 1
    assert samples[0]["api_request_id"] == "req-1"
    assert samples[0]["provider"] == "anthropic"
    assert samples[0]["cost_usd"] == 0.001
    assert samples[0]["usage"]["input_tokens"] == 10


# ---------------------------------------------------------------------------
# Defensive: hooks with bad payloads don't blow up the accumulator
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method_name, payload",
    [
        ("on_pre_api_request", {}),
        ("on_post_api_request", {"api_request_id": "x"}),
        ("on_pre_tool_call", {}),
        ("on_post_tool_call", {"tool_call_id": "x", "result": object()}),
        ("on_subagent_start", {"child_session_id": ""}),
        ("on_subagent_stop", {"child_session_id": ""}),
        ("on_api_request_error", {"api_request_id": ""}),
    ],
)
def test_malformed_payloads_are_ignored_silently(method_name, payload):
    acc = _accumulator()
    method = getattr(acc, method_name)
    # None of these should raise — the daemon's validator would reject the
    # event anyway, but a noisy hook would break the agent loop.
    method(payload)
    event = acc.build_event()
    # Event still builds; nothing was learned from the bad payload.
    assert event["id"] == "ses-1:turn-1"


# ---------------------------------------------------------------------------
# Plugin-level fail-open: hook callback exceptions must not propagate
# ---------------------------------------------------------------------------


def test_plugin_hook_callbacks_swallow_exceptions(tmp_path, monkeypatch):
    """__init__.py wraps every hook in _safe(), so an exception inside a
    hook callback is logged + swallowed rather than raised. This is what
    keeps a telemetry bug from breaking the user's agent turn."""
    import importlib.util
    import sys
    from pathlib import Path

    # Point _config() at a tmpdir so the plugin can write its outbox
    # without polluting the user's real one. AGENTS_ANALYSIS_HERMES_ENABLED
    # stays at the default; we just need an isolated socket + outbox.
    daemon = tmp_path / "daemon.sock"
    outbox = tmp_path / "outbox.json"
    monkeypatch.setenv("AGENTS_ANALYSIS_DAEMON", f"unix://{daemon}")
    monkeypatch.setenv("AGENTS_ANALYSIS_HERMES_OUTBOX", str(outbox))

    plugin_dir = Path(__file__).resolve().parent
    module_name = "agents_analysis_failopen_test"
    spec = importlib.util.spec_from_file_location(
        module_name, str(plugin_dir / "__init__.py"),
        submodule_search_locations=[str(plugin_dir)],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    for sub in plugin_dir.glob("*.py"):
        if sub.name == "__init__.py":
            continue
        sub_name = f"{module_name}.{sub.stem}"
        sub_spec = importlib.util.spec_from_file_location(sub_name, str(sub))
        sub_mod = importlib.util.module_from_spec(sub_spec)
        sys.modules[sub_name] = sub_mod
        sub_spec.loader.exec_module(sub_mod)
        setattr(mod, sub.stem, sub_mod)
    spec.loader.exec_module(mod)

    hooks: dict[str, object] = {}

    class _Ctx:
        def register_hook(self, name: str, fn: object) -> None:
            hooks[name] = fn

    mod.register(_Ctx())

    # Replace every inner handler with one that raises. The plugin wraps
    # these in _safe() at module load time, so the registered callbacks
    # should swallow the exception and return None rather than re-raising.
    # If any of these surfaced an exception, telemetry would be a
    # regression risk for the user's agent turn.
    def make_explode(name: str):
        def fn(*args: object, **kwargs: object) -> None:
            raise RuntimeError(f"boom from {name}")
        return fn

    for name in ("_on_pre_api_request", "_on_post_api_request",
                 "_on_pre_tool_call", "_on_post_tool_call",
                 "_on_subagent_start", "_on_subagent_stop",
                 "_on_post_llm_call", "_on_session_end",
                 "_on_api_request_error"):
        setattr(mod, name, make_explode(name))

    # The hooks dict still holds the original (wrapped) functions; call
    # them and assert none of them raise.
    for fn in hooks.values():
        fn()  # type: ignore[operator]