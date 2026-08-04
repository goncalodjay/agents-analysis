package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/gonza/agents-analysis/internal/capture"
	"github.com/gonza/agents-analysis/internal/history"
	"github.com/gonza/agents-analysis/internal/tui"
)

const usage = "Usage: agents-analysis [--history <path>] | agents-analysis daemon [--history <path>] [--socket <unix://path>]\n\nOptions:\n  --history <path>  local history file\n  --socket <address> Unix socket for daemon events\n  --help            show this help\n"

func run(args []string, input io.Reader, output, errors io.Writer) int {
	if len(args) > 0 && args[0] == "daemon" {
		return runDaemon(args[1:], errors)
	}
	path := "datos/trazas.sqlite"
	if len(args) == 1 && args[0] == "--help" {
		fmt.Fprint(output, usage)
		return 0
	}
	if len(args) == 2 && args[0] == "--history" {
		path = args[1]
	} else if len(args) != 0 {
		fmt.Fprint(errors, usage+"Unknown option or arguments\n")
		return 2
	}
	store, err := history.Open(path)
	if err != nil {
		fmt.Fprintln(errors, "Unable to start history TUI:", err)
		return 1
	}
	defer store.Close()
	records, err := store.Consultations()
	if err != nil {
		fmt.Fprintln(errors, "Unable to start history TUI:", err)
		return 1
	}
	model := tui.Start(records)
	fmt.Fprint(output, model.Render())
	scanner := bufio.NewScanner(input)
	for scanner.Scan() {
		var exit bool
		model, exit = model.HandleKey(scanner.Text())
		if exit {
			return 0
		}
	}
	return 0
}
func runDaemon(args []string, errorsOut io.Writer) int {
	historyPath := "datos/trazas.sqlite"
	socketAddress := "unix://~/.local/share/agents-analysis/daemon.sock"
	for len(args) > 0 {
		if len(args) < 2 || (args[0] != "--history" && args[0] != "--socket") {
			fmt.Fprint(errorsOut, usage+"Unknown option or arguments\n")
			return 2
		}
		if args[0] == "--history" {
			historyPath = args[1]
		} else {
			socketAddress = args[1]
		}
		args = args[2:]
	}
	if !strings.HasPrefix(socketAddress, "unix://") {
		fmt.Fprintln(errorsOut, "Daemon socket must use unix://")
		return 2
	}
	socketPath := strings.TrimPrefix(socketAddress, "unix://")
	if socketPath == "~" || strings.HasPrefix(socketPath, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintln(errorsOut, "Unable to find home directory:", err)
			return 1
		}
		socketPath = filepath.Join(home, strings.TrimPrefix(socketPath, "~/"))
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
	store, err := history.Open(historyPath)
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

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }
