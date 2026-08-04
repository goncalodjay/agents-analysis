package main

import (
	"bufio"
	"fmt"
	"io"
	"os"

	"github.com/gonza/agents-analysis/internal/history"
	"github.com/gonza/agents-analysis/internal/tui"
	"golang.org/x/term"
)

const usage = "Usage: agents-analysis [--history <path>] | agents-analysis daemon [--history <path>] [--socket <unix://path>]\n\nOptions:\n  --history <path>  local history file\n  --socket <address> Unix socket for daemon events\n  --help            show this help\n"

var userHomeDir = os.UserHomeDir

func run(args []string, input io.Reader, output, errors io.Writer) int {
	if len(args) > 0 && args[0] == "daemon" {
		return runDaemon(args[1:], errors)
	}
	path := defaultHistoryPath
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
	home, err := userHomeDir()
	if err != nil {
		fmt.Fprintln(errors, "Unable to find home directory:", err)
		return 1
	}
	store, err := history.Open(resolveUserPath(path, home))
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
	if input == os.Stdin && output == os.Stdout && term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd())) {
		if err := tui.RunTerminal(os.Stdin, os.Stdout, model); err != nil {
			fmt.Fprintln(errors, "Unable to run history TUI:", err)
			return 1
		}
		return 0
	}
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

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }
