import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { buildCompletedEvent, CaptureController, lastTurn, messageOf } from "./agents-analysis/core.ts";
import { expandHome, FileOutbox, sendToDaemon } from "./agents-analysis/outbox.ts";

export { buildCompletedEvent, CaptureController } from "./agents-analysis/core.ts";
export type { CompletedEvent, Outbox, TurnSnapshot } from "./agents-analysis/core.ts";
export { FileOutbox, sendToDaemon } from "./agents-analysis/outbox.ts";

type TurnStart = { at: number; systemPrompt: string; context: string; userPrompt: string };

export default function agentsAnalysis(pi: ExtensionAPI) {
  const address = process.env.AGENTS_ANALYSIS_DAEMON ?? "unix://~/.local/share/agents-analysis/daemon.sock";
  const outboxPath = expandHome(process.env.AGENTS_ANALYSIS_OUTBOX ?? "~/.local/share/agents-analysis/pi-outbox.json");
  const capture = new CaptureController(new FileOutbox(outboxPath), (event) => sendToDaemon(address, event));
  let start: TurnStart | undefined;
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
    const turn = lastTurn(ctx.sessionManager.getBranch() as unknown[]);
    if (!turn) return;

    const finalAssistant = turn.entries
      .map(messageOf)
      .findLast((message) => message?.role === "assistant");
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
