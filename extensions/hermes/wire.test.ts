// Integration test: feed a Python-built Hermes event into the actual
// daemon validator (src/capture/event.ts). This is the wire contract
// guarantee — if Python builds an event the TypeScript validator rejects,
// the daemon would silently drop it.
//
// The Python event is produced by extensions/hermes/state.py and printed
// to stdout as JSON. The TypeScript test reads it back and runs the
// daemon's validator against it, so any future drift in the Python
// builder will fail the test before it reaches production.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validate, type Event } from "../../src/capture/event.ts";
import type { CompletedEvent } from "../agents-analysis/core.ts";

type ScriptResult = { status: number | null; stdout: string; stderr: string };

function runPython(script: string): ScriptResult {
  const python = process.env.PYTHON ?? "python3";
  const result = spawnSync(python, ["-c", script], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function pythonEventScript(scenario: object): string {
  // Replay a scenario dict into the Python TurnAccumulator, exactly the
  // way the plugin's hook callbacks do, and print the resulting event
  // as JSON. Anything the TypeScript validator rejects is a wire drift.
  return `
import json, sys
sys.path.insert(0, "extensions/hermes")
from state import TurnAccumulator
scenario = json.loads(${JSON.stringify(JSON.stringify(scenario))})
acc = TurnAccumulator(session_id=scenario["session_id"], turn_id=scenario["turn_id"])
for pre in scenario.get("pre_api_requests", []):
    acc.on_pre_api_request(pre)
for post in scenario.get("post_api_requests", []):
    acc.on_post_api_request(post)
for err in scenario.get("api_request_errors", []):
    acc.on_api_request_error(err)
for pre in scenario.get("pre_tool_calls", []):
    acc.on_pre_tool_call(pre)
for post in scenario.get("post_tool_calls", []):
    acc.on_post_tool_call(post)
for start in scenario.get("subagent_starts", []):
    acc.on_subagent_start(start)
for stop in scenario.get("subagent_stops", []):
    acc.on_subagent_stop(stop)
if scenario.get("post_llm_call"):
    acc.on_post_llm_call(scenario["post_llm_call"])
acc.on_session_end()
result = acc.build_event()
print("null" if result is None else json.dumps(result))
`;
}

test("a Python-built Hermes event passes the real TypeScript validator", () => {
  // Scenario: a multi-request turn (tool loop), with cache tokens, a sub-agent,
  // and a post_llm_call override. Every wire field the validator checks
  // (provider, model, sessionId, turnId, usage nonnegativity, duration)
  // is exercised.
  const scenario = {
    session_id: "ses-integration",
    turn_id: "turn-integration",
    pre_api_requests: [
      {
        session_id: "ses-integration",
        turn_id: "turn-integration",
        api_request_id: "req-1",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        started_at: "2026-01-01T00:00:00.000Z",
        request: {
          system: "be brief",
          messages: [{ role: "user", content: "summarise" }],
        },
      },
    ],
    post_api_requests: [
      {
        session_id: "ses-integration",
        turn_id: "turn-integration",
        api_request_id: "req-1",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        started_at: "2026-01-01T00:00:00.000Z",
        ended_at: "2026-01-01T00:00:01.000Z",
        usage: { input_tokens: 100, output_tokens: 30, cache_read_tokens: 40, cache_write_tokens: 5 },
        response: { content: [{ type: "text", text: "scratch" }] },
      },
      {
        session_id: "ses-integration",
        turn_id: "turn-integration",
        api_request_id: "req-2",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        started_at: "2026-01-01T00:00:01.000Z",
        ended_at: "2026-01-01T00:00:02.000Z",
        usage: { input_tokens: 150, output_tokens: 80, reasoning_tokens: 20, cache_read_tokens: 50 },
        response: { content: [{ type: "text", text: "the final answer" }] },
      },
    ],
    pre_tool_calls: [
      { session_id: "ses-integration", turn_id: "turn-integration", tool_call_id: "call-1", tool_name: "terminal", args: { command: "ls" }, started_at: "2026-01-01T00:00:00.000Z" },
    ],
    post_tool_calls: [
      { session_id: "ses-integration", turn_id: "turn-integration", tool_call_id: "call-1", tool_name: "terminal", status: "ok", result: "file1\nfile2", ended_at: "2026-01-01T00:00:00.500Z" },
    ],
    subagent_starts: [
      { parent_session_id: "ses-integration", parent_turn_id: "turn-integration", child_session_id: "ses-child", child_role: "repo-explorer", child_goal: "list files", started_at: "2026-01-01T00:00:00.000Z" },
    ],
    subagent_stops: [
      { parent_session_id: "ses-integration", parent_turn_id: "turn-integration", child_session_id: "ses-child", status: "ok", child_summary: "done", duration_ms: 1000 },
    ],
    post_llm_call: {
      session_id: "ses-integration",
      turn_id: "turn-integration",
      user_message: { role: "user", content: "summarise" },
      assistant_response: { role: "assistant", content: "the final answer" },
    },
  };

  const script = pythonEventScript(scenario);
  const result = runPython(script);
  assert.equal(result.status, 0, `python failed: ${result.stderr}`);
  const event = JSON.parse(result.stdout) as CompletedEvent;

  // The validator is the contract — anything it rejects the daemon would
  // silently drop. This is the wire-compatibility check.
  assert.equal(validate(event as unknown as Event), undefined);

  // Identity + content + usage pass-through as expected.
  assert.equal(event.agent, "hermes");
  assert.equal(event.identity.provider, "anthropic");
  assert.equal(event.identity.model, "claude-sonnet-4.5");
  assert.equal(event.content.userPrompt, "summarise");
  assert.equal(event.content.response, "the final answer");
  assert.deepEqual(event.usage, { input: 250, prompt: 95, thinking: 20, output: 110, cacheRead: 90, cacheWrite: 5 });
  assert.equal(event.tools?.length, 1);
  assert.equal(event.subAgents?.length, 1);
  assert.equal(event.subAgents?.[0]?.name, "repo-explorer");
});

test("a requestless Python turn builds an event the plugin's wire guard rejects", () => {
  // Mirror the guard in __init__.py:_is_wire_valid: build_event returns
  // a dict, but the plugin short-circuits an event without provider+model
  // because the daemon's validator would reject it anyway. This is what
  // saves the unhappy path one socket round-trip.
  const script = `
import json, sys
sys.path.insert(0, "extensions/hermes")
from state import TurnAccumulator
acc = TurnAccumulator(session_id="ses-x", turn_id="turn-x")
acc.on_pre_tool_call({"tool_call_id": "c1", "tool_name": "terminal", "args": {}})
result = acc.build_event()
print(json.dumps(result))
`;
  const result = runPython(script);
  assert.equal(result.status, 0, `python failed: ${result.stderr}`);
  const event = JSON.parse(result.stdout) as CompletedEvent;

  // The accumulator built something, but it's NOT wire-valid: provider
  // and model are empty (no API request fired).
  assert.equal(event.identity.provider, "");
  assert.equal(event.identity.model, "");
  assert.equal(validate(event as unknown as Event), "identidad obligatoria");
});