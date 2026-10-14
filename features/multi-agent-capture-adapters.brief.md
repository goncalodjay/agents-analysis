# Feature Brief: Capture Adapters for opencode, Claude Code, Codex, and kiro-cli

## Goal and Context
Today the only working capture adapter is the Pi extension (`extensions/agents-analysis/core.ts`), which normalizes Pi's internal turn representation into a `consultation.completed` event and delivers it over the existing Unix-socket daemon protocol (`internal/capture/event.go` / its TypeScript port). The daemon and the event schema are already agent-agnostic (`Event.Agent` is a free-text string, `Identity.Provider`/`.Model` are separate). What's missing is one adapter per remaining CLI the user runs through `swarmforge` (`swarmforge/swarmforge.conf:2`: claude, codex, copilot, grok, opencode, pi) plus `kiro-cli`, each translating that CLI's own hook/log/plugin surface into the same event shape.

## Decisions Settled with the User
- Reuse the existing protocol unmodified: newline-delimited JSON over the Unix socket, same `CompletedEvent` shape, same outbox-and-retry pattern as the Pi adapter (`extensions/agents-analysis/core.ts:133-157`).
- Each adapter sets `agent` to its own CLI name (`"opencode"`, `"claude-code"`, `"codex"`, `"kiro-cli"`) — this becomes the `Harness` the agent menu ([[tui-agent-menu-navigation]]) lists.
- One adapter package per CLI under `extensions/<agent-name>/`, mirroring the Pi extension's structure (`core.ts` for normalization, `outbox.ts` for delivery/retry).

## Per-agent research and status
- **Claude Code** — done. Global `Stop` hook (`~/.claude/settings.json`, merged alongside the pre-existing `herdr` `SessionStart` hook) runs `extensions/claude-code/hook.ts`, which parses the session's transcript JSONL under `~/.claude/projects/` (verified field shapes: `type`, `message.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens,output_tokens_details.thinking_tokens}`, `effort`, `toolUseResult`). Verified end-to-end against this project's own real transcripts.
- **opencode** — done. Global plugin at `~/.config/opencode/plugins/agents-analysis.ts` (symlinked to `extensions/opencode/plugin.ts` — opencode auto-loads anything in that directory, no `opencode.json` entry needed). Hooks the `event` plugin API for `session.idle`, then reads the turn via `client.session.messages({path:{id}})` (verified shapes: `AssistantMessage.tokens.{input,output,reasoning,cache.{read,write}}`, `ToolPart`/`ToolState`, `UserMessage.system`). Verified live with real `opencode run` sessions — see `docs/opencode-plugin.md` for a real quirk found and mitigated (one-shot `run` can dispose the process before delivery finishes; `capture.retry()` at plugin startup self-heals it on the next invocation).
- **Codex**: needs checking what session/transcript format it writes and whether it exposes hooks or only a config-driven log file. Already confirmed it has a real hook mechanism (`~/.codex/hooks.json`, currently used by `herdr` for `session_start`) and per-session rollout JSONL under `~/.codex/sessions/` — what's still unverified is the hook event name for "turn complete" (only `session_start` is confirmed).
- **kiro-cli**: not referenced anywhere in this repo yet (not even in `swarmforge.conf`) — needs the most groundwork: confirm it's actually a CLI the user drives today, then find its extension/logging surface.

## Edge Cases and Error Handling
- An adapter that can't determine token usage must still send the event with zeros rather than drop it (`Usage.hasNegativeValue` in `internal/capture/event.go` only rejects negative values, not missing ones) — but should be flagged as low-confidence in a way the TUI can surface later if needed.
- Same delivery guarantees as Pi: outbox persists locally first, retries on daemon-unreachable, marks delivered only after a `{accepted: true}` reply.

## Non-Functional Constraints
- Zero changes to the daemon or event schema.
- Each adapter ships its own tests mirroring `extensions/agents-analysis.test.ts`.

## Non-Goals
- Do not build a generic "universal" adapter — each CLI's data source is different enough that a shared abstraction would be premature.
- Do not attempt to backfill history from before an adapter existed.

## Open Questions
- Codex vs. kiro-cli: which one next? Codex has more groundwork already done (confirmed hook mechanism + rollout files); kiro-cli needs discovery from scratch.
