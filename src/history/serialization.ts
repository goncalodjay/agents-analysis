// Maps the idiomatic camelCase domain model to the exact JSON shape Go's `encoding/json`
// produced (snake_case top-level fields, capitalized nested Usage/Rates/ToolResult fields —
// those nested Go structs had no json tags). Existing databases were written in this shape,
// so every field below mirrors its Go struct tag's omitempty behavior exactly.
import type { Consultation, Rates, SubAgentCall, ToolResult, Usage } from "../consultation/consultation.ts";

type StoredUsage = { Input: number; Prompt: number; Thinking: number; Output: number };
type StoredRates = { Input: number; Prompt: number; Thinking: number; Output: number };
type StoredToolResult = { Tool: string; Request: string; Result: string };

// Sub-agent calls never existed in the Go implementation, so there is no legacy shape to mirror
// here — unlike the types above, this one uses plain snake_case throughout.
type StoredSubAgent = {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  response?: string;
  provider?: string;
  model?: string;
  usage?: StoredUsage;
  cost?: number;
  duration_ms?: number;
  error?: string;
};

export type StoredConsultation = {
  id: string;
  status: string;
  provider?: string;
  model?: string;
  harness?: string;
  inference_parameters?: string;
  prompts?: Record<string, string>;
  context?: string;
  response?: string;
  tool_results?: StoredToolResult[];
  sub_agents?: StoredSubAgent[];
  provider_metadata?: Record<string, string>;
  usage: StoredUsage;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  result?: string;
  error?: string;
  cost?: number;
  rate_snapshot?: StoredRates;
  legacy_edn?: string;
};

const emptyString = (value: string | undefined): string | undefined => (value ? value : undefined);
const emptyMap = (value: Record<string, string> | undefined): Record<string, string> | undefined =>
  value && Object.keys(value).length > 0 ? value : undefined;
const emptyArray = <T>(value: T[] | undefined): T[] | undefined => (value && value.length > 0 ? value : undefined);
const emptyNumber = (value: number | undefined): number | undefined => (value ? value : undefined);

const toStoredUsage = (usage: Usage): StoredUsage => ({
  Input: usage.input,
  Prompt: usage.prompt,
  Thinking: usage.thinking,
  Output: usage.output,
});

const fromStoredUsage = (usage: StoredUsage | undefined): Usage => ({
  input: usage?.Input ?? 0,
  prompt: usage?.Prompt ?? 0,
  thinking: usage?.Thinking ?? 0,
  output: usage?.Output ?? 0,
});

const toStoredRates = (rates: Rates): StoredRates => ({
  Input: rates.input,
  Prompt: rates.prompt,
  Thinking: rates.thinking,
  Output: rates.output,
});

const fromStoredRates = (rates: StoredRates): Rates => ({
  input: rates.Input,
  prompt: rates.Prompt,
  thinking: rates.Thinking,
  output: rates.Output,
});

const toStoredSubAgent = (call: SubAgentCall): StoredSubAgent => ({
  id: call.id,
  name: call.name,
  description: emptyString(call.description),
  prompt: call.prompt,
  response: emptyString(call.response),
  provider: emptyString(call.provider),
  model: emptyString(call.model),
  usage: call.usage ? toStoredUsage(call.usage) : undefined,
  cost: call.cost,
  duration_ms: call.durationMs,
  error: emptyString(call.error),
});

const fromStoredSubAgent = (call: StoredSubAgent): SubAgentCall => ({
  id: call.id,
  name: call.name,
  description: call.description,
  prompt: call.prompt ?? "",
  response: call.response,
  provider: call.provider,
  model: call.model,
  usage: call.usage ? fromStoredUsage(call.usage) : undefined,
  cost: call.cost,
  durationMs: call.duration_ms,
  error: call.error,
});

const toStoredTool = (tool: ToolResult): StoredToolResult => ({ Tool: tool.tool, Request: tool.request, Result: tool.result });
const fromStoredTool = (tool: StoredToolResult): ToolResult => ({ tool: tool.Tool, request: tool.Request, result: tool.Result });

export function toStored(record: Consultation): StoredConsultation {
  return {
    id: record.id,
    status: record.status,
    provider: emptyString(record.provider),
    model: emptyString(record.model),
    harness: emptyString(record.harness),
    inference_parameters: emptyString(record.inferenceParameters),
    prompts: emptyMap(record.prompts),
    context: emptyString(record.context),
    response: emptyString(record.response),
    tool_results: emptyArray(record.toolResults?.map(toStoredTool)),
    sub_agents: emptyArray(record.subAgents?.map(toStoredSubAgent)),
    provider_metadata: emptyMap(record.providerMetadata),
    usage: toStoredUsage(record.usage),
    started_at: emptyString(record.startedAt),
    finished_at: emptyString(record.finishedAt),
    duration_ms: emptyNumber(record.durationMs),
    result: emptyString(record.result),
    error: emptyString(record.error),
    cost: record.cost,
    rate_snapshot: record.rateSnapshot ? toStoredRates(record.rateSnapshot) : undefined,
    legacy_edn: emptyString(record.legacyEdn),
  };
}

export function fromStored(stored: StoredConsultation): Consultation {
  return {
    id: stored.id,
    status: stored.status,
    provider: stored.provider,
    model: stored.model,
    harness: stored.harness,
    inferenceParameters: stored.inference_parameters,
    prompts: stored.prompts,
    context: stored.context,
    response: stored.response,
    toolResults: stored.tool_results?.map(fromStoredTool),
    subAgents: stored.sub_agents?.map(fromStoredSubAgent),
    providerMetadata: stored.provider_metadata,
    usage: fromStoredUsage(stored.usage),
    startedAt: stored.started_at,
    finishedAt: stored.finished_at,
    durationMs: stored.duration_ms,
    result: stored.result,
    error: stored.error,
    cost: stored.cost,
    rateSnapshot: stored.rate_snapshot ? fromStoredRates(stored.rate_snapshot) : undefined,
    legacyEdn: stored.legacy_edn,
  };
}

export function ratesToStored(rates: Rates): StoredRates {
  return toStoredRates(rates);
}

export function ratesFromStored(stored: StoredRates): Rates {
  return fromStoredRates(stored);
}
