// Per-model $/token pricing. Two layers, override-first:
//  1. A hand-edited override file (pricing.json) for models an automated source won't know
//     about (custom aliases, internal routing names).
//  2. An auto-refreshed cache (pricing-cache.json) sourced from models.dev
//     (https://models.dev/api.json) — the same open, community-maintained pricing database
//     opencode itself is built on. Refreshed on a timer (see refreshPricingCache), never on the
//     capture hot path — reading the cache is a plain synchronous file read, so handling an
//     event never blocks on network I/O.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { Rates } from "./consultation/consultation.ts";

/** Rates as published by providers: USD per 1,000,000 tokens, keyed by model name. */
export type PricingTable = Record<string, Rates>;

export function loadPricingTable(path: string): PricingTable {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as PricingTable) : {};
  } catch {
    return {};
  }
}

const PER_TOKEN = 1_000_000;

/** Converts a model's published per-million-token rate into the per-token `Rates` `attachCost`
 * expects. Returns undefined when the model has no configured price — callers should leave
 * the consultation's cost unset in that case rather than defaulting it to zero. */
export function rateFor(table: PricingTable, model: string | undefined): Rates | undefined {
  if (!model) return undefined;
  const perMillion = table[model];
  if (!perMillion) return undefined;
  return {
    input: perMillion.input / PER_TOKEN,
    prompt: perMillion.prompt / PER_TOKEN,
    thinking: perMillion.thinking / PER_TOKEN,
    output: perMillion.output / PER_TOKEN,
  };
}

// --- models.dev auto-sourced pricing ---

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const PRICING_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

type ModelsDevCost = { input?: number; output?: number; reasoning?: number; cache_read?: number; cache_write?: number };
type ModelsDevData = Record<string, { models?: Record<string, { cost?: ModelsDevCost }> }>;

// Many resellers/gateways re-list the same model at (near-)identical pricing; when several
// providers offer the same model id, prefer whichever of these appears first, since it's most
// likely the first-party rate rather than a gateway markup or a stale mirror.
const PREFERRED_PROVIDERS = ["anthropic", "openai", "google", "google-vertex", "azure", "deepseek", "opencode"];

// cache_read tokens dominate a long session's "prompt" bucket far more than the rarer
// cache_write ones, and the wire event already collapses both into one `usage.prompt` count
// before it reaches this table (see extensions/*/core.ts) — so cache_read is the closer
// approximation of the two. Cost figures are therefore an estimate, not exact, for any model
// whose cache_write rate differs meaningfully from its cache_read rate.
// Kept in the same $/1,000,000-tokens unit as the manual pricing.json file (rateFor is the
// only place that ever converts to $/token) — mixing units here caused a real double-division
// bug once (a rate got divided by 1e6 twice: once here, again in rateFor).
function toRates(cost: ModelsDevCost): Rates {
  return {
    input: cost.input ?? 0,
    prompt: cost.cache_read ?? cost.input ?? 0,
    thinking: cost.reasoning ?? cost.output ?? 0,
    output: cost.output ?? 0,
  };
}

export function buildPricingTableFromModelsDev(data: ModelsDevData): PricingTable {
  const byModel = new Map<string, { providerId: string; cost: ModelsDevCost }[]>();
  for (const [providerId, provider] of Object.entries(data)) {
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      if (!model.cost) continue;
      const entries = byModel.get(modelId) ?? [];
      entries.push({ providerId, cost: model.cost });
      byModel.set(modelId, entries);
    }
  }

  const table: PricingTable = {};
  for (const [modelId, entries] of byModel) {
    const preferred = PREFERRED_PROVIDERS.map((id) => entries.find((entry) => entry.providerId === id)).find(Boolean);
    table[modelId] = toRates((preferred ?? entries[0])!.cost);
  }
  return table;
}

type PricingCache = { fetchedAt: string; table: PricingTable };

function readPricingCacheFile(cachePath: string): PricingCache | undefined {
  if (!existsSync(cachePath)) return undefined;
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as PricingCache;
  } catch {
    return undefined;
  }
}

/** Synchronous read of whatever's currently cached — safe to call from the capture hot path. */
export function readAutoPricingTable(cachePath: string): PricingTable {
  return readPricingCacheFile(cachePath)?.table ?? {};
}

/** Fetches models.dev and rewrites the cache, unless the existing cache is still fresh.
 * Never throws: a failed fetch (offline, DNS, non-200) just keeps the existing cache in place. */
export async function refreshPricingCache(cachePath: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const existing = readPricingCacheFile(cachePath);
  if (existing && Date.now() - Date.parse(existing.fetchedAt) < PRICING_REFRESH_INTERVAL_MS) return;

  try {
    const response = await fetchImpl(MODELS_DEV_URL);
    if (!response.ok) throw new Error(`models.dev responded ${response.status}`);
    const data = (await response.json()) as ModelsDevData;
    const table = buildPricingTableFromModelsDev(data);
    writeFileSync(cachePath, JSON.stringify({ fetchedAt: new Date().toISOString(), table } satisfies PricingCache));
  } catch {
    // Offline or the endpoint is down — keep serving whatever's already cached (possibly nothing).
  }
}
