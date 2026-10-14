// Builds a consultation.completed event from opencode's own session/message API
// (client.session.messages({path:{id}})). Shapes below were verified against @opencode-ai/sdk's
// generated types AND against a live ~/.local/share/opencode/opencode.db, not guessed:
//
// - AssistantMessage.tokens separates input/output/reasoning/cache.{read,write}, and (unlike
//   Pi/Claude Code) output does not include reasoning, so no subtraction is needed.
// - AssistantMessage.cost is the price opencode itself billed for the turn. It is authoritative
//   and is reported as-is rather than re-derived from a local rate table.
// - UserMessage.system is declared optional in the SDK and is in practice ALWAYS absent: no user
//   message row in the live database carries it. That is why the system prompt could never be
//   captured from the message alone, and why it now has to be supplied by the caller, which
//   collects it from opencode's experimental.chat.system.transform hook.
// - A delegated call is a `task` tool part whose state.metadata.sessionId names the child
//   session that ran it; that child session holds the sub-agent's own tokens and cost.
import type { CompletedEvent, SubAgentEvent } from "../agents-analysis/core.ts";

type ToolState =
  | { status: "pending" | "running"; input: Record<string, unknown> }
  | { status: "completed"; input: Record<string, unknown>; output: string; metadata?: Record<string, unknown>; time?: { start: number; end: number } }
  | { status: "error"; input: Record<string, unknown>; error: string; metadata?: Record<string, unknown>; time?: { start: number; end: number } };

type Part =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "tool"; callID: string; tool: string; state: ToolState }
  | { type: string; [key: string]: unknown };

type UserMessage = {
  id: string;
  sessionID: string;
  role: "user";
  time: { created: number };
  agent?: string;
  model?: { providerID: string; modelID: string };
  system?: string;
};

type AssistantMessage = {
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  error?: unknown;
  modelID: string;
  providerID: string;
  cost?: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
};

export type OpencodeMessage = { info: UserMessage | AssistantMessage; parts: Part[] };

/** What the plugin gathers from opencode before an event can be built: the system prompt (only
 * observable through a hook) and the messages of each child session a `task` call spawned. */
export type OpencodeContext = {
  systemPrompt?: string;
  subAgentSessions?: Record<string, OpencodeMessage[]>;
};

function isAssistant(message: OpencodeMessage): message is { info: AssistantMessage; parts: Part[] } {
  return message.info.role === "assistant";
}

/** Synthetic text parts are injected by opencode itself (command expansions, continuations);
 * they are not what the user typed, so they must not be reported as the user's prompt. */
function textOf(parts: Part[]): string {
  return parts
    .filter((part): part is { type: "text"; text: string; synthetic?: boolean } => part.type === "text" && typeof part.text === "string" && !part.synthetic)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/** opencode assembles its system prompt from several blocks (agent instructions, environment,
 * AGENTS.md, ...). They are sent to the model concatenated, so that is how they are recorded. */
export function joinSystemPrompt(parts: string[]): string {
  return (parts ?? []).filter((part) => typeof part === "string" && part.trim()).join("\n\n").trim();
}

/** The most recent turn: from the last user message to the end of the session. */
export function lastTurn(messages: OpencodeMessage[]): OpencodeMessage[] | undefined {
  const startIndex = messages.findLastIndex((message) => message.info.role === "user");
  if (startIndex === -1) return undefined;
  return messages.slice(startIndex);
}

export type Totals = { input: number; prompt: number; thinking: number; output: number; cacheRead: number; cacheWrite: number };

function totalsOf(messages: OpencodeMessage[]): { usage: Totals; cost?: number; durationMs: number } {
  const usage: Totals = { input: 0, prompt: 0, thinking: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost: number | undefined;
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const message of messages) {
    if (!isAssistant(message)) continue;
    const { tokens, time } = message.info;
    usage.input += tokens?.input ?? 0;
    usage.output += tokens?.output ?? 0;
    usage.thinking += tokens?.reasoning ?? 0;
    usage.cacheRead += tokens?.cache?.read ?? 0;
    usage.cacheWrite += tokens?.cache?.write ?? 0;
    if (typeof message.info.cost === "number") cost = (cost ?? 0) + message.info.cost;
    first = Math.min(first, time.created);
    last = Math.max(last, time.completed ?? time.created);
  }
  usage.prompt = usage.cacheRead + usage.cacheWrite;
  return { usage, cost, durationMs: Number.isFinite(first) ? Math.max(0, last - first) : 0 };
}

const TASK_TOOLS = new Set(["task", "agent", "subagent"]);

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value ? value : undefined;
}

