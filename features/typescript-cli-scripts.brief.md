# Feature Brief: TypeScript CLI Entry Point and Scripts

## Goal and Context
Replace the Go `cmd/agents-analysis` entry point with `src/cli.ts` and update the shell scripts under `scripts/` so the whole product runs and tests without Go. The CLI must remain compatible with the existing command-line interface and the systemd service installer.

## Decisions Settled with the User
- CLI entry point: `src/cli.ts`, invoked via `node --experimental-strip-types`.
- `package.json` defines a `bin` entry for `agents-analysis`.
- Preserve the CLI: `agents-analysis [--history <path>]`, `agents-analysis daemon [--history <path>] [--socket <address>]`, `agents-analysis --help`.
- Preserve exit codes: `0` success, `1` runtime error, `2` usage error.
- Replace the Go Gherkin parser in `.tools/bin/gherkin-parser` with a minimal TypeScript parser invoked by `scripts/acceptance`.
- `scripts/property-tests` runs only Node property tests (no Go tests).

## Edge Cases and Error Handling
- Missing option value (e.g. `--socket` alone) must exit with code `2`.
- Non-Unix socket address must exit with code `2`.
- Failure to open history or create daemon directory must exit with code `1`.
- The Gherkin parser must produce JSON IR compatible with the current acceptance pipeline.

## Non-Functional Constraints
- Zero Go dependency in scripts or CLI.
- Scripts remain POSIX sh where possible.
- Tests use Node's built-in test runner.

## Non-Goals
- Do not change the capture event schema or the systemd unit template.
- Do not add new CLI subcommands.

## Open Questions
- Should the acceptance parser be strict or lenient with Gherkin syntax? (Default: strict enough for the project's existing feature files.)
