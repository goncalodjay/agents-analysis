#!/usr/bin/env -S node --experimental-strip-types
// Entry point for Claude Code's `Stop` hook. Claude Code pipes a JSON payload on stdin
// (verified fields: session_id, transcript_path, stop_hook_active) and doesn't care about
// this process's stdout — it must stay silent and never fail loudly, since it runs inline
// with the user's actual session.
import { readFileSync } from "node:fs";

import { CaptureController } from "../agents-analysis/core.ts";
import { expandHome, FileOutbox, sendToDaemon } from "../agents-analysis/outbox.ts";
import { buildCompletedEventFromTranscript } from "./core.ts";

type HookPayload = { session_id?: string; transcript_path?: string; stop_hook_active?: boolean };

async function main(): Promise<void> {
  const payload = JSON.parse(readFileSync(0, "utf8")) as HookPayload;
  // stop_hook_active is true when Claude Code re-invokes Stop after a hook already ran once
  // for this turn — skip it to avoid capturing (or looping on) the same turn twice.
  if (payload.stop_hook_active) return;
  if (!payload.session_id || !payload.transcript_path) return;

  const event = buildCompletedEventFromTranscript(payload.transcript_path, payload.session_id);
  if (!event) return;

  const address = process.env.AGENTS_ANALYSIS_DAEMON ?? "unix://~/.local/share/agents-analysis/daemon.sock";
  const outboxPath = expandHome(process.env.AGENTS_ANALYSIS_CLAUDE_OUTBOX ?? "~/.local/share/agents-analysis/claude-code-outbox.json");
  const capture = new CaptureController(new FileOutbox(outboxPath), (pending) => sendToDaemon(address, pending));
  await capture.settled(event);
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
