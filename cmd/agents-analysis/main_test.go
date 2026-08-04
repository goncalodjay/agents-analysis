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

func TestDaemonConfigParsesOptionsAndResolvesUnixPaths(t *testing.T) {
	config, err := parseDaemonConfig([]string{"--socket", "unix:///tmp/daemon.sock", "--history", "/tmp/history.sqlite"})
	if err != nil {
		t.Fatal(err)
	}
	if config.socketAddress != "unix:///tmp/daemon.sock" || config.historyPath != "/tmp/history.sqlite" {
		t.Fatalf("unexpected config: %#v", config)
	}
	if path, err := resolveSocketPath("unix://~/daemon.sock", "/home/test"); err != nil || path != "/home/test/daemon.sock" {
		t.Fatalf("resolveSocketPath() = %q, %v", path, err)
	}
	if path, err := resolveSocketPath("unix://~", "/home/test"); err != nil || path != "/home/test" {
		t.Fatalf("resolveSocketPath() = %q, %v", path, err)
	}
	if _, err := resolveSocketPath("tcp://localhost", "/home/test"); err == nil {
		t.Fatal("non-Unix address was accepted")
	}
}

func TestDaemonConfigRejectsIncompleteAndUnknownOptions(t *testing.T) {
	for _, args := range [][]string{{"--socket"}, {"--unknown", "value"}} {
		if _, err := parseDaemonConfig(args); err == nil {
			t.Fatalf("parseDaemonConfig(%q) succeeded", args)
		}
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
