#!/usr/bin/env -S node --experimental-strip-types --experimental-ffi
// OpenTUI reaches its native renderer through node:ffi, which Node only exposes behind
// --experimental-ffi — hence the two flags in the shebang above.
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { createElement as h } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { runDaemon } from "./daemon-cli.ts";
import { HistoryStore } from "./history/history.ts";
import { DEFAULT_HISTORY_PATH, resolveUserPath } from "./paths.ts";
import { App } from "./tui/App.ts";
import { start } from "./tui/model.ts";
import { USAGE } from "./usage.ts";

export type Streams = {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
};

export async function run(args: string[], streams: Streams): Promise<number> {
  if (args[0] === "daemon") {
    return runDaemon(args.slice(1), homedir(), (line) => streams.stderr.write(`${line}\n`));
  }

  let historyPath = DEFAULT_HISTORY_PATH;
  if (args.length === 1 && args[0] === "--help") {
    streams.stdout.write(USAGE);
    return 0;
  }
  if (args.length === 2 && args[0] === "--history") {
    historyPath = args[1]!;
  } else if (args.length !== 0) {
    streams.stderr.write(`${USAGE}Unknown option or arguments\n`);
    return 2;
  }

  let store: HistoryStore;
  try {
    store = HistoryStore.open(resolveUserPath(historyPath, homedir()));
  } catch (error) {
    streams.stderr.write(`Unable to start history TUI: ${(error as Error).message}\n`);
    return 1;
  }

  try {
    const records = store.consultations();
    // exitOnCtrlC is off because the app maps ctrl-c to its own quit path, which goes through
    // renderer.destroy() so the terminal is restored rather than abandoned mid-frame.
    let finished: () => void;
    const closed = new Promise<void>((resolve) => (finished = resolve));
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      stdout: streams.stdout,
      stdin: streams.stdin,
      onDestroy: () => finished(),
    });
    createRoot(renderer).render(h(App, { initial: start(records) }));
    await closed;
    return 0;
  } catch (error) {
    streams.stderr.write(`Unable to run history TUI: ${(error as Error).message}\n`);
    return 1;
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const code = await run(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin });
  process.exitCode = code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
