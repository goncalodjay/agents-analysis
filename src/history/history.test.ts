import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { attachCost, summarize, COMPLETED, type Consultation } from "../consultation/consultation.ts";
import { HistoryStore } from "./history.ts";

function tempPath(name: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-history-"));
  return { dir, path: join(dir, name) };
}

test("store round-trips a complete consultation", () => {
  const { dir, path } = tempPath("history.sqlite");
  const want: Consultation = {
    id: "pi-1",
    status: COMPLETED,
    provider: "openai",
    model: "gpt-5",
    prompts: { system: "be helpful", user: "summarize" },
    context: "repository context",
    response: "summary",
    toolResults: [{ tool: "read", request: "", result: "contents" }],
    usage: { input: 12, prompt: 4, thinking: 3, output: 8 },
    durationMs: 210,
    result: "success",
  };
  const store = HistoryStore.open(path);
  try {
    store.save(want);
    const got = store.consultations();
    assert.equal(got.length, 1);
    assert.equal(got[0]!.id, want.id);
    assert.equal(got[0]!.response, want.response);
    assert.equal(got[0]!.toolResults?.[0]!.result, "contents");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store upsert prevents duplicate consultations", () => {
  const { dir, path } = tempPath("history.sqlite");
  const store = HistoryStore.open(path);
  try {
    const record: Consultation = { id: "pi-1", status: COMPLETED, usage: { input: 0, prompt: 0, thinking: 0, output: 0 } };
    store.save(record);
    store.save(record);
    assert.equal(store.consultations().length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save rejects a consultation without an id", () => {
  const { dir, path } = tempPath("history.sqlite");
  const store = HistoryStore.open(path);
  try {
    assert.throws(() => store.save({ id: "", status: COMPLETED, usage: { input: 0, prompt: 0, thinking: 0, output: 0 } }));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("completed consultations have costs and summary", () => {
  const record: Consultation = { id: "one", status: COMPLETED, usage: { input: 100, prompt: 20, thinking: 10, output: 50 } };
  const rated = attachCost(record, { input: 0.000002, prompt: 0.000001, thinking: 0.000003, output: 0.000004 });
  assert.ok(rated.cost !== undefined && rated.cost >= 0.00045 && rated.cost <= 0.00047);
  const summary = summarize([rated]);
  assert.equal(summary.tokens, 180);
  assert.ok(summary.cost !== undefined);
});

test("creates the parent directory when missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-history-"));
  const path = join(dir, "nested", "history.sqlite");
  const store = HistoryStore.open(path);
  try {
    store.save({ id: "one", status: COMPLETED, usage: { input: 0, prompt: 0, thinking: 0, output: 0 } });
    assert.equal(store.consultations().length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store round-trips sub-agent calls, including their own cost and latency", () => {
  const { dir, path } = tempPath("history.sqlite");
  const want: Consultation = {
    id: "oc-1",
    status: COMPLETED,
    provider: "opencode-go",
    model: "qwen3.6-plus",
    harness: "opencode",
    usage: { input: 1, prompt: 0, thinking: 0, output: 1 },
    subAgents: [
      {
        id: "call-1",
        name: "repo-explorer",
        description: "Map the repo",
        prompt: "EXPLORE EVERYTHING",
        response: "the report",
        provider: "deepseek",
        model: "v4-flash",
        usage: { input: 1_000, prompt: 40, thinking: 5, output: 200 },
        cost: 0.25,
        durationMs: 90_000,
      },
      { id: "call-2", name: "planner", prompt: "plan it", error: "Model not found" },
    ],
  };
  const store = HistoryStore.open(path);
  try {
    store.save(want);
    const [got] = store.consultations();
    // Compared through JSON: like every other optional field in serialization.ts, absent values
    // read back as explicitly-undefined keys, and it is the persisted data that matters here.
    assert.deepEqual(JSON.parse(JSON.stringify(got!.subAgents)), JSON.parse(JSON.stringify(want.subAgents)));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a consultation with no sub-agents reads back without the field", () => {
  const { dir, path } = tempPath("history.sqlite");
  const store = HistoryStore.open(path);
  try {
    store.save({ id: "pi-1", status: COMPLETED, usage: { input: 0, prompt: 0, thinking: 0, output: 0 } });
    assert.equal(store.consultations()[0]!.subAgents, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
