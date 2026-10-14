import assert from "node:assert/strict";
import test from "node:test";

import { COMPLETED, attachCost, subAgentTotals, summarize, visible, type Consultation, type Rates } from "./consultation.ts";

test("visible, summary, and cost use only completed consultations", () => {
  const rates: Rates = { input: 2, prompt: 2, thinking: 3, output: 4 };
  const completed = attachCost(
    { id: "completed", status: COMPLETED, usage: { input: 3, prompt: 2, thinking: 3, output: 4 } },
    rates,
  );
  const records: Consultation[] = [completed, { id: "pending", status: "pending", usage: { input: 100, prompt: 0, thinking: 0, output: 0 } }];

  const shown = visible(records);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, "completed");

  const summary = summarize(records);
  assert.equal(summary.tokens, 12);
  assert.equal(summary.cost, 35);

  assert.deepEqual(completed.rateSnapshot, rates);
});

test("summary leaves cost absent when records have no cost", () => {
  const summary = summarize([{ id: "one", status: COMPLETED, usage: { input: 0, prompt: 0, thinking: 0, output: 0 } }]);
  assert.equal(summary.cost, undefined);
});

test("property: summary conserves completed token counts", () => {
  let state = 0x5eed;
  const next = () => (state = (state * 1_664_525 + 1_013_904_223) >>> 0) % 65_536;
  for (let example = 0; example < 2_000; example += 1) {
    const usage = { input: next(), prompt: next(), thinking: next(), output: next() };
    const summary = summarize([{ id: "one", status: COMPLETED, usage }]);
    assert.equal(summary.tokens, usage.input + usage.prompt + usage.thinking + usage.output);
    assert.equal(summary.cost, undefined);
  }
});

test("sub-agent calls are priced with the same rates as their parent", () => {
  const rates: Rates = { input: 2, prompt: 2, thinking: 3, output: 4 };
  const priced = attachCost(
    {
      id: "parent",
      status: COMPLETED,
      usage: { input: 1, prompt: 0, thinking: 0, output: 0 },
      subAgents: [{ id: "sub-1", name: "repo-explorer", prompt: "explore", usage: { input: 10, prompt: 0, thinking: 0, output: 5 } }],
    },
    rates,
  );
  assert.equal(priced.subAgents![0].cost, 40);
});

test("a sub-agent that already reported its own cost keeps it", () => {
  const priced = attachCost(
    {
      id: "parent",
      status: COMPLETED,
      usage: { input: 0, prompt: 0, thinking: 0, output: 0 },
      subAgents: [{ id: "sub-1", name: "repo-explorer", prompt: "explore", cost: 0.5, usage: { input: 999, prompt: 0, thinking: 0, output: 0 } }],
    },
    { input: 2, prompt: 2, thinking: 3, output: 4 },
  );
  assert.equal(priced.subAgents![0].cost, 0.5);
});

test("sub-agent totals sum tokens, cost and latency across delegated calls", () => {
  const totals = subAgentTotals({
    id: "parent",
    status: COMPLETED,
    usage: { input: 0, prompt: 0, thinking: 0, output: 0 },
    subAgents: [
      { id: "a", name: "explorer", prompt: "p", cost: 0.25, durationMs: 1_000, usage: { input: 10, prompt: 1, thinking: 2, output: 3 } },
      { id: "b", name: "planner", prompt: "p", cost: 0.75, durationMs: 2_500, usage: { input: 4, prompt: 0, thinking: 0, output: 1 } },
    ],
  });
  assert.deepEqual(totals, { count: 2, tokens: 21, cost: 1, durationMs: 3_500 });
});

test("sub-agent totals report no cost when none of the calls were priced", () => {
  const totals = subAgentTotals({
    id: "parent",
    status: COMPLETED,
    usage: { input: 0, prompt: 0, thinking: 0, output: 0 },
    subAgents: [{ id: "a", name: "explorer", prompt: "p" }],
  });
  assert.equal(totals.cost, undefined);
  assert.equal(totals.count, 1);
});
