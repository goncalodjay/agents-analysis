# Feature Brief: Detail Submenus for Prompts, Tools and Sub-agents

## Goal and Context
The detail panel had three flat categories (tools, skills, prompts) that each dumped their whole
contents into one scrolling column. Two of them were unusable:

- **Tools broke the layout outright.** Each tool's request and result were passed to a single
  `<Text>` element. Measured against the real database, one `pi` tool result is **51.281
  characters across 1.078 newlines**; Ink rendered that as 1.078 rows, which pushed the list,
  the stats and the footer off the screen. This was the reported "se rompe el menú".
- **Long prompts were unreadable.** System and user prompt were concatenated into one stream, so
  reaching the user prompt meant scrolling past an entire system prompt.

## Key existing-code facts
- `Consultation.toolResults[].request` is a JSON **string** (`JSON.stringify` of the tool input
  in `src/capture/event.ts`), so it arrives as one unbroken line unless it is re-indented.
- Tool results are captured verbatim from the agent, escape sequences included.
- `src/tui/model.ts` is pure and already the only place that knows about navigation, so the
  submenu state belongs there rather than in the view.

## Decisions Settled with the User
- Every category becomes two stages: a **list** of its entries, then one entry opened **in full**.
  `enter` descends, `esc` climbs back one level at a time.
- Prompts offers exactly two entries — the system prompt and the user prompt — each openable on
  its own, which is what was asked for.
- Tools are listed in call order (chronology is the information), numbered, each row carrying its
  argument and result sizes so the reader knows the cost of opening it. Opening a tool
  pretty-prints its arguments as indented JSON and shows the result beneath.
- The detail menu additionally summarises usage as `read×5, bash×3` — the answer to "what did
  this call actually do", which a flat chronological list buries.
- A new **Sub-agents** category lists delegated calls with cost, latency and tokens; opening one
  shows the prompt that was sent, the response, and that sub-agent's own model and spend.

## Edge Cases and Error Handling
- All text reaching the renderer goes through `sanitize` + `toLines`: CR/LF normalised, tabs
  expanded, **every other control character stripped** — including ESC, so captured tool output
  cannot repaint the screen with its own escape sequences — then hard-wrapped to the viewport
  width. The result is a bounded array of newline-free rows, which is what makes the scroll
  arithmetic exact and the layout unbreakable.
- Rows are rendered with `wrapMode: "none"` and `truncate`, so the renderer never re-wraps text
  the model already wrapped and one overlong row can never push a panel off screen.
- Scrolling clamps to the last full screenful rather than running past the end; `home`/`end` jump
  to either edge, `pageup`/`pagedown` move a screen at a time.
- A category with no entries says so and refuses to open an empty entry view.
- A prompt an agent never reported is labelled `not captured` rather than shown as blank — see
  [[subagent-and-prompt-capture]] for why opencode's system prompt used to be empty.

## Non-Functional Constraints
- The wrap width comes from `detailViewport(model)`, the same function the view lays out with.
- No memoisation yet: wrapping a 51k-character result on each keystroke is measurably fine.

## Non-Goals
- No search inside a prompt or tool result, no copy-to-clipboard, no syntax highlighting.
- The response body still is not a browsable category; only the two prompts were asked for.

## Sequencing
Depends on [[tui-opentui-presentation]] for the viewport maths, and on
[[subagent-and-prompt-capture]] for there to be sub-agent data to show.
