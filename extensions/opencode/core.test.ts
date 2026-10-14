import assert from "node:assert/strict";
import test from "node:test";

import { buildCompletedEvent, joinSystemPrompt, lastTurn, subAgentSessionIds, type OpencodeMessage } from "./core.ts";

type UserInfo = Extract<OpencodeMessage["info"], { role: "user" }>;
type AssistantInfo = Extract<OpencodeMessage["info"], { role: "assistant" }>;

const messages: OpencodeMessage[] = [
  {
    info: { id: "u0", sessionID: "s1", role: "user", time: { created: 1000 } },
    parts: [{ type: "text", text: "an earlier unrelated prompt" }],
  },
  {
    info: { id: "a0", sessionID: "s1", role: "assistant", time: { created: 1001, completed: 1002 }, modelID: "m", providerID: "p", tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
    parts: [{ type: "text", text: "old answer" }],
  },
  {
    info: { id: "u1", sessionID: "s1", role: "user", time: { created: 5000 }, system: "system prompt", agent: "coder" },
    parts: [{ type: "text", text: "resume el repositorio" }],
  },
  {
    info: {
      id: "a1",
      sessionID: "s1",
      role: "assistant",
      time: { created: 5001, completed: 5004 },
      modelID: "gpt-5.4-mini",
      providerID: "openai",
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
    },
    parts: [
      { type: "tool", callID: "call-1", tool: "bash", state: { status: "completed", input: { command: "ls" }, output: "file1\nfile2" } },
      { type: "text", text: "El repositorio tiene dos archivos." },
    ],
  },
];

test("lastTurn starts at the most recent user message", () => {
  const turn = lastTurn(messages);
  assert.ok(turn);
  assert.equal(turn![0]!.info.id, "u1");
  assert.equal(turn!.length, 2);
});

test("builds a completed event aggregating usage, tools, and response across the turn", () => {
  const event = buildCompletedEvent(messages, "s1");
  assert.ok(event);
  assert.equal(event!.agent, "opencode");
  assert.equal(event!.id, "s1:a1");
  assert.deepEqual(event!.identity, { sessionId: "s1", turnId: "a1", provider: "openai", model: "gpt-5.4-mini", reasoningLevel: "" });
  assert.equal(event!.content.systemPrompt, "system prompt");
  assert.equal(event!.content.userPrompt, "resume el repositorio");
  assert.equal(event!.content.response, "El repositorio tiene dos archivos.");
  assert.deepEqual(event!.usage, { input: 100, prompt: 25, thinking: 10, output: 50, cacheRead: 20, cacheWrite: 5 });
  assert.deepEqual(event!.tools, [{ id: "call-1", name: "bash", input: { command: "ls" }, output: "file1\nfile2", isError: false }]);
  assert.equal(event!.durationMs, 4);
  assert.equal(event!.result, "success");
});

test("marks the result as an error when an assistant message carries an error", () => {
  const failing: OpencodeMessage[] = [
    messages[2]!,
    { ...messages[3]!, info: { ...(messages[3]!.info as Extract<OpencodeMessage["info"], { role: "assistant" }>), error: { name: "UnknownError" } } },
  ];
  const event = buildCompletedEvent(failing, "s1");
  assert.equal(event!.result, "error");
});

test("returns undefined when there is no user message yet", () => {
  assert.equal(
    buildCompletedEvent(
      [{ info: { id: "a0", sessionID: "s1", role: "assistant", time: { created: 0 }, modelID: "m", providerID: "p", tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] }],
      "s1",
    ),
    undefined,
  );
});

test("returns undefined when the turn has no assistant response yet", () => {
  assert.equal(buildCompletedEvent([messages[2]!], "s1"), undefined);
});

test("captures a failed tool call", () => {
  const withFailedTool: OpencodeMessage[] = [
    messages[2]!,
    {
      ...messages[3]!,
      parts: [{ type: "tool", callID: "call-2", tool: "bash", state: { status: "error", input: { command: "false" }, error: "exit code 1" } }],
    },
  ];
  const event = buildCompletedEvent(withFailedTool, "s1");
  assert.deepEqual(event!.tools, [{ id: "call-2", name: "bash", input: { command: "false" }, output: "exit code 1", isError: true }]);
});

// --- system prompt ------------------------------------------------------------
// The bug this covers: opencode never persists `system` on the user message (verified against
// its own SQLite — no user row has the field), so every captured opencode consultation had an
// empty system prompt. It now has to come from the caller.

test("the system prompt comes from the caller, since opencode does not store it on the message", () => {
  const withoutSystem: OpencodeMessage[] = [
    { ...messages[2]!, info: { ...(messages[2]!.info as UserInfo), system: undefined } },
    messages[3]!,
  ];
  assert.equal(buildCompletedEvent(withoutSystem, "s1")!.content.systemPrompt, "");
  assert.equal(
    buildCompletedEvent(withoutSystem, "s1", { systemPrompt: "YOU ARE BUILD AGENT" })!.content.systemPrompt,
    "YOU ARE BUILD AGENT",
  );
});

test("opencode's system prompt blocks are joined in the order they are sent", () => {
  assert.equal(joinSystemPrompt(["agent instructions", "", "  ", "AGENTS.md"]), "agent instructions\n\nAGENTS.md");
  assert.equal(joinSystemPrompt([]), "");
});

test("synthetic text parts are not reported as the user's prompt", () => {
  const withSynthetic: OpencodeMessage[] = [
    { ...messages[2]!, parts: [{ type: "text", text: "expanded command output", synthetic: true }, { type: "text", text: "lo que escribí" }] },
    messages[3]!,
  ];
  assert.equal(buildCompletedEvent(withSynthetic, "s1")!.content.userPrompt, "lo que escribí");
});

// --- cost ---------------------------------------------------------------------

test("the cost opencode itself billed is reported rather than left for a rate table", () => {
  const priced: OpencodeMessage[] = [
    messages[2]!,
    { ...messages[3]!, info: { ...(messages[3]!.info as AssistantInfo), cost: 0.01425225 } },
  ];
  assert.equal(buildCompletedEvent(priced, "s1")!.cost, 0.01425225);
});

test("no cost is claimed when opencode did not report one", () => {
  assert.equal(buildCompletedEvent(messages, "s1")!.cost, undefined);
});

// --- sub-agents ----------------------------------------------------------------

const taskPart = {
  type: "tool" as const,
  callID: "call_6aa1fcd5",
  tool: "task",
  state: {
    status: "completed" as const,
    input: { description: "Read all 12 feature briefs", prompt: "Read all 12 feature brief files and summarise each.", subagent_type: "repo-explorer" },
    output: "here is the summary",
    metadata: { parentSessionId: "s1", sessionId: "ses_child", model: { providerID: "deepseek", modelID: "v4-flash" } },
    time: { start: 1_000, end: 91_000 },
  },
};

const childMessages: OpencodeMessage[] = [
  { info: { id: "cu", sessionID: "ses_child", role: "user", time: { created: 1_000 } }, parts: [] },
  {
    info: {
      id: "ca",
      sessionID: "ses_child",
      role: "assistant",
      time: { created: 1_010, completed: 90_000 },
      modelID: "v4-flash",
      providerID: "deepseek",
      cost: 0.25,
      tokens: { input: 1_000, output: 200, reasoning: 5, cache: { read: 40, write: 0 } },
    },
    parts: [{ type: "text", text: "here is the summary" }],
  },
];

test("a task call is reported as a sub-agent with its prompt, cost and latency", () => {
  const withTask: OpencodeMessage[] = [messages[2]!, { ...messages[3]!, parts: [taskPart] }];
  const event = buildCompletedEvent(withTask, "s1", { subAgentSessions: { ses_child: childMessages } });
  assert.equal(event!.subAgents!.length, 1);
  const [sub] = event!.subAgents!;
  assert.equal(sub!.name, "repo-explorer");
  assert.equal(sub!.description, "Read all 12 feature briefs");
  assert.match(sub!.prompt, /Read all 12 feature brief files/);
  assert.equal(sub!.response, "here is the summary");
  assert.equal(sub!.cost, 0.25);
  assert.equal(sub!.durationMs, 90_000);
  assert.deepEqual(sub!.usage, { input: 1_000, prompt: 40, thinking: 5, output: 200 });
  assert.equal(sub!.provider, "deepseek");
  assert.equal(sub!.model, "v4-flash");
});

test("the child sessions a turn delegated to are discoverable before they are fetched", () => {
  const withTask: OpencodeMessage[] = [messages[2]!, { ...messages[3]!, parts: [taskPart, taskPart] }];
  assert.deepEqual(subAgentSessionIds(withTask), ["ses_child"]);
});

test("a sub-agent whose child session could not be read is still reported, without totals", () => {
  const withTask: OpencodeMessage[] = [messages[2]!, { ...messages[3]!, parts: [taskPart] }];
  const [sub] = buildCompletedEvent(withTask, "s1")!.subAgents!;
  assert.equal(sub!.name, "repo-explorer");
  assert.equal(sub!.usage, undefined);
  assert.equal(sub!.cost, undefined);
  assert.equal(sub!.durationMs, 90_000, "the tool's own span still gives the latency");
});

test("a failed task call keeps its error and still names the sub-agent", () => {
  const failedTask = {
    ...taskPart,
    state: { status: "error" as const, input: taskPart.state.input, error: "Model not found: deepseek-v4-flash/.", metadata: taskPart.state.metadata, time: { start: 1_000, end: 1_080 } },
  };
  const withTask: OpencodeMessage[] = [messages[2]!, { ...messages[3]!, parts: [failedTask] }];
  const [sub] = buildCompletedEvent(withTask, "s1")!.subAgents!;
  assert.equal(sub!.error, "Model not found: deepseek-v4-flash/.");
  assert.equal(sub!.name, "repo-explorer");
  assert.equal(sub!.durationMs, 80);
});

test("a turn with no delegated calls carries no sub-agents field at all", () => {
  assert.equal(buildCompletedEvent(messages, "s1")!.subAgents, undefined);
});
