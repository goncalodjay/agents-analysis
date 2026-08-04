package tui

import (
	"fmt"
	"sort"
	"strings"

	"github.com/gonza/agents-analysis/internal/history"
)

type Model struct {
	Records       []history.Consultation
	SelectedID    string
	Detail        bool
	Columns, Rows int
}

func Start(records []history.Consultation) Model {
	records = history.Visible(records)
	sort.SliceStable(records, func(i, j int) bool { return records[i].FinishedAt > records[j].FinishedAt })
	model := Model{Records: records, Columns: 80, Rows: 24}
	if len(records) > 0 {
		model.SelectedID = records[0].ID
	}
	return model
}
func (m Model) Move(delta int) Model {
	if len(m.Records) == 0 {
		return m
	}
	index := 0
	for i, record := range m.Records {
		if record.ID == m.SelectedID {
			index = i
			break
		}
	}
	index = (index + delta + len(m.Records)) % len(m.Records)
	m.SelectedID = m.Records[index].ID
	return m
}
func (m Model) HandleKey(key string) (Model, bool) {
	switch key {
	case "up":
		return m.Move(-1), false
	case "down":
		return m.Move(1), false
	case "enter":
		m.Detail = true
	case "esc":
		m.Detail = false
	case "q":
		return m, true
	}
	return m, false
}
func (m Model) Render() string {
	if len(m.Records) == 0 {
		return "list: no consultations available | detail: | q: quit"
	}
	ids := make([]string, len(m.Records))
	for i, record := range m.Records {
		ids[i] = record.ID
	}
	detail := "closed"
	if m.Detail {
		detail = "open"
	}
	return fmt.Sprintf("list: %s | selected: %s | detail: %s | q: quit", strings.Join(ids, ", "), m.SelectedID, detail)
}
