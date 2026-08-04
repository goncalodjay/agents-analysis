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
	if !strings.Contains(screen, "full response for pi-1") {
		t.Fatalf("detail is incomplete:\n%s", screen)
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
	_, exit = help.HandleKey("q")
	if !exit {
		t.Fatal("q did not request exit")
	}
}
