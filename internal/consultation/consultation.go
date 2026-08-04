// Package consultation defines completed consultation records and domain summaries.
package consultation

const Completed = "completed"

type Usage struct{ Input, Prompt, Thinking, Output int64 }
type Rates struct{ Input, Prompt, Thinking, Output float64 }
type ToolResult struct{ Tool, Request, Result string }
type Consultation struct {
	ID                  string            `json:"id"`
	Status              string            `json:"status"`
	Provider            string            `json:"provider,omitempty"`
	Model               string            `json:"model,omitempty"`
	Harness             string            `json:"harness,omitempty"`
	InferenceParameters string            `json:"inference_parameters,omitempty"`
	Prompts             map[string]string `json:"prompts,omitempty"`
	Context             string            `json:"context,omitempty"`
	Response            string            `json:"response,omitempty"`
	ToolResults         []ToolResult      `json:"tool_results,omitempty"`
	ProviderMetadata    map[string]string `json:"provider_metadata,omitempty"`
	Usage               Usage             `json:"usage"`
	StartedAt           string            `json:"started_at,omitempty"`
	FinishedAt          string            `json:"finished_at,omitempty"`
	DurationMS          int64             `json:"duration_ms,omitempty"`
	Result              string            `json:"result,omitempty"`
	Error               string            `json:"error,omitempty"`
	Cost                *float64          `json:"cost,omitempty"`
	RateSnapshot        *Rates            `json:"rate_snapshot,omitempty"`
	LegacyEDN           string            `json:"legacy_edn,omitempty"`
}
type Summary struct {
	Tokens int64
	Cost   *float64
}

func Visible(records []Consultation) []Consultation {
	visible := make([]Consultation, 0, len(records))
	for _, record := range records {
		if record.Status == Completed {
			visible = append(visible, record)
		}
	}
	return visible
}

func AttachCost(record Consultation, rates Rates) Consultation {
	cost := float64(record.Usage.Input)*rates.Input + float64(record.Usage.Prompt)*rates.Prompt + float64(record.Usage.Thinking)*rates.Thinking + float64(record.Usage.Output)*rates.Output
	record.Cost = &cost
	record.RateSnapshot = &rates
	return record
}

func Summarize(records []Consultation) Summary {
	var summary Summary
	for _, record := range Visible(records) {
		summary.Tokens += record.Usage.Input + record.Usage.Prompt + record.Usage.Thinking + record.Usage.Output
		if record.Cost != nil {
			if summary.Cost == nil {
				summary.Cost = new(float64)
			}
			*summary.Cost += *record.Cost
		}
	}
	return summary
}
