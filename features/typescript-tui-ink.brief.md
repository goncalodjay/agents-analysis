# Feature Brief: TypeScript Terminal UI with Ink

## Goal and Context
Replace the Go `internal/tui` package with a TypeScript implementation in `src/tui` using **Ink** and **React**. The visible terminal UI must remain the same for the user: split-pane list/detail layout, keyboard navigation, filters, help overlay, and clean terminal restoration on exit.

## Decisions Settled with the User
- Use **Ink** (already installed) for rendering React components in the terminal.
- Use React function components and hooks (`useState`, `useEffect`, `useInput`, `useApp`, `useStdout`).
- Preserve the existing keybindings: `up/down`, `tab`, `enter`, `esc`, `/`, `?`, `q`.
- Preserve the existing filter syntax (`provider=...` and free text).
- Preserve the existing box-drawing visual style (List / Detail / Keys panels).

## Edge Cases and Error Handling
- When the terminal is too small, the TUI must not crash; it should clamp or truncate content gracefully.
- When the history store fails to open, the TUI must show an error message and allow exit with `q`.
- When no consultations are available, the list panel shows "no consultations available".
- Pressing `backspace` in filter mode when the filter is empty must be safe.

## Non-Functional Constraints
- Zero Go dependency in the TUI layer.
- Testable without a real terminal using Ink's `render` testing utilities or a fake stdin/stdout.
- Tests use Node's built-in test runner.

## Non-Goals
- Do not add mouse support.
- Do not change the color scheme beyond the existing monochrome/box style.

## Open Questions
- None.
