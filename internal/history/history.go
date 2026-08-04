// Package history persists completed agent consultations in a local SQLite database.
package history

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const Completed = "completed"

type Usage struct{ Input, Prompt, Thinking, Output int64 }
type Rates struct{ Input, Prompt, Thinking, Output float64 }
type ToolResult struct{ Tool, Request, Result string }
type Consultation struct {
	ID                  string            `json:"id"`
	Status              string            `json:"status"`
	Provider            string            `json:"provider,omitempty"`
	Model               string            `json:"model,omitempty"`
	Harness             string            `json:"harness,omitempty"`
	InferenceParameters string            `json:"inference_parameters,omitempty"`
	Prompts             map[string]string `json:"prompts,omitempty"`
	Context             string            `json:"context,omitempty"`
	Response            string            `json:"response,omitempty"`
	ToolResults         []ToolResult      `json:"tool_results,omitempty"`
	ProviderMetadata    map[string]string `json:"provider_metadata,omitempty"`
	Usage               Usage             `json:"usage"`
	StartedAt           string            `json:"started_at,omitempty"`
	FinishedAt          string            `json:"finished_at,omitempty"`
	DurationMS          int64             `json:"duration_ms,omitempty"`
	Result              string            `json:"result,omitempty"`
	Error               string            `json:"error,omitempty"`
	Cost                *float64          `json:"cost,omitempty"`
	RateSnapshot        *Rates            `json:"rate_snapshot,omitempty"`
	LegacyEDN           string            `json:"legacy_edn,omitempty"`
}
type Summary struct {
	Tokens int64
	Cost   *float64
}
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
func Visible(records []Consultation) []Consultation {
	visible := make([]Consultation, 0, len(records))
	for _, record := range records {
		if record.Status == Completed {
			visible = append(visible, record)
		}
	}
	return visible
}
func AttachCost(record Consultation, rates Rates) Consultation {
	cost := float64(record.Usage.Input)*rates.Input + float64(record.Usage.Prompt)*rates.Prompt + float64(record.Usage.Thinking)*rates.Thinking + float64(record.Usage.Output)*rates.Output
	record.Cost = &cost
	record.RateSnapshot = &rates
	return record
}
func Summarize(records []Consultation) Summary {
	var summary Summary
	for _, record := range Visible(records) {
		summary.Tokens += record.Usage.Input + record.Usage.Prompt + record.Usage.Thinking + record.Usage.Output
		if record.Cost != nil {
			if summary.Cost == nil {
				summary.Cost = new(float64)
			}
			*summary.Cost += *record.Cost
		}
	}
	return summary
}
