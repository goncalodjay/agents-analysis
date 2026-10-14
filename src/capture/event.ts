// Wire event received from CLI adapters (Pi, and future opencode/Claude Code/Codex/kiro-cli
// adapters) and converted into a domain Consultation for persistence.
import type { Consultation, SubAgentCall, ToolResult } from "../consultation/consultation.ts";

export type Identity = { sessionId: string; turnId: string; provider: string; model: string; reasoningLevel: string };
export type Content = { systemPrompt: string; context: string; userPrompt: string; response: string };
export type Usage = { input: number; prompt: number; thinking: number; output: number; cacheRead: number; cacheWrite: number };
export type Tool = { id: string; name: string; input: unknown; output: string; isError: boolean };
/** A call the agent delegated to a sub-agent. Adapters that can't see delegated calls simply
 * omit the field, so older adapters keep validating against this schema unchanged. */
export type SubAgent = {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  response?: string;
  provider?: string;
  model?: string;
  usage?: { input: number; prompt: number; thinking: number; output: number };
  cost?: number;
  durationMs?: number;
  error?: string;
};

export type Event = {
  type: string;
  version: number;
  id: string;
  agent: string;
  identity: Identity;
  content: Content;
  usage: Usage;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: string;
  error?: string;
  tools: Tool[];
  subAgents?: SubAgent[];
  /** What the agent itself billed for the turn, when it reports one. */
  cost?: number;
};

export type Reply = { accepted: boolean; id?: string; reason?: string };

function hasRequiredIdentity(event: Event): boolean {
  if (event.type !== "consultation.completed" || event.version !== 1) return false;
  const required = [event.id, event.agent, event.identity?.sessionId, event.identity?.turnId, event.identity?.provider, event.identity?.model];
  return required.every((value) => typeof value === "string" && value !== "");
}

function usageHasNegativeValue(usage: Usage): boolean {
  const values = [usage.input, usage.prompt, usage.thinking, usage.output, usage.cacheRead, usage.cacheWrite];
  return values.some((value) => value < 0);
}

export function validate(event: Event): string | undefined {
  if (!hasRequiredIdentity(event)) return "identidad obligatoria";
  if (usageHasNegativeValue(event.usage)) return "uso de tokens inválido";
  if (event.durationMs < 0) return "duración inválida";
  return undefined;
}

export function toConsultation(event: Event): Consultation {
  const toolResults: ToolResult[] = (event.tools ?? []).map((tool) => ({
    tool: tool.name,
    request: JSON.stringify(tool.input ?? {}),
    result: tool.output,
  }));
  const subAgents: SubAgentCall[] | undefined = event.subAgents?.map((call) => ({
    id: call.id,
    name: call.name,
    description: call.description,
    prompt: call.prompt,
    response: call.response,
    provider: call.provider,
    model: call.model,
    usage: call.usage,
    cost: call.cost,
    durationMs: call.durationMs,
    error: call.error,
  }));
  return {
    id: event.id,
    status: "completed",
    provider: event.identity.provider,
    model: event.identity.model,
    harness: event.agent,
    inferenceParameters: `reasoning=${event.identity.reasoningLevel}`,
    prompts: { system: event.content.systemPrompt, user: event.content.userPrompt },
    context: event.content.context,
    response: event.content.response,
    toolResults,
    ...(subAgents && subAgents.length > 0 ? { subAgents } : {}),
    usage: { input: event.usage.input, prompt: event.usage.prompt, thinking: event.usage.thinking, output: event.usage.output },
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
    durationMs: event.durationMs,
    result: event.result,
    error: event.error,
    ...(event.cost === undefined ? {} : { cost: event.cost }),
  };
}
