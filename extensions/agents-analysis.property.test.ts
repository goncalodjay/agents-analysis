import assert from "node:assert/strict";
import test from "node:test";

import { buildCompletedEvent, type TurnSnapshot } from "./agents-analysis/core.ts";

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state;
  };
}

test("completed event accounting remains nonnegative and conservative over broad usage inputs", () => {
  const next = pseudoRandom(0x5eed);
  for (let example = 0; example < 500; example += 1) {
    const startedAt = next();
    const settledAt = next();
    const assistantCount = next() % 12;
    const entries: unknown[] = [];
    let expectedInput = 0;
    let expectedThinking = 0;
    let expectedOutput = 0;
    let expectedCacheRead = 0;
    let expectedCacheWrite = 0;

    for (let index = 0; index < assistantCount; index += 1) {
      const input = next() % 100_000;
      const output = next() % 100_000;
      const reasoning = next() % 100_000;
      const cacheRead = next() % 100_000;
      const cacheWrite = next() % 100_000;
      expectedInput += input;
      expectedThinking += reasoning;
      expectedOutput += Math.max(0, output - reasoning);
      expectedCacheRead += cacheRead;
      expectedCacheWrite += cacheWrite;
      entries.push({ message: { role: "assistant", usage: { input, output, reasoning, cacheRead, cacheWrite }, content: [] } });
    }

    const turn: TurnSnapshot = {
      sessionId: `session-${example}`,
      leafId: `leaf-${example}`,
      provider: "provider",
      model: "model",
      reasoningLevel: "medium",
      systemPrompt: "system",
      context: "context",
      userPrompt: "prompt",
      startedAt,
      settledAt,
      entries,
    };
    const event = buildCompletedEvent(turn);

    assert.deepEqual(event, buildCompletedEvent(turn), "formatting is stable");
    assert.equal(event.durationMs, Math.max(0, settledAt - startedAt));
    assert.deepEqual(event.usage, {
      input: expectedInput,
      prompt: expectedCacheRead + expectedCacheWrite,
      thinking: expectedThinking,
      output: expectedOutput,
      cacheRead: expectedCacheRead,
      cacheWrite: expectedCacheWrite,
    });
    assert.ok(Object.values(event.usage).every((value) => value >= 0));
  }
});
