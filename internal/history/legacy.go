package history

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// Legacy migration is isolated from the canonical SQLite store so old EDN
// payload knowledge can be removed without affecting normal persistence.
func legacyValue(source, key, pattern string) string {
	match := regexp.MustCompile(`:` + key + `\s+` + pattern).FindStringSubmatch(source)
	if len(match) == 2 {
		return match[1]
	}
	return ""
}

func legacyString(source, key string) string {
	return legacyValue(source, key, `"([^"]*)"`)
}

func legacyKeyword(source, key string) string {
	return legacyValue(source, key, `:([^\s}]+)`)
}

func legacyRate(source, key string) float64 {
	value, _ := strconv.ParseFloat(legacyValue(source, key, `([0-9.]+)`), 64)
	return value
}

func legacyConsultation(encoded string) (Consultation, error) {
	source, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return Consultation{}, err
	}
	text := string(source)
	return Consultation{
		ID:        legacyString(text, "id"),
		Status:    legacyKeyword(text, "status"),
		Provider:  legacyString(text, "provider"),
		Model:     legacyString(text, "model"),
		LegacyEDN: text,
	}, nil
}

func (s *Store) migrateLegacyPayloads() error {
	rows, err := s.db.Query(`SELECT id, payload FROM consultations`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type row struct{ id, payload string }
	var legacy []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.id, &item.payload); err != nil {
			return err
		}
		if !strings.HasPrefix(item.payload, "{") {
			legacy = append(legacy, item)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range legacy {
		record, err := legacyConsultation(item.payload)
		if err != nil {
			return err
		}
		if record.ID == "" {
			record.ID = item.id
		}
		payload, err := json.Marshal(record)
		if err != nil {
			return err
		}
		if _, err = s.db.Exec(`UPDATE consultations SET payload = ? WHERE id = ?`, payload, item.id); err != nil {
			return err
		}
	}
	var encodedRates string
	err = s.db.QueryRow(`SELECT value FROM history_metadata WHERE key = 'rates'`).Scan(&encodedRates)
	if err == nil && !strings.HasPrefix(encodedRates, "{") {
		legacyRates, decodeErr := base64.StdEncoding.DecodeString(encodedRates)
		if decodeErr != nil {
			return decodeErr
		}
		payload, marshalErr := json.Marshal(Rates{
			Input:    legacyRate(string(legacyRates), "input"),
			Prompt:   legacyRate(string(legacyRates), "prompt"),
			Thinking: legacyRate(string(legacyRates), "thinking"),
			Output:   legacyRate(string(legacyRates), "output"),
		})
		if marshalErr != nil {
			return marshalErr
		}
		_, err = s.db.Exec(`UPDATE history_metadata SET value = ? WHERE key = 'rates'`, payload)
	}
	if err == sql.ErrNoRows {
		return nil
	}
	return err
}
