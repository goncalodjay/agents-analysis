import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCompletedEventFromEntries, buildCompletedEventFromTranscript, lastTurn, type TranscriptEntry } from "./core.ts";

const entries = [
  { type: "user", uuid: "u0", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "an earlier unrelated prompt" } },
  {
    type: "assistant",
    uuid: "a0",
    timestamp: "2026-01-01T00:00:01.000Z",
    effort: "medium",
    message: { role: "assistant", id: "msg_old", model: "claude-sonnet-5", content: [{ type: "text", text: "old answer" }], usage: {} },
  },
  { type: "user", uuid: "u1", timestamp: "2026-01-01T00:05:00.000Z", message: { role: "user", content: "resume el repositorio" } },
  {
    type: "assistant",
    uuid: "a1",
    timestamp: "2026-01-01T00:05:01.000Z",
    effort: "high",
    message: {
      role: "assistant",
      id: "msg_1",
      model: "claude-sonnet-5",
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "..." },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
      ],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens_details: { thinking_tokens: 10 } },
    },
  },
  {
    type: "user",
    uuid: "u2",
    timestamp: "2026-01-01T00:05:02.000Z",
    toolUseResult: { stdout: "file1\nfile2" },
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file1\nfile2" }] },
  },
  {
    type: "assistant",
    uuid: "a2",
    timestamp: "2026-01-01T00:05:04.000Z",
    effort: "high",
    message: {
      role: "assistant",
      id: "msg_2",
      model: "claude-sonnet-5",
      stop_reason: "stop",
      content: [{ type: "text", text: "El repositorio tiene dos archivos." }],
      usage: { input_tokens: 10, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens_details: { thinking_tokens: 0 } },
    },
  },
];

test("lastTurn starts at the most recent genuine user prompt, not at a tool-result carrying entry", () => {
  const turn = lastTurn(entries);
  assert.ok(turn);
  assert.equal(turn![0]!.uuid, "u1");
  assert.equal(turn!.length, 4);
});

test("builds a completed event aggregating usage, tools, and the final response across the turn", () => {
  const event = buildCompletedEventFromEntries(entries, "session-1");
  assert.ok(event);
  assert.equal(event!.agent, "claude-code");
  assert.equal(event!.id, "session-1:msg_2");
  assert.deepEqual(event!.identity, { sessionId: "session-1", turnId: "msg_2", provider: "anthropic", model: "claude-sonnet-5", reasoningLevel: "high" });
  assert.equal(event!.content.userPrompt, "resume el repositorio");
  assert.equal(event!.content.response, "El repositorio tiene dos archivos.");
  assert.deepEqual(event!.usage, { input: 110, prompt: 25, thinking: 10, output: 70, cacheRead: 20, cacheWrite: 5 });
  assert.deepEqual(event!.tools, [{ id: "toolu_1", name: "Bash", input: { command: "ls" }, output: "file1\nfile2", isError: false }]);
  assert.equal(event!.durationMs, 4000);
  assert.equal(event!.result, "success");
});

test("returns undefined when the transcript has no genuine user prompt yet", () => {
  const event = buildCompletedEventFromEntries([{ type: "system" }], "session-1");
  assert.equal(event, undefined);
});

test("marks the result as an error when the assistant's final stop reason is an error or refusal", () => {
  const failing = entries.slice(0, -1).concat([
    {
      ...entries.at(-1)!,
      message: { ...entries.at(-1)!.message!, stop_reason: "refusal", content: [{ type: "text", text: "I can't help with that." }] },
    },
  ]);
  const event = buildCompletedEventFromEntries(failing, "session-1");
  assert.equal(event!.result, "error");
});

test("reads and parses a real transcript file from disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-code-transcript-"));
  const path = join(dir, "session.jsonl");
  try {
    const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
    writeFileSync(path, `${lines}\n\n`); // trailing blank line, as real transcripts have
    const event = buildCompletedEventFromTranscript(path, "session-1");
    assert.ok(event);
    assert.equal(event!.content.userPrompt, "resume el repositorio");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- sub-agents ---------------------------------------------------------------
// The sidechain shape below follows Claude Code's documented transcript format; no transcript
// on this machine contained a Task call, so it is covered here rather than observed in the wild.

const taskTurn: TranscriptEntry[] = [
  { type: "user", uuid: "u1", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "delegate this" } },
  {
    type: "assistant",
    uuid: "a1",
    parentUuid: "u1",
    timestamp: "2026-01-01T00:00:01Z",
    message: {
      role: "assistant",
      id: "msg-1",
      model: "claude-opus-5",
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        { type: "text", text: "handing this off" },
        { type: "tool_use", id: "task-1", name: "Task", input: { description: "Map the repo", prompt: "EXPLORE EVERYTHING", subagent_type: "repo-explorer" } },
      ],
    },
  },
  {
    type: "assistant",
    uuid: "s1",
    parentUuid: "a1",
    isSidechain: true,
    timestamp: "2026-01-01T00:00:05Z",
    message: { role: "assistant", id: "msg-s1", model: "claude-sonnet-5", usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 40 }, content: [{ type: "text", text: "looking" }] },
  },
  {
    type: "assistant",
    uuid: "s2",
    parentUuid: "s1",
    isSidechain: true,
    timestamp: "2026-01-01T00:00:35Z",
    message: { role: "assistant", id: "msg-s2", model: "claude-sonnet-5", usage: { input_tokens: 100, output_tokens: 80 }, content: [{ type: "text", text: "done" }] },
  },
  {
    type: "user",
    uuid: "r1",
    parentUuid: "a1",
    timestamp: "2026-01-01T00:00:36Z",
    toolUseResult: {},
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "task-1", content: "the sub-agent's report" }] },
  },
];

test("a Task call is reported as a sub-agent with its prompt and response", () => {
  const event = buildCompletedEventFromEntries(taskTurn, "s")!;
  assert.equal(event.subAgents!.length, 1);
  const [sub] = event.subAgents!;
  assert.equal(sub!.name, "repo-explorer");
  assert.equal(sub!.description, "Map the repo");
  assert.equal(sub!.prompt, "EXPLORE EVERYTHING");
  assert.equal(sub!.response, "the sub-agent's report");
});

test("a sub-agent's tokens and latency come from its sidechain, not the parent's", () => {
  const [sub] = buildCompletedEventFromEntries(taskTurn, "s")!.subAgents!;
  assert.deepEqual(sub!.usage, { input: 1_000, prompt: 40, thinking: 0, output: 200 });
  assert.equal(sub!.durationMs, 30_000);
});

test("sidechain spend is kept out of the parent's own token count", () => {
  const event = buildCompletedEventFromEntries(taskTurn, "s")!;
  assert.deepEqual(event.usage, { input: 10, prompt: 0, thinking: 0, output: 5, cacheRead: 0, cacheWrite: 0 });
});

test("a turn that delegated nothing carries no sub-agents field", () => {
  const plain: TranscriptEntry[] = [
    taskTurn[0]!,
    { type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", id: "m", model: "claude-opus-5", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "did it myself" }] } },
  ];
  assert.equal(buildCompletedEventFromEntries(plain, "s")!.subAgents, undefined);
});
