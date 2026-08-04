package tui

import (
	"bufio"
	"bytes"
	"strings"
	"testing"

	"github.com/gonza/agents-analysis/internal/history"
)

func TestReadKeyRecognizesTerminalSequencesWithoutNewline(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"\x1b[A", "up"},
		{"\x1b[B", "down"},
		{"\x1b[C", "esc"},
		{"\x1b", "esc"},
		{"\x03", "q"},
		{"\x04", "q"},
		{"\x7f", "backspace"},
		{"?", "?"},
	}
	for _, test := range tests {
		key, err := readKey(bufio.NewReader(strings.NewReader(test.input)))
		if err != nil || key != test.want {
			t.Errorf("readKey(%q) = %q, %v; want %q", test.input, key, err, test.want)
		}
	}
}

func TestTerminalLoopFiltersNavigatesAndQuits(t *testing.T) {
	model := Start([]history.Consultation{
		consultation("openai-1", "openai", 1),
		consultation("anthropic-1", "anthropic", 2),
	})
	var output bytes.Buffer
	input := bufio.NewReader(strings.NewReader("/provider=openai\x1b\x1b[Bq"))

	if err := runTerminal(input, &output, model); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "filter: provider=openai") {
		t.Fatalf("filter was not rendered:\n%s", output.String())
	}
}

func TestFilterControllerBackspaceIsSafeAtEmptyFilter(t *testing.T) {
	controller := terminalController{model: Start(nil)}
	if controller.handleKey("/") || controller.handleKey("backspace") {
		t.Fatal("filter keys requested exit")
	}
	if controller.model.Filter != "" {
		t.Fatalf("filter = %q", controller.model.Filter)
	}
	controller.handleKey("esc")
	if controller.filtering {
		t.Fatal("escape did not leave filter mode")
	}
}
