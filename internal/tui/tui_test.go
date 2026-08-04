package tui

import (
	"strings"
	"testing"

	"github.com/gonza/agents-analysis/internal/history"
)

func TestModelOrdersAndNavigatesCompletedConsultations(t *testing.T) {
	model := Start([]history.Consultation{{ID: "old", Status: history.Completed, FinishedAt: "2026-01-01T00:00:00Z"}, {ID: "new", Status: history.Completed, FinishedAt: "2026-02-01T00:00:00Z"}})
	if model.SelectedID != "new" {
		t.Fatalf("selected %q, want new", model.SelectedID)
	}
	if moved := model.Move(1); moved.SelectedID != "old" {
		t.Fatalf("selected %q, want old", moved.SelectedID)
	}
	if !strings.Contains(model.Render(), "detail") {
		t.Fatal("screen lacks detail panel")
	}
}
func TestInputHandlesDetailAndExit(t *testing.T) {
	model := Start([]history.Consultation{{ID: "one", Status: history.Completed}})
	opened, exit := model.HandleKey("enter")
	if exit || !opened.Detail {
		t.Fatal("enter did not open detail")
	}
	_, exit = model.HandleKey("q")
	if !exit {
		t.Fatal("q did not exit")
	}
}
