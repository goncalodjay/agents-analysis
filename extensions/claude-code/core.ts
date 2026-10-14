// Builds a consultation.completed event from a Claude Code session transcript (JSONL).
// Field shapes below were verified by reading a real transcript on disk, not guessed from
// memory — see the entries' `type`, `message.usage`, `effort`, `toolUseResult` fields.
import { readFileSync } from "node:fs";

import type { CompletedEvent, SubAgentEvent } from "../agents-analysis/core.ts";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown };

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
};

export type TranscriptEntry = {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  timestamp?: string;
  toolUseResult?: unknown;
  effort?: string;
  message?: {
    role?: string;
    id?: string;
    model?: string;
    content?: string | ContentBlock[];
    usage?: Usage;
    stop_reason?: string | null;
  };
};

function isGenuineUserPrompt(entry: TranscriptEntry): boolean {
  return entry.type === "user" && entry.toolUseResult === undefined && !entry.isSidechain;
}

/** Work a sub-agent did runs inline in the same transcript, flagged `isSidechain`. It is the
 * sub-agent's spend, not the parent's, so it is excluded from the parent everywhere and
 * re-attached under the Task call that started it. */
function isSidechain(entry: TranscriptEntry): boolean {
  return entry.isSidechain === true;
}

function textOf(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function toolResultsOf(entries: TranscriptEntry[]): Map<string, string> {
  const results = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "user" || isSidechain(entry) || !Array.isArray(entry.message?.content)) continue;
    for (const part of entry.message.content) {
      if (part.type === "tool_result") {
        results.set(part.tool_use_id, typeof part.content === "string" ? part.content : JSON.stringify(part.content));
      }
    }
  }
  return results;
}

function parseEntries(transcriptPath: string): TranscriptEntry[] {
  const lines = readFileSync(transcriptPath, "utf8").split("\n");
  const entries: TranscriptEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch {
      // Ignore malformed lines rather than aborting the whole capture.
    }
  }
  return entries;
}

/** The most recent turn: from the last genuine user prompt to the end of the transcript. */
export function lastTurn(entries: TranscriptEntry[]): TranscriptEntry[] | undefined {
  const startIndex = entries.findLastIndex(isGenuineUserPrompt);
  if (startIndex === -1) return undefined;
  return entries.slice(startIndex);
}

const TASK_TOOL = "Task";

type Totals = { input: number; prompt: number; thinking: number; output: number };