function subAgentOf(part: { callID: string; tool: string; state: ToolState }, context: OpencodeContext): SubAgentEvent {
  const state = part.state;
  const metadata = ("metadata" in state ? state.metadata : undefined) ?? {};
  const childSessionId = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined;
  const childMessages = childSessionId ? context.subAgentSessions?.[childSessionId] : undefined;
  const totals = childMessages ? totalsOf(childMessages) : undefined;
  const model = (metadata.model ?? {}) as { providerID?: string; modelID?: string };
  const time = "time" in state ? state.time : undefined;
  // The tool's own start/end brackets the whole delegated run, so it is the latency the user
  // actually waited; the child session's own span is only used when the tool didn't report one.
  const durationMs = time ? Math.max(0, time.end - time.start) : totals?.durationMs;

  return {
    id: part.callID,
    name: stringField(state.input, "subagent_type") ?? (typeof metadata.agent === "string" ? metadata.agent : undefined) ?? "sub-agent",
    description: stringField(state.input, "description"),
    prompt: stringField(state.input, "prompt") ?? "",
    response: state.status === "completed" ? state.output : undefined,
    error: state.status === "error" ? state.error : undefined,
    provider: model.providerID,
    model: model.modelID,
    usage: totals?.usage ? { input: totals.usage.input, prompt: totals.usage.prompt, thinking: totals.usage.thinking, output: totals.usage.output } : undefined,
    cost: totals?.cost,
    durationMs,
  };
}

/** Child sessions of `task` calls, so the plugin knows which sessions to fetch before building
 * the event. Exported so the fetching stays in the plugin and the parsing stays here. */
export function subAgentSessionIds(messages: OpencodeMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      const tool = part as { tool: string; state: ToolState };
      if (!TASK_TOOLS.has(tool.tool)) continue;
      const metadata = ("metadata" in tool.state ? tool.state.metadata : undefined) ?? {};
      if (typeof metadata.sessionId === "string" && !ids.includes(metadata.sessionId)) ids.push(metadata.sessionId);
    }
  }
  return ids;
}

export function buildCompletedEvent(messages: OpencodeMessage[], sessionId: string, context: OpencodeContext = {}): CompletedEvent | undefined {
  const turn = lastTurn(messages);
  if (!turn) return undefined;

  const user = turn[0]!.info as UserMessage;
  const assistants = turn.filter(isAssistant);
  if (assistants.length === 0) return undefined;

  const tools: CompletedEvent["tools"] = [];
  const subAgents: SubAgentEvent[] = [];
  const responseParts: string[] = [];
  let failed = false;

  for (const assistant of assistants) {
    if (assistant.info.error) failed = true;
    responseParts.push(textOf(assistant.parts));
    for (const part of assistant.parts) {
      if (part.type !== "tool") continue;
      const tool = part as { callID: string; tool: string; state: ToolState };
      const state = tool.state;
      if (state.status === "completed") tools.push({ id: tool.callID, name: tool.tool, input: state.input, output: state.output, isError: false });
      else if (state.status === "error") tools.push({ id: tool.callID, name: tool.tool, input: state.input, output: state.error, isError: true });
      else continue;
      if (TASK_TOOLS.has(tool.tool)) subAgents.push(subAgentOf(tool, context));
    }
  }

  const { usage, cost } = totalsOf(turn);
  const lastAssistant = assistants.at(-1)!.info;
  const startedAt = user.time.created;
  const finishedAt = lastAssistant.time.completed ?? lastAssistant.time.created;

  return {
    type: "consultation.completed",
    version: 1,
    id: `${sessionId}:${lastAssistant.id}`,
    agent: "opencode",
    identity: {
      sessionId,
      turnId: lastAssistant.id,
      provider: lastAssistant.providerID,
      model: lastAssistant.modelID,
      // opencode doesn't expose a reasoning-effort level on the message the way Pi does —
      // left blank rather than guessed.
      reasoningLevel: "",
    },
    content: {
      // user.system is always absent in practice; the plugin supplies what the model was
      // actually sent, captured from experimental.chat.system.transform.
      systemPrompt: context.systemPrompt ?? user.system ?? "",
      context: "",
      userPrompt: textOf(turn[0]!.parts),
      response: responseParts.filter(Boolean).join("\n"),
    },
    usage,
    ...(cost === undefined ? {} : { cost }),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: Math.max(0, finishedAt - startedAt),
    result: failed ? "error" : "success",
    tools,
    ...(subAgents.length > 0 ? { subAgents } : {}),
  };
}
