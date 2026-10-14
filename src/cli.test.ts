import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run, type Streams } from "./cli.ts";

class Sink extends PassThrough {
  private text = "";
  constructor() {
    super();
    this.on("data", (chunk: Buffer) => {
      this.text += chunk.toString("utf8");
    });
  }
  toString(): string {
    return this.text;
  }
}

function fakeStreams(): Streams & { stdout: Sink; stderr: Sink } {
  return {
    stdout: new Sink() as unknown as NodeJS.WriteStream,
    stderr: new Sink() as unknown as NodeJS.WriteStream,
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
  } as Streams & { stdout: Sink; stderr: Sink };
}

test("--help prints usage and succeeds", async () => {
  const io = fakeStreams();
  const code = await run(["--help"], io);
  assert.equal(code, 0);
  assert.match(io.stdout.toString(), /agents-analysis/);
});

test("an unknown option is a usage error", async () => {
  const io = fakeStreams();
  const code = await run(["--unknown"], io);
  assert.equal(code, 2);
});

test("a history path whose parent cannot be created reports a runtime error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-cli-"));
  const blockingFile = join(dir, "not-a-directory");
  writeFileSync(blockingFile, "");
  try {
    const io = fakeStreams();
    const code = await run(["--history", join(blockingFile, "nested", "history.sqlite")], io);
    assert.equal(code, 1);
    assert.match(io.stderr.toString(), /Unable to start history TUI/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daemon rejects a non-Unix socket address", async () => {
  const io = fakeStreams();
  const code = await run(["daemon", "--socket", "tcp://localhost:1234"], io);
  assert.equal(code, 2);
  assert.match(io.stderr.toString(), /unix:\/\//);
});
