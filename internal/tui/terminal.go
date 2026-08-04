package tui

import (
	"bufio"
	"fmt"
	"io"
	"os"

	"golang.org/x/term"
)

// RunTerminal renders the model in an alternate terminal screen and handles keys immediately.
func RunTerminal(input *os.File, output io.Writer, model Model) error {
	state, err := term.MakeRaw(int(input.Fd()))
	if err != nil {
		return err
	}
	defer term.Restore(int(input.Fd()), state)
	fmt.Fprint(output, "\x1b[?1049h\x1b[?25l")
	defer fmt.Fprint(output, "\x1b[?25h\x1b[?1049l")
	return runTerminal(bufio.NewReader(input), output, model)
}

type terminalController struct {
	model     Model
	filtering bool
}

func runTerminal(reader *bufio.Reader, output io.Writer, model Model) error {
	controller := terminalController{model: model}
	for {
		fmt.Fprint(output, "\x1b[H\x1b[2J"+controller.model.Render())
		key, err := readKey(reader)
		if err != nil {
			return err
		}
		if controller.handleKey(key) {
			return nil
		}
	}
}

func (controller *terminalController) handleKey(key string) bool {
	if key == "/" {
		controller.filtering = true
		return false
	}
	if controller.filtering {
		controller.handleFilterKey(key)
		return false
	}
	var exit bool
	controller.model, exit = controller.model.HandleKey(key)
	return exit
}

func (controller *terminalController) handleFilterKey(key string) {
	switch key {
	case "esc":
		controller.filtering = false
	case "backspace":
		controller.model = controller.model.SetFilter(controller.model.Filter[:max(0, len(controller.model.Filter)-1)])
	default:
		if len(key) == 1 {
			controller.model = controller.model.SetFilter(controller.model.Filter + key)
		}
	}
}

func readKey(reader *bufio.Reader) (string, error) {
	key, err := reader.ReadByte()
	if err != nil {
		return "", err
	}
	return keyName(key, reader), nil
}

func keyName(key byte, reader *bufio.Reader) string {
	switch key {
	case 3, 4:
		return "q"
	case 127:
		return "backspace"
	case 27:
		return escapeKey(reader)
	default:
		return string(key)
	}
}

func escapeKey(reader *bufio.Reader) string {
	next, err := reader.Peek(2)
	if err != nil || next[0] != '[' {
		return "esc"
	}
	_, _ = reader.Discard(2)
	switch next[1] {
	case 'A':
		return "up"
	case 'B':
		return "down"
	default:
		return "esc"
	}
}
