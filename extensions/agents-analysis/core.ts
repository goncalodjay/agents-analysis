export type CompletedEvent = {
  type: "consultation.completed";
  version: 1;
  id: string;
  identity: { sessionId: string; turnId: string; provider: string; model: string; reasoningLevel: string };
  content: { systemPrompt: string; context: string; userPrompt: string; response: string };
  usage: { input: number; prompt: number; thinking: number; output: number; cacheRead: number; cacheWrite: number };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: "success" | "error";
  error?: string;
  tools: Array<{ id: string; name: string; input: unknown; output: string; isError: boolean }>;
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

export function messageOf(entry: unknown): Message | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const message = (entry as { message?: unknown }).message;
  return message && typeof message === "object" ? message as Message : undefined;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join("\n");
}

function messagesWithRole(entries: unknown[], role: string): Message[] {
  return entries.map(messageOf).filter((message): message is Message => message?.role === role);
}

export function buildCompletedEvent(turn: TurnSnapshot): CompletedEvent {
  const assistants = messagesWithRole(turn.entries, "assistant");
  const results = new Map(messagesWithRole(turn.entries, "toolResult").flatMap((message) =>
    message.toolCallId ? [[message.toolCallId, message] as const] : [],
  ));

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
    if (!Array.isArray(assistant.content)) continue;
    for (const part of assistant.content) {
      if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "toolCall") continue;
      const call = part as { id?: string; name?: string; arguments?: unknown };
      if (!call.id || !call.name) continue;
      const result = results.get(call.id);
      tools.push({ id: call.id, name: call.name, input: call.arguments ?? {}, output: textOf(result?.content), isError: result?.isError ?? false });
    }
  }

  const failed = [...assistants].reverse().find((message) => message.stopReason === "error" || message.stopReason === "aborted");
  return {
    type: "consultation.completed",
    version: 1,
    id: `${turn.sessionId}:${turn.leafId}`,
    identity: { sessionId: turn.sessionId, turnId: turn.leafId, provider: turn.provider, model: turn.model, reasoningLevel: turn.reasoningLevel },
    content: {
      systemPrompt: turn.systemPrompt,
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
        return;
      }
    }
  }
}

export function lastTurn(entries: unknown[]): { leafId: string; entries: unknown[]; userPrompt: string } | undefined {
  const userIndex = entries.findLastIndex((entry) => messageOf(entry)?.role === "user");
  if (userIndex < 0) return undefined;
  const leaf = entries.at(-1) as { id?: string } | undefined;
  if (!leaf?.id) return undefined;
  return { leafId: leaf.id, entries: entries.slice(userIndex + 1), userPrompt: textOf(messageOf(entries[userIndex])?.content) };
}
