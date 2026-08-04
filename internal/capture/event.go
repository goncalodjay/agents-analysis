package capture

import (
	"encoding/json"
	"errors"

	"github.com/gonza/agents-analysis/internal/consultation"
)

// ConsultationStore is the persistence boundary used by the capture daemon.
type ConsultationStore interface {
	Save(consultation.Consultation) error
}

type Event struct {
	Type       string   `json:"type"`
	Version    int      `json:"version"`
	ID         string   `json:"id"`
	Agent      string   `json:"agent"`
	Identity   Identity `json:"identity"`
	Content    Content  `json:"content"`
	Usage      Usage    `json:"usage"`
	StartedAt  string   `json:"startedAt"`
	FinishedAt string   `json:"finishedAt"`
	DurationMS int64    `json:"durationMs"`
	Result     string   `json:"result"`
	Error      string   `json:"error"`
	Tools      []Tool   `json:"tools"`
}

type Identity struct {
	SessionID      string `json:"sessionId"`
	TurnID         string `json:"turnId"`
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	ReasoningLevel string `json:"reasoningLevel"`
}

type Content struct {
	SystemPrompt string `json:"systemPrompt"`
	Context      string `json:"context"`
	UserPrompt   string `json:"userPrompt"`
	Response     string `json:"response"`
}

type Usage struct {
	Input      int64 `json:"input"`
	Prompt     int64 `json:"prompt"`
	Thinking   int64 `json:"thinking"`
	Output     int64 `json:"output"`
	CacheRead  int64 `json:"cacheRead"`
	CacheWrite int64 `json:"cacheWrite"`
}

type Tool struct {
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	Output  string          `json:"output"`
	IsError bool            `json:"isError"`
}

type Reply struct {
	Accepted bool   `json:"accepted"`
	ID       string `json:"id,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

func (event Event) Validate() error {
	if !event.hasRequiredIdentity() {
		return errors.New("identidad obligatoria")
	}
	if event.Usage.hasNegativeValue() {
		return errors.New("uso de tokens inválido")
	}
	if event.DurationMS < 0 {
		return errors.New("duración inválida")
	}
	return nil
}

func (event Event) hasRequiredIdentity() bool {
	if event.Type != "consultation.completed" || event.Version != 1 {
		return false
	}
	required := []string{event.ID, event.Agent, event.Identity.SessionID, event.Identity.TurnID, event.Identity.Provider, event.Identity.Model}
	for _, value := range required {
		if value == "" {
			return false
		}
	}
	return true
}

func (usage Usage) hasNegativeValue() bool {
	values := [...]int64{usage.Input, usage.Prompt, usage.Thinking, usage.Output, usage.CacheRead, usage.CacheWrite}
	for _, value := range values {
		if value < 0 {
			return true
		}
	}
	return false
}

func (event Event) Consultation() consultation.Consultation {
	tools := make([]consultation.ToolResult, 0, len(event.Tools))
	for _, tool := range event.Tools {
		tools = append(tools, consultation.ToolResult{Tool: tool.Name, Request: string(tool.Input), Result: tool.Output})
	}
	return consultation.Consultation{
		ID: event.ID, Status: consultation.Completed, Provider: event.Identity.Provider, Model: event.Identity.Model,
		Harness: event.Agent, InferenceParameters: "reasoning=" + event.Identity.ReasoningLevel,
		Prompts: map[string]string{"system": event.Content.SystemPrompt, "user": event.Content.UserPrompt},
		Context: event.Content.Context, Response: event.Content.Response, ToolResults: tools,
		Usage:     consultation.Usage{Input: event.Usage.Input, Prompt: event.Usage.Prompt, Thinking: event.Usage.Thinking, Output: event.Usage.Output},
		StartedAt: event.StartedAt, FinishedAt: event.FinishedAt, DurationMS: event.DurationMS, Result: event.Result, Error: event.Error,
	}
}
