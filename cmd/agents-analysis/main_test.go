package main

import (
	"bytes"
	"testing"
)

func TestHelpIsSuccessful(t *testing.T) {
	var output, errors bytes.Buffer
	if code := run([]string{"--help"}, bytes.NewBuffer(nil), &output, &errors); code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if !bytes.Contains(output.Bytes(), []byte("agents-analysis")) {
		t.Fatal("help did not name command")
	}
}
func TestUnknownOptionIsAnError(t *testing.T) {
	var output, errors bytes.Buffer
	if code := run([]string{"--unknown"}, bytes.NewBuffer(nil), &output, &errors); code != 2 {
		t.Fatalf("exit code = %d", code)
	}
}

func TestDaemonRejectsNonUnixSocket(t *testing.T) {
	var output, errors bytes.Buffer
	if code := run([]string{"daemon", "--socket", "tcp://localhost:1234"}, bytes.NewBuffer(nil), &output, &errors); code != 2 {
		t.Fatalf("exit code = %d", code)
	}
	if !bytes.Contains(errors.Bytes(), []byte("unix://")) {
		t.Fatalf("unexpected error: %s", errors.String())
	}
}
