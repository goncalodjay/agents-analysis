# opencode capture adapter

## How it's installed

opencode auto-loads any file placed in `~/.config/opencode/plugins/` at startup — no entry in `opencode.json` needed (that config key is npm-package-only). This project's plugin lives in the repo and is symlinked in:

```
ln -sf /home/gonza/projects/agents-analysis/extensions/opencode/plugin.ts ~/.config/opencode/plugins/agents-analysis.ts
```

Editing `extensions/opencode/plugin.ts` or `core.ts` takes effect on the next opencode session — no reinstall step.

## How it works

- Hooks opencode's `event` plugin hook, watching for `session.idle` (fires when a turn finishes).
- On idle, fetches the session's messages via `client.session.messages({path:{id}})` and takes everything from the last user message to the end (usage, tool calls, response) — same "last turn" shape as the Pi and Claude Code adapters.
- Delivers to the daemon exactly like the other adapters: `extensions/agents-analysis/outbox.ts`'s `FileOutbox` + `sendToDaemon`, same protocol, same retry-on-failure.

## The system prompt has to come from a hook

opencode does **not** persist the system prompt on the message it sends. `UserMessage.system` is
declared optional in `@opencode-ai/sdk` and is always absent in practice — no user-message row in
`~/.local/share/opencode/opencode.db` carries it. Reading it from the message (which is what this
adapter used to do) therefore captured an empty system prompt on every single opencode turn.

The only place it is observable is the `experimental.chat.system.transform` hook, which hands the
plugin the assembled `system: string[]` together with a `sessionID`. The plugin keeps the latest
per session (bounded to 64 sessions) and passes it into `buildCompletedEvent` as context.

## Cost comes from opencode, not from the local rate table

`AssistantMessage.cost` is populated by opencode with what it actually billed (real rows carry
values like `0.01425225`). That figure is reported on the event and the daemon keeps it: a
locally configured rate in `pricing.json` is an estimate and must not overwrite a real price. The
rate table still fills in costs for agents that don't report one.

## Sub-agents

A delegated call is a `task` tool part. `state.input` holds `{prompt, description,
subagent_type}` and `state.metadata.sessionId` names the **child session** that ran it, which
holds the sub-agent's own tokens and cost. The plugin fetches those child sessions and reports
each delegated call under the turn's `subAgents`.

That child session also emits its own `session.idle`. The plugin checks `session.parentID` and
skips child sessions as top-level consultations — otherwise the same work is recorded twice and
is detached from the call that caused it.

## A verified quirk: `opencode run` can drop a delivery

Confirmed by running it live: a one-shot `opencode run "..."` invocation can dispose the process before the in-flight socket delivery to the daemon finishes. The event is still durably written to `~/.local/share/agents-analysis/opencode-outbox.json` first — nothing is lost — it just isn't marked delivered yet.

The plugin retries any pending deliveries at startup (`capture.retry()`), the same way the Pi extension retries on `session_start`. So a delivery lost to this race is only delayed until the *next* opencode invocation, never dropped — verified by running two consecutive `opencode run` calls and watching the first one's event land in history only after the second one started.

This only affects one-shot `run` mode. An interactive/TUI opencode session stays alive far longer between turns, so the race is unlikely to matter there.

## Verifying it's working

```sh
opencode run "reply with only the single word: pong"
```

Then check the daemon's history (harness `opencode`) — or run it a second time first if the first capture is still sitting in the outbox as pending.
