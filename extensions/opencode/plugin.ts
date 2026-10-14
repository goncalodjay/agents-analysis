// Global opencode plugin: captures every session's completed turn and reports it to the
// agents-analysis daemon. Loaded by opencode itself from ~/.config/opencode/plugins/ (a
// symlink back to this file — see docs/opencode-plugin.md), so imports below resolve against
// opencode's own node_modules, not this repo's.
//
// One-shot `opencode run` invocations can dispose the process before an in-flight delivery
// (the socket round trip in sendToDaemon) finishes — verified by running it live: the event was
// durably enqueued to the outbox but never marked delivered. capture.retry() at plugin startup
// flushes whatever a previous invocation left pending, the same way Pi's extension retries on
// session_start — so a lost delivery is only ever delayed by one invocation, never dropped.
import type { Plugin } from "@opencode-ai/plugin";

import { CaptureController } from "../agents-analysis/core.ts";
import { expandHome, FileOutbox, sendToDaemon } from "../agents-analysis/outbox.ts";
import { buildCompletedEvent, joinSystemPrompt, subAgentSessionIds, type OpencodeMessage } from "./core.ts";

/** opencode never persists the system prompt on the message it sends (confirmed against its
 * own SQLite: no user row carries a `system` field), so the only place to observe it is the
 * hook that assembles it. Held per session and bounded, because a long-lived opencode server
 * would otherwise accumulate one entry per session it ever ran. */
const MAX_TRACKED_SESSIONS = 64;

class SystemPrompts {
  readonly #bySession = new Map<string, string>();

  record(sessionId: string, parts: string[]): void {
    this.#bySession.delete(sessionId);
    this.#bySession.set(sessionId, joinSystemPrompt(parts));
    for (const oldest of this.#bySession.keys()) {
      if (this.#bySession.size <= MAX_TRACKED_SESSIONS) break;
      this.#bySession.delete(oldest);
    }
  }

  get(sessionId: string): string | undefined {
    return this.#bySession.get(sessionId);
  }
}

export const AgentsAnalysis: Plugin = async ({ client }) => {
  const address = process.env.AGENTS_ANALYSIS_DAEMON ?? "unix://~/.local/share/agents-analysis/daemon.sock";
  const outboxPath = expandHome(process.env.AGENTS_ANALYSIS_OPENCODE_OUTBOX ?? "~/.local/share/agents-analysis/opencode-outbox.json");
  const capture = new CaptureController(new FileOutbox(outboxPath), (event) => sendToDaemon(address, event));
  const systemPrompts = new SystemPrompts();

  void capture.retry();

  const messagesOf = async (sessionId: string): Promise<OpencodeMessage[]> => {
    const response = await client.session.messages({ path: { id: sessionId } });
    return (response.data ?? []) as OpencodeMessage[];
  };

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (input.sessionID) systemPrompts.record(input.sessionID, output.system);
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return;
      const sessionId = event.properties.sessionID;
      try {
        // A sub-agent runs in its own child session, which goes idle too. Capturing it as a
        // top-level consultation would both duplicate the work and hide it from the parent it
        // belongs to, so child sessions are reported only inside their parent's sub-agent list.
        const session = await client.session.get({ path: { id: sessionId } });
        if ((session.data as { parentID?: string } | undefined)?.parentID) return;

        const messages = await messagesOf(sessionId);
        const subAgentSessions: Record<string, OpencodeMessage[]> = {};
        for (const childId of subAgentSessionIds(messages)) {
          try {
            subAgentSessions[childId] = await messagesOf(childId);
          } catch {
            // A child session that can no longer be read still yields a sub-agent entry — just
            // without its token/cost totals. Better a named delegated call than none at all.
          }
        }

        const completed = buildCompletedEvent(messages, sessionId, { systemPrompt: systemPrompts.get(sessionId), subAgentSessions });
        if (completed) await capture.settled(completed);
      } catch {
        // A capture failure must never surface inside the user's opencode session.
      }
    },
  };
};
