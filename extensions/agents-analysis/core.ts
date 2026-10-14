// Pi's system prompt bundles a large static block (tool descriptions, guidelines, doc
// pointers, skill-loading instructions) that's identical on every call and adds nothing to
// the analysis. Cut it out, keeping the short role preamble and the one line that does vary
// per session (the working directory). Duplicated in src/tui/model.ts — the TUI applies the
// same trim at display time for rows captured before this existed, and this extension is
// copied standalone into Pi's extensions directory, so it can't import from src/.
const TOOLS_MARKER = "\nAvailable tools:";
const CWD_MARKER = "\nCurrent working directory:";

export function stripSystemPromptBoilerplate(systemPrompt: string): string {
  const startIndex = systemPrompt.indexOf(TOOLS_MARKER);
  if (startIndex === -1) return systemPrompt;
  const endIndex = systemPrompt.indexOf(CWD_MARKER, startIndex);
  const head = systemPrompt.slice(0, startIndex).trimEnd();
  const tail = endIndex === -1 ? "" : systemPrompt.slice(endIndex).trim();
  return tail ? `${head}\n${tail}` : head;
}

/** A call the agent delegated to a sub-agent. Adapters that cannot observe delegated calls
 * simply omit the field. `cost` is only set when the agent itself reported a price — the daemon
 * fills in the rest from its rate table rather than the adapter guessing. */
export type SubAgentEvent = {
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

// Keep Pi's loosely typed session representation behind this normalization boundary.
export type CompletedEvent = {
  type: "consultation.completed";
  version: 1;
  id: string;
  agent: string;
  identity: { sessionId: string; turnId: string; provider: string; model: string; reasoningLevel: string };
  content: { systemPrompt: string; context: string; userPrompt: string; response: string };
  usage: { input: number; prompt: number; thinking: number; output: number; cacheRead: number; cacheWrite: number };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: "success" | "error";
  error?: string;
  tools: Array<{ id: string; name: string; input: unknown; output: string; isError: boolean }>;
  subAgents?: SubAgentEvent[];
  /** What the agent itself says the turn cost. Present only for agents that report a price
   * (opencode does); the daemon prefers it over its own rate table. */
  cost?: number;
};

export type TurnSnapshot = {
  sessionId: string;
  leafId: string;
  provider: string;
  model: string;
  reasoningLevel: string;
  systemPrompt: string;
  context: string;
  userPrompt: string;
  startedAt: number;
  settledAt: number;
  entries: unknown[];
};

export interface Outbox {
  hasDelivered(id: string): Promise<boolean>;
  enqueue(event: CompletedEvent): Promise<void>;
  listPending(): Promise<CompletedEvent[]>;
  markDelivered(id: string): Promise<void>;
}

type Message = {
  role?: string;
  provider?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: Record<string, number>;
  content?: unknown;
  toolCallId?: string;
  isError?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  // Stryker disable next-line ConditionalExpression: property reads on truthy primitives are observationally equivalent.
  return Boolean(value) && typeof value === "object";
}

export function messageOf(entry: unknown): Message | undefined {
  if (!isRecord(entry)) return undefined;
  const message = entry.message;
  return isRecord(message) ? message as Message : undefined;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: "text"; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function messagesWithRole(entries: unknown[], role: string): Message[] {
  return entries.map(messageOf).filter((message): message is Message => message?.role === role);
}

export function buildCompletedEvent(turn: TurnSnapshot): CompletedEvent {
  const assistants = messagesWithRole(turn.entries, "assistant");
  const results = new Map<string, Message>();
  for (const message of messagesWithRole(turn.entries, "toolResult")) {
    // Stryker disable next-line ConditionalExpression: missing IDs cannot match a valid tool call.
    if (message.toolCallId) results.set(message.toolCallId, message);
  }

  let input = 0;
  let output = 0;
  let thinking = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  const tools: CompletedEvent["tools"] = [];
  for (const assistant of assistants) {
    input += assistant.usage?.input ?? 0;
    const assistantThinking = assistant.usage?.reasoning ?? 0;
    output += Math.max(0, (assistant.usage?.output ?? 0) - assistantThinking);
    thinking += assistantThinking;
    cacheRead += assistant.usage?.cacheRead ?? 0;
    cacheWrite += assistant.usage?.cacheWrite ?? 0;
    if (Array.isArray(assistant.content)) {
      for (const part of assistant.content) {
        if (!isRecord(part) || part.type !== "toolCall") continue;
        const call = part as { id?: string; name?: string; arguments?: unknown };
        if (call.id && call.name) {
          const result = results.get(call.id);
          tools.push({ id: call.id, name: call.name, input: call.arguments ?? {}, output: textOf(result?.content), isError: result?.isError ?? false });
        }
      }
    }
  }

  const failed = assistants.findLast((message) => ["error", "aborted"].includes(message.stopReason as string));
  return {
    type: "consultation.completed",
    version: 1,
    id: `${turn.sessionId}:${turn.leafId}`,
    agent: "pi",
    identity: { sessionId: turn.sessionId, turnId: turn.leafId, provider: turn.provider, model: turn.model, reasoningLevel: turn.reasoningLevel },
    content: {
      systemPrompt: stripSystemPromptBoilerplate(turn.systemPrompt),
      context: turn.context,
      userPrompt: turn.userPrompt,
      response: assistants.map((message) => textOf(message.content)).filter(Boolean).join("\n"),
    },
    usage: { input, prompt: cacheRead + cacheWrite, thinking, output, cacheRead, cacheWrite },
    startedAt: new Date(turn.startedAt).toISOString(),
    finishedAt: new Date(turn.settledAt).toISOString(),
    durationMs: Math.max(0, turn.settledAt - turn.startedAt),
    result: failed ? "error" : "success",
    ...(failed?.errorMessage ? { error: failed.errorMessage } : {}),
    tools,
  };
}

export class CaptureController {
  private readonly outbox: Outbox;
  private readonly deliver: (event: CompletedEvent) => Promise<void>;

  constructor(outbox: Outbox, deliver: (event: CompletedEvent) => Promise<void>) {
    this.outbox = outbox;
    this.deliver = deliver;
  }

  async settled(event: CompletedEvent): Promise<void> {
    if (await this.outbox.hasDelivered(event.id)) return;
    await this.outbox.enqueue(event);
    await this.retry();
  }

  async retry(): Promise<void> {
    for (const event of await this.outbox.listPending()) {
      try {
        await this.deliver(event);
        await this.outbox.markDelivered(event.id);
      } catch {
        break;
      }
    }
  }
}

export function lastTurn(entries: unknown[]): { leafId: string; entries: unknown[]; userPrompt: string } | undefined {
  const userIndex = entries.findLastIndex((entry) => messageOf(entry)?.role === "user");
  if (userIndex < 0) return undefined;

  const leaf = entries.at(-1);
  if (!isRecord(leaf) || typeof leaf.id !== "string" || !leaf.id) return undefined;
  const user = messageOf(entries[userIndex]);
  return {
    leafId: leaf.id,
    entries: entries.slice(userIndex + 1),
    userPrompt: textOf(user!.content),
  };
}
