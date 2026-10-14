#!/usr/bin/env -S node --experimental-strip-types
// Runs the project acceptance pipeline: parses every features/*.feature file and confirms it
// yields a non-empty acceptance IR (a name and at least one scenario). Replaces the Go runner
// that shelled out to a separately cloned-and-built gherkin-parser binary.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseFeature } from "./gherkin/parser.ts";

function main(): void {
  const featuresDir = "features";
  const outDir = join("build", "acceptance");
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(featuresDir).filter((file) => file.endsWith(".feature"));
  let failed = false;
  for (const file of files) {
    const ir = parseFeature(readFileSync(join(featuresDir, file), "utf8"));
    writeFileSync(join(outDir, `${file}.json`), JSON.stringify(ir, null, 2));
    if (!ir.name || ir.scenarios.length === 0) {
      console.error("invalid acceptance IR:", file);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

main();