function addUsage(totals: Totals, usage: Usage | undefined): void {
  const thinking = usage?.output_tokens_details?.thinking_tokens ?? 0;
  totals.input += usage?.input_tokens ?? 0;
  totals.output += Math.max(0, (usage?.output_tokens ?? 0) - thinking);
  totals.thinking += thinking;
  totals.prompt += (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
}

/** Which non-sidechain entry each sidechain entry ultimately hangs off, by walking parentUuid
 * up out of the sidechain. That anchor is the assistant entry that issued the Task call. */
function sidechainOwners(entries: TranscriptEntry[]): Map<string, string> {
  const byUuid = new Map(entries.filter((entry) => entry.uuid).map((entry) => [entry.uuid!, entry]));
  const owners = new Map<string, string>();
  for (const entry of entries) {
    if (!isSidechain(entry) || !entry.uuid) continue;
    let cursor: TranscriptEntry | undefined = entry;
    const seen = new Set<string>();
    while (cursor?.parentUuid && !seen.has(cursor.parentUuid)) {
      seen.add(cursor.parentUuid);
      const parent = byUuid.get(cursor.parentUuid);
      if (!parent) break;
      if (!isSidechain(parent)) {
        owners.set(entry.uuid, parent.uuid!);
        break;
      }
      cursor = parent;
    }
  }
  return owners;
}

/** Delegated calls, with what each sub-agent spent.
 *
 * Caveat, stated rather than hidden: no transcript available on this machine contained a Task
 * call or a single `isSidechain` entry, so unlike the rest of this file the shapes below could
 * not be checked against real data — only against Claude Code's documented transcript format.
 * Every field is therefore read defensively: a sub-agent is still reported with its prompt even
 * when none of the usage/latency sources are present. */
function subAgentsOf(entries: TranscriptEntry[], results: Map<string, string>): SubAgentEvent[] {
  const owners = sidechainOwners(entries);
  const byOwner = new Map<string, { usage: Totals; first?: string; last?: string }>();
  for (const entry of entries) {
    if (!isSidechain(entry) || !entry.uuid) continue;
    const owner = owners.get(entry.uuid);
    if (!owner) continue;
    const bucket = byOwner.get(owner) ?? { usage: { input: 0, prompt: 0, thinking: 0, output: 0 } };
    if (entry.type === "assistant") addUsage(bucket.usage, entry.message?.usage);
    if (entry.timestamp) {
      bucket.first = bucket.first && bucket.first < entry.timestamp ? bucket.first : entry.timestamp;
      bucket.last = bucket.last && bucket.last > entry.timestamp ? bucket.last : entry.timestamp;
    }
    byOwner.set(owner, bucket);
  }

  const subAgents: SubAgentEvent[] = [];
  for (const entry of entries) {
    if (entry.type !== "assistant" || isSidechain(entry) || !Array.isArray(entry.message?.content)) continue;
    for (const part of entry.message.content) {
      if (part.type !== "tool_use" || part.name !== TASK_TOOL) continue;
      const input = (part.input ?? {}) as { prompt?: string; description?: string; subagent_type?: string };
      const bucket = entry.uuid ? byOwner.get(entry.uuid) : undefined;
      const spanMs = bucket?.first && bucket?.last ? Math.max(0, Date.parse(bucket.last) - Date.parse(bucket.first)) : undefined;
      const usage = bucket && (bucket.usage.input || bucket.usage.output || bucket.usage.thinking || bucket.usage.prompt) ? bucket.usage : undefined;
      subAgents.push({
        id: part.id,
        name: input.subagent_type ?? "sub-agent",
        description: input.description,
        prompt: input.prompt ?? "",
        response: results.get(part.id),
        model: entry.message?.model,
        provider: "anthropic",
        usage,
        durationMs: spanMs,
      });
    }
  }
  return subAgents;
}

export function buildCompletedEventFromEntries(entries: TranscriptEntry[], sessionId: string): CompletedEvent | undefined {
  const turn = lastTurn(entries);
  if (!turn) return undefined;

  const userPrompt = textOf(turn[0]!.message?.content);
  const assistants = turn.filter((entry) => entry.type === "assistant" && entry.message?.role === "assistant" && !isSidechain(entry));
  const results = toolResultsOf(turn);

  let input = 0;
  let output = 0;
  let thinking = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  const tools: CompletedEvent["tools"] = [];
  const responseParts: string[] = [];
  let model = "";
  let lastAssistantId = "";
  let lastStopReason: string | null | undefined;

  for (const assistant of assistants) {
    const usage = assistant.message?.usage;
    const assistantThinking = usage?.output_tokens_details?.thinking_tokens ?? 0;
    input += usage?.input_tokens ?? 0;
    output += Math.max(0, (usage?.output_tokens ?? 0) - assistantThinking);
    thinking += assistantThinking;
    cacheRead += usage?.cache_read_input_tokens ?? 0;
    cacheWrite += usage?.cache_creation_input_tokens ?? 0;
    model = assistant.message?.model ?? model;
    lastAssistantId = assistant.message?.id ?? lastAssistantId;
    lastStopReason = assistant.message?.stop_reason;

    const content = assistant.message?.content;
    if (Array.isArray(content)) {
      responseParts.push(textOf(content));
      for (const part of content) {
        if (part.type === "tool_use") {
          tools.push({ id: part.id, name: part.name, input: part.input ?? {}, output: results.get(part.id) ?? "", isError: false });
        }
      }
    }
  }

  const subAgents = subAgentsOf(turn, results);
  const lastEntry = turn.at(-1)!;
  const startedAt = turn[0]!.timestamp ?? new Date().toISOString();
  const finishedAt = lastEntry.timestamp ?? startedAt;
  const failed = lastStopReason === "error" || lastStopReason === "refusal";

  return {
    type: "consultation.completed",
    version: 1,
    id: `${sessionId}:${lastAssistantId || lastEntry.uuid || startedAt}`,
    agent: "claude-code",
    identity: {
      sessionId,
      turnId: lastAssistantId || lastEntry.uuid || startedAt,
      provider: "anthropic",
      model,
      reasoningLevel: assistants.at(-1)?.effort ?? "",
    },
    content: {
      // Claude Code doesn't expose its base system prompt in the transcript (it's applied at
      // the API level, not logged per turn), so it's intentionally left blank here rather than
      // guessed at.
      systemPrompt: "",
      context: "",
      userPrompt,
      response: responseParts.filter(Boolean).join("\n"),
    },
    usage: { input, prompt: cacheRead + cacheWrite, thinking, output, cacheRead, cacheWrite },
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    result: failed ? "error" : "success",
    tools,
    ...(subAgents.length > 0 ? { subAgents } : {}),
  };
}

export function buildCompletedEventFromTranscript(transcriptPath: string, sessionId: string): CompletedEvent | undefined {
  return buildCompletedEventFromEntries(parseEntries(transcriptPath), sessionId);
}
