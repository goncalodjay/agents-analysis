import assert from "node:assert/strict";
import test from "node:test";

import { COMPLETED, type Consultation } from "../consultation/consultation.ts";
import {
  costRows,
  DETAIL_CATEGORIES,
  detailEntries,
  detailItemLines,
  detailItemText,
  deriveSkills,
  handleKey,
  menuItems,
  move,
  moveMenu,
  prettyJson,
  resize,
  sanitize,
  selectMenuItem,
  setFilter,
  start,
  stripSystemPromptBoilerplate,
  toLines,
  toolUsage,
  totalCost,
  visibleCost,
  type Model,
} from "./model.ts";

function consultation(id: string, harness: string, provider: string, finishedAt: string, cost?: number): Consultation {
  return {
    id,
    status: COMPLETED,
    harness,
    provider,
    model: "gpt-5",
    finishedAt,
    response: `full response for ${id}`,
    prompts: { system: "system", user: "user" },
    toolResults: [{ tool: "read", request: '{"path":"file"}', result: "contents" }],
    usage: { input: 0, prompt: 0, thinking: 0, output: 0 },
    cost,
  };
}

function intoDetail(records: Consultation[]): Model {
  let model = start(records);
  ({ model } = handleKey(model, "enter")); // menu -> list
  ({ model } = handleKey(model, "enter")); // list -> detail
  return model;
}

test("starts on the menu, ordering consultations by recency across agents", () => {
  const model = start([
    consultation("old", "pi", "openai", "2026-01-01T00:00:00Z"),
    consultation("new", "opencode", "openai", "2026-02-01T00:00:00Z"),
  ]);
  assert.equal(model.focus, "menu");
  assert.deepEqual(
    model.agents.map((agent) => agent.name),
    ["opencode", "pi"],
  );
  assert.equal(model.allRecords[0]!.id, "new");
});

test("entering an agent scopes the list to that agent, most recent first", () => {
  const model = start([
    consultation("pi-old", "pi", "openai", "2026-01-01T00:00:00Z"),
    consultation("pi-new", "pi", "openai", "2026-02-01T00:00:00Z"),
    consultation("opencode-1", "opencode", "openai", "2026-01-15T00:00:00Z"),
  ]);
  const entered = selectMenuItem(model); // menuIndex 0 = "opencode" (alphabetical)
  assert.equal(entered.focus, "list");
  assert.equal(entered.selectedAgent, "opencode");
  assert.deepEqual(
    entered.records.map((record) => record.id),
    ["opencode-1"],
  );
});

test("moving in the list wraps and stays within the selected agent", () => {
  const model = selectMenuItem(start([consultation("pi-1", "pi", "openai", "2026-01-01Z"), consultation("pi-2", "pi", "openai", "2026-02-01Z")]));
  const moved = move(model, 1);
  assert.equal(moved.selectedId, model.records[1]!.id);
  assert.equal(move(moved, 1).selectedId, model.records[0]!.id);
});

test("enter dives into detail, esc bubbles detail -> list -> menu", () => {
  let model = start([consultation("pi-1", "pi", "openai", "2026-01-01Z")]);
  ({ model } = handleKey(model, "enter"));
  assert.equal(model.focus, "list");
  ({ model } = handleKey(model, "enter"));
  assert.equal(model.focus, "detail");
  ({ model } = handleKey(model, "esc"));
  assert.equal(model.focus, "list");
  ({ model } = handleKey(model, "esc"));
  assert.equal(model.focus, "menu");
});

// --- costs ------------------------------------------------------------------

test("the menu offers a costs entry after the agents", () => {
  const model = start([consultation("pi-1", "pi", "openai", "2026-01-01Z")]);
  const items = menuItems(model);
  assert.equal(items.length, 2);
  assert.equal(items.at(-1)!.kind, "costs");
});

test("selecting the costs entry opens the costs panel, and esc returns to the menu", () => {
  let model = start([consultation("pi-1", "pi", "openai", "2026-01-01Z")]);
  model = moveMenu(model, 1); // past the single agent, onto "costs"
  ({ model } = handleKey(model, "enter"));
  assert.equal(model.focus, "costs");
  ({ model } = handleKey(model, "esc"));
  assert.equal(model.focus, "menu");
});

test("costs break spend out per agent and per model", () => {
  const rows = costRows([
    { ...consultation("a", "pi", "openai", "2026-01-01Z", 1), model: "gpt-5" },
    { ...consultation("b", "pi", "openai", "2026-01-02Z", 3), model: "gpt-5" },
    { ...consultation("c", "pi", "anthropic", "2026-01-03Z", 2), model: "opus" },
    { ...consultation("d", "opencode", "openai", "2026-01-04Z", 5), model: "gpt-5" },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.agent, row.model, row.count, row.cost]),
    [
      ["opencode", "gpt-5", 1, 5],
      ["pi", "gpt-5", 2, 4],
      ["pi", "opus", 1, 2],
    ],
  );
});

