package capture

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"testing"
	"time"

	"github.com/gonza/agents-analysis/internal/history"
)

func validEvent() Event {
	return Event{
		Type: "consultation.completed", Version: 1, ID: "pi-1", Agent: "pi",
		Identity: Identity{SessionID: "session-1", TurnID: "turn-1", Provider: "openai", Model: "gpt-5", ReasoningLevel: "medium"},
		Content:  Content{SystemPrompt: "system", Context: "context", UserPrompt: "user", Response: "answer"},
		Usage:    Usage{Input: 120, Prompt: 80, Thinking: 40, Output: 160}, DurationMS: 2000, Result: "success",
		Tools: []Tool{{ID: "tool-1", Name: "read", Input: json.RawMessage(`{"path":"file"}`), Output: "contents"}},
	}
}

func startDaemon(t *testing.T) (string, *history.Store, context.CancelFunc) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "daemon.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	store, err := history.Open(filepath.Join(t.TempDir(), "history.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = Serve(ctx, listener, store) }()
	t.Cleanup(func() { cancel(); listener.Close(); store.Close() })
	return path, store, cancel
}

func send(t *testing.T, address string, event Event) Reply {
	t.Helper()
	connection, err := net.Dial("unix", address)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := json.NewEncoder(connection).Encode(event); err != nil {
		t.Fatal(err)
	}
	var reply Reply
	if err := json.NewDecoder(bufio.NewReader(connection)).Decode(&reply); err != nil {
		t.Fatal(err)
	}
	return reply
}

func TestDaemonAcknowledgesAndStoresValidatedEvent(t *testing.T) {
	address, store, _ := startDaemon(t)
	reply := send(t, address, validEvent())
	if !reply.Accepted || reply.ID != "pi-1" {
		t.Fatalf("unexpected reply: %#v", reply)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		records, err := store.Consultations()
		if err != nil {
			t.Fatal(err)
		}
		if len(records) == 1 {
			if records[0].ID != "pi-1" || records[0].Harness != "pi" || records[0].Response != "answer" {
				t.Fatalf("unexpected record: %#v", records[0])
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("event was not stored")
}

func TestDaemonRejectsInvalidEventsWithoutWritingHistory(t *testing.T) {
	address, store, _ := startDaemon(t)
	event := validEvent()
	event.Identity.SessionID = ""
	reply := send(t, address, event)
	if reply.Accepted || reply.Reason != "identidad obligatoria" {
		t.Fatalf("unexpected reply: %#v", reply)
	}

	event = validEvent()
	event.ID = "pi-4"
	event.Usage.Output = -1
	reply = send(t, address, event)
	if reply.Accepted || reply.Reason != "uso de tokens inválido" {
		t.Fatalf("unexpected reply: %#v", reply)
	}

	records, err := store.Consultations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("invalid events wrote history: %#v", records)
	}
}

func TestEventValidationAcceptsZeroMeasurements(t *testing.T) {
	event := validEvent()
	event.Usage = Usage{}
	event.DurationMS = 0
	if err := event.Validate(); err != nil {
		t.Fatalf("Validate() = %v", err)
	}
}

func TestEventValidationRejectsEveryMissingIdentityAndInvalidMeasurement(t *testing.T) {
	tests := []struct {
		name   string
		change func(*Event)
		reason string
	}{
		{"type", func(event *Event) { event.Type = "other" }, "identidad obligatoria"},
		{"version", func(event *Event) { event.Version = 2 }, "identidad obligatoria"},
		{"id", func(event *Event) { event.ID = "" }, "identidad obligatoria"},
		{"agent", func(event *Event) { event.Agent = "" }, "identidad obligatoria"},
		{"turn", func(event *Event) { event.Identity.TurnID = "" }, "identidad obligatoria"},
		{"provider", func(event *Event) { event.Identity.Provider = "" }, "identidad obligatoria"},
		{"model", func(event *Event) { event.Identity.Model = "" }, "identidad obligatoria"},
		{"negative input", func(event *Event) { event.Usage.Input = -1 }, "uso de tokens inválido"},
		{"negative prompt", func(event *Event) { event.Usage.Prompt = -1 }, "uso de tokens inválido"},
		{"negative thinking", func(event *Event) { event.Usage.Thinking = -1 }, "uso de tokens inválido"},
		{"negative cache read", func(event *Event) { event.Usage.CacheRead = -1 }, "uso de tokens inválido"},
		{"negative cache write", func(event *Event) { event.Usage.CacheWrite = -1 }, "uso de tokens inválido"},
		{"negative duration", func(event *Event) { event.DurationMS = -1 }, "duración inválida"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			event := validEvent()
			test.change(&event)
			if err := event.Validate(); err == nil || err.Error() != test.reason {
				t.Fatalf("Validate() = %v, want %q", err, test.reason)
			}
		})
	}
}

func TestServeStopsWhenListenerCloses(t *testing.T) {
	listener, err := net.Listen("unix", filepath.Join(t.TempDir(), "closed.sock"))
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	if err := Serve(context.Background(), listener, nil); err != nil {
		t.Fatalf("Serve() = %v", err)
	}
}

func TestServeStopsWhenContextIsCancelled(t *testing.T) {
	listener, err := net.Listen("unix", filepath.Join(t.TempDir(), "cancelled.sock"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Serve(ctx, listener, nil); err != nil {
		t.Fatalf("Serve() = %v", err)
	}
}

func TestDaemonPreservesAnyAgentAsTheHarness(t *testing.T) {
	address, store, _ := startDaemon(t)
	event := validEvent()
	event.ID, event.Agent = "other-1", "other-agent"
	if reply := send(t, address, event); !reply.Accepted {
		t.Fatalf("unexpected reply: %#v", reply)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		records, _ := store.Consultations()
		if len(records) == 1 {
			if records[0].Harness != "other-agent" {
				t.Fatalf("got harness %q", records[0].Harness)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("event was not stored")
}
