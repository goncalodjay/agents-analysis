import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseFeature } from "./parser.ts";

test("parses a feature with a scenario outline and an examples table", () => {
  const source = `Feature: Sample feature

  # a comment
  Scenario Outline: Does the thing
    Given a precondition <value>
    When the user acts
    Then the outcome is <value>

    Examples:
      | value |
      | one   |
      | two   |
`;
  const ir = parseFeature(source);
  assert.equal(ir.name, "Sample feature");
  assert.equal(ir.scenarios.length, 1);
  const scenario = ir.scenarios[0]!;
  assert.equal(scenario.name, "Does the thing");
  assert.deepEqual(
    scenario.steps.map((step) => step.keyword),
    ["Given", "When", "Then"],
  );
  assert.deepEqual(scenario.examples, { headers: ["value"], rows: [["one"], ["two"]] });
});

test("parses a plain Scenario (no outline) without an examples table", () => {
  const ir = parseFeature("Feature: Plain\n\n  Scenario: Works\n    Given a thing\n    Then it works\n");
  assert.equal(ir.scenarios.length, 1);
  assert.equal(ir.scenarios[0]!.examples, undefined);
});

test("every feature file in this repository parses into a valid acceptance IR", () => {
  const dir = "features";
  const files = readdirSync(dir).filter((file) => file.endsWith(".feature"));
  assert.ok(files.length > 0, "expected at least one .feature file");
  for (const file of files) {
    const ir = parseFeature(readFileSync(join(dir, file), "utf8"));
    assert.ok(ir.name, `${file}: missing feature name`);
    assert.ok(ir.scenarios.length > 0, `${file}: no scenarios parsed`);
  }
});