test("the total cost includes what sub-agents spent", () => {
  const record: Consultation = {
    ...consultation("pi-1", "pi", "openai", "2026-01-01Z", 2),
    subAgents: [{ id: "s", name: "explorer", prompt: "p", cost: 3 }],
  };
  assert.equal(totalCost([record]), 5);
});

test("visible cost is undefined when nothing in view was priced", () => {
  const model = selectMenuItem(start([consultation("pi-1", "pi", "openai", "2026-01-01Z")]));
  assert.equal(visibleCost(model), undefined);
});

// --- text safety -------------------------------------------------------------

test("sanitize keeps newlines but drops escape sequences that could repaint the screen", () => {
  const sanitized = sanitize("a\u001b[31mred\u001b[0m\nb\tc\r\nd");
  assert.equal(sanitized, "a[31mred[0m\nb    c\nd");
  assert.ok(!sanitized.includes("\u001b"));
});

test("a huge single-line tool result becomes bounded, newline-free display lines", () => {
  const lines = toLines("x".repeat(5_000), 40);
  assert.equal(lines.length, 125);
  for (const line of lines) {
    assert.ok(line.length <= 40, `line of ${line.length} exceeds the 40-column viewport`);
    assert.ok(!line.includes("\n"));
  }
});

test("wrapping prefers word boundaries but still advances on unbreakable tokens", () => {
  assert.deepEqual(toLines("the quick brown fox jumps", 10), ["the quick", "brown fox", "jumps"]);
  assert.deepEqual(toLines("abcdefghijklmnopqrst", 10), ["abcdefghij", "klmnopqrst"]);
});

test("tool arguments are re-indented so they read as arguments, not as one blob", () => {
  assert.equal(prettyJson('{"path":"a"}'), '{\n  "path": "a"\n}');
  assert.equal(prettyJson("not json"), "not json");
});

// --- detail submenus ---------------------------------------------------------

test("the detail menu offers prompts, tools, skills and sub-agents", () => {
  assert.deepEqual(DETAIL_CATEGORIES, ["prompts", "tools", "skills", "subagents"]);
});

test("prompts is a submenu of exactly the system and user prompt", () => {
  const model = intoDetail([consultation("pi-1", "pi", "openai", "2026-01-01Z")]);
  const entries = detailEntries("prompts", model.records[0]!);
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ["System prompt", "User prompt"],
  );
});

test("entering prompts and picking one opens that prompt in full", () => {
  const long = { ...consultation("pi-1", "pi", "openai", "2026-01-01Z") };
  long.prompts = { system: "SYSTEM TEXT", user: Array.from({ length: 200 }, (_, i) => `user line ${i}`).join("\n") };
  let model = intoDetail([long]);
  ({ model } = handleKey(model, "enter")); // detail menu -> prompts
  assert.equal(model.detailView, "prompts");
  assert.equal(model.detailStage, "list");
  ({ model } = handleKey(model, "enter")); // prompts -> system prompt
  assert.equal(model.detailStage, "item");
  assert.match(detailItemText(model, long), /SYSTEM TEXT/);

  ({ model } = handleKey(model, "esc")); // back to the prompt list
  assert.equal(model.detailStage, "list");
  ({ model } = handleKey(model, "down")); // onto the user prompt
  ({ model } = handleKey(model, "enter"));
  assert.match(detailItemText(model, long), /user line 0/);
});

test("a prompt the agent never reported says so instead of showing an empty pane", () => {
  const record = { ...consultation("oc-1", "opencode", "openai", "2026-01-01Z"), prompts: { system: "", user: "hi" } };
  const entries = detailEntries("prompts", record);
  assert.equal(entries[0]!.meta, "not captured");
  let model = intoDetail([record]);
  ({ model } = handleKey(model, "enter"));
  ({ model } = handleKey(model, "enter"));
  assert.match(detailItemText(model, record), /did not report/);
});

