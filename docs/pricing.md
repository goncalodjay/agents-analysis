# Cost tracking

The daemon attaches a `$` cost to every captured consultation, computed from its token usage and a price per model.

## Where prices come from

Two layers, checked in this order:

1. **Auto-sourced** (default, no setup): the daemon pulls pricing from [models.dev](https://models.dev) — an open, community-maintained database of model specs and pricing that opencode itself is built on. Cached at `~/.local/share/agents-analysis/pricing-cache.json` and refreshed at most once every 24h, on a background timer — never on the capture path itself, so a slow or offline network never delays a capture. If the machine is offline, it just keeps using whatever was cached last (or shows `cost: unknown` if it's never fetched successfully).
2. **Manual override** — `~/.local/share/agents-analysis/pricing.json`, for models the auto source doesn't know (custom aliases, internal routing names like the ones swarmforge configures). Re-read on every event, no restart needed. Anything listed here wins over the auto-sourced price for that model. Override the location with `daemon --pricing <path>`.

If neither layer has a price for a model, its consultations show `cost: unknown` instead of a wrong number — the daemon never guesses.

## Manual override format

A JSON object keyed by the exact model name you see in the TUI's stats line (`model: ...`). Rates are **USD per 1,000,000 tokens** — the units providers publish pricing in, and the same units the auto-sourced cache uses internally.

```json
{
  "gpt-5.6-luna": { "input": 0.4, "prompt": 0.04, "thinking": 0.4, "output": 1.6 }
}
```

- `input` — fresh (non-cached) input tokens
- `prompt` — cached/reused context tokens (what the daemon calls `usage.prompt`)
- `thinking` — reasoning tokens
- `output` — completion tokens

## A known approximation

The wire event only carries one combined "cached context" token count (`usage.prompt`), not separate cache-read and cache-write counts — even though providers often price those differently (cache writes are usually pricier than cache reads). The auto-sourced table prices that whole bucket at the model's `cache_read` rate, since reads vastly outnumber writes in a typical multi-turn session. This makes the cost figure a close estimate, not an exact one, for models where cache-write pricing differs a lot from cache-read pricing.

## Forcing a refresh

Delete the cache file and it rebuilds on the next event (or daemon restart):

```
rm ~/.local/share/agents-analysis/pricing-cache.json
```
