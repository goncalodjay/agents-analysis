import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";

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
  toolName?: string;
  isError?: boolean;
};

function messageOf(entry: unknown): Message | undefined {
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

export function buildCompletedEvent(turn: TurnSnapshot): CompletedEvent {
  const assistants = turn.entries.map(messageOf).filter((message): message is Message => message?.role === "assistant");
  const results = new Map<string, Message>();
  for (const message of turn.entries.map(messageOf)) {
    if (message?.role === "toolResult" && message.toolCallId) results.set(message.toolCallId, message);
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

type OutboxState = { pending: CompletedEvent[]; delivered: string[] };

export class FileOutbox implements Outbox {
  private operation: Promise<unknown> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) { this.path = path; }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.then(work, work);
    this.operation = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<OutboxState> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8")) as Partial<OutboxState>;
      return { pending: Array.isArray(state.pending) ? state.pending : [], delivered: Array.isArray(state.delivered) ? state.delivered : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { pending: [], delivered: [] };
      throw error;
    }
  }

  private async write(state: OutboxState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }

  hasDelivered(id: string): Promise<boolean> {
    return this.serialized(async () => (await this.read()).delivered.includes(id));
  }

  enqueue(event: CompletedEvent): Promise<void> {
    return this.serialized(async () => {
      const state = await this.read();
      if (!state.delivered.includes(event.id) && !state.pending.some((item) => item.id === event.id)) {
        state.pending.push(event);
        await this.write(state);
      }
    });
  }

  listPending(): Promise<CompletedEvent[]> {
    return this.serialized(async () => [...(await this.read()).pending]);
  }

  markDelivered(id: string): Promise<void> {
    return this.serialized(async () => {
      const state = await this.read();
      state.pending = state.pending.filter((event) => event.id !== id);
      state.delivered = [...state.delivered.filter((item) => item !== id), id].slice(-1000);
      await this.write(state);
    });
  }
}

function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function sendToDaemon(address: string, event: CompletedEvent): Promise<void> {
  const socketPath = expandHome(address.replace(/^unix:\/\//, ""));
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setTimeout(2_000);
    socket.once("connect", () => socket.end(`${JSON.stringify(event)}\n`, resolve));
    socket.once("timeout", () => socket.destroy(new Error("daemon connection timed out")));
    socket.once("error", reject);
  });
}

function lastTurn(entries: unknown[]): { leafId: string; entries: unknown[]; userPrompt: string } | undefined {
  let userIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (messageOf(entries[index])?.role === "user") { userIndex = index; break; }
  }
  if (userIndex < 0) return undefined;
  const leaf = entries[entries.length - 1] as { id?: string } | undefined;
  if (!leaf?.id) return undefined;
  return { leafId: leaf.id, entries: entries.slice(userIndex + 1), userPrompt: textOf(messageOf(entries[userIndex])?.content) };
}

export default function agentsAnalysis(pi: ExtensionAPI) {
  const address = process.env.AGENTS_ANALYSIS_DAEMON ?? "unix://~/.local/share/agents-analysis/daemon.sock";
  const outboxPath = expandHome(process.env.AGENTS_ANALYSIS_OUTBOX ?? "~/.local/share/agents-analysis/pi-outbox.json");
  const capture = new CaptureController(new FileOutbox(outboxPath), (event) => sendToDaemon(address, event));
  let start: { at: number; systemPrompt: string; context: string; userPrompt: string } | undefined;
  let retryTimer: ReturnType<typeof setInterval> | undefined;

  pi.on("session_start", async () => {
    if (retryTimer) clearInterval(retryTimer);
    await capture.retry();
    retryTimer = setInterval(() => void capture.retry(), 5_000);
    retryTimer.unref();
  });

  pi.on("before_agent_start", (event) => {
    const contextFiles = event.systemPromptOptions.contextFiles ?? [];
    start = {
      at: Date.now(),
      systemPrompt: event.systemPrompt,
      context: contextFiles.map((file) => `${file.path}=${file.content}`).join("\n"),
      userPrompt: event.prompt,
    };
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const entries = ctx.sessionManager.getBranch() as unknown[];
    const turn = lastTurn(entries);
    if (!turn) return;
    const finalAssistant = [...turn.entries].reverse().map(messageOf).find((message) => message?.role === "assistant");
    const settledAt = Date.now();
    await capture.settled(buildCompletedEvent({
      sessionId: ctx.sessionManager.getSessionId(),
      leafId: turn.leafId,
      provider: finalAssistant?.provider ?? ctx.model?.provider ?? "",
      model: finalAssistant?.model ?? ctx.model?.id ?? "",
      reasoningLevel: ctx.thinkingLevel,
      systemPrompt: start?.systemPrompt ?? ctx.getSystemPrompt(),
      context: start?.context ?? "",
      userPrompt: start?.userPrompt ?? turn.userPrompt,
      startedAt: start?.at ?? settledAt,
      settledAt,
      entries: turn.entries,
    }));
  });

  pi.on("session_shutdown", async () => {
    if (retryTimer) clearInterval(retryTimer);
    retryTimer = undefined;
    await capture.retry();
  });
}
