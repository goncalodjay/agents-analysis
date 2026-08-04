// Package capture receives completed-agent events and stores them in local history.
package capture

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"

	"github.com/gonza/agents-analysis/internal/history"
)

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
	if event.Type != "consultation.completed" || event.Version != 1 || event.ID == "" || event.Agent == "" || event.Identity.SessionID == "" || event.Identity.TurnID == "" || event.Identity.Provider == "" || event.Identity.Model == "" {
		return errors.New("identidad obligatoria")
	}
	if event.Usage.Input < 0 || event.Usage.Prompt < 0 || event.Usage.Thinking < 0 || event.Usage.Output < 0 || event.Usage.CacheRead < 0 || event.Usage.CacheWrite < 0 {
		return errors.New("uso de tokens inválido")
	}
	if event.DurationMS < 0 {
		return errors.New("duración inválida")
	}
	return nil
}

func (event Event) Consultation() history.Consultation {
	tools := make([]history.ToolResult, 0, len(event.Tools))
	for _, tool := range event.Tools {
		tools = append(tools, history.ToolResult{Tool: tool.Name, Request: string(tool.Input), Result: tool.Output})
	}
	return history.Consultation{
		ID: event.ID, Status: history.Completed, Provider: event.Identity.Provider, Model: event.Identity.Model,
		Harness: event.Agent, InferenceParameters: "reasoning=" + event.Identity.ReasoningLevel,
		Prompts: map[string]string{"system": event.Content.SystemPrompt, "user": event.Content.UserPrompt},
		Context: event.Content.Context, Response: event.Content.Response, ToolResults: tools,
		Usage:     history.Usage{Input: event.Usage.Input, Prompt: event.Usage.Prompt, Thinking: event.Usage.Thinking, Output: event.Usage.Output},
		StartedAt: event.StartedAt, FinishedAt: event.FinishedAt, DurationMS: event.DurationMS, Result: event.Result, Error: event.Error,
	}
}

// Serve accepts newline-delimited JSON events until the listener closes or context is cancelled.
func Serve(ctx context.Context, listener net.Listener, store *history.Store) error {
	for {
		connection, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) || strings.Contains(err.Error(), "use of closed network connection") {
				return nil
			}
			return err
		}
		go handle(connection, store)
	}
}

func handle(connection net.Conn, store *history.Store) {
	defer connection.Close()
	var event Event
	err := json.NewDecoder(bufio.NewReader(connection)).Decode(&event)
	if err == nil {
		err = event.Validate()
	}
	if err == nil {
		err = store.Save(event.Consultation())
	}
	reply := Reply{Accepted: err == nil}
	if err != nil {
		reply.Reason = err.Error()
	} else {
		reply.ID = event.ID
	}
	_ = json.NewEncoder(connection).Encode(reply)
}
