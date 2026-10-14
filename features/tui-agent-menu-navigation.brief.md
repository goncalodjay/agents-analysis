# Feature Brief: Agent Menu as TUI Entry Point

## Goal and Context
Today the TUI (Go `internal/tui`, and its Ink port from `typescript-tui-ink`) opens directly into a flat, single list of all consultations across every CLI, filterable by free text or `provider=`. The user wants the TUI to open on a **menu of agent CLIs** (pi, opencode, claude-code, codex, kiro-cli, ...) and only show a given agent's prompt list after picking one. This feature is additive on top of `typescript-tui-ink` and must not change its panel rendering, only add a screen in front of it and a way back.

## Key existing-code fact
The domain model already separates two concepts that this feature depends on:
- `Consultation.Harness` (`internal/consultation/consultation.go:14`) = the CLI tool that produced the call (`event.Agent` in `internal/capture/event.go`, e.g. `"pi"`). This is the **agent** the menu must list.
- `Consultation.Provider` / `.Model` = the underlying model provider (`openai`, `anthropic`, ...). This is unrelated to which CLI was used and must stay available as a secondary filter inside a per-agent list, not be confused with it.

## Decisions Settled with the User
- New top-level `Panel` state, `MenuPanel`, shown on startup, listing distinct `Harness` values present in the history store, each with a count of consultations.
- Selecting an agent moves focus to `ListPanel` scoped to that `Harness` (existing list/detail/keys layout, unchanged).
- Existing filter syntax (`provider=...`, free text) keeps working *inside* an agent's list.
- `esc` bubbles one level: detail -> list -> menu (does not exit the app).
- If the store has only one distinct agent, still show the menu (consistency over a special case).

## Edge Cases and Error Handling
- No consultations at all: menu shows "no agents captured yet" and only `q` is active.
- An agent with zero visible (non-completed) consultations still appears in the menu with count `0`; entering it shows the existing empty-list message.
- Returning from list to menu preserves the previously selected agent's highlight.

## Non-Functional Constraints
- No change to the SQLite schema or the capture protocol.
- Testable with Ink's testing utilities, same as `typescript-tui-ink`.

## Non-Goals
- Do not add nested menus beyond agent -> list -> detail.
- Do not change how `provider=` filtering works once inside an agent's list.

## Open Questions
- Naming for `Harness` values coming from CLIs not yet integrated (see [[multi-agent-capture-adapters]]) — use the raw `agent` string the adapter sends (e.g. `"opencode"`, `"codex"`, `"kiro-cli"`) as the canonical menu label.

## Sequencing
Depends on `typescript-tui-ink` landing first; this brief only adds the menu screen and the panel-transition rule on top of it.
