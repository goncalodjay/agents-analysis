// Minimal Gherkin parser covering the subset this repository's .feature files use:
// Feature, Scenario/Scenario Outline, Given/When/Then/And/But steps, and an Examples table.
// Replaces the Go gherkin-parser binary (cloned and built from an external repository) so the
// acceptance pipeline runs with zero external dependencies.

export type Step = { keyword: string; text: string };
export type Examples = { headers: string[]; rows: string[][] };
export type Scenario = { name: string; steps: Step[]; examples?: Examples };
export type FeatureIR = { name: string; scenarios: Scenario[] };

const SCENARIO_PREFIX = /^Scenario(?: Outline)?:\s*(.*)$/;
const STEP_PREFIX = /^(Given|When|Then|And|But)\s+(.*)$/;

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

export function parseFeature(source: string): FeatureIR {
  let name = "";
  const scenarios: Scenario[] = [];
  let current: Scenario | undefined;
  let inExamples = false;
  let exampleHeaders: string[] | undefined;
  let exampleRows: string[][] = [];

  const closeExamples = () => {
    if (current && exampleHeaders) current.examples = { headers: exampleHeaders, rows: exampleRows };
    inExamples = false;
    exampleHeaders = undefined;
    exampleRows = [];
  };

  const closeScenario = () => {
    closeExamples();
    if (current) scenarios.push(current);
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("Feature:")) {
      name = line.slice("Feature:".length).trim();
      continue;
    }

    const scenarioMatch = line.match(SCENARIO_PREFIX);
    if (scenarioMatch) {
      closeScenario();
      current = { name: scenarioMatch[1]!, steps: [] };
      continue;
    }

    if (line.startsWith("Examples:")) {
      inExamples = true;
      continue;
    }

    if (inExamples && line.startsWith("|")) {
      const cells = parseTableRow(line);
      if (!exampleHeaders) exampleHeaders = cells;
      else exampleRows.push(cells);
      continue;
    }

    const stepMatch = line.match(STEP_PREFIX);
    if (stepMatch && current) current.steps.push({ keyword: stepMatch[1]!, text: stepMatch[2]! });
  }
  closeScenario();

  return { name, scenarios };
}
