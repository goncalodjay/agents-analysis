//go:build property

package capture

import (
	"testing"
	"testing/quick"
)

func TestPropertyTokenValidationMatchesNonnegativeInvariant(t *testing.T) {
	property := func(input, prompt, thinking, output, cacheRead, cacheWrite int64) bool {
		event := validEvent()
		event.Usage = Usage{
			Input: input, Prompt: prompt, Thinking: thinking,
			Output: output, CacheRead: cacheRead, CacheWrite: cacheWrite,
		}
		allNonnegative := input >= 0 && prompt >= 0 && thinking >= 0 && output >= 0 && cacheRead >= 0 && cacheWrite >= 0
		return (event.Validate() == nil) == allNonnegative
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 2_000}); err != nil {
		t.Fatal(err)
	}
}

func TestPropertyConsultationPreservesCaptureIdentity(t *testing.T) {
	property := func(id, agent, provider, model string) bool {
		event := validEvent()
		event.ID, event.Agent = id, agent
		event.Identity.Provider, event.Identity.Model = provider, model
		consultation := event.Consultation()
		return consultation.ID == id && consultation.Harness == agent && consultation.Provider == provider && consultation.Model == model
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 1_000}); err != nil {
		t.Fatal(err)
	}
}
