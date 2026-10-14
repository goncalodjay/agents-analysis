# Inspecting the history database

The captured consultations live in a SQLite file. Default location (same one the daemon and the TUI use when you don't pass `--history`):

```
~/.local/share/agents-analysis/trazas.sqlite
```

A copy with sample data also lives at `datos/trazas.sqlite` in this repo.

## Open it

```sh
sqlite3 ~/.local/share/agents-analysis/trazas.sqlite
```

## Schema

- `consultations(id TEXT PRIMARY KEY, payload JSON)` — one row per captured consultation. Everything (prompts, response, usage, tools, timing) is inside `payload` as JSON, not in separate columns.
- `history_metadata(key TEXT PRIMARY KEY, value JSON)` — currently only holds a `rates` row if you've configured per-token pricing.

## Useful queries

Remember every statement needs a trailing `;` or `sqlite3` just waits for more input.

```sql
.tables
.schema consultations
.mode column
.headers on

-- quick overview: which agent/provider each row came from
SELECT id, json_extract(payload,'$.harness') AS harness, json_extract(payload,'$.provider') AS provider
FROM consultations;

-- full row
SELECT payload FROM consultations LIMIT 1;
```

## Pretty-print a full JSON payload

From your normal shell (not inside the `sqlite3` prompt):

```sh
sqlite3 ~/.local/share/agents-analysis/trazas.sqlite "SELECT payload FROM consultations LIMIT 1;" | python3 -m json.tool
```

The exact field names in `payload` (including the odd capitalized `usage`/`rate_snapshot` keys, kept for compatibility with the old Go-written rows) are documented in `src/history/serialization.ts`.
