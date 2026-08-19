# Feature Brief: TypeScript Bootstrap

## Goal and Context
Establish the project structure for the TypeScript migration so the remaining features have a consistent runtime, layout, and dependency model. The Go codebase will remain in place until Feature 6; this feature only prepares the TypeScript foundation.

## Decisions Settled with the User
- Runtime: Node.js with `--experimental-strip-types`.
- Dependency manager: npm; runtime dependencies are allowed.
- Already installed locally: `better-sqlite3`, `ink`, `react`.
- Source root: `src/`; Pi extension stays in `extensions/`.
- `package.json` uses `"type": "module"` and defines CLI `bin` entries.
- Constitution updated to allow npm dependencies.

## Edge Cases and Error Handling
- If a `.ts` file is invoked without `--experimental-strip-types`, Node must report a syntax error (expected).
- The CLI `bin` entry must work when invoked through `npx` or via `node` directly.
- `node_modules` and lockfile are versioned? No — they remain ignored; only `package.json` is versioned.

## Non-Functional Constraints
- No runtime dependency on Go after this feature is complete.
- Keep the existing extension untouched.

## Non-Goals
- Do not migrate any business logic in this feature.
- Do not remove Go files yet.

## Open Questions
- None.
