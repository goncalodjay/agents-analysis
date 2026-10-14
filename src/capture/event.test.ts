import assert from "node:assert/strict";
import test from "node:test";

import { toConsultation, validate, type Event } from "./event.ts";

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
    tools: [{ id: "tool-1", name: "read", input: { path: "file" }, output: "contents", isError: false }],
  };
}

test("accepts a fully-populated event", () => {
  assert.equal(validate(validEvent()), undefined);
});

test("rejects an event missing required identity", () => {
  const event = validEvent();
  event.identity.sessionId = "";
  assert.equal(validate(event), "identidad obligatoria");
});

test("rejects negative token usage", () => {
  const event = validEvent();
  event.usage.output = -1;
  assert.equal(validate(event), "uso de tokens inválido");
});

test("rejects a negative duration", () => {
  const event = validEvent();
  event.durationMs = -1;
  assert.equal(validate(event), "duración inválida");
});

test("converts an event into a consultation, preserving the agent as harness", () => {
  const event = validEvent();
  event.id = "other-1";
  event.agent = "other-agent";
  const consultation = toConsultation(event);
  assert.equal(consultation.id, "other-1");
  assert.equal(consultation.harness, "other-agent");
  assert.equal(consultation.provider, "openai");
  assert.equal(consultation.model, "gpt-5");
  assert.deepEqual(consultation.toolResults, [{ tool: "read", request: '{"path":"file"}', result: "contents" }]);
});

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state;
  };
}

test("property: token validation matches the nonnegative invariant", () => {
  const next = pseudoRandom(0xc0ffee);
  for (let example = 0; example < 2_000; example += 1) {
    const event = validEvent();
    const input = next() - 2 ** 31;
    const prompt = next() - 2 ** 31;
    const thinking = next() - 2 ** 31;
    const output = next() - 2 ** 31;
    const cacheRead = next() - 2 ** 31;
    const cacheWrite = next() - 2 ** 31;
    event.usage = { input, prompt, thinking, output, cacheRead, cacheWrite };
    const allNonnegative = [input, prompt, thinking, output, cacheRead, cacheWrite].every((value) => value >= 0);
    assert.equal(validate(event) === undefined, allNonnegative);
  }
});

test("property: converting to a consultation preserves capture identity", () => {
  const next = pseudoRandom(0xbeef);
  for (let example = 0; example < 1_000; example += 1) {
    const event = validEvent();
    event.id = `id-${next()}`;
    event.agent = `agent-${next()}`;
    event.identity.provider = `provider-${next()}`;
    event.identity.model = `model-${next()}`;
    const consultation = toConsultation(event);
    assert.equal(consultation.id, event.id);
    assert.equal(consultation.harness, event.agent);
    assert.equal(consultation.provider, event.identity.provider);
    assert.equal(consultation.model, event.identity.model);
  }
});
