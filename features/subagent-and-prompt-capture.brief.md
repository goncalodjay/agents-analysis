# Feature Brief: Sub-agent Capture and opencode Prompt Capture

## Goal and Context
Two capture defects, both confirmed against live data rather than inferred:

1. **opencode never captured a system prompt.** The adapter read `UserMessage.system`. That field
   is declared optional in `@opencode-ai/sdk` and is, in practice, *always absent*: no user
   message row in `~/.local/share/opencode/opencode.db` carries it. Every opencode consultation
   in the history therefore stored `systemPrompt: ""`.
2. **Delegated calls were invisible.** A sub-agent's prompt, tokens, cost and latency were either
   missing entirely or silently folded into the parent's totals, so the most expensive thing an
   agent does — spawning another agent — could not be seen or costed.

## Key existing-code facts
- opencode's system prompt is only observable through the `experimental.chat.system.transform`
  hook, which hands the plugin `output.system: string[]` alongside a `sessionID`.
- `AssistantMessage.cost` **is** populated by opencode (verified: real rows carry values like
  `0.01425225`). The daemon was ignoring it and re-deriving cost from a local rate table.
- A delegated opencode call is a `task` tool part; `state.input` holds `{prompt, description,
  subagent_type}` and `state.metadata.sessionId` names the **child session** that ran it. That
  child session holds the sub-agent's own tokens and cost, and it emits its own `session.idle`.
- Claude Code runs sub-agent work inline in the same transcript, flagged `isSidechain: true` and
  chained by `parentUuid` back to the `Task` tool_use entry.

## Decisions Settled with the User
- The plugin records the system prompt per session from the hook (bounded to 64 sessions) and
  supplies it to `buildCompletedEvent`; the parser stays pure and takes it as context.
- Synthetic text parts (opencode's own command expansions) are excluded from the user prompt.
- An agent-reported cost is authoritative: `attachCost` still prices sub-agents from the rate
  table, but a cost the agent itself billed is never overwritten by a local estimate.
- Child sessions are skipped as top-level consultations (checked via `session.parentID`) and
  reported only inside their parent's sub-agent list — otherwise the same work appears twice and
  is detached from the call that caused it.
- `SubAgentCall` is a first-class field on `Consultation`, not another entry in `toolResults`,
  because a sub-agent burns its own tokens on its own model.
- Sub-agent latency is the `task` tool's own start/end span: that is what the user waited for.

## Edge Cases and Error Handling
- A child session that can no longer be read still yields a sub-agent entry, just without token
  or cost totals. A named delegated call beats no record of it.
- A delegated call that failed before producing tokens (real example in the database: `Model not
  found: deepseek-v4-flash/.`) is still listed, with its error and the latency it consumed, and
  no cost is claimed for it.
- Claude Code sidechain usage is excluded from the parent's own token count and re-attached under
  the `Task` call, so the parent's figures stop absorbing the sub-agent's spend.

## Known Verification Gap
The opencode path was replayed end-to-end against real sessions from opencode's own SQLite, and
its sub-agent extraction confirmed on real `task` calls. **The Claude Code sub-agent path could
not be verified against real data**: no transcript on this machine contains a single `Task` call
or `isSidechain` entry. It is implemented against the documented transcript format and reads
every field defensively — a sub-agent is still reported with its prompt when none of the
usage/latency sources are present — but it wants a live check once a real Task run exists.

## Non-Functional Constraints
- No schema migration: `sub_agents` is a new optional key inside the existing `payload` JSON, and
  the wire event's `subAgents`/`cost` fields are optional, so older adapters keep validating.
- Capture failures must never surface inside the user's agent session.

## Non-Goals
- No recursive capture of sub-agents of sub-agents.
- Pi has no delegation concept today, so its adapter is unchanged.

## Sequencing
Feeds [[tui-detail-submenus]], which renders the sub-agent section this produces.
