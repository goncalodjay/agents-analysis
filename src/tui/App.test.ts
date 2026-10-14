// Runs against OpenTUI's headless test renderer, so these assert on the characters that would
// actually reach a terminal — including the wrapping and clipping that keep a 51k-character
// tool result from tearing the layout apart.
import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement as h } from "react";
import { testRender } from "@opentui/react/test-utils";

import { COMPLETED, type Consultation } from "../consultation/consultation.ts";
import { start } from "./model.ts";
import { App } from "./App.ts";

// Keystrokes below are dispatched inside act(), so React has flushed the resulting state before
// the next frame is captured. This flag is what makes React honour that.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WIDTH = 100;
const HEIGHT = 30;

type Harness = Awaited<ReturnType<typeof testRender>>;

async function withApp(records: Consultation[], run: (harness: Harness) => Promise<void>): Promise<void> {
  const harness = await testRender(h(App, { initial: start(records) }), { width: WIDTH, height: HEIGHT });
  try {
    await harness.renderOnce();
    await run(harness);
  } finally {
    harness.renderer.destroy();
  }
}

function consultation(id: string, harness: string, provider: string, extra: Partial<Consultation> = {}): Consultation {
  return {
    id,
    status: COMPLETED,
    harness,
    provider,
    model: "gpt-5",
    finishedAt: "2026-01-01T14:04:20Z",
    response: `full response for ${id}`,
    prompts: { system: "the system prompt", user: "the user prompt" },
    toolResults: [{ tool: "read", request: '{"path":"/tmp/a"}', result: "contents" }],
    usage: { input: 0, prompt: 0, thinking: 0, output: 0 },
    ...extra,
  };
}

async function press(harness: Harness, ...keys: ("ENTER" | "ESC" | "DOWN" | "UP")[]): Promise<void> {
  for (const key of keys) {
    await act(async () => {
      if (key === "ENTER") harness.mockInput.pressEnter();
      else if (key === "ESC") {
        harness.mockInput.pressEscape();
        // A lone ESC is the prefix of every arrow/function-key sequence, so the input parser
        // holds it until it can rule that out. Without this pause the next simulated key is
        // glued onto it and the pair is decoded as one alt-modified keystroke.
        await new Promise((resolve) => setTimeout(resolve, 30));
      } else harness.mockInput.pressArrow(key === "DOWN" ? "down" : "up");
    });
    await harness.renderOnce();
  }
}

/** The captured frame ends in a trailing newline; drop it so a row count is a row count. */
function frameRows(harness: Harness): string[] {
  const frame = harness.captureCharFrame();
  const rows = frame.split("\n");
  if (rows.at(-1) === "") rows.pop();
  return rows;
}

test("opens on the agent menu and offers the costs entry", async () => {
  await withApp([consultation("pi-1", "pi", "openai"), consultation("oc-1", "opencode", "openai")], async (harness) => {
    const frame = harness.captureCharFrame();
    assert.match(frame, /Agents/);
    assert.match(frame, /opencode/);
    assert.match(frame, /pi/);
    assert.match(frame, /Costs/);
  });
});

test("the total cost is pinned to the top right of the header", async () => {
  await withApp([consultation("pi-1", "pi", "openai", { cost: 12_000 })], async (harness) => {
    const headerRow = harness.captureCharFrame().split("\n")[1] ?? "";
    assert.match(headerRow, /total/);
    assert.match(headerRow, /\$12\.000,00/);
    const costColumn = headerRow.indexOf("$12.000,00");
    assert.ok(costColumn > WIDTH / 2, `total cost sat at column ${costColumn}, not on the right half`);
  });
});

test("token counts and durations are rendered grouped and in seconds, never as raw ms", async () => {
  const record = consultation("pi-1", "pi", "openai", {
    usage: { input: 42_189, prompt: 0, thinking: 121, output: 311 },
    durationMs: 16_264,
  });
  await withApp([record], async (harness) => {
    await press(harness, "ENTER", "ENTER");
    const frame = harness.captureCharFrame();
    assert.match(frame, /42\.189/);
    assert.match(frame, /16,26s/);
    assert.doesNotMatch(frame, /16264ms/);
  });
});

test("a duration past a minute is shown in minutes", async () => {
  await withApp([consultation("pi-1", "pi", "openai", { durationMs: 272_000 })], async (harness) => {
    await press(harness, "ENTER", "ENTER");
    assert.match(harness.captureCharFrame(), /4m 32s/);
  });
});

