package history

import (
	"encoding/base64"
	"path/filepath"
	"testing"
)

func TestOpenMigratesThePreviousSQLitePayloadFormat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	legacyRecord := base64.StdEncoding.EncodeToString([]byte(`{:id "pi-1" :status :completed :provider "openai" :model "gpt-5" :response "complete response"}`))
	legacyRates := base64.StdEncoding.EncodeToString([]byte(`{:input 0.1 :prompt 0.2 :thinking 0.3 :output 0.4}`))
	if _, err := store.db.Exec(`INSERT INTO consultations (id, payload) VALUES (?, ?)`, "pi-1", legacyRecord); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT INTO history_metadata (key, value) VALUES ('rates', ?)`, legacyRates); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	migrated, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer migrated.Close()
	records, err := migrated.Consultations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].ID != "pi-1" || records[0].LegacyEDN == "" {
		t.Fatalf("legacy data lost: %#v", records)
	}
	rates, err := migrated.Rates()
	if err != nil || rates.Output != 0.4 {
		t.Fatalf("rates = %#v, %v", rates, err)
	}
}
