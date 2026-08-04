package main

import (
	"bytes"
	"errors"
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

func TestTUIReportsHomeDirectoryFailure(t *testing.T) {
	original := userHomeDir
	userHomeDir = func() (string, error) { return "", errors.New("home unavailable") }
	t.Cleanup(func() { userHomeDir = original })

	var output, errorsOut bytes.Buffer
	if code := run([]string{"--history", "/tmp/history.sqlite"}, bytes.NewBuffer(nil), &output, &errorsOut); code != 1 {
		t.Fatalf("exit code = %d", code)
	}
	if !bytes.Contains(errorsOut.Bytes(), []byte("Unable to find home directory")) {
		t.Fatalf("unexpected error: %s", errorsOut.String())
	}
}

func TestDaemonConfigParsesOptionsAndResolvesUnixPaths(t *testing.T) {
	defaults, err := parseDaemonConfig(nil)
	if err != nil || defaults.historyPath != defaultHistoryPath {
		t.Fatalf("default config = %#v, %v", defaults, err)
	}
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
	if path := resolveUserPath(defaultHistoryPath, "/home/test"); path != "/home/test/.local/share/agents-analysis/trazas.sqlite" {
		t.Fatalf("resolveUserPath() = %q", path)
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
