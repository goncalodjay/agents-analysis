// OpenTUI view for the TUI. Written with React.createElement (no JSX) because Node's
// --experimental-strip-types only erases TypeScript type syntax — it does not transform JSX,
// so a .tsx pipeline would defeat the project's zero-build-step goal.
//
// This file draws; it decides nothing. Every geometry number it uses comes from model.ts
// (LAYOUT/detailViewport) so that what the user can scroll matches what actually fits.
import { createElement as h, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { KeyEvent } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";

import { subAgentTotals, totalTokens, type Consultation, type Usage } from "../consultation/consultation.ts";
import { formatCost, formatDuration, formatTokens, UNKNOWN } from "./format.ts";
import {
  bodyHeight,
  categoryLabel,
  costRows,
  DETAIL_CATEGORIES,
  detailEntries,
  detailItemLines,
  detailViewport,
  detailWidth,
  handleKey,
  LAYOUT,
  listWidth,
  menuItems,
  resize,
  selected,
  setFilter,
  toolUsage,
  totalCost,
  visibleCost,
  type Model,
} from "./model.ts";
import { theme } from "./theme.ts";

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const NAMED_KEYS: Record<string, string> = {
  up: "up",
  down: "down",
  return: "enter",
  enter: "enter",
  escape: "esc",
  tab: "tab",
  pageup: "pageup",
  pagedown: "pagedown",
  home: "home",
  end: "end",
};

function keyName(key: KeyEvent, filtering: boolean): string | undefined {
  if (key.ctrl && (key.name === "c" || key.name === "d")) return "q";
  const named = NAMED_KEYS[key.name];
  if (named) return named;
  if (filtering) return key.sequence && key.sequence.length === 1 ? key.sequence : undefined;
  if (key.name === "k") return "up";
  if (key.name === "j") return "down";
  return key.name;
}

// ---------------------------------------------------------------------------
// Small view helpers
// ---------------------------------------------------------------------------

// Every line reaching the renderer was already wrapped to the viewport by model.ts. Letting
// OpenTUI wrap again would reflow content the scroll maths has already accounted for, and a
// single overlong row would push the rest of the panel off screen — which is exactly how the
// tools view used to break. wrapMode "none" + truncate makes a row occupy exactly one row.
const LINE = { wrapMode: "none" as const, truncate: true };

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function clip(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** Smallest window of `height` rows out of `length` that still contains `index`, centring it
 * when there's room — the "keep the cursor in view, scroll minimally" behaviour of a pager. */
function windowAround(length: number, index: number, height: number): { start: number; end: number } {
  if (length <= height) return { start: 0, end: length };
  const start = Math.max(0, Math.min(index - Math.floor(height / 2), length - height));
  return { start, end: start + height };
}

function row(key: string, text: string, width: number, isSelected: boolean, colour = theme.text): ReactElement {
  return h("text", { ...LINE,
      key,
      fg: isSelected ? theme.selectedText : colour,
      ...(isSelected ? { bg: theme.selectedBackground } : {}),
    },
    pad(`${isSelected ? "❯ " : "  "}${text}`, width),
  );
}

function panel(options: { title: string; focused: boolean; width?: number | string; height?: number; bottomTitle?: string }, children: ReactNode[]): ReactElement {
  return h(
    "box",
    {
      border: true,
      borderStyle: "rounded",
      borderColor: options.focused ? theme.primary : theme.borderIdle,
      title: ` ${options.title} `,
      titleColor: options.focused ? theme.primaryBright : theme.muted,
      ...(options.bottomTitle ? { bottomTitle: ` ${options.bottomTitle} `, bottomTitleAlignment: "right" as const } : {}),
      flexDirection: "column",
      backgroundColor: theme.panel,
      ...(options.width === undefined ? { flexGrow: 1 } : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
    },
    ...children,
  );
}

function note(text: string): ReactElement {
  return h("text", { ...LINE, key: "note", fg: theme.muted }, text);
}

// ---------------------------------------------------------------------------
// Header / footer
// ---------------------------------------------------------------------------

function breadcrumb(model: Model): string {
  const parts: string[] = ["agents"];
  if (model.focus === "costs") return "agents › costs";
  if (model.selectedAgent) parts.push(model.selectedAgent);
  if (model.focus === "detail") {
    const record = selected(model);
    if (record) parts.push(clip(record.id, 28));
    if (model.detailView !== "menu") {
      parts.push(model.detailView);
      if (model.detailStage === "item") parts.push("full");
    }
  }
  return parts.join(" › ");
}

function Header({ model }: { model: Model }): ReactElement {
  const total = totalCost(model.allRecords);
  return h(
    "box",
    {
      border: true,
      borderStyle: "rounded",
      borderColor: theme.primary,
      backgroundColor: theme.panel,
      height: LAYOUT.headerRows,
      flexDirection: "row",
      justifyContent: "space-between",
      paddingLeft: 1,
      paddingRight: 1,
    },
    h("text", { ...LINE, fg: theme.heading }, h("strong", null, "agents-analysis"), h("span", { fg: theme.muted }, `  ${breadcrumb(model)}`)),
    h("text", { ...LINE, fg: theme.muted },
      "total ",
      h("span", { fg: theme.cost }, h("strong", null, total === undefined ? UNKNOWN : formatCost(total))),
    ),
  );
}

const HELP_KEYS = "↑↓/jk move · enter open · esc back · tab panel · / filter · pgup/pgdn · home/end · ? help · q quit";

function Footer({ model, filtering }: { model: Model; filtering: boolean }): ReactElement {
  const shown = visibleCost(model);
  const status = filtering
    ? `filter: /${model.filter}▏`
    : `focus: ${model.focus}${model.filter ? ` · filter: ${model.filter}` : ""} · shown: ${model.records.length} calls · ${shown === undefined ? UNKNOWN : formatCost(shown)}`;
  return h(
    "box",
    {
      border: true,
      borderStyle: "rounded",
      borderColor: theme.borderIdle,
      backgroundColor: theme.panel,
      height: LAYOUT.footerRows,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
    },
    h("text", { ...LINE, key: "status", fg: filtering ? theme.primaryBright : theme.text }, clip(status, Math.max(10, model.columns - 4))),
    h("text", { ...LINE, key: "keys", fg: theme.muted }, clip(model.help ? HELP_KEYS : "? for keys", Math.max(10, model.columns - 4))),
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function MenuPanel({ model }: { model: Model }): ReactElement {
  const height = bodyHeight(model) - LAYOUT.panelBorder;
  const width = model.columns - LAYOUT.panelBorder;
  const items = menuItems(model);
  if (model.agents.length === 0) {
    return panel({ title: "Agents", focused: true, height: bodyHeight(model) }, [note("no agents captured yet")]);
  }
  const { start, end } = windowAround(items.length, model.menuIndex, height);
  const rows = items.slice(start, end).map((item, offset) => {
    const index = start + offset;
    const isSelected = index === model.menuIndex;
    if (item.kind === "costs") {
      return row("costs", `Costs — spend by agent and model`, width, isSelected, theme.cost);
    }
    const { agent } = item;
    const label = `${pad(agent.name, 16)} ${String(agent.count).padStart(4)} calls  ${pad(formatTokens(agent.tokens), 12)} tok  ${formatCost(agent.cost)}`;
    return row(agent.name, label, width, isSelected);
  });
  return panel({ title: "Agents", focused: true, height: bodyHeight(model) }, rows);
}

function CostsPanel({ model }: { model: Model }): ReactElement {
  const height = bodyHeight(model) - LAYOUT.panelBorder;
  const width = model.columns - LAYOUT.panelBorder;
  const rows = costRows(model.allRecords);
  const header = h("text", { ...LINE, key: "head", fg: theme.heading },
    pad(`  ${pad("agent", 14)}${pad("provider", 16)}${pad("model", 22)}${"calls".padStart(6)}${"tokens".padStart(14)}${"cost".padStart(14)}`, width),
  );

  const lines: ReactElement[] = [header];
  let previousAgent = "";
  for (const costRow of rows) {
    const agentCell = costRow.agent === previousAgent ? "" : costRow.agent;
    previousAgent = costRow.agent;
    lines.push(
      h("text", { ...LINE, key: `${costRow.agent}/${costRow.provider}/${costRow.model}`, fg: theme.text },
        h("span", { fg: theme.primaryBright }, pad(`  ${agentCell}`, 16)),
        h("span", { fg: theme.provider }, pad(clip(costRow.provider || UNKNOWN, 15), 16)),
        h("span", { fg: theme.model }, pad(clip(costRow.model || UNKNOWN, 21), 22)),
        h("span", { fg: theme.muted }, String(costRow.count).padStart(6)),
        h("span", { fg: theme.text }, formatTokens(costRow.tokens).padStart(14)),
        h("span", { fg: theme.cost }, formatCost(costRow.cost).padStart(14)),
      ),
    );
  }

  const subAgentSpend = model.agents.reduce<number | undefined>(
    (total, agent) => (agent.subAgentCost === undefined ? total : (total ?? 0) + agent.subAgentCost),
    undefined,
  );
  lines.push(h("text", { ...LINE, key: "gap", fg: theme.muted }, ""));
  lines.push(
    h("text", { ...LINE, key: "total", fg: theme.heading },
      h("strong", null, pad("  TOTAL", 74)),
      h("span", { fg: theme.cost }, h("strong", null, formatCost(totalCost(model.allRecords)).padStart(14))),
    ),
  );
  if (subAgentSpend !== undefined) {
    lines.push(h("text", { ...LINE, key: "subs", fg: theme.muted }, `  of which delegated to sub-agents: ${formatCost(subAgentSpend)}`));
  }

  const start = Math.min(model.costsScroll, Math.max(0, lines.length - height));
  return panel(
    { title: "Costs", focused: true, height: bodyHeight(model), bottomTitle: "esc back" },
    lines.slice(start, start + height),
  );
}

function ListPanel({ model }: { model: Model }): ReactElement {
  const width = listWidth(model);
  const inner = width - LAYOUT.panelBorder;
  const height = bodyHeight(model) - LAYOUT.panelBorder;
  const focused = model.focus === "list";
  if (model.records.length === 0) {
    return panel({ title: model.selectedAgent || "List", focused, width, height: bodyHeight(model) }, [note("no consultations available")]);
  }
  const selectedIndex = Math.max(
    0,
    model.records.findIndex((record) => record.id === model.selectedId),
  );
  const { start, end } = windowAround(model.records.length, selectedIndex, height);
  const rows = model.records.slice(start, end).map((record) => {
    const isSelected = record.id === model.selectedId;
    const time = (record.finishedAt ?? "").slice(11, 16) || "--:--";
    const cost = formatCost(record.cost);
    const modelWidth = Math.max(6, inner - 2 - time.length - cost.length - 4);
    return h("text", { ...LINE, key: record.id, fg: isSelected ? theme.selectedText : theme.text, ...(isSelected ? { bg: theme.selectedBackground } : {}) },
      isSelected ? "❯ " : "  ",
      h("span", { fg: isSelected ? theme.selectedText : theme.muted }, `${time}  `),
      h("span", { fg: isSelected ? theme.selectedText : theme.model }, pad(clip(record.model ?? UNKNOWN, modelWidth), modelWidth)),
      h("span", { fg: isSelected ? theme.selectedText : theme.cost }, `  ${cost}`),
    );
  });
  return panel(
    { title: `${model.selectedAgent} (${model.records.length})`, focused, width, height: bodyHeight(model) },
    rows,
  );
}

/** Total first, breakdown after — and the breakdown is clipped by hand so it ellipsizes at its
 * end. Left to the renderer's own truncation it would cut the middle out of a number. */
function tokenLine(usage: Usage, width: number): ReactElement {
  const head = `tokens ${formatTokens(totalTokens(usage))}`;
  const breakdown = `  (in ${formatTokens(usage.input)} · cache ${formatTokens(usage.prompt)} · think ${formatTokens(usage.thinking)} · out ${formatTokens(usage.output)})`;
  return h("text", { ...LINE, key: "s3", fg: theme.muted },
    "tokens ",
    h("span", { fg: theme.text }, formatTokens(totalTokens(usage))),
    h("span", { fg: theme.muted }, clip(breakdown, Math.max(0, width - head.length))),
  );
}

function statLines(record: Consultation, width: number): ReactElement[] {
  const usage = record.usage;
  const subs = subAgentTotals(record);
  return [
    h("text", { ...LINE, key: "s0", fg: theme.muted }, "id ", h("span", { fg: theme.text }, record.id)),
    h("text", { ...LINE, key: "s1", fg: theme.muted },
      "agent ",
      h("span", { fg: theme.primaryBright }, record.harness ?? UNKNOWN),
      "   provider ",
      h("span", { fg: theme.provider }, record.provider ?? UNKNOWN),
      "   model ",
      h("span", { fg: theme.model }, record.model ?? UNKNOWN),
    ),
    h("text", { ...LINE, key: "s2", fg: theme.muted },
      "result ",
      h("span", { fg: record.result === "error" || record.error ? theme.error : theme.ok }, record.result ?? record.status),
      record.error ? h("span", { fg: theme.error }, `   ${record.error}`) : "",
    ),
    tokenLine(usage, width),
    h("text", { ...LINE, key: "s4", fg: theme.muted },
      "cost ",
      h("span", { fg: theme.cost }, formatCost(record.cost)),
      "   latency ",
      h("span", { fg: theme.text }, formatDuration(record.durationMs)),
    ),
    h("text", { ...LINE, key: "s5", fg: theme.muted },
      "sub-agents ",
      h("span", { fg: subs.count > 0 ? theme.primaryBright : theme.muted }, String(subs.count)),
      subs.count > 0 ? h("span", { fg: theme.muted }, `  (${formatCost(subs.cost)} · ${formatDuration(subs.durationMs)} · ${formatTokens(subs.tokens)} tok)` ) : "",
    ),
    h("text", { ...LINE, key: "sep", fg: theme.borderIdle }, "─".repeat(Math.max(1, width))),
  ];
}

const CATEGORY_HINT: Record<string, string> = {
  prompts: "the system and user prompt, each openable in full",
  tools: "every tool call in order, with its arguments and result",
  skills: "skill files this call read",
  subagents: "delegated calls, with their prompt, cost and latency",
};

function detailBody(model: Model, record: Consultation, width: number, height: number): { rows: ReactElement[]; bottom?: string } {
  if (model.detailView === "menu") {
    const rows = DETAIL_CATEGORIES.map((category, index) => {
      const isSelected = index === model.detailMenuIndex;
      const count = detailEntries(category, record).length;
      const label = `${pad(categoryLabel(category, record), 22)}${pad(CATEGORY_HINT[category] ?? "", Math.max(0, width - 26))}`;
      return row(category, label, width, isSelected, count === 0 ? theme.muted : theme.text);
    });
    const usage = toolUsage(record);
    if (usage.length > 0) {
      rows.push(h("text", { ...LINE, key: "gap", fg: theme.muted }, ""));
      rows.push(
        h("text", { ...LINE, key: "usage", fg: theme.muted }, clip(`tools used: ${usage.map((entry) => `${entry.tool}×${entry.count}`).join(", ")}`, width)),
      );
    }
    return { rows };
  }

  if (model.detailStage === "list") {
    const entries = detailEntries(model.detailView, record);
    if (entries.length === 0) {
      return { rows: [note(`nothing captured under ${model.detailView} for this call`)] };
    }
    const { start, end } = windowAround(entries.length, model.detailIndex, height);
    const rows = entries.slice(start, end).map((entry, offset) => {
      const index = start + offset;
      const isSelected = index === model.detailIndex;
      const label = `${pad(clip(entry.label, Math.max(10, width - 34)), Math.max(10, width - 34))}  ${entry.meta}`;
      return row(`entry-${index}`, label, width, isSelected, entry.empty ? theme.muted : theme.text);
    });
    return { rows, bottom: `${model.detailIndex + 1}/${entries.length} · enter to open` };
  }

  const lines = detailItemLines(model, record);
  const start = Math.min(model.detailScroll, Math.max(0, lines.length - height));
  const rows = lines.slice(start, start + height).map((line, index) =>
    h("text", { ...LINE, key: `line-${index}`, fg: line.startsWith("──") ? theme.primaryBright : theme.text }, line),
  );
  return { rows, bottom: `${start + 1}-${Math.min(start + height, lines.length)} / ${lines.length} lines · esc back` };
}

function DetailPanel({ model }: { model: Model }): ReactElement {
  const focused = model.focus === "detail";
  const record = selected(model);
  const outerWidth = detailWidth(model);
  if (!record) {
    return panel({ title: "Detail", focused, width: outerWidth, height: bodyHeight(model) }, [note("no selection")]);
  }
  const { width, height } = detailViewport(model);
  const { rows, bottom } = detailBody(model, record, width, height);
  return panel(
    { title: `Detail — ${categoryLabel(model.detailView, record)}`, focused, width: outerWidth, height: bodyHeight(model), bottomTitle: bottom },
    [...statLines(record, width), ...rows],
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App({ initial }: { initial: Model }): ReactElement {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [model, setModel] = useState(initial);
  const [filtering, setFiltering] = useState(false);

  // A ref mirror keeps the keyboard handler reading the current model without re-subscribing
  // on every keystroke, and without the stale closure a plain capture would give it.
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    setModel((current) => (current.columns === width && current.rows === height ? current : resize(current, width, height)));
  }, [width, height]);

  useKeyboard((key) => {
    const name = keyName(key, filtering);
    if (!name) return;

    if (filtering) {
      if (name === "esc" || name === "enter") {
        setFiltering(false);
        return;
      }
      if (key.name === "backspace") {
        setModel(setFilter(modelRef.current, modelRef.current.filter.slice(0, -1)));
        return;
      }
      if (name.length === 1) setModel(setFilter(modelRef.current, modelRef.current.filter + name));
      return;
    }

    if (name === "/" && modelRef.current.focus === "list") {
      setFiltering(true);
      return;
    }
    const result = handleKey(modelRef.current, name);
    setModel(result.model);
    // renderer.destroy() and never process.exit(): it restores the alternate screen, the cursor
    // and raw mode on the way out.
    if (result.exit) renderer.destroy();
  });

  const body =
    model.focus === "menu"
      ? h(MenuPanel, { model })
      : model.focus === "costs"
        ? h(CostsPanel, { model })
        : h("box", { flexDirection: "row", height: bodyHeight(model) }, h(ListPanel, { model }), h(DetailPanel, { model }));

  return h(
    "box",
    { flexDirection: "column", width, height, backgroundColor: theme.panel },
    h(Header, { model }),
    body,
    h(Footer, { model, filtering }),
  );
}
