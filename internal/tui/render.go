package tui

import (
	"fmt"
	"strings"

	domain "github.com/gonza/agents-analysis/internal/consultation"
)

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
	content := fmt.Sprintf("id: %s\nprovider: %s\nmodel: %s\nstatus: %s\nsystem: %s\ncontext: %s\nuser: %s\nresponse: %s\ntools: %s", record.ID, record.Provider, record.Model, record.Status, record.Prompts["system"], record.Context, record.Prompts["user"], record.Response, renderTools(record.ToolResults))
	lines := strings.Split(content, "\n")
	start := min(max(0, m.DetailScroll), max(0, len(lines)-1))
	height := max(1, m.Rows/2)
	end := min(len(lines), start+height)
	return strings.Join(lines[start:end], "\n")
}

func (m Model) renderKeyHelp() string {
	help := "up/down: navigate | tab: focus | ? : help | q: quit | filter: provider=<name>"
	if m.Help {
		help = "Commands: navigation, focus, scrolling, filters and exit\n" + help
	}
	return fmt.Sprintf("focus: %s | filter: %s | cost: %.2f\n%s", m.Focus, m.Filter, m.VisibleCost(), help)
}

func renderTools(tools []domain.ToolResult) string {
	parts := make([]string, 0, len(tools))
	for _, tool := range tools {
		parts = append(parts, tool.Tool+"("+tool.Request+") => "+tool.Result)
	}
	return strings.Join(parts, "\n")
}

func box(title, content string) string {
	return "+ " + title + "\n" + content + "\n+"
}
