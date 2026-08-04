package history

import (
	"path/filepath"
	"testing"
)

func TestStoreRoundTripsCompleteConsultation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.sqlite")
	want := Consultation{
		ID: "pi-1", Status: Completed, Provider: "openai", Model: "gpt-5",
		Prompts: map[string]string{"system": "be helpful", "user": "summarize"},
		Context: "repository context", Response: "summary",
		ToolResults: []ToolResult{{Tool: "read", Result: "contents"}},
		Usage:       Usage{Input: 12, Prompt: 4, Thinking: 3, Output: 8},
		DurationMS:  210, Result: "success",
	}
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Save(want); err != nil {
		t.Fatal(err)
	}

	got, err := store.Consultations()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != want.ID || got[0].Response != want.Response || got[0].ToolResults[0].Result != "contents" {
		t.Fatalf("consultation was not preserved: %#v", got)
	}
}

func TestStoreUpsertPreventsDuplicateConsultations(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "history.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	record := Consultation{ID: "pi-1", Status: Completed}
	if err := store.Save(record); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(record); err != nil {
		t.Fatal(err)
	}
	got, err := store.Consultations()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d consultations, want 1", len(got))
	}
}

func TestCompletedConsultationsHaveCostsAndSummary(t *testing.T) {
	record := Consultation{Status: Completed, Usage: Usage{Input: 100, Prompt: 20, Thinking: 10, Output: 50}}
	rated := AttachCost(record, Rates{Input: .000002, Prompt: .000001, Thinking: .000003, Output: .000004})
	if rated.Cost == nil || *rated.Cost < .00045 || *rated.Cost > .00047 {
		t.Fatalf("unexpected cost: %#v", rated.Cost)
	}
	summary := Summarize([]Consultation{rated})
	if summary.Tokens != 180 || summary.Cost == nil {
		t.Fatalf("unexpected summary: %#v", summary)
	}
}
