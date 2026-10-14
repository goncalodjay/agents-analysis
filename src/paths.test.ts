import assert from "node:assert/strict";
import test from "node:test";

import { parseDaemonConfig, resolveSocketPath, resolveUserPath } from "./paths.ts";

test("resolveUserPath expands only home-prefixed paths", () => {
  assert.equal(resolveUserPath("~", "/home/gonza"), "/home/gonza");
  assert.equal(resolveUserPath("~/data.sqlite", "/home/gonza"), "/home/gonza/data.sqlite");
  assert.equal(resolveUserPath("/abs/path", "/home/gonza"), "/abs/path");
});

test("resolveSocketPath requires a unix:// address", () => {
  assert.equal(resolveSocketPath("unix://~/daemon.sock", "/home/gonza"), "/home/gonza/daemon.sock");
  assert.throws(() => resolveSocketPath("tcp://localhost", "/home/gonza"));
});

test("parseDaemonConfig applies defaults and overrides", () => {
  const defaults = parseDaemonConfig([]);
  assert.match(defaults.historyPath, /^~/);
  assert.match(defaults.socketAddress, /^unix:\/\//);

  const overridden = parseDaemonConfig(["--history", "/tmp/h.sqlite", "--socket", "unix:///tmp/d.sock"]);
  assert.equal(overridden.historyPath, "/tmp/h.sqlite");
  assert.equal(overridden.socketAddress, "unix:///tmp/d.sock");
});

test("parseDaemonConfig rejects a dangling option and an unknown option", () => {
  assert.throws(() => parseDaemonConfig(["--history"]));
  assert.throws(() => parseDaemonConfig(["--bogus", "value"]));
});
