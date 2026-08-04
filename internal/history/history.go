// Package history persists completed agent consultations in a local SQLite database.
package history

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gonza/agents-analysis/internal/consultation"
	_ "modernc.org/sqlite"
)

const Completed = consultation.Completed

type Usage = consultation.Usage
type Rates = consultation.Rates
type ToolResult = consultation.ToolResult
type Consultation = consultation.Consultation
type Summary = consultation.Summary
type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil && filepath.Dir(path) != "." {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	store := &Store{db: db}
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS consultations (id TEXT PRIMARY KEY, payload JSON NOT NULL);
		CREATE TABLE IF NOT EXISTS history_metadata (key TEXT PRIMARY KEY, value JSON NOT NULL);`); err != nil {
		db.Close()
		return nil, err
	}
	if err = store.migrateLegacyPayloads(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Save(record Consultation) error {
	if record.ID == "" {
		return fmt.Errorf("consultation id is required")
	}
	payload, err := json.Marshal(record)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO consultations (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`, record.ID, payload)
	return err
}
func (s *Store) Consultations() ([]Consultation, error) {
	rows, err := s.db.Query(`SELECT payload FROM consultations ORDER BY rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []Consultation
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var record Consultation
		if err := json.Unmarshal(payload, &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}
func (s *Store) SaveRates(rates Rates) error {
	payload, err := json.Marshal(rates)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO history_metadata (key, value) VALUES ('rates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, payload)
	return err
}
func (s *Store) Rates() (Rates, error) {
	var payload []byte
	err := s.db.QueryRow(`SELECT value FROM history_metadata WHERE key = 'rates'`).Scan(&payload)
	if err == sql.ErrNoRows {
		return Rates{}, nil
	}
	if err != nil {
		return Rates{}, err
	}
	var rates Rates
	return rates, json.Unmarshal(payload, &rates)
}
func Visible(records []Consultation) []Consultation { return consultation.Visible(records) }
func AttachCost(record Consultation, rates Rates) Consultation {
	return consultation.AttachCost(record, rates)
}
func Summarize(records []Consultation) Summary { return consultation.Summarize(records) }
