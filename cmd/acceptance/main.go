// Command acceptance runs the project acceptance pipeline after APS parsing.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

type featureIR struct { Name string `json:"name"`; Scenarios []json.RawMessage `json:"scenarios"` }
func main() {
	parser := os.Getenv("GHERKIN_PARSER")
	if parser == "" { parser = "gherkin-parser" }
	features, err := filepath.Glob("features/*.feature"); if err != nil { panic(err) }
	for _, feature := range features {
		output := filepath.Join("build", "acceptance", filepath.Base(feature)+".json")
		if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil { panic(err) }
		command := exec.Command(parser, feature, output); command.Stdout, command.Stderr = os.Stdout, os.Stderr
		if err := command.Run(); err != nil { fmt.Fprintln(os.Stderr, "gherkin parser failed:", err); os.Exit(1) }
		data, err := os.ReadFile(output); if err != nil { panic(err) }; var ir featureIR
		if err := json.Unmarshal(data, &ir); err != nil || ir.Name == "" || len(ir.Scenarios) == 0 { fmt.Fprintln(os.Stderr, "invalid acceptance IR:", feature); os.Exit(1) }
	}
}
