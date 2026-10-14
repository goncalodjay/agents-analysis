# Hermes Plugin

The `agents-analysis` Hermes observer plugin forwards every Hermes turn to
the agents-analysis daemon, so the [TUI](../README.md) shows Hermes sessions
alongside Pi, opencode, and Claude Code.

It is **read-only**: it registers observer hooks only, never rewrites
requests or tool arguments. Hook callbacks are fail-open — a telemetry
exception is logged and swallowed, never propagated back into the agent
loop.

## What gets captured

The plugin accumulates one event per Hermes turn. Every field is the
exact shape the agents-analysis daemon already validates (see
`src/capture/event.ts`), so the same TUI renders a Hermes row with no
TUI changes.

| Field | Source |
| --- | --- |
| `agent` | hardcoded `"hermes"` |
| `identity.sessionId` / `turnId` | `session_id` / `turn_id` from any per-turn hook |
| `identity.provider` / `model` | `pre_api_request.provider` / `model` (or `post_api_request.response_model` as fallback) |
| `identity.reasoningLevel` | `pre_api_request.reasoning_level` if reported, else `""` |
| `content.systemPrompt` / `userPrompt` | first `pre_api_request.request` (OpenAI Chat Completions / Anthropic Messages / Responses API shapes all recognised) |
| `content.response` | last `post_api_request.response` (assistant text only); overridden by `post_llm_call.assistant_response` when present |
| `usage.input` / `output` / `thinking` | sum of `post_api_request.usage.{input,output,reasoning}_tokens` across the turn's API requests |
| `usage.cacheRead` / `cacheWrite` | sum of `post_api_request.usage.cache_{read,write}_tokens` |
| `usage.prompt` | `cacheRead + cacheWrite` (matches the wire shape every other adapter emits) |
| `startedAt` / `finishedAt` / `durationMs` | `started_at` / `ended_at` of the first / last API request in the turn |
| `cost` | sum of `post_api_request.cost_usd` when present; otherwise the daemon's rate table fills it in |
| `tools` | `pre_tool_call` / `post_tool_call` pairs, matched by `tool_call_id`. Unpaired pre calls are recorded as errors on session end. |
| `subAgents` | `subagent_start` / `subagent_stop` pairs, matched by `child_session_id`. Cost / usage / duration are NOT folded into the parent's totals — they appear under the sub-agent entry, the same way the opencode and Claude Code adapters do. |
| `providerMetadata.request_samples` | per-request provider / model / usage / cost summary, so the TUI can answer "what did Hermes actually send to the model?" |
| `providerMetadata.tool_call_history` | the observer-grade tool history the runtime passes to `subagent_stop` (no raw prompts or results) |
| `result` | `"error"` when `api_request_error` fired; otherwise `"success"` |
| `error` | message from `api_request_error` when the turn failed |

## Install

```sh
./scripts/install-hermes-plugin
hermes plugins enable agents-analysis
hermes chat -q "Reply exactly ok"
```

The install script honours `$HERMES_HOME` when set, so a per-profile
install Just Works without the plugin caring which profile is active.
The same daemon socket the other adapters use is the default; override
with `AGENTS_ANALYSIS_DAEMON=unix:///path/to/daemon.sock` if you have
relocated it.

## Verify

```sh
agents-analysis        # opens the TUI; a "hermes" entry should appear
sqlite3 ~/.local/share/agents-analysis/trazas.sqlite \
  "SELECT id, harness, provider, model, json_extract(payload, '$.usage.Input'), json_extract(payload, '$.cost') FROM consultations WHERE harness='hermes' ORDER BY rowid DESC LIMIT 5;"
```

## Disable

```sh
hermes plugins disable agents-analysis
# or, without disabling the plugin itself:
AGENTS_ANALYSIS_HERMES_ENABLED=0 hermes chat -q "..."
```

## What the plugin does NOT do

- No request rewriting (no middleware — observers only).
- No streaming / partial-turn captures. One `consultation.completed`
  per Hermes turn.
- No pricing logic. The daemon owns the rate table; the plugin just
  passes through whatever `cost_usd` the runtime reports.
- No TUI changes. The existing `harness`-keyed menu naturally shows a
  new "hermes" entry once any Hermes session is captured.

## Hook list

| Hook | Used for |
| --- | --- |
| `pre_api_request` | identity (provider / model / reasoning), system + user prompt extraction |
| `post_api_request` | usage, response text, cost_usd |
| `api_request_error` | `result: "error"` + error message |
| `pre_tool_call` / `post_tool_call` | tool entry, matched by id |
| `subagent_start` / `subagent_stop` | sub-agent entry, matched by child_session_id |
| `post_llm_call` | final user_message + assistant_response override |
| `on_session_end` | emit event + drop accumulator |

## Wire contract

The plugin is fail-open: if a hook callback raises, the exception is
caught and logged, never propagated. The `_is_wire_valid` helper in
`__init__.py` mirrors the daemon's `validate()` so a malformed event
short-circuits locally rather than costing a socket round-trip.

Outbox layout matches `extensions/agents-analysis/outbox.ts`:
`~/.local/share/agents-analysis/hermes-outbox.json` (override with
`AGENTS_ANALYSIS_HERMES_OUTBOX`). One outbox per agent harness so an
outage on one agent's path does not lose another's events.