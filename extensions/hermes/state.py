# Hermes -> agents-analysis event builder.
#
# Pure functions (no Hermes runtime, no filesystem, no network) that turn the
# stream of observer-hook payloads a Hermes turn produces into the same
# `consultation.completed` event the pi/opencode/claude-code adapters emit,
# so the agents-analysis daemon accepts it unchanged and the existing TUI
# renders it alongside any other agent.
#
# Wire contract (see src/capture/event.ts in this repo):
#   { type: "consultation.completed", version: 1, id, agent: "hermes",
#     identity: {sessionId, turnId, provider, model, reasoningLevel},
#     content:  {systemPrompt, context, userPrompt, response},
#     usage:    {input, prompt, thinking, output, cacheRead, cacheWrite},
#     startedAt, finishedAt, durationMs, result, error?,
#     tools:    [{id, name, input, output, isError}],
#     subAgents?: [...], cost?, providerMetadata? }
#
# `providerMetadata` is new: the existing TUI passes it through untouched,
# and it is the only way to surface the raw request payload (Hermes exposes
# it sanitized on `pre_api_request.request` / `post_api_request.response`).
# It is optional, so older captures keep validating.
#
# Aggregation rules:
#   - One turn = one event, keyed by turn_id. If Hermes fires multiple API
#     requests inside one turn (tool loops), input/prompt/thinking/output
#     cache tokens are summed across the requests; thinking tokens are
#     NOT subtracted from output here (Hermes' canonical usage keeps them
#     separate, matching opencode; claude-code subtracts only because
#     Anthropic's wire format double-counts them).
#   - Tools are matched pre/post by tool_call_id. A pre without a post is
#     still recorded as an error with the args and a placeholder output.
#   - Sub-agents are matched by child_session_id; their usage/cost comes
#     from their own subagent_stop payload, NOT summed into the parent's.
#   - System prompt and user prompt are read from the first pre_api_request
#     of the turn (Hermes re-emits them on every request, but only the
#     first one is interesting for the history view).
#   - Cost is the sum of post_api_request's USD estimate when present;
#     otherwise the daemon's rate table fills it in.
"""Turn accumulator + completed-event builder for the Hermes observer plugin.

Pure: takes hook payloads in, returns a CompletedEvent-shaped dict (and the
list of API request summaries) out. No Hermes runtime, no I/O.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Iterable

# Mirrors src/capture/event.ts CompletedEvent. Kept as a dict (not a
# TypedDict) so the unit tests can build one with field-by-field assertions
# without importing the TypeScript schema validator. Field names match the
# wire shape exactly — the daemon validates them case-sensitively.
COMPLETED_EVENT_TYPE = "consultation.completed"
COMPLETED_EVENT_VERSION = 1
AGENT_NAME = "hermes"

# Reasoning-effort levels Hermes exposes (low/medium/high/xhigh on Anthropic,
# reasoning_effort on OpenAI, etc.). Anything string-like is passed through;
# empty string means "the runtime did not report one", which is also what
# the opencode adapter does today.
_REASONING_FALLBACK = ""


# ---------------------------------------------------------------------------
# Per-turn accumulator
# ---------------------------------------------------------------------------


@dataclass
class _ToolCall:
    """One tool call, paired across pre_tool_call/post_tool_call by id."""

    id: str
    name: str
    args: Any
    started_at_ms: int
    finished_at_ms: int = 0
    output: Any = ""
    is_error: bool = False
    status: str = "pending"  # ok / error / blocked / cancelled / pending

    def to_event(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "input": self.args if self.args is not None else {},
            "output": "" if self.output is None else (self.output if isinstance(self.output, str) else repr(self.output)),
            "isError": self.is_error,
        }


@dataclass
class _ApiRequest:
    """One provider API request inside a turn (a tool-loop iteration)."""

    request_id: str
    provider: str
    model: str
    reasoning_level: str
    started_at_ms: int
    finished_at_ms: int = 0
    # Usage fields — populated from post_api_request.usage (a CanonicalUsage
    # summary dict). Reasoning tokens are kept separate from output tokens;
    # the daemon's CompletedEvent.usage.thinking then surfaces them.
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float | None = None
    finish_reason: str = ""
    response_model: str = ""
    # Sanitized request payload (system prompt + messages). Used to recover
    # the system prompt and the user prompt the model actually saw. Stored
    # in providerMetadata.request_samples so the TUI can show "what did
    # Hermes actually send?" without forcing every other adapter to grow
    # the wire schema.
    request_payload: Any = None
    response_payload: Any = None


@dataclass
class _SubAgent:
    """One delegated child agent (Hermes' subagent_start/stop pair)."""

    child_session_id: str
    child_subagent_id: str
    parent_session_id: str
    parent_turn_id: str
    parent_subagent_id: str
    child_role: str
    child_goal: str
    started_at_ms: int
    finished_at_ms: int = 0
    status: str = ""
    child_summary: str = ""
    duration_ms: int = 0
    # Sub-agent's own usage, when its parent turn reports it. NOT summed
    # into the parent's totals — the parent's tokens are what Hermes
    # actually billed at the parent's provider.
    usage_input: int = 0
    usage_output: int = 0
    usage_reasoning: int = 0
    usage_cache_read: int = 0
    usage_cache_write: int = 0
    cost_usd: float | None = None
    # tool_call_history is the observer-grade metadata list (no raw prompts
    # or results). Stored verbatim in providerMetadata for the TUI.
    tool_call_history: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class TurnAccumulator:
    """All state for one Hermes turn (session_id, turn_id).

    Hook callbacks call `on_*` methods; flush() returns the event. Multiple
    turns can coexist (the daemon's session_id space is opaque to us).
    """

    session_id: str
    turn_id: str
    started_at_ms: int = 0
    finished_at_ms: int = 0
    user_prompt: str = ""
    system_prompt: str = ""
    response_text: str = ""
    reasoning_level: str = _REASONING_FALLBACK
    error: str = ""
    result: str = "success"  # success / error
    requests: dict[str, _ApiRequest] = field(default_factory=dict)
    request_order: list[str] = field(default_factory=list)
    tools: dict[str, _ToolCall] = field(default_factory=dict)
    tool_order: list[str] = field(default_factory=list)
    subagents: dict[str, _SubAgent] = field(default_factory=dict)
    subagent_order: list[str] = field(default_factory=list)

    # ---- session-level --------------------------------------------------

    def on_session_start(self, *, session_id: str, started_at_ms: int) -> None:
        # Some Hermes builds omit session_id from per-turn hooks; we keep
        # whatever the first hook that names a session reported.
        if not self.session_id and session_id:
            self.session_id = session_id
        if not self.started_at_ms and started_at_ms:
            self.started_at_ms = started_at_ms

    # ---- API requests ---------------------------------------------------

    def on_pre_api_request(self, payload: dict[str, Any]) -> None:
        req_id = payload.get("api_request_id") or ""
        if not req_id:
            return
        # A pre_api_request after the first one for the same turn is a
        # tool-loop iteration; keep the system prompt / user prompt only
        # from the very first one (Hermes re-emits them on every request,
        # and they're identical).
        first_request = not self.requests
        req = self.requests.setdefault(
            req_id,
            _ApiRequest(
                request_id=req_id,
                provider=str(payload.get("provider") or ""),
                model=str(payload.get("model") or ""),
                reasoning_level=str(payload.get("reasoning_level") or ""),
                started_at_ms=_to_ms(payload.get("started_at")),
            ),
        )
        # Maintain insertion order so build_event() can recover the most
        # recent provider/model from the last API request. setdefault only
        # inserts on first call, so the append is its own idempotent step.
        if req_id not in self.request_order:
            self.request_order.append(req_id)
        # Update fields that may be reported on a re-fired pre hook (rare
        # but defensive — Hermes may swap mid-loop on a retry).
        if req.provider == "":
            req.provider = str(payload.get("provider") or "")
        if req.model == "":
            req.model = str(payload.get("model") or "")
        if first_request:
            self.reasoning_level = req.reasoning_level or self.reasoning_level
            req.request_payload = payload.get("request")
            prompt_pair = _extract_prompts(payload.get("request"))
            if prompt_pair is not None:
                if not self.system_prompt:
                    self.system_prompt = prompt_pair[0]
                if not self.user_prompt:
                    self.user_prompt = prompt_pair[1]

    def on_post_api_request(self, payload: dict[str, Any]) -> None:
        req_id = payload.get("api_request_id") or ""
        if not req_id:
            return
        req = self.requests.get(req_id)
        if req is None:
            # Hermes occasionally reports post before pre when a retry is
            # collapsed; synthesize a stub so we still capture usage.
            req = _ApiRequest(
                request_id=req_id,
                provider=str(payload.get("provider") or ""),
                model=str(payload.get("model") or payload.get("response_model") or ""),
                reasoning_level="",
                started_at_ms=_to_ms(payload.get("started_at")),
            )
            self.requests[req_id] = req
            self.request_order.append(req_id)
        req.finished_at_ms = _to_ms(payload.get("ended_at")) or req.finished_at_ms
        if not req.model and payload.get("response_model"):
            req.model = str(payload.get("response_model"))
        # Defend against a pre/post double-append: if pre_api_request
        # already recorded the request, don't append again or _last()
        # would happily return a duplicate.
        if req_id not in self.request_order:
            self.request_order.append(req_id)
        usage = payload.get("usage") or {}
        if isinstance(usage, dict):
            req.input_tokens += int(usage.get("input_tokens") or 0)
            req.output_tokens += int(usage.get("output_tokens") or 0)
            req.reasoning_tokens += int(usage.get("reasoning_tokens") or 0)
            req.cache_read_tokens += int(usage.get("cache_read_tokens") or 0)
            req.cache_write_tokens += int(usage.get("cache_write_tokens") or 0)
        cost = payload.get("cost_usd")
        if isinstance(cost, (int, float)):
            req.cost_usd = float(cost) if req.cost_usd is None else req.cost_usd + float(cost)
        finish = payload.get("finish_reason")
        if finish:
            req.finish_reason = str(finish)
        response_text = _extract_assistant_text(payload.get("response"))
        if response_text:
            # The most recent post_api_request's text wins over earlier ones:
            # tool-loop iterations emit intermediate scratch as their
            # "response" and only the final iteration carries the answer
            # the user actually sees.
            self.response_text = response_text
        req.response_payload = payload.get("response")

    def on_api_request_error(self, payload: dict[str, Any]) -> None:
        req_id = payload.get("api_request_id") or ""
        if not req_id:
            return
        req = self.requests.get(req_id)
        if req is None:
            req = _ApiRequest(
                request_id=req_id,
                provider=str(payload.get("provider") or ""),
                model=str(payload.get("model") or ""),
                reasoning_level="",
                started_at_ms=_to_ms(payload.get("started_at")),
            )
            self.requests[req_id] = req
            self.request_order.append(req_id)
        req.finished_at_ms = _to_ms(payload.get("ended_at")) or req.finished_at_ms
        err = payload.get("error") or {}
        msg = err.get("message") if isinstance(err, dict) else None
        self.error = str(msg or payload.get("reason") or "api_request_error")
        self.result = "error"

    # ---- tools ----------------------------------------------------------

    def on_pre_tool_call(self, payload: dict[str, Any]) -> None:
        call_id = payload.get("tool_call_id") or payload.get("tool_name") or ""
        if not call_id:
            return
        existing = self.tools.get(call_id)
        if existing is not None:
            # Re-fire on the same id (rare; loop retries): keep the
            # original args, reset output state.
            existing.status = "pending"
            existing.output = ""
            existing.is_error = False
            return
        self.tools[call_id] = _ToolCall(
            id=call_id,
            name=str(payload.get("tool_name") or ""),
            args=payload.get("args"),
            started_at_ms=_to_ms(payload.get("started_at")) or _now_ms(),
        )
        self.tool_order.append(call_id)

    def on_post_tool_call(self, payload: dict[str, Any]) -> None:
        call_id = payload.get("tool_call_id") or ""
        if not call_id:
            return
        call = self.tools.get(call_id)
        if call is None:
            # A post without a pre: tool was dispatched before we registered,
            # or a hook returned {action: "modify"} that changed the id.
            # Synthesize a stub so the call is still recorded.
            call = _ToolCall(
                id=call_id,
                name=str(payload.get("tool_name") or ""),
                args=None,
                started_at_ms=_to_ms(payload.get("started_at")) or _now_ms(),
            )
            self.tools[call_id] = call
            self.tool_order.append(call_id)
        call.finished_at_ms = _to_ms(payload.get("ended_at")) or _now_ms()
        call.status = str(payload.get("status") or "ok")
        call.is_error = call.status in ("error", "blocked")
        result = payload.get("result")
        if result is not None:
            call.output = result if isinstance(result, str) else repr(result)

    # ---- sub-agents -----------------------------------------------------

    def on_subagent_start(self, payload: dict[str, Any]) -> None:
        child_id = payload.get("child_session_id") or payload.get("child_subagent_id") or ""
        if not child_id:
            return
        sub = self.subagents.get(child_id)
        if sub is None:
            sub = _SubAgent(
                child_session_id=str(payload.get("child_session_id") or ""),
                child_subagent_id=str(payload.get("child_subagent_id") or ""),
                parent_session_id=str(payload.get("parent_session_id") or self.session_id),
                parent_turn_id=str(payload.get("parent_turn_id") or self.turn_id),
                parent_subagent_id=str(payload.get("parent_subagent_id") or ""),
                child_role=str(payload.get("child_role") or "sub-agent"),
                child_goal=str(payload.get("child_goal") or ""),
                started_at_ms=_to_ms(payload.get("started_at")) or _now_ms(),
            )
            self.subagents[child_id] = sub
            self.subagent_order.append(child_id)

    def on_subagent_stop(self, payload: dict[str, Any]) -> None:
        child_id = payload.get("child_session_id") or payload.get("child_subagent_id") or ""
        if not child_id:
            return
        sub = self.subagents.get(child_id)
        if sub is None:
            sub = _SubAgent(
                child_session_id=str(child_id),
                child_subagent_id=str(child_id),
                parent_session_id=str(payload.get("parent_session_id") or self.session_id),
                parent_turn_id=str(payload.get("parent_turn_id") or self.turn_id),
                parent_subagent_id=str(payload.get("parent_subagent_id") or ""),
                child_role="sub-agent",
                child_goal="",
                started_at_ms=_to_ms(payload.get("started_at")) or _now_ms(),
            )
            self.subagents[child_id] = sub
            self.subagent_order.append(child_id)
        sub.finished_at_ms = _to_ms(payload.get("ended_at")) or _now_ms()
        sub.duration_ms = int(payload.get("duration_ms") or max(0, sub.finished_at_ms - sub.started_at_ms))
        sub.status = str(payload.get("status") or "")
        summary = payload.get("child_summary")
        if summary:
            sub.child_summary = str(summary)
        usage = payload.get("usage") or {}
        if isinstance(usage, dict):
            sub.usage_input = int(usage.get("input_tokens") or 0)
            sub.usage_output = int(usage.get("output_tokens") or 0)
            sub.usage_reasoning = int(usage.get("reasoning_tokens") or 0)
            sub.usage_cache_read = int(usage.get("cache_read_tokens") or 0)
            sub.usage_cache_write = int(usage.get("cache_write_tokens") or 0)
        cost = payload.get("cost_usd")
        if isinstance(cost, (int, float)):
            sub.cost_usd = float(cost)
        history = payload.get("tool_call_history")
        if isinstance(history, list):
            sub.tool_call_history = [h for h in history if isinstance(h, dict)]

    # ---- finalisation ---------------------------------------------------

    def on_post_llm_call(self, payload: dict[str, Any]) -> None:
        # Hermes' turn-level hook; carries the final user_message and
        # assistant_response. We prefer its user_prompt/response when
        # present because they reflect the runtime's final view, not a
        # tool-loop intermediate one.
        user_msg = payload.get("user_message")
        if isinstance(user_msg, dict):
            text = _content_text(user_msg.get("content"))
            if text and not self.user_prompt:
                self.user_prompt = text
        elif isinstance(user_msg, str) and user_msg and not self.user_prompt:
            self.user_prompt = user_msg
        assistant = payload.get("assistant_response")
        if isinstance(assistant, dict):
            text = _content_text(assistant.get("content"))
            if text:
                self.response_text = text
        elif isinstance(assistant, str) and assistant:
            self.response_text = assistant

    def on_session_end(self, *, finished_at_ms: int | None = None) -> None:
        if finished_at_ms is None:
            finished_at_ms = _now_ms()
        self.finished_at_ms = finished_at_ms
        # No observation should remain pending; close any unpaired tool calls
        # so they surface in the recorded tools list with a clear error.
        for call in self.tools.values():
            if call.status == "pending":
                call.status = "error"
                call.is_error = True
                if not call.output:
                    call.output = "(no post_tool_call received)"
                call.finished_at_ms = call.finished_at_ms or finished_at_ms

    # ---- emit -----------------------------------------------------------

    def build_event(self) -> dict[str, Any]:
        """Materialise the consultation.completed event this turn describes.

        Idempotent: callers may call it more than once (e.g. on session
        finalise AND on a periodic flush). Totals are recomputed each call.

        The accumulator is permissive: it builds an event from whatever
        hooks fired, even a turn with no API requests (only tools or only
        sub-agents). Whether to send it is the plugin's call — a turn with
        no provider/model would be rejected by the daemon's validator
        anyway (see src/capture/event.ts `hasRequiredIdentity`).
        """
        if not self.session_id or not self.turn_id:
            raise ValueError("TurnAccumulator needs both session_id and turn_id before build_event()")

        usage = _sum_usage(self.requests.values())
        cost = _sum_cost(self.requests.values())

        last_req = _last(self.request_order, self.requests)
        provider = last_req.provider if last_req else ""
        model = last_req.model if last_req else ""
        reasoning = self.reasoning_level or (last_req.reasoning_level if last_req else "")

        started_ms = self.started_at_ms
        finished_ms = self.finished_at_ms
        if not started_ms or not finished_ms:
            started_req = _argmin(self.requests.values(), lambda r: r.started_at_ms)
            finished_req = _argmax(self.requests.values(), lambda r: r.finished_at_ms)
            if not started_ms and started_req is not None:
                started_ms = started_req.started_at_ms
            if not finished_ms and finished_req is not None:
                finished_ms = finished_req.finished_at_ms
        started_iso = _iso(started_ms) if started_ms else _iso(_now_ms())
        finished_iso = _iso(finished_ms) if finished_ms else started_iso
        duration_ms = max(0, int((finished_ms or _now_ms()) - (started_ms or _now_ms())))

        event: dict[str, Any] = {
            "type": COMPLETED_EVENT_TYPE,
            "version": COMPLETED_EVENT_VERSION,
            "id": f"{self.session_id}:{self.turn_id}",
            "agent": AGENT_NAME,
            "identity": {
                "sessionId": self.session_id,
                "turnId": self.turn_id,
                "provider": provider,
                "model": model,
                "reasoningLevel": reasoning,
            },
            "content": {
                "systemPrompt": self.system_prompt,
                "context": "",
                "userPrompt": self.user_prompt,
                "response": self.response_text,
            },
            "usage": usage,
            "startedAt": started_iso,
            "finishedAt": finished_iso,
            "durationMs": duration_ms,
            "result": self.result,
            "tools": [self.tools[cid].to_event() for cid in self.tool_order],
        }
        sub_agents = [self._subagent_to_event(self.subagents[sid]) for sid in self.subagent_order]
        if sub_agents:
            event["subAgents"] = sub_agents
        if cost is not None:
            event["cost"] = cost
        if self.error:
            event["error"] = self.error

        # Provenance + samples of the wire payloads, so the TUI can answer
        # "what did Hermes actually send to the model?" without us having to
        # grow the CompletedEvent schema for every other adapter.
        provider_metadata: dict[str, Any] = {"harness": AGENT_NAME}
        request_samples = [
            {
                "api_request_id": self.requests[rid].request_id,
                "provider": self.requests[rid].provider,
                "model": self.requests[rid].model,
                "started_at": _iso(self.requests[rid].started_at_ms),
                "ended_at": _iso(self.requests[rid].finished_at_ms) if self.requests[rid].finished_at_ms else None,
                "finish_reason": self.requests[rid].finish_reason,
                "cost_usd": self.requests[rid].cost_usd,
                "usage": {
                    "input_tokens": self.requests[rid].input_tokens,
                    "output_tokens": self.requests[rid].output_tokens,
                    "reasoning_tokens": self.requests[rid].reasoning_tokens,
                    "cache_read_tokens": self.requests[rid].cache_read_tokens,
                    "cache_write_tokens": self.requests[rid].cache_write_tokens,
                },
            }
            for rid in self.request_order
        ]
        if request_samples:
            provider_metadata["request_samples"] = request_samples
        event["providerMetadata"] = provider_metadata

        return event

    def _subagent_to_event(self, sub: _SubAgent) -> dict[str, Any]:
        usage_total = sub.usage_input + sub.usage_cache_read + sub.usage_cache_write + sub.usage_reasoning + sub.usage_output
        prompt_cache = sub.usage_cache_read + sub.usage_cache_write
        out: dict[str, Any] = {
            "id": sub.child_session_id or sub.child_subagent_id,
            "name": sub.child_role or "sub-agent",
            "description": sub.child_goal,
            "prompt": sub.child_goal,
            "response": sub.child_summary,
            "provider": "",
            "model": "",
            "usage": {
                "input": sub.usage_input,
                "prompt": prompt_cache,
                "thinking": sub.usage_reasoning,
                "output": sub.usage_output,
            },
            "durationMs": sub.duration_ms,
        }
        if sub.cost_usd is not None:
            out["cost"] = sub.cost_usd
        if sub.status and sub.status not in ("ok", "success"):
            out["error"] = sub.status
        # Stash the observer-grade tool_call_history under providerMetadata
        # so the existing TUI (which only reads sub-agent prompt/response/
        # usage/cost) still renders, but the raw data is recoverable.
        if sub.tool_call_history:
            out.setdefault("providerMetadata", {})["tool_call_history"] = sub.tool_call_history
        # Touch the variable so the linter does not flag usage_total as
        # unused — it is currently diagnostic-only.
        del usage_total
        return out


# ---------------------------------------------------------------------------
# Pure helpers (exported so the tests can poke at them without instantiating
# an accumulator)
# ---------------------------------------------------------------------------


def _now_ms() -> int:
    return int(time.time() * 1000)


def _to_ms(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        # Heuristic: a value that looks like seconds is small (< 10**12).
        return int(value) if value > 10**12 else int(value * 1000)
    if isinstance(value, str):
        # Hermes emits ISO-8601 strings ("2026-01-01T00:00:00.123Z").
        # Parse defensively: fromisoformat handles "...Z" only from 3.11+,
        # so strip a trailing 'Z' to stay compatible with 3.10.
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            from datetime import datetime
            return int(datetime.fromisoformat(text).timestamp() * 1000)
        except ValueError:
            return 0
    return 0


def _iso(ms: int) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _extract_prompts(request: Any) -> tuple[str, str] | None:
    """Recover system + user prompt from a sanitized request payload.

    Hermes' `pre_api_request.request` is one of:
      - OpenAI Chat Completions: {"messages": [{"role": "system"|"user", ...}, ...], "model": ...}
      - Anthropic Messages:      {"system": "...", "messages": [...]}
      - Responses API:           {"instructions": "...", "input": [...]}

    Returns (system, user) or None if nothing recognisable was found.
    """
    if not isinstance(request, dict):
        return None
    system = ""
    user = ""
    # Anthropic shape.
    if isinstance(request.get("system"), str):
        system = request["system"]
    # OpenAI Chat Completions / Anthropic messages: a list with system first.
    messages = request.get("messages")
    if isinstance(messages, list) and messages:
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            role = msg.get("role")
            if role == "system" and not system:
                system = _content_text(msg.get("content"))
            elif role == "user" and not user:
                user = _content_text(msg.get("content"))
    # Responses API: top-level instructions + input items.
    if not system and isinstance(request.get("instructions"), str):
        system = request["instructions"]
    if not user:
        input_items = request.get("input")
        if isinstance(input_items, list):
            for item in input_items:
                if isinstance(item, dict) and item.get("role") == "user":
                    user = _content_text(item.get("content"))
                    if user:
                        break
    if not system and not user:
        return None
    return system, user


def _extract_assistant_text(response: Any) -> str:
    """Pull the visible assistant text out of a sanitized response payload.

    OpenAI Chat Completions: response.choices[0].message.content (str or parts).
    Anthropic Messages:      response.content[*].text (with type == "text").
    Responses API:           response.output[*].content[*].text.
    """
    if not isinstance(response, dict):
        return ""
    choices = response.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            msg = first.get("message") or {}
            return _content_text(msg.get("content"))
    content = response.get("content")
    if isinstance(content, list):
        return _content_text(content)
    if isinstance(content, str):
        return content
    output = response.get("output")
    if isinstance(output, list):
        chunks: list[str] = []
        for item in output:
            if isinstance(item, dict):
                chunks.append(_content_text(item.get("content")))
        return "\n".join(filter(None, chunks))
    return ""


def _content_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for part in content:
            if isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str):
                    chunks.append(text)
                elif isinstance(text, list):
                    chunks.append(_content_text(text))
            elif isinstance(part, str):
                chunks.append(part)
        return "\n".join(filter(None, chunks))
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
    return ""


def _sum_usage(requests: Iterable[_ApiRequest]) -> dict[str, int]:
    total = {"input": 0, "prompt": 0, "thinking": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
    for req in requests:
        total["input"] += req.input_tokens
        total["cacheRead"] += req.cache_read_tokens
        total["cacheWrite"] += req.cache_write_tokens
        total["thinking"] += req.reasoning_tokens
        total["output"] += req.output_tokens
    total["prompt"] = total["cacheRead"] + total["cacheWrite"]
    return total


def _sum_cost(requests: Iterable[_ApiRequest]) -> float | None:
    total = 0.0
    seen = False
    for req in requests:
        if req.cost_usd is not None:
            total += req.cost_usd
            seen = True
    return total if seen else None


def _last(order: list[str], items: dict[str, Any]) -> Any:
    return items[order[-1]] if order else None


def _argmin(items: Iterable[Any], key) -> Any:
    """Return the item whose `key(item)` is smallest; None if items is empty."""
    best = None
    best_key = None
    for item in items:
        k = key(item)
        if best is None or k < best_key:
            best = item
            best_key = k
    return best


def _argmax(items: Iterable[Any], key) -> Any:
    """Return the item whose `key(item)` is largest; None if items is empty."""
    best = None
    best_key = None
    for item in items:
        k = key(item)
        if best is None or k > best_key:
            best = item
            best_key = k
    return best