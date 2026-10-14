import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPricingTableFromModelsDev, loadPricingTable, rateFor, readAutoPricingTable, refreshPricingCache } from "./pricing.ts";

test("loadPricingTable returns an empty table when the file is missing", () => {
  assert.deepEqual(loadPricingTable("/nonexistent/pricing.json"), {});
});

test("loadPricingTable returns an empty table for malformed JSON rather than throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-pricing-"));
  try {
    const path = join(dir, "pricing.json");
    writeFileSync(path, "{not json");
    assert.deepEqual(loadPricingTable(path), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPricingTable reads a real file", () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-pricing-"));
  try {
    const path = join(dir, "pricing.json");
    writeFileSync(path, JSON.stringify({ "claude-sonnet-5": { input: 3, prompt: 0.3, thinking: 3, output: 15 } }));
    const table = loadPricingTable(path);
    assert.deepEqual(table["claude-sonnet-5"], { input: 3, prompt: 0.3, thinking: 3, output: 15 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rateFor converts published per-million rates into per-token rates", () => {
  const table = { "gpt-5.4-mini": { input: 2, prompt: 0.5, thinking: 2, output: 8 } };
  assert.deepEqual(rateFor(table, "gpt-5.4-mini"), { input: 0.000002, prompt: 0.0000005, thinking: 0.000002, output: 0.000008 });
});

test("rateFor returns undefined for an unpriced or unknown model", () => {
  assert.equal(rateFor({}, "some-model"), undefined);
  assert.equal(rateFor({ "some-model": { input: 1, prompt: 1, thinking: 1, output: 1 } }, undefined), undefined);
});

test("buildPricingTableFromModelsDev prefers a first-party provider over gateway resellers, kept in $/1M units", () => {
  const data = {
    "some-gateway": { models: { "gpt-5.4-mini": { cost: { input: 1.5, output: 9, cache_read: 0.15 } } } },
    openai: { models: { "gpt-5.4-mini": { cost: { input: 0.75, output: 4.5, cache_read: 0.075 } } } },
  };
  const table = buildPricingTableFromModelsDev(data);
  assert.deepEqual(table["gpt-5.4-mini"], { input: 0.75, prompt: 0.075, thinking: 4.5, output: 4.5 });
});

test("buildPricingTableFromModelsDev falls back to whatever provider is present, and to output when reasoning/cache_read are absent", () => {
  const data = { "only-provider": { models: { "some-model": { cost: { input: 1, output: 2 } } } } };
  const table = buildPricingTableFromModelsDev(data);
  assert.deepEqual(table["some-model"], { input: 1, prompt: 1, thinking: 2, output: 2 });
});

test("buildPricingTableFromModelsDev uses an explicit reasoning rate when the provider publishes one", () => {
  const data = { deepseek: { models: { "deepseek-v4-flash": { cost: { input: 0.14, output: 0.28, reasoning: 0.5, cache_read: 0.0028 } } } } };
  const table = buildPricingTableFromModelsDev(data);
  assert.equal(table["deepseek-v4-flash"]!.thinking, 0.5);
});

test("refreshPricingCache fetches and writes the cache when there is none yet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-pricing-"));
  try {
    const cachePath = join(dir, "pricing-cache.json");
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ openai: { models: { "gpt-5.4-mini": { cost: { input: 0.75, output: 4.5, cache_read: 0.075 } } } } }),
      };
    }) as unknown as typeof fetch;

    await refreshPricingCache(cachePath, fakeFetch);
    assert.equal(calls, 1);
    assert.deepEqual(readAutoPricingTable(cachePath)["gpt-5.4-mini"], { input: 0.75, prompt: 0.075, thinking: 4.5, output: 4.5 });

    // A second call within the refresh window must not fetch again.
    await refreshPricingCache(cachePath, fakeFetch);
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("end to end: the auto cache feeds rateFor in the same $/1M unit as the manual pricing.json file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-pricing-"));
  try {
    const cachePath = join(dir, "pricing-cache.json");
    const fakeFetch = (async () => ({
      ok: true,
      json: async () => ({ openai: { models: { "gpt-5.4-mini": { cost: { input: 0.75, output: 4.5, cache_read: 0.075 } } } } }),
    })) as unknown as typeof fetch;
    await refreshPricingCache(cachePath, fakeFetch);

    const rate = rateFor(readAutoPricingTable(cachePath), "gpt-5.4-mini")!;
    assert.deepEqual(rate, { input: 0.75 / 1e6, prompt: 0.075 / 1e6, thinking: 4.5 / 1e6, output: 4.5 / 1e6 });

    // Usage input:1000, cacheRead(prompt):500, thinking:100, output:200 against the real
    // published gpt-5.4-mini rate — the number a user would actually see in the TUI.
    const cost = 1000 * rate.input + 500 * rate.prompt + 100 * rate.thinking + 200 * rate.output;
    assert.ok(Math.abs(cost - 0.0021375) < 1e-9, `cost = ${cost}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshPricingCache keeps the existing cache when the fetch fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-pricing-"));
  try {
    const cachePath = join(dir, "pricing-cache.json");
    writeFileSync(cachePath, JSON.stringify({ fetchedAt: new Date(0).toISOString(), table: { "old-model": { input: 1, prompt: 1, thinking: 1, output: 1 } } } as never));

    const failingFetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await refreshPricingCache(cachePath, failingFetch);

    assert.deepEqual(readAutoPricingTable(cachePath)["old-model"], { input: 1, prompt: 1, thinking: 1, output: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readAutoPricingTable returns an empty table when there is no cache yet", () => {
  assert.deepEqual(readAutoPricingTable("/nonexistent/pricing-cache.json"), {});
});
