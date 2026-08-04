package main

import (
	"errors"
	"path/filepath"
	"strings"
)

const (
	defaultHistoryPath   = "~/.local/share/agents-analysis/trazas.sqlite"
	defaultSocketAddress = "unix://~/.local/share/agents-analysis/daemon.sock"
)

type daemonConfig struct {
	historyPath   string
	socketAddress string
}

func parseDaemonConfig(args []string) (daemonConfig, error) {
	config := daemonConfig{historyPath: defaultHistoryPath, socketAddress: defaultSocketAddress}
	for len(args) > 0 {
		if len(args) < 2 {
			return daemonConfig{}, errors.New("missing daemon option value")
		}
		switch args[0] {
		case "--history":
			config.historyPath = args[1]
		case "--socket":
			config.socketAddress = args[1]
		default:
			return daemonConfig{}, errors.New("unknown daemon option")
		}
		args = args[2:]
	}
	return config, nil
}

func resolveSocketPath(address, home string) (string, error) {
	if !strings.HasPrefix(address, "unix://") {
		return "", errors.New("daemon socket must use unix://")
	}
	return resolveUserPath(strings.TrimPrefix(address, "unix://"), home), nil
}

func resolveUserPath(path, home string) string {
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") {
		return filepath.Join(home, strings.TrimPrefix(path, "~/"))
	}
	return path
}