test("the costs panel breaks spend down per agent and model", async () => {
  const records = [
    consultation("pi-1", "pi", "openai", { cost: 2, model: "gpt-5" }),
    consultation("oc-1", "opencode", "anthropic", { cost: 3, model: "opus" }),
  ];
  await withApp(records, async (harness) => {
    await press(harness, "DOWN", "DOWN", "ENTER"); // past both agents onto "Costs"
    const frame = harness.captureCharFrame();
    assert.match(frame, /Costs/);
    assert.match(frame, /opus/);
    assert.match(frame, /gpt-5/);
    assert.match(frame, /TOTAL/);
    assert.match(frame, /\$5,00/);
  });
});

test("prompts open as a submenu, and picking one shows that prompt in full", async () => {
  const record = consultation("pi-1", "pi", "openai", {
    prompts: { system: "SYSTEM MARKER", user: Array.from({ length: 200 }, (_, i) => `user line ${i}`).join("\n") },
  });
  await withApp([record], async (harness) => {
    await press(harness, "ENTER", "ENTER", "ENTER"); // menu -> list -> detail -> prompts
    let frame = harness.captureCharFrame();
    assert.match(frame, /System prompt/);
    assert.match(frame, /User prompt/);

    await press(harness, "ENTER"); // open the system prompt
    frame = harness.captureCharFrame();
    assert.match(frame, /SYSTEM MARKER/);

    await press(harness, "ESC", "DOWN", "ENTER"); // back, then open the user prompt
    frame = harness.captureCharFrame();
    assert.match(frame, /user line 0/);
    assert.match(frame, /lines/, "a long prompt should report its scroll position");
  });
});

test("a huge tool result stays inside the panel instead of tearing the layout apart", async () => {
  const record = consultation("pi-1", "pi", "openai", {
    toolResults: [{ tool: "read", request: '{"path":"/tmp/big"}', result: "x".repeat(51_281).replace(/(.{47})/g, "$1\n") }],
  });
  await withApp([record], async (harness) => {
    await press(harness, "ENTER", "ENTER", "DOWN", "ENTER", "ENTER"); // detail -> tools -> open tool 1
    const frame = harness.captureCharFrame();
    const lines = frameRows(harness);
    assert.ok(lines.length <= HEIGHT, `frame used ${lines.length} rows in a ${HEIGHT}-row terminal`);
    for (const line of lines) assert.ok(line.length <= WIDTH, `a row ran to ${line.length} columns`);
    // The footer is the bottom-most thing on screen; if the tool blew the layout it is gone.
    assert.match(frame, /q quit|\? for keys/);
    assert.match(frame, /"path": "\/tmp\/big"/, "tool arguments should be indented, not raw");
  });
});

test("sub-agents are their own section, showing prompt, cost and latency", async () => {
  const record = consultation("oc-1", "opencode", "openai", {
    subAgents: [
      {
        id: "sub-1",
        name: "repo-explorer",
        description: "Explore repo structure",
        prompt: "SUBAGENT PROMPT MARKER",
        response: "found it",
        cost: 0.25,
        durationMs: 90_000,
        usage: { input: 1_000, prompt: 0, thinking: 0, output: 200 },
      },
    ],
  });
  await withApp([record], async (harness) => {
    await press(harness, "ENTER", "ENTER"); // into detail
    assert.match(harness.captureCharFrame(), /Sub-agents \(1\)/);

    await press(harness, "DOWN", "DOWN", "DOWN", "ENTER"); // prompts -> tools -> skills -> subagents
    let frame = harness.captureCharFrame();
    assert.match(frame, /repo-explorer/);
    assert.match(frame, /1m 30s/);

    await press(harness, "ENTER");
    frame = harness.captureCharFrame();
    assert.match(frame, /SUBAGENT PROMPT MARKER/);
    assert.match(frame, /cost: \$0,25/);
    assert.match(frame, /latency: 1m 30s/);
  });
});

test("esc bubbles item -> category -> detail menu -> list -> agent menu", async () => {
  await withApp([consultation("pi-1", "pi", "openai")], async (harness) => {
    await press(harness, "ENTER", "ENTER", "ENTER", "ENTER"); // into a prompt, fully nested
    await press(harness, "ESC", "ESC", "ESC", "ESC");
    assert.match(harness.captureCharFrame(), /Agents/);
  });
});

test("a long list never pushes the footer off the bottom of the terminal", async () => {
  const many = Array.from({ length: 200 }, (_, index) => consultation(`pi-${index}`, "pi", "openai"));
  await withApp(many, async (harness) => {
    await press(harness, "ENTER");
    for (let index = 0; index < 40; index += 1) await press(harness, "DOWN");
    assert.ok(frameRows(harness).length <= HEIGHT);
    assert.match(harness.captureCharFrame(), /q quit|\? for keys/);
  });
});
