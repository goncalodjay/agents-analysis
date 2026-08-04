// Package tui contains the testable state and rendering model for the terminal UI.
package tui

import (
	"sort"
	"strings"

	domain "github.com/gonza/agents-analysis/internal/consultation"
)

type Panel string

const (
	ListPanel   Panel = "list"
	DetailPanel Panel = "detail"
)

type Model struct {
	Records       []domain.Consultation
	allRecords    []domain.Consultation
	SelectedID    string
	Detail        bool
	Focus         Panel
	DetailScroll  int
	Filter        string
	Help          bool
	Columns, Rows int
}

func Start(records []domain.Consultation) Model {
	visible := domain.Visible(records)
	sort.SliceStable(visible, func(i, j int) bool { return visible[i].FinishedAt > visible[j].FinishedAt })
	model := Model{allRecords: visible, Focus: ListPanel, Columns: 80, Rows: 24}
	return model.SetFilter("")
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
	length := len(m.Records)
	delta %= length
	index = (index + delta + length) % length
	m.SelectedID = m.Records[index].ID
	return m
}

func (m Model) SetFilter(filter string) Model {
	m.Filter = filter
	m.Records = m.Records[:0]
	for _, record := range m.allRecords {
		if matches(record, filter) {
			m.Records = append(m.Records, record)
		}
	}
	if !containsID(m.Records, m.SelectedID) {
		m.SelectedID = ""
		if len(m.Records) > 0 {
			m.SelectedID = m.Records[0].ID
		}
	}
	m.DetailScroll = 0
	return m
}

func matches(record domain.Consultation, filter string) bool {
	if filter == "" {
		return true
	}
	if provider, ok := strings.CutPrefix(filter, "provider="); ok {
		return record.Provider == provider
	}
	return strings.Contains(strings.ToLower(record.ID+" "+record.Provider+" "+record.Model), strings.ToLower(filter))
}

func containsID(records []domain.Consultation, id string) bool {
	for _, record := range records {
		if record.ID == id {
			return true
		}
	}
	return false
}

func (m Model) VisibleCost() float64 {
	var cost float64
	for _, record := range m.Records {
		if record.Cost != nil {
			cost += *record.Cost
		}
	}
	return cost
}

var keyActions = map[string]func(Model) Model{
	"tab":   toggleFocus,
	"up":    moveUp,
	"down":  moveDown,
	"enter": func(model Model) Model { model.Detail = true; return model },
	"esc":   func(model Model) Model { model.Detail = false; return model },
	"?":     func(model Model) Model { model.Help = !model.Help; return model },
}

func (m Model) HandleKey(key string) (Model, bool) {
	if key == "q" {
		return m, true
	}
	if action := keyActions[key]; action != nil {
		m = action(m)
	}
	return m, false
}

func toggleFocus(model Model) Model {
	if model.Focus == ListPanel {
		model.Focus = DetailPanel
	} else {
		model.Focus = ListPanel
	}
	return model
}

func moveUp(model Model) Model {
	if model.Focus == ListPanel {
		return model.Move(-1)
	}
	if model.DetailScroll > 0 {
		model.DetailScroll--
	}
	return model
}

func moveDown(model Model) Model {
	if model.Focus == ListPanel {
		return model.Move(1)
	}
	model.DetailScroll++
	return model
}

func (m Model) selected() *domain.Consultation {
	for index := range m.Records {
		if m.Records[index].ID == m.SelectedID {
			return &m.Records[index]
		}
	}
	return nil
}
