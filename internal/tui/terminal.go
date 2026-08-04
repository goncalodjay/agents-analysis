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

	reader := bufio.NewReader(input)
	filtering := false
	for {
		fmt.Fprint(output, "\x1b[H\x1b[2J"+model.Render())
		key, err := readKey(reader)
		if err != nil {
			return err
		}
		if key == "/" {
			filtering = true
			continue
		}
		if filtering {
			switch key {
			case "esc":
				filtering = false
			case "backspace":
				model = model.SetFilter(model.Filter[:max(0, len(model.Filter)-1)])
			default:
				if len(key) == 1 {
					model = model.SetFilter(model.Filter + key)
				}
			}
			continue
		}
		var exit bool
		model, exit = model.HandleKey(key)
		if exit {
			return nil
		}
	}
}

func readKey(reader *bufio.Reader) (string, error) {
	key, err := reader.ReadByte()
	if err != nil {
		return "", err
	}
	switch key {
	case 3, 4:
		return "q", nil
	case 127:
		return "backspace", nil
	case 27:
		next, err := reader.Peek(2)
		if err == nil && next[0] == '[' {
			_, _ = reader.Discard(2)
			switch next[1] {
			case 'A':
				return "up", nil
			case 'B':
				return "down", nil
			}
		}
		return "esc", nil
	default:
		return string(key), nil
	}
}
