import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";

import { buildCompletedEvent, CaptureController, lastTurn, messageOf, type CompletedEvent, type Outbox, type TurnSnapshot } from "./agents-analysis/core.ts";
import { expandHome, FileOutbox, sendToDaemon } from "./agents-analysis/outbox.ts";

const baseTurn: TurnSnapshot = {
  sessionId: "session",
  leafId: "leaf",
  provider: "provider",
  model: "model",
  reasoningLevel: "medium",
  systemPrompt: "system",
  context: "context",
  userPrompt: "prompt",
  startedAt: 10,
  settledAt: 20,
  entries: [],
};

function event(id: string): CompletedEvent {
  return { ...buildCompletedEvent(baseTurn), id };
}

test("ignores malformed session entries and content parts", () => {
  assert.equal(messageOf(null), undefined);
  assert.equal(messageOf("entry"), undefined);
  assert.equal(messageOf(7), undefined);
  assert.equal(messageOf({ message: null }), undefined);

  const completed = buildCompletedEvent({
    ...baseTurn,
    entries: [
      null,
      { message: { role: "toolResult", content: [] } },
      { message: { role: "assistant", content: { text: "not-an-array" } } },
      { message: { role: "assistant", content: [null, "part", {}, { type: "other", text: "wrong" }, { type: "text", text: 3 }, { type: "text", text: "answer" }] } },
      { message: { role: "assistant", content: [null, "part", {}, { id: "wrong-type", name: "read" }, { type: "toolCall" }, { type: "toolCall", id: "id-only" }, { type: "toolCall", name: "name-only" }] } },
    ],
  });

  assert.equal(completed.type, "consultation.completed");
  assert.equal(completed.content.response, "answer");
  assert.deepEqual(completed.tools, []);

  const multiline = buildCompletedEvent({
    ...baseTurn,
    entries: [
      { message: { role: "assistant", content: [{ type: "text", text: "line-one" }, { type: "text", text: "line-two" }] } },
      { message: { role: "assistant", content: "second-response" } },
    ],
  });
  assert.equal(multiline.content.response, "line-one\nline-two\nsecond-response");
});

test("defaults missing tool results and preserves tool errors", () => {
  const completed = buildCompletedEvent({
    ...baseTurn,
    entries: [
      { message: { role: "assistant", content: [
        { type: "toolCall", id: "missing", name: "read" },
        { type: "toolCall", id: "failed", name: "bash" },
      ] } },
      { message: { role: "toolResult", toolCallId: "failed", isError: true, content: "failure" } },
    ],
  });

  assert.deepEqual(completed.tools, [
    { id: "missing", name: "read", input: {}, output: "", isError: false },
    { id: "failed", name: "bash", input: {}, output: "failure", isError: true },
  ]);
});

test("uses the last terminal failure and recognizes error and aborted stop reasons", () => {
  const failed = buildCompletedEvent({
    ...baseTurn,
    entries: [{ message: { role: "assistant", stopReason: "error", errorMessage: "failed", content: [] } }],
  });
  const aborted = buildCompletedEvent({
    ...baseTurn,
    entries: [
      { message: { role: "assistant", stopReason: "error", errorMessage: "first", content: [] } },
      { message: { role: "assistant", stopReason: "aborted", errorMessage: "last", content: [] } },
    ],
  });

  assert.equal(failed.result, "error");
  assert.equal(failed.error, "failed");
  assert.equal(aborted.result, "error");
  assert.equal(aborted.error, "last");
});

test("stops ordered retries after the first delivery failure", async () => {
  const pending = [event("first"), event("second")];
  const attempted: string[] = [];
  const outbox: Outbox = {
    async hasDelivered() { return false; },
    async enqueue() {},
    async listPending() { return pending; },
    async markDelivered() {},
  };
  const capture = new CaptureController(outbox, async (item) => {
    attempted.push(item.id);
    if (item.id === "first") throw new Error("offline");
  });

  await capture.retry();

  assert.deepEqual(attempted, ["first"]);
});

