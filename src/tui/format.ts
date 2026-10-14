// Display formatting shared by every TUI panel. Numbers use the es-AR convention ("." groups
// thousands, "," separates decimals) because the reader of this tool is Argentine and long
// token counts are unreadable ungrouped. Durations are never shown in raw milliseconds: a
// six-digit ms figure carries no intuition, seconds and minutes do.

const TOKENS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const MONEY = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Per-call costs are routinely fractions of a cent, where two decimals collapse everything to
// "0,00" and the column stops saying anything. Keep enough places to tell those calls apart.
const SMALL_MONEY = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const SECONDS = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const THOUSANDS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

export const UNKNOWN = "—";

export function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return UNKNOWN;
  return TOKENS.format(value);
}

/** Costs below one cent keep extra decimals; anything larger reads as plain money. */
export function formatCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return UNKNOWN;
  return `$${(Math.abs(value) < 1 ? SMALL_MONEY : MONEY).format(value)}`;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** ms -> seconds, rolling up to minutes past 60s and to hours past 60m. */
export function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return UNKNOWN;
  if (milliseconds < MINUTE) return `${SECONDS.format(milliseconds / SECOND)}s`;
  if (milliseconds < HOUR) {
    const minutes = Math.floor(milliseconds / MINUTE);
    return `${minutes}m ${Math.round((milliseconds - minutes * MINUTE) / SECOND)}s`;
  }
  const hours = Math.floor(milliseconds / HOUR);
  return `${hours}h ${Math.round((milliseconds - hours * HOUR) / MINUTE)}m`;
}

/** Human-readable byte-ish size for prompt and tool payloads, so a row can say how big a
 * blob is before the user pays the scroll cost of opening it. */
export function formatSize(characters: number): string {
  if (characters < 1_000) return `${characters} ch`;
  return `${THOUSANDS.format(characters / 1_000)}k ch`;
}
