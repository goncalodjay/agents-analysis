import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { HistoryStore } from "./history.ts";

test("open migrates the previous SQLite payload format", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-analysis-legacy-"));
  const path = join(dir, "history.sqlite");
  try {
    HistoryStore.open(path).close();

    const legacyRecord = Buffer.from(
      '{:id "pi-1" :status :completed :provider "openai" :model "gpt-5" :response "complete response"}',
    ).toString("base64");
    const legacyRates = Buffer.from("{:input 0.1 :prompt 0.2 :thinking 0.3 :output 0.4}").toString("base64");
    const seed = new Database(path);
    seed.prepare(`INSERT INTO consultations (id, payload) VALUES (?, ?)`).run("pi-1", legacyRecord);
    seed.prepare(`INSERT INTO history_metadata (key, value) VALUES ('rates', ?)`).run(legacyRates);
    seed.close();

    const migrated = HistoryStore.open(path);
    try {
      const records = migrated.consultations();
      assert.equal(records.length, 1);
      assert.equal(records[0]!.id, "pi-1");
      assert.ok(records[0]!.legacyEdn);
      const rates = migrated.rates();
      assert.equal(rates.output, 0.4);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
