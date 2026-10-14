// Completed-consultation domain model and pure summaries shared by the daemon, history store, and TUI.

export const COMPLETED = "completed";

export type Usage = { input: number; prompt: number; thinking: number; output: number };
export type Rates = { input: number; prompt: number; thinking: number; output: number };
export type ToolResult = { tool: string; request: string; result: string };

/** One delegated call an agent made to a sub-agent (opencode's `task` tool, Claude Code's
 * `Task` tool). Kept separate from `toolResults` because a sub-agent burns its own tokens on
 * its own model — folding it into the parent's tool list would hide where the money went. */
export type SubAgentCall = {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  response?: string;
  provider?: string;
  model?: string;
  usage?: Usage;
  cost?: number;
  durationMs?: number;
  error?: string;
};

export type Consultation = {
  id: string;
  status: string;
  provider?: string;
  model?: string;
  harness?: string;
  inferenceParameters?: string;
  prompts?: Record<string, string>;
  context?: string;
  response?: string;
  toolResults?: ToolResult[];
  subAgents?: SubAgentCall[];
  providerMetadata?: Record<string, string>;
  usage: Usage;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  result?: string;
  error?: string;
  cost?: number;
  rateSnapshot?: Rates;
  legacyEdn?: string;
};

export type Summary = { tokens: number; cost?: number };

export const EMPTY_USAGE: Usage = { input: 0, prompt: 0, thinking: 0, output: 0 };

export function totalTokens(usage: Usage | undefined): number {
  if (!usage) return 0;
  return usage.input + usage.prompt + usage.thinking + usage.output;
}

export function visible(records: Consultation[]): Consultation[] {
  return records.filter((record) => record.status === COMPLETED);
}

function priceUsage(usage: Usage, rates: Rates): number {
  return usage.input * rates.input + usage.prompt * rates.prompt + usage.thinking * rates.thinking + usage.output * rates.output;
}

/** Prices the call and every sub-agent call under it. A sub-agent that already reported its own
 * cost (opencode does) keeps that number — a locally configured rate must never overwrite what
 * the provider actually billed. */
export function attachCost(record: Consultation, rates: Rates): Consultation {
  const subAgents = record.subAgents?.map((call) =>
    call.cost === undefined && call.usage ? { ...call, cost: priceUsage(call.usage, rates) } : call,
  );
  return { ...record, cost: priceUsage(record.usage, rates), rateSnapshot: rates, ...(subAgents ? { subAgents } : {}) };
}

/** What the sub-agents under a call cost and how long they ran, for the detail header. */
export function subAgentTotals(record: Consultation): { count: number; tokens: number; cost?: number; durationMs: number } {
  const calls = record.subAgents ?? [];
  let tokens = 0;
  let durationMs = 0;
  let cost: number | undefined;
  for (const call of calls) {
    tokens += totalTokens(call.usage);
    durationMs += call.durationMs ?? 0;
    if (call.cost !== undefined) cost = (cost ?? 0) + call.cost;
  }
  return { count: calls.length, tokens, cost, durationMs };
}

export function summarize(records: Consultation[]): Summary {
  let tokens = 0;
  let cost: number | undefined;
  for (const record of visible(records)) {
    tokens += totalTokens(record.usage);
    if (record.cost !== undefined) {
      cost = (cost ?? 0) + record.cost;
    }
  }
  return { tokens, cost };
}
