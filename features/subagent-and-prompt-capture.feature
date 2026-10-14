Feature: Sub-agent capture and opencode prompt capture

  # Capture 001: opencode's system prompt comes from the hook, not the message
  Scenario: Capture 001: opencode's system prompt comes from the hook, not the message
    Given opencode does not persist the system prompt on the user message
    When the plugin captures a completed turn
    Then the system prompt recorded is the one opencode assembled for the model
    And it is collected from the chat system transform hook, keyed by session

  # Capture 002: Synthetic parts are not the user's prompt
  Scenario: Capture 002: Synthetic parts are not the user's prompt
    Given a user message whose parts include a synthetic text part
    When the turn is captured
    Then the recorded user prompt contains only what the user actually typed

  # Capture 003: The agent's own price wins over a local rate table
  Scenario: Capture 003: The agent's own price wins over a local rate table
    Given opencode reports a cost on its assistant message
    When the daemon stores the consultation
    Then the stored cost is the one opencode billed
    And a locally configured rate is not used to overwrite it

  # Capture 004: A sub-agent's session is not captured as its own consultation
  Scenario: Capture 004: A sub-agent's session is not captured as its own consultation
    Given a delegated call runs in a child session that also goes idle
    When the plugin handles that idle event
    Then the child session is skipped
    And its work is reported inside the parent's sub-agent list instead

  # Capture 005: A delegated call records its prompt, cost and latency
  Scenario Outline: Capture 005: A delegated call records its prompt, cost and latency
    Given a <agent> turn that delegated work to a sub-agent
    When the turn is captured
    Then the sub-agent's name, description and prompt are recorded
    And its tokens, cost and latency are recorded separately from the parent's
    And the parent's own token count excludes what the sub-agent spent

    Examples:
      | agent       |
      | opencode    |
      | claude-code |

  # Capture 006: A sub-agent that failed is still reported
  Scenario: Capture 006: A sub-agent that failed is still reported
    Given a delegated call that failed before the sub-agent produced any tokens
    When the turn is captured
    Then the sub-agent is still listed, with its error and the latency it consumed
    And no cost is claimed for it