test("rejects branches without a valid user turn and leaf", () => {
  assert.deepEqual(lastTurn([{ id: "user", message: { role: "user", content: "only" } }]), {
    leafId: "user",
    entries: [],
    userPrompt: "only",
  });
  assert.equal(lastTurn([null, "entry", { id: "leaf", message: null }]), undefined);
  assert.equal(lastTurn([{ id: "user", message: { role: "user", content: [] } }, null]), undefined);
  assert.equal(lastTurn([{ id: "user", message: { role: "user", content: [] } }, {}]), undefined);
  assert.equal(lastTurn([{ id: "user", message: { role: "user", content: [] } }, { id: 123, message: { role: "assistant" } }]), undefined);
  assert.equal(lastTurn([{ id: "user", message: { role: "user", content: [] } }, { id: "", message: { role: "assistant" } }]), undefined);
});

test("validates, deduplicates, and bounds persisted outbox state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agents-analysis-outbox-"));
  const path = join(directory, "outbox.json");
  try {
    const outbox = new FileOutbox(path);
    assert.deepEqual(await outbox.listPending(), []);
    assert.equal(await outbox.hasDelivered("Stryker was here"), false);

    await outbox.enqueue(event("first"));
    await outbox.enqueue(event("first"));
    await outbox.enqueue(event("second"));
    assert.deepEqual((await outbox.listPending()).map((item) => item.id), ["first", "second"]);
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    await outbox.markDelivered("first");
    assert.deepEqual((await outbox.listPending()).map((item) => item.id), ["second"]);
    assert.equal(await outbox.hasDelivered("first"), true);

    const delivered = Array.from({ length: 1_000 }, (_, index) => `old-${index}`);
    await writeFile(path, JSON.stringify({ pending: [], delivered }));
    await outbox.markDelivered("new");
    assert.equal(await outbox.hasDelivered("old-0"), false);
    assert.equal(await outbox.hasDelivered("old-999"), true);
    assert.equal(await outbox.hasDelivered("new"), true);

    await writeFile(path, JSON.stringify({ pending: "invalid", delivered: "invalid" }));
    assert.deepEqual(await outbox.listPending(), []);
    assert.equal(await outbox.hasDelivered("invalid"), false);
    assert.equal(await outbox.hasDelivered("Stryker was here"), false);

    await writeFile(path, JSON.stringify({ pending: [], delivered: ["new", "keep"] }));
    await outbox.markDelivered("new");
    const state = JSON.parse(await readFile(path, "utf8")) as { delivered: string[] };
    assert.deepEqual(state.delivered, ["keep", "new"]);

    await chmod(path, 0o600);
    await writeFile(path, "not-json");
    await assert.rejects(outbox.listPending());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("expands only home-prefixed paths", () => {
  assert.equal(expandHome("~").startsWith("/"), true);
  assert.equal(expandHome("~/outbox.json"), join(expandHome("~"), "outbox.json"));
  assert.equal(expandHome("relative/outbox.json"), "relative/outbox.json");
  assert.equal(expandHome("prefix~/outbox.json"), "prefix~/outbox.json");
});

test("sends one newline-delimited event to a Unix daemon and reports connection errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agents-analysis-daemon-"));
  const socketPath = join(directory, "daemon.sock");
  const chunks: Buffer[] = [];
  const server = createServer((socket) => {
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => socket.end('{"accepted":true}\n'));
  });
  try {
    await new Promise<void>((resolve, reject) => server.listen(socketPath, resolve).once("error", reject));
    await sendToDaemon(`unix://${socketPath}`, event("sent"));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const received = JSON.parse(Buffer.concat(chunks).toString("utf8").trim()) as CompletedEvent;
    assert.equal(received.id, "sent");

    await assert.rejects(sendToDaemon(`unix://${join(directory, "missing.sock")}`, event("failed")));
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
