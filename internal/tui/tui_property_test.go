//go:build property

package tui

import (
	"testing"
	"testing/quick"

	"github.com/gonza/agents-analysis/internal/history"
)

func TestPropertyMovingAlwaysSelectsAVisibleRecord(t *testing.T) {
	records := []history.Consultation{
		{ID: "one", Status: history.Completed},
		{ID: "two", Status: history.Completed},
		{ID: "three", Status: history.Completed},
	}
	property := func(delta int) bool {
		moved := Start(records).Move(delta)
		return containsID(moved.Records, moved.SelectedID)
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 2_000}); err != nil {
		t.Fatal(err)
	}
}

func TestPropertyClearingAFilterRestoresTheVisibleHistory(t *testing.T) {
	records := []history.Consultation{
		{ID: "openai", Status: history.Completed, Provider: "openai"},
		{ID: "anthropic", Status: history.Completed, Provider: "anthropic"},
	}
	property := func(filter string) bool {
		restored := Start(records).SetFilter(filter).SetFilter("")
		return len(restored.Records) == len(records)
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 1_000}); err != nil {
		t.Fatal(err)
	}
}
