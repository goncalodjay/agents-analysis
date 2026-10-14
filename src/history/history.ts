// Persists completed agent consultations in a local SQLite database.
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Consultation, Rates } from "../consultation/consultation.ts";
import { isLegacyPayload, legacyConsultation, legacyRates } from "./legacy.ts";
import { fromStored, ratesFromStored, ratesToStored, toStored, type StoredConsultation } from "./serialization.ts";

// Rows written by the previous Go implementation store JSON/TEXT columns with a BLOB storage
// class (better-sqlite3 returns those as Buffer); rows written here store them as TEXT (returned
// as string). Buffer#toString() and String#toString() both normalize to the same UTF-8 text.
const text = (value: string | Buffer): string => value.toString();

export class HistoryStore {
  #db: Database.Database;

  private constructor(db: Database.Database) {
    this.#db = db;
  }

  static open(path: string): HistoryStore {
    const dir = dirname(path);
    if (dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });

    const db = new Database(path);
    db.exec(
      `CREATE TABLE IF NOT EXISTS consultations (id TEXT PRIMARY KEY, payload JSON NOT NULL);
       CREATE TABLE IF NOT EXISTS history_metadata (key TEXT PRIMARY KEY, value JSON NOT NULL);`,
    );
    const store = new HistoryStore(db);
    store.#migrateLegacyPayloads();
    return store;
  }

  close(): void {
    this.#db.close();
  }

  save(record: Consultation): void {
    if (!record.id) throw new Error("consultation id is required");
    const payload = JSON.stringify(toStored(record));
    this.#db
      .prepare(`INSERT INTO consultations (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`)
      .run(record.id, payload);
  }

  consultations(): Consultation[] {
    const rows = this.#db.prepare(`SELECT payload FROM consultations ORDER BY rowid`).all() as { payload: string | Buffer }[];
    return rows.map((row) => fromStored(JSON.parse(text(row.payload)) as StoredConsultation));
  }

  saveRates(rates: Rates): void {
    const payload = JSON.stringify(ratesToStored(rates));
    this.#db
      .prepare(`INSERT INTO history_metadata (key, value) VALUES ('rates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(payload);
  }

  rates(): Rates {
    const row = this.#db.prepare(`SELECT value FROM history_metadata WHERE key = 'rates'`).get() as { value: string | Buffer } | undefined;
    if (!row) return { input: 0, prompt: 0, thinking: 0, output: 0 };
    return ratesFromStored(JSON.parse(text(row.value)));
  }

  #migrateLegacyPayloads(): void {
    const rows = this.#db.prepare(`SELECT id, payload FROM consultations`).all() as { id: string; payload: string | Buffer }[];
    for (const row of rows) {
      const payload = text(row.payload);
      if (!isLegacyPayload(payload)) continue;
      const record = legacyConsultation(payload);
      if (!record.id) record.id = row.id;
      this.#db.prepare(`UPDATE consultations SET payload = ? WHERE id = ?`).run(JSON.stringify(record), row.id);
    }

    const ratesRow = this.#db.prepare(`SELECT value FROM history_metadata WHERE key = 'rates'`).get() as
      | { value: string | Buffer }
      | undefined;
    if (ratesRow) {
      const value = text(ratesRow.value);
      if (isLegacyPayload(value)) {
        const payload = JSON.stringify(legacyRates(value));
        this.#db.prepare(`UPDATE history_metadata SET value = ? WHERE key = 'rates'`).run(payload);
      }
    }
  }
}
