// Package tui contains the testable state and rendering model for the terminal UI.
package tui

import (
	"fmt"
	"sort"
	"strings"

	"github.com/gonza/agents-analysis/internal/history"
)

type Panel string

const (
	ListPanel   Panel = "list"
	DetailPanel Panel = "detail"
)

type Model struct {
	Records       []history.Consultation
	allRecords    []history.Consultation
	SelectedID    string
	Detail        bool
	Focus         Panel
	DetailScroll  int
	Filter        string
	Help          bool
	Columns, Rows int
}

func Start(records []history.Consultation) Model {
	visible := history.Visible(records)
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

func matches(record history.Consultation, filter string) bool {
	if filter == "" {
		return true
	}
	if provider, ok := strings.CutPrefix(filter, "provider="); ok {
		return record.Provider == provider
	}
	return strings.Contains(strings.ToLower(record.ID+" "+record.Provider+" "+record.Model), strings.ToLower(filter))
}

func containsID(records []history.Consultation, id string) bool {
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

func (m Model) selected() *history.Consultation {
	for index := range m.Records {
		if m.Records[index].ID == m.SelectedID {
			return &m.Records[index]
		}
	}
	return nil
}

func (m Model) Render() string {
	return box("List", m.renderList()) + "\n" +
		box("Detail", "detail:\n"+m.renderDetail()) + "\n" +
		box("Keys", m.renderKeyHelp())
}

func (m Model) renderList() string {
	list := make([]string, 0, len(m.Records))
	for _, record := range m.Records {
		marker := " "
		if record.ID == m.SelectedID {
			marker = ">"
		}
		list = append(list, fmt.Sprintf("%s %s  %s/%s", marker, record.ID, record.Provider, record.Model))
	}
	if len(list) == 0 {
		return "no consultations available"
	}
	return strings.Join(list, "\n")
}

func (m Model) renderDetail() string {
	record := m.selected()
	if record == nil {
		return "no selection"
	}
	return fmt.Sprintf("id: %s\nprovider: %s\nmodel: %s\nstatus: %s\nsystem: %s\ncontext: %s\nuser: %s\nresponse: %s\ntools: %s", record.ID, record.Provider, record.Model, record.Status, record.Prompts["system"], record.Context, record.Prompts["user"], record.Response, renderTools(record.ToolResults))
}

func (m Model) renderKeyHelp() string {
	help := "up/down: navigate | tab: focus | ? : help | q: quit | filter: provider=<name>"
	if m.Help {
		help = "Commands: navigation, focus, scrolling, filters and exit\n" + help
	}
	return fmt.Sprintf("focus: %s | filter: %s | cost: %.2f\n%s", m.Focus, m.Filter, m.VisibleCost(), help)
}

func renderTools(tools []history.ToolResult) string {
	parts := make([]string, 0, len(tools))
	for _, tool := range tools {
		parts = append(parts, tool.Tool+"("+tool.Request+") => "+tool.Result)
	}
	return strings.Join(parts, "\n")
}

func box(title, content string) string {
	return "+ " + title + "\n" + content + "\n+"
}
