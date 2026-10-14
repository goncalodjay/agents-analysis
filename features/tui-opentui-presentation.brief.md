# Feature Brief: OpenTUI Presentation and Readable Figures

## Goal and Context
The TUI rendered through Ink with no colour system: every panel looked the same, focus was
signalled only by the word `focus:` in the footer, token counts were ungrouped digit strings,
latency was printed in raw milliseconds, and there was nowhere to answer "what has each agent
cost me". This feature replaces the renderer with OpenTUI and gives the numbers a form a human
can read at a glance.

## Key existing-code facts
- The project's whole build story is "no build step": `node --experimental-strip-types` erases
  types but does **not** transform JSX. The Ink view was therefore written with
  `React.createElement`, and the OpenTUI view must be too. `.tsx` is not an option.
- OpenTUI's reference runtime is Bun. Its Node path exists but is narrow: importing
  `@opentui/core` works anywhere, while `createCliRenderer()` needs **Node ≥ 26.4.0 launched
  with `--experimental-ffi`**, because the renderer is a Zig native library reached over
  `node:ffi`. Verified live on this machine (Node 26.4.0) before committing to the migration.
- `src/tui/model.ts` was already pure and renderer-free, so only the view had to change.

## Decisions Settled with the User
- Green is the primary colour: focused borders and selections are bright green, unfocused
  borders a dim green, so "where am I" is answered by colour before it is answered by reading.
- The total cost across every agent is pinned to the top-right of the header and is visible from
  every panel, not just the list.
- A `Costs` entry sits at the bottom of the agent menu. Entering it shows spend per configured
  agent, broken down by the model that produced it, with a grand total.
- Numbers use the es-AR convention (`12.000,00`): `.` groups thousands, `,` separates decimals.
- Durations are never shown in milliseconds. Under a minute they read as seconds (`16,26s`);
  past a minute they roll up to minutes (`4m 32s`); past an hour, to hours (`1h 30m`).
- Provider and model are separate, differently coloured fields — "which CLI" and "which LLM" are
  different questions and the old `provider/model` blob answered neither.

## Edge Cases and Error Handling
- A consultation with no price shows `—`, never `$0,00`: "not priced" and "free" are different
  facts and the costs table must not conflate them.
- Per-call costs are routinely fractions of a cent, so costs below $1 keep up to six decimals;
  above that, two. Two decimals everywhere would collapse most rows to `0,00`.
- Sub-agent spend is added into the header total and called out separately in the costs panel,
  because a delegated call's tokens are billed to a different session than its parent's.

## Non-Functional Constraints
- Node ≥ 26.4.0 becomes a hard minimum (`engines`), and both the `bin` shebang and the test
  script carry `--experimental-ffi`.
- No build step, still. No JSX, no bundler, no transpile.
- The view owns no geometry: `LAYOUT`, `bodyHeight`, `listWidth`, `detailWidth` and
  `detailViewport` live in the model, so what the user can scroll matches what actually fits.

## Non-Goals
- No mouse support, no animation, no theme switching.
- The costs panel reports; it does not edit pricing. `pricing.json` stays hand-edited.

## Sequencing
Lands with [[tui-detail-submenus]], which depends on the same viewport maths, and ahead of
nothing else — the capture adapters are independent of the renderer.
