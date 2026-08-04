package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"

	"github.com/gonza/agents-analysis/internal/capture"
	"github.com/gonza/agents-analysis/internal/history"
)

func runDaemon(args []string, errorsOut io.Writer) int {
	config, err := parseDaemonConfig(args)
	if err != nil {
		fmt.Fprint(errorsOut, usage+"Unknown option or arguments\n")
		return 2
	}
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(errorsOut, "Unable to find home directory:", err)
		return 1
	}
	socketPath, err := resolveSocketPath(config.socketAddress, home)
	if err != nil {
		fmt.Fprintln(errorsOut, "Daemon socket must use unix://")
		return 2
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0755); err != nil {
		fmt.Fprintln(errorsOut, "Unable to create daemon directory:", err)
		return 1
	}
	if err := os.Remove(socketPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintln(errorsOut, "Unable to clear daemon socket:", err)
		return 1
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		fmt.Fprintln(errorsOut, "Unable to listen for capture events:", err)
		return 1
	}
	defer func() { listener.Close(); os.Remove(socketPath) }()
	store, err := history.Open(config.historyPath)
	if err != nil {
		fmt.Fprintln(errorsOut, "Unable to open history:", err)
		return 1
	}
	defer store.Close()
	if err := capture.Serve(context.Background(), listener, store); err != nil {
		fmt.Fprintln(errorsOut, "Capture daemon stopped:", err)
		return 1
	}
	return 0
}
