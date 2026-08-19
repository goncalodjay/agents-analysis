# Feature Brief: TypeScript Capture Daemon

## Goal and Context
Replace the Go `internal/capture` package with a TypeScript module in `src/capture`. The daemon listens on a Unix socket, receives newline-delimited JSON events, validates them, persists valid consultations through the history store, and returns a JSON reply.

## Decisions Settled with the User
- Daemon is implemented in TypeScript.
- Uses Node's built-in `node:net` module (zero extra dependency).
- Protocol remains newline-delimited JSON over a Unix socket.
- Validation rules and error messages match the Go implementation.
- Store boundary is an interface so tests can use an in-memory fake.

## Edge Cases and Error Handling
- Invalid events are rejected with a reason and not persisted.
- Negative token usage or duration rejects the event.
- Missing identity fields reject the event.
- Server stops cleanly when the controlling AbortSignal fires or the socket closes.
- A connection that sends malformed JSON receives `{accepted: false, reason: ...}`.

## Non-Functional Constraints
- Zero Go dependency.
- Tests use Node's built-in test runner.

## Non-Goals
- Do not add TLS, HTTP, or other transports.
- Do not change the event schema or reply format.

## Open Questions
- None.
