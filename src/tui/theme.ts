// One palette for the whole TUI. Green is the primary: it carries focus, selection and the
// borders of whatever panel currently owns the keyboard, so "where am I" is answered by colour
// before it is answered by reading. Everything not focused drops to `borderIdle` — a dim green
// rather than grey, so the screen still reads as one surface instead of two competing ones.
export const theme = {
  primary: "#00d75f",
  primaryBright: "#7ee787",
  borderIdle: "#215c39",

  text: "#d6e2da",
  muted: "#7d9086",
  heading: "#b7f2c8",

  selectedBackground: "#0f3b23",
  selectedText: "#d9ffe4",

  panel: "#0a0f0c",

  cost: "#ffd479",
  warn: "#ffb454",
  error: "#ff6b6b",
  ok: "#00d75f",

  // Model and provider are different axes (which CLI vs which LLM), and the list shows both on
  // one row — distinct hues stop them reading as a single slash-joined blob.
  provider: "#61b8ff",
  model: "#c792ea",
} as const;

export type Theme = typeof theme;
