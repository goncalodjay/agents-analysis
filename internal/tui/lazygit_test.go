package tui

import (
	"strings"
	"testing"

	"github.com/gonza/agents-analysis/internal/history"
)

func consultation(id, provider string, cost float64) history.Consultation {
	return history.Consultation{
		ID: id, Status: history.Completed, Provider: provider, FinishedAt: "2026-08-04T10:00:00Z",
		Response: "full response for " + id, Prompts: map[string]string{"system": "system", "user": "user"},
		ToolResults: []history.ToolResult{{Tool: "read", Request: "file", Result: "contents"}}, Cost: &cost,
	}
}

func TestRenderShowsBoxedListDetailAndKeyHelp(t *testing.T) {
	model := Start([]history.Consultation{consultation("pi-1", "openai", 1)})
	screen := model.Render()
	for _, panel := range []string{"+ List", "+ Detail", "+ Keys"} {
		if !strings.Contains(screen, panel) {
			t.Fatalf("screen lacks %q:\n%s", panel, screen)
		}
	}
	if !strings.Contains(screen, "full response for pi-1") || !strings.Contains(screen, "> pi-1") {
		t.Fatalf("selection or detail is incomplete:\n%s", screen)
	}
	if list := Start(nil).renderList(); list != "no consultations available" {
		t.Fatalf("empty list = %q", list)
	}
}

func TestDetailRenderingUsesTheScrollOffset(t *testing.T) {
	record := consultation("pi-1", "openai", 1)
	record.Response = "first\nsecond\nthird"
	model := Start([]history.Consultation{record})
	model.Rows = 4
	before := model.renderDetail()
	if before != "id: pi-1\nprovider: openai" {
		t.Fatalf("initial detail = %q", before)
	}
	model.Focus = DetailPanel
	after, _ := model.HandleKey("down")
	if detail := after.renderDetail(); detail != "provider: openai\nmodel: " {
		t.Fatalf("scrolled detail = %q", detail)
	}
	model.DetailScroll = -10
	if detail := model.renderDetail(); detail != before {
		t.Fatalf("negative scroll detail = %q", detail)
	}
	model.DetailScroll = 1_000
	if detail := model.renderDetail(); detail != "tools: read(file) => contents" {
		t.Fatalf("bounded detail = %q", detail)
	}
}

func TestFocusMovesDetailWithoutChangingSelection(t *testing.T) {
	model := Start([]history.Consultation{consultation("pi-1", "openai", 1)})
	focused, exit := model.HandleKey("tab")
	if exit || focused.Focus != DetailPanel {
		t.Fatalf("focus = %q", focused.Focus)
	}
	scrolled, _ := focused.HandleKey("down")
	if scrolled.SelectedID != "pi-1" || scrolled.DetailScroll != 1 {
		t.Fatalf("unexpected state: %#v", scrolled)
	}
	scrolled, _ = scrolled.HandleKey("up")
	if scrolled.DetailScroll != 0 {
		t.Fatalf("detail scroll = %d", scrolled.DetailScroll)
	}
	list, _ := scrolled.HandleKey("tab")
	list, _ = list.HandleKey("up")
	if list.Focus != ListPanel || list.SelectedID != "pi-1" {
		t.Fatalf("unexpected list state: %#v", list)
	}
}

func TestFilterRestrictsRecordsAndDisplayedCostThenRestores(t *testing.T) {
	model := Start([]history.Consultation{consultation("pi-openai", "openai", 2), consultation("pi-anthropic", "anthropic", 3)})
	filtered := model.SetFilter("provider=openai")
	if len(filtered.Records) != 1 || filtered.Records[0].ID != "pi-openai" || filtered.VisibleCost() != 2 {
		t.Fatalf("unexpected filter: %#v", filtered)
	}
	restored := filtered.SetFilter("")
	if len(restored.Records) != 2 || restored.VisibleCost() != 5 {
		t.Fatalf("unexpected restored view: %#v", restored)
	}
}

func TestHelpAndQuitDoNotMutateHistory(t *testing.T) {
	model := Start([]history.Consultation{consultation("pi-1", "openai", 1)})
	help, exit := model.HandleKey("?")
	if exit || !help.Help || len(help.Records) != 1 {
		t.Fatalf("unexpected help state: %#v", help)
	}
	if rendered := help.renderKeyHelp(); !strings.Contains(rendered, "Commands:") {
		t.Fatalf("help was not rendered: %q", rendered)
	}
	_, exit = help.HandleKey("q")
	if !exit {
		t.Fatal("q did not request exit")
	}
}
