import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDaemon } from "./daemon-cli.ts";

test("rejects an unknown option with a usage error", async () => {
  const lines: string[] = [];
  const code = await runDaemon(["--unknown", "value"], "/home/test", (line) => lines.push(line));
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /Unknown option or arguments/);
});

test("rejects a non-Unix socket address", async () => {
  const lines: string[] = [];
  const code = await runDaemon(["--socket", "tcp://localhost:1234"], "/home/test", (line) => lines.push(line));
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /unix:\/\//);
});

test("reports a listen failure when the socket path is unusable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-daemon-cli-"));
  try {
    const lines: string[] = [];
    // A socket path nested under a nonexistent grandparent with no write access
    // simulates an unusable path without depending on OS-specific permission tricks:
    // point the socket at a path segment that is itself a plain file.
    const blockingFile = join(dir, "blocking");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(blockingFile, "");
    const code = await runDaemon(["--socket", `unix://${blockingFile}/nested/daemon.sock`], "/home/test", (line) => lines.push(line));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
