# Plan: Capture Hermes sessions into agents-analysis

## Goal

Add a Hermes observer plugin that captures every Hermes session (the prompts,
tool calls, sub-agents, costs, and tokens Hermes itself sends/receives) and
reports it to the existing agents-analysis daemon, so the same TUI shows
Hermes runs alongside Pi, opencode, and Claude Code.

## Decisions

- Plugin name: `agents-analysis`. Lives at `extensions/hermes/` in this repo
  (mirrors the layout of `extensions/claude-code/`, `extensions/opencode/`)
  and installs into `~/.hermes/plugins/agents-analysis/` via
  `scripts/install-hermes-plugin`.
- Capture mechanism: register observer hooks (`pre_api_request`,
  `post_api_request`, `api_request_error`, `pre_tool_call`, `post_tool_call`,
  `subagent_start`, `subagent_stop`, `on_session_end`) and accumulate per-turn
  state in process memory. On `post_llm_call` / `on_session_end` / session
  finalize, build a `consultation.completed` event identical to the existing
  wire shape and send it to the daemon socket — same daemon, same SQLite,
  same TUI. No new event types; no schema changes.
- Wire shape: same `CompletedEvent` the other adapters emit (`agent: "hermes"`,
  `identity.provider/model` from `pre_api_request`, `usage` aggregated from
  per-`api_request_id` usage dicts, `tools` aggregated from
  pre/post_tool_call pairs, `subAgents` aggregated from
  `subagent_start/stop`, `content.systemPrompt` from the first
  `pre_api_request.request` of the turn, `content.userPrompt` from the same
  turn's user message). Reuse `src/capture/event.ts` validation as the
  source of truth — schema additions only if absolutely needed and additive.
- The sanitized request/response payload is captured (`pre_api_request.request`,
  `post_api_request.response`) and stored in `providerMetadata` as a JSON
  blob, because `Consultation` does not currently expose raw request
  payloads; the new field is optional, so old captures remain valid.
- Failure policy: fail-open. Hook callbacks are wrapped to log and swallow;
  the plugin never blocks the Hermes agent loop.
- Outbox: reuse `extensions/agents-analysis/outbox.ts`'s `FileOutbox` +
  `sendToDaemon`. Same socket address env var
  (`AGENTS_ANALYSIS_DAEMON`), defaulting to the existing
  `unix://~/.local/share/agents-analysis/daemon.sock`. Same retry semantics.

## Files to add / change

1. `extensions/hermes/__init__.py` — the plugin (registers hooks, owns
   per-turn state, emits `consultation.completed` events). Python because
   Hermes plugins are Python (`register(ctx)` signature); install into
   `~/.hermes/plugins/agents-analysis/__init__.py`.
2. `extensions/hermes/state.py` — pure Python port of the per-turn
   accumulator: receives hook payloads, returns a `CompletedEvent`-shaped
   dict on flush. Kept separate so it can be unit-tested without a Hermes
   runtime.
3. `extensions/hermes/core.test.py` — unit tests for the accumulator
   (mirrors the coverage of `extensions/claude-code/core.test.ts` and
   `extensions/opencode/core.test.ts`).
4. `extensions/hermes/manifest.toml` — plugin metadata (name, version,
   hooks used, env vars).
5. `scripts/install-hermes-plugin` — copies the plugin files into
   `~/.hermes/plugins/agents-analysis/`. Mirrors `scripts/install-pi-extension`.
6. `docs/hermes-plugin.md` — install + enable instructions (mirrors
   `docs/opencode-plugin.md`).
7. `features/hermes-extension-capture.feature` — gherkin scenarios covering:
   the observer hooks produce a `consultation.completed` event; the event
   validates against `src/capture/event.ts`'s validator; usage/cost/tool/sub-agent
   aggregation matches the existing adapters' contract; failures inside a
   hook do not break the agent turn.

## Acceptance

- `hermes plugins enable agents-analysis` then `hermes chat -q "Reply exactly ok"`
  produces a row in `~/.local/share/agents-analysis/trazas.sqlite` whose
  `harness == "hermes"`, `provider`, `model`, `usage.input`, `usage.output`,
  and `cost` (if pricing is configured) are populated.
- `agents-analysis` TUI shows the Hermes row alongside any existing
  Pi/opencode/Claude Code rows, with the prompts/tools/sub-agents detail
  views populated.
- Unit tests pass: `npm run test` (existing) and `python -m pytest
  extensions/hermes/` (new) — both green.
- A simulated hook exception does not propagate: tested by injecting a
  raising callback in `core.test.py`.

## Sequencing

Feeds [[tui-detail-submenus]] — the Hermes row reuses the existing prompts,
tools, and sub-agents detail panes without TUI changes.

## Non-goals

- No middleware rewrites; this is observation-only.
- No pricing logic for providers Hermes doesn't natively bill.
- No streaming/partial-turn captures: one `consultation.completed` per
  Hermes turn.
- No TUI changes; the existing `harness`-keyed menu naturally shows a new
  "hermes" entry once any Hermes session is captured.

## Status

Implemented and verified.

- `extensions/hermes/__init__.py` — Python plugin (register(ctx),
  per-turn accumulator dispatch, fail-open hook wrappers, file-backed
  outbox + Unix-socket daemon flush).
- `extensions/hermes/state.py` — pure accumulator + event builder
  (extracted for unit testing; no Hermes runtime, no I/O).
- `extensions/hermes/manifest.toml` — plugin metadata.
- `extensions/hermes/test_core.py` — 28 unit tests covering identity,
  prompt extraction across all three provider shapes, multi-request
  aggregation, tool matching, sub-agent pairs, error paths, malformed
  payloads, and the fail-open contract on every hook callback.
- `extensions/hermes/wire.test.ts` — 2 cross-language wire tests that
  feed a Python-built event into the real TypeScript validator.
- `scripts/install-hermes-plugin` — installs into `$HERMES_HOME`.
- `scripts/hermes-plugin-smoke.py` — end-to-end test: load the installed
  plugin with the same loader Hermes uses, fire hooks, verify the daemon
  receives a wire-valid event with the expected fields.
- `docs/hermes-plugin.md` — install + enable instructions.
- `features/hermes-extension-capture.feature` — gherkin scenarios.

## Test results

- `npm run test` — 139 pass, 0 fail (existing tests + the 2 wire tests).
- `python3 -m pytest extensions/hermes/test_core.py` — 28 pass, 0 fail.
- `python3 scripts/hermes-plugin-smoke.py` — `smoke ok: id=ses-smoke:turn-smoke model=claude-sonnet-4.5 usage={'input': 100, 'prompt': 40, ...}`.