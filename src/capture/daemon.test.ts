import assert from "node:assert/strict";
import { createConnection, createServer, type Server } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Consultation } from "../consultation/consultation.ts";
import { serve, type ConsultationStore } from "./daemon.ts";
import type { Event, Reply } from "./event.ts";

function memoryStore(): ConsultationStore & { saved: Consultation[] } {
  const saved: Consultation[] = [];
  return { saved, save: (record) => void saved.push(record) };
}

function validEvent(): Event {
  return {
    type: "consultation.completed",
    version: 1,
    id: "pi-1",
    agent: "pi",
    identity: { sessionId: "session-1", turnId: "turn-1", provider: "openai", model: "gpt-5", reasoningLevel: "medium" },
    content: { systemPrompt: "system", context: "context", userPrompt: "user", response: "answer" },
    usage: { input: 120, prompt: 80, thinking: 40, output: 160, cacheRead: 0, cacheWrite: 0 },
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:02.000Z",
    durationMs: 2000,
    result: "success",
    tools: [],
  };
}

async function withDaemon(run: (address: string, store: ReturnType<typeof memoryStore>) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-daemon-"));
  const address = join(dir, "daemon.sock");
  const store = memoryStore();
  const server: Server = createServer();
  const controller = new AbortController();
  const finished = serve(server, store, { signal: controller.signal });
  await new Promise<void>((resolve) => server.listen(address, resolve));
  try {
    await run(address, store);
  } finally {
    controller.abort();
    await finished;
    rmSync(dir, { recursive: true, force: true });
  }
}

function send(address: string, event: Event): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(address);
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("connect", () => socket.end(`${JSON.stringify(event)}\n`));
    socket.once("error", reject);
    socket.once("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Reply));
  });
}

test("acknowledges and stores a validated event", async () => {
  await withDaemon(async (address, store) => {
    const reply = await send(address, validEvent());
    assert.equal(reply.accepted, true);
    assert.equal(reply.id, "pi-1");
    assert.equal(store.saved.length, 1);
    assert.equal(store.saved[0]!.harness, "pi");
    assert.equal(store.saved[0]!.response, "answer");
  });
});

test("rejects invalid events without writing history", async () => {
  await withDaemon(async (address, store) => {
    const missingIdentity = validEvent();
    missingIdentity.identity.sessionId = "";
    const first = await send(address, missingIdentity);
    assert.equal(first.accepted, false);
    assert.equal(first.reason, "identidad obligatoria");

    const negativeUsage = validEvent();
    negativeUsage.id = "pi-4";
    negativeUsage.usage.output = -1;
    const second = await send(address, negativeUsage);
    assert.equal(second.accepted, false);
    assert.equal(second.reason, "uso de tokens inválido");

    assert.equal(store.saved.length, 0);
  });
});

test("preserves any agent as the harness", async () => {
  await withDaemon(async (address, store) => {
    const event = validEvent();
    event.id = "other-1";
    event.agent = "other-agent";
    const reply = await send(address, event);
    assert.equal(reply.accepted, true);
    assert.equal(store.saved[0]!.harness, "other-agent");
  });
});

test("attaches cost when the event's model has a configured price, leaves it unset otherwise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-daemon-"));
  try {
    const pricingPath = join(dir, "pricing.json");
    writeFileSync(pricingPath, JSON.stringify({ "gpt-5": { input: 2, prompt: 0.5, thinking: 2, output: 8 } }));
    const address = join(dir, "daemon.sock");
    const store = memoryStore();
    const server = createServer();
    const controller = new AbortController();
    const finished = serve(server, store, { pricingPath, signal: controller.signal });
    await new Promise<void>((resolve) => server.listen(address, resolve));
    try {
      await send(address, validEvent()); // model "gpt-5", priced
      const unpriced = validEvent();
      unpriced.id = "pi-2";
      unpriced.identity.model = "some-unpriced-model";
      await send(address, unpriced);

      assert.equal(store.saved.length, 2);
      const priced = store.saved.find((record) => record.id === "pi-1")!;
      // usage: input 120, prompt 80, thinking 40, output 160; rates $/token: 2e-6, 0.5e-6, 2e-6, 8e-6
      assert.ok(priced.cost !== undefined && Math.abs(priced.cost - (120 * 2e-6 + 80 * 0.5e-6 + 40 * 2e-6 + 160 * 8e-6)) < 1e-9);
      assert.equal(store.saved.find((record) => record.id === "pi-2")!.cost, undefined);
    } finally {
      controller.abort();
      await finished;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stops cleanly when the abort signal fires before any connection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-daemon-"));
  try {
    const address = join(dir, "daemon.sock");
    const server = createServer();
    const controller = new AbortController();
    const finished = serve(server, memoryStore(), { signal: controller.signal });
    await new Promise<void>((resolve) => server.listen(address, resolve));
    controller.abort();
    await finished;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
