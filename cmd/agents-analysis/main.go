package main

import (
	"bufio"
	"fmt"
	"io"
	"os"

	"github.com/gonza/agents-analysis/internal/history"
	"github.com/gonza/agents-analysis/internal/tui"
)

const usage = "Usage: agents-analysis [--history <path>]\n\nOptions:\n  --history <path>  local history file\n  --help            show this help\n"

func run(args []string, input io.Reader, output, errors io.Writer) int {
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
func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }
