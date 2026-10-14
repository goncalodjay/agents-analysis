import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { CaptureController, buildCompletedEvent, lastTurn, type CompletedEvent, type Outbox } from "./agents-analysis/core.ts";
import { FileOutbox } from "./agents-analysis/outbox.ts";

function memoryOutbox(): Outbox & { pending: CompletedEvent[]; delivered: Set<string> } {
  const pending: CompletedEvent[] = [];
  const delivered = new Set<string>();
  return {
    pending,
    delivered,
    async hasDelivered(id) { return delivered.has(id); },
    async enqueue(event) { if (!pending.some((item) => item.id === event.id)) pending.push(event); },
    async listPending() { return [...pending]; },
    async markDelivered(id) {
      const index = pending.findIndex((event) => event.id === id);
      if (index >= 0) pending.splice(index, 1);
      delivered.add(id);
    },
  };
}

const turn = {
  sessionId: "pi-1",
  leafId: "assistant-1",
  provider: "openai",
  model: "gpt-5",
  reasoningLevel: "medium",
  systemPrompt: "eres-asistente",
  context: "AGENTS.md=reglas",
  userPrompt: "resume-el-repositorio",
  startedAt: 1_000,
  settledAt: 3_000,
  entries: [
    { type: "message", message: { role: "assistant", provider: "openai", model: "gpt-5", stopReason: "toolUse", usage: { input: 120, output: 40, reasoning: 40, cacheRead: 80, cacheWrite: 0 }, content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "file" } }] } },
    { type: "message", message: { role: "toolResult", toolCallId: "call-1", toolName: "read", isError: false, content: [{ type: "text", text: "contenido" }] } },
    { type: "message", message: { role: "assistant", provider: "openai", model: "gpt-5", stopReason: "stop", usage: { input: 0, output: 160, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, content: [{ type: "text", text: "repositorio-resumido" }] } },
  ],
};

test("builds a completed event preserving identity, content, usage, duration, result, and tools", () => {
  const event = buildCompletedEvent(turn);

  assert.equal(event.id, "pi-1:assistant-1");
  assert.equal(event.agent, "pi");
  assert.deepEqual(event.identity, { sessionId: "pi-1", turnId: "assistant-1", provider: "openai", model: "gpt-5", reasoningLevel: "medium" });
  assert.deepEqual(event.content, { systemPrompt: "eres-asistente", context: "AGENTS.md=reglas", userPrompt: "resume-el-repositorio", response: "repositorio-resumido" });
  assert.deepEqual(event.usage, { input: 120, prompt: 80, thinking: 40, output: 160, cacheRead: 80, cacheWrite: 0 });
  assert.equal(event.durationMs, 2_000);
  assert.equal(event.result, "success");
  assert.deepEqual(event.tools, [{ id: "call-1", name: "read", input: { path: "file" }, output: "contenido", isError: false }]);
});

test("strips Pi's static tool/guidelines boilerplate out of the captured system prompt", () => {
  const noisy =
    "You are an expert coding assistant operating inside pi.\n\nAvailable tools:\n- read: Read file contents\n\nGuidelines:\n- Be concise\n\nPi documentation (read only when asked):\n- docs/...\n\nCurrent working directory: /home/gonza/projects/agents-analysis";
  const event = buildCompletedEvent({ ...turn, systemPrompt: noisy });

  assert.equal(
    event.content.systemPrompt,
    "You are an expert coding assistant operating inside pi.\nCurrent working directory: /home/gonza/projects/agents-analysis",
  );
});

test("preserves terminal errors and clamps reversed durations", () => {
  const event = buildCompletedEvent({
    ...turn,
    startedAt: 4_000,
    settledAt: 3_000,
    entries: [
      null,
      { message: { role: "assistant", stopReason: "aborted", errorMessage: "cancelled", content: "partial" } },
    ],
  });

  assert.equal(event.result, "error");
  assert.equal(event.error, "cancelled");
  assert.equal(event.durationMs, 0);
  assert.equal(event.content.response, "partial");
});

test("extracts the last user turn from a session branch", () => {
  assert.deepEqual(lastTurn([
    { id: "user-1", message: { role: "user", content: "first" } },
    { id: "assistant-1", message: { role: "assistant", content: [] } },
    { id: "user-2", message: { role: "user", content: [{ type: "text", text: "latest" }] } },
    { id: "assistant-2", message: { role: "assistant", content: [] } },
  ]), {
    leafId: "assistant-2",
    entries: [{ id: "assistant-2", message: { role: "assistant", content: [] } }],
    userPrompt: "latest",
  });
  assert.equal(lastTurn([]), undefined);
});

test("does not deliver a settled consultation twice", async () => {
  const outbox = memoryOutbox();
  const delivered: CompletedEvent[] = [];
  const capture = new CaptureController(outbox, async (event) => { delivered.push(event); });

  await capture.settled(buildCompletedEvent(turn));
  await capture.settled(buildCompletedEvent(turn));

  assert.equal(delivered.length, 1);
});

test("retains an event while unavailable and retries it later", async () => {
  const outbox = memoryOutbox();
  let available = false;
  const delivered: CompletedEvent[] = [];
  const capture = new CaptureController(outbox, async (event) => {
    if (!available) throw new Error("daemon unavailable");
    delivered.push(event);
  });

  await capture.settled(buildCompletedEvent(turn));
  assert.equal(outbox.pending.length, 1);

  available = true;
  await capture.retry();

  assert.equal(outbox.pending.length, 0);
  assert.deepEqual(delivered.map((event) => event.id), ["pi-1:assistant-1"]);
});

test("persists pending events across extension restarts", async () => {
  const directory = join(process.cwd(), "tmp", "pi-extension-outbox-test");
  const path = join(directory, "outbox.json");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  try {
    const event = buildCompletedEvent(turn);
    await new CaptureController(new FileOutbox(path), async () => { throw new Error("offline"); }).settled(event);

    const delivered: string[] = [];
    await new CaptureController(new FileOutbox(path), async (pending) => { delivered.push(pending.id); }).retry();

    assert.deepEqual(delivered, [event.id]);
    const restarted = new FileOutbox(path);
    assert.deepEqual(await restarted.listPending(), []);
    assert.equal(await restarted.hasDelivered(event.id), true);
    await restarted.enqueue(event);
    assert.deepEqual(await restarted.listPending(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
