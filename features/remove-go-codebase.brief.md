# Feature Brief: Remove Go Codebase

## Goal and Context
Delete every Go source file, module manifest, and Go-built artifact from the repository once the TypeScript replacements are in place and tested. The repository must no longer require Go to build, test, or run.

## Decisions Settled with the User
- Remove all `.go` files under `cmd/` and `internal/`.
- Remove `go.mod` and `go.sum`.
- Remove the Go-built `.tools/bin/gherkin-parser`.
- Rename or remove `features/go-*.feature` files whose behavior is now covered by TypeScript features or existing technology-agnostic features.
- Update `scripts/` so none invoke `go`.

## Edge Cases and Error Handling
- Before removal, verify that `npm test` and `scripts/acceptance` pass without Go.
- Preserve any non-Go content in `scripts/` (e.g. extension installer).

## Non-Functional Constraints
- No `.go` files remain in tracked source.
- No `go.mod` or `go.sum` remains.
- CI/build instructions no longer reference Go.

## Non-Goals
- Do not rewrite the Pi extension (it is already TypeScript).
- Do not change the SQLite database format.

## Open Questions
- Should the old `go-*.feature` files be deleted or renamed to `typescript-*.feature`? (Default: delete if superseded, rename only if they describe behavior still relevant.)