test("scrolling a long prompt stops at the last screenful instead of running past it", () => {
  const record = { ...consultation("pi-1", "pi", "openai", "2026-01-01Z") };
  record.prompts = { system: Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"), user: "u" };
  let model = resize(intoDetail([record]), 100, 30);
  ({ model } = handleKey(model, "enter"));
  ({ model } = handleKey(model, "enter"));
  for (let i = 0; i < 500; i += 1) ({ model } = handleKey(model, "down"));
  const lines = detailItemLines(model, record);
  assert.ok(model.detailScroll > 0);
  assert.ok(model.detailScroll <= lines.length, "scroll ran past the end of the content");
  ({ model } = handleKey(model, "home"));
  assert.equal(model.detailScroll, 0);
});

// --- tools -------------------------------------------------------------------

test("tools are listed in call order with their payload sizes", () => {
  const record: Consultation = {
    ...consultation("pi-1", "pi", "openai", "2026-01-01Z"),
    toolResults: [
      { tool: "read", request: '{"path":"a"}', result: "a".repeat(2_000) },
      { tool: "bash", request: '{"cmd":"ls"}', result: "ok" },
    ],
  };
  const entries = detailEntries("tools", record);
  assert.deepEqual(
    entries.map((entry) => entry.label),
    [" 1. read", " 2. bash"],
  );
  assert.match(entries[0]!.meta, /result 2k ch/);
});

test("tool usage counts answer 'which tools did this call actually use'", () => {
  const record: Consultation = {
    ...consultation("pi-1", "pi", "openai", "2026-01-01Z"),
    toolResults: [
      { tool: "read", request: "{}", result: "" },
      { tool: "bash", request: "{}", result: "" },
      { tool: "read", request: "{}", result: "" },
    ],
  };
  assert.deepEqual(toolUsage(record), [
    { tool: "read", count: 2 },
    { tool: "bash", count: 1 },
  ]);
});

test("opening a tool shows its arguments and result, wrapped to the viewport", () => {
  const record: Consultation = {
    ...consultation("pi-1", "pi", "openai", "2026-01-01Z"),
    toolResults: [{ tool: "read", request: '{"path":"/tmp/x"}', result: "line\n".repeat(2_000) }],
  };
  let model = resize(intoDetail([record]), 100, 30);
  ({ model } = handleKey(model, "down")); // prompts -> tools
  ({ model } = handleKey(model, "enter"));
  assert.equal(model.detailView, "tools");
  ({ model } = handleKey(model, "enter"));
  const lines = detailItemLines(model, record);
  assert.ok(lines.some((line) => line.includes('"path": "/tmp/x"')));
  assert.ok(lines.every((line) => !line.includes("\n")));
});

test("a call with no tools cannot be opened into an empty item view", () => {
  const record: Consultation = { ...consultation("pi-1", "pi", "openai", "2026-01-01Z"), toolResults: [] };
  let model = intoDetail([record]);
  ({ model } = handleKey(model, "down"));
  ({ model } = handleKey(model, "enter"));
  ({ model } = handleKey(model, "enter"));
  assert.equal(model.detailStage, "list");
});

// --- sub-agents ---------------------------------------------------------------

test("sub-agents are listed with their cost, latency and tokens", () => {
  const record: Consultation = {
    ...consultation("oc-1", "opencode", "openai", "2026-01-01Z"),
    subAgents: [
      {
        id: "sub-1",
        name: "repo-explorer",
        description: "Explore repo structure",
        prompt: "look around",
        response: "found it",
        cost: 0.25,
        durationMs: 90_000,
        usage: { input: 1_000, prompt: 0, thinking: 0, output: 200 },
      },
    ],
  };
  const entries = detailEntries("subagents", record);
  assert.equal(entries[0]!.label, "repo-explorer — Explore repo structure");
  assert.match(entries[0]!.meta, /\$0,25/);
  assert.match(entries[0]!.meta, /1m 30s/);
  assert.match(entries[0]!.meta, /1\.200 tok/);
});

test("opening a sub-agent shows the prompt it was sent plus its cost and latency", () => {
  const record: Consultation = {
    ...consultation("oc-1", "opencode", "openai", "2026-01-01Z"),
    subAgents: [{ id: "sub-1", name: "repo-explorer", prompt: "READ EVERYTHING", response: "done", cost: 0.25, durationMs: 4_000 }],
  };
  let model = intoDetail([record]);
  model = { ...model, detailView: "subagents", detailStage: "item", detailIndex: 0 };
  const text = detailItemText(model, record);
  assert.match(text, /READ EVERYTHING/);
  assert.match(text, /cost: \$0,25/);
  assert.match(text, /latency: 4,00s/);
  assert.match(text, /done/);
});

// --- retained behaviour --------------------------------------------------------

test("skills are still derived from reads of skill files, for both path spellings", () => {
  const record: Consultation = {
    ...consultation("pi-1", "pi", "openai", "2026-01-01Z"),
    toolResults: [
      { tool: "read", request: '{"path":"/home/u/dev/skills/opentui/SKILL.md"}', result: "" },
      { tool: "read", request: '{"filePath":"/home/u/dev/skills/langfuse/SKILL.md"}', result: "" },
      { tool: "read", request: '{"path":"/etc/hosts"}', result: "" },
    ],
  };
  assert.deepEqual(
    deriveSkills(record).map((skill) => skill.name),
    ["opentui", "langfuse"],
  );
});

test("system prompt boilerplate is still trimmed for older records", () => {
  const trimmed = stripSystemPromptBoilerplate("Role.\nAvailable tools:\nlots of noise\nCurrent working directory: /tmp");
  assert.equal(trimmed, "Role.\nCurrent working directory: /tmp");
});

test("filters still work inside an agent's list, including model=", () => {
  const model = selectMenuItem(
    start([
      { ...consultation("a", "pi", "openai", "2026-01-01Z"), model: "gpt-5" },
      { ...consultation("b", "pi", "anthropic", "2026-01-02Z"), model: "opus" },
    ]),
  );
  assert.deepEqual(
    setFilter(model, "provider=openai").records.map((record) => record.id),
    ["a"],
  );
  assert.deepEqual(
    setFilter(model, "model=opus").records.map((record) => record.id),
    ["b"],
  );
});
