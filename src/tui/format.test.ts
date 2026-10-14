import assert from "node:assert/strict";
import test from "node:test";

import { formatCost, formatDuration, formatSize, formatTokens, UNKNOWN } from "./format.ts";

test("token counts group thousands with the es-AR separator", () => {
  assert.equal(formatTokens(12_000), "12.000");
  assert.equal(formatTokens(244_352), "244.352");
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(undefined), UNKNOWN);
});

test("costs use a comma decimal separator and keep sub-cent precision", () => {
  assert.equal(formatCost(12_000), "$12.000,00");
  assert.equal(formatCost(0.0224), "$0,0224");
  assert.equal(formatCost(1.5), "$1,50");
  assert.equal(formatCost(undefined), UNKNOWN);
});

test("durations are read in seconds, never raw milliseconds", () => {
  assert.equal(formatDuration(16_264), "16,26s");
  assert.equal(formatDuration(850), "0,85s");
  assert.equal(formatDuration(0), "0,00s");
});

test("durations past a minute roll up to minutes, and past an hour to hours", () => {
  assert.equal(formatDuration(60_000), "1m 0s");
  assert.equal(formatDuration(272_000), "4m 32s");
  assert.equal(formatDuration(3_600_000), "1h 0m");
  assert.equal(formatDuration(5_400_000), "1h 30m");
});

test("a missing or negative duration reads as unknown rather than as zero", () => {
  assert.equal(formatDuration(undefined), UNKNOWN);
  assert.equal(formatDuration(-1), UNKNOWN);
});

test("payload sizes stay short enough for a list row", () => {
  assert.equal(formatSize(240), "240 ch");
  assert.equal(formatSize(51_281), "51,3k ch");
});
