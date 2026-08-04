package consultation

import "testing"

func TestVisibleSummaryAndCostUseOnlyCompletedConsultations(t *testing.T) {
	rates := Rates{Input: 2, Prompt: 2, Thinking: 3, Output: 4}
	completed := AttachCost(Consultation{
		ID: "completed", Status: Completed,
		Usage: Usage{Input: 3, Prompt: 2, Thinking: 3, Output: 4},
	}, rates)
	records := []Consultation{completed, {ID: "pending", Status: "pending", Usage: Usage{Input: 100}}}

	visible := Visible(records)
	if len(visible) != 1 || visible[0].ID != "completed" {
		t.Fatalf("Visible() = %#v", visible)
	}
	summary := Summarize(records)
	if summary.Tokens != 12 || summary.Cost == nil || *summary.Cost != 35 {
		t.Fatalf("Summarize() = %#v", summary)
	}
	if completed.RateSnapshot == nil || *completed.RateSnapshot != rates {
		t.Fatalf("AttachCost() rate snapshot = %#v", completed.RateSnapshot)
	}
}

func TestSummaryLeavesCostAbsentWhenRecordsHaveNoCost(t *testing.T) {
	summary := Summarize([]Consultation{{ID: "one", Status: Completed}})
	if summary.Cost != nil {
		t.Fatalf("cost = %v", *summary.Cost)
	}
}
