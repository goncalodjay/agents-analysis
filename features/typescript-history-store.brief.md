# Feature Brief: TypeScript History Store and Domain Model

## Goal and Context
Replace the Go `internal/consultation` and `internal/history` packages with equivalent TypeScript modules in `src/consultation` and `src/history`. The SQLite schema, JSON payload format, and public API surface must stay compatible so existing databases continue to work.

## Decisions Settled with the User
- Use `better-sqlite3` (already installed) for synchronous SQLite access.
- Keep the same table schema: `consultations(id TEXT PRIMARY KEY, payload JSON)` and `history_metadata(key TEXT PRIMARY KEY, value JSON)`.
- Preserve the legacy base64-EDN migration on first open so old databases remain readable.
- Keep domain functions (`Visible`, `AttachCost`, `Summarize`) pure and deterministic.

## Edge Cases and Error Handling
- Opening a missing parent directory must create it.
- Saving a consultation without an `id` must throw.
- Reading a corrupted JSON payload must throw and not return partial data.
- Legacy EDN payloads that fail to decode must throw so the user knows the database needs manual intervention.

## Non-Functional Constraints
- Synchronous API like `better-sqlite3`.
- Zero Go dependency in this layer.
- Tests use Node's built-in test runner.

## Non-Goals
- Do not change the on-disk SQLite schema.
- Do not add encryption or migration versioning beyond the existing legacy migration.

## Open Questions
- None.
