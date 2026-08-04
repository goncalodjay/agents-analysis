package tui

import (
	"bufio"
	"strings"
	"testing"
)

func TestReadKeyRecognizesArrowKeysWithoutNewline(t *testing.T) {
	key, err := readKey(bufio.NewReader(strings.NewReader("\x1b[B")))
	if err != nil || key != "down" {
		t.Fatalf("key %q, err %v", key, err)
	}
}
