Feature: Hermes extension captures every Hermes turn and ships it to the agents-analysis daemon

  # Capture 001: A Hermes turn produces a consultation.completed event
  Scenario: Capture 001: A Hermes turn produces a consultation.completed event
    Given a Hermes session where the user sent "summarise this repo"
    When the agent turn completes
    Then the plugin emits a consultation.completed event to the daemon
    And the event's agent is "hermes"
    And the event's identity carries provider, model and a non-empty session/turn id
    And the event's content includes the system prompt and the user prompt
    And the event's usage sums the per-request input/output/reasoning/cache tokens

  # Capture 002: Tool calls are matched pre/post and recorded with args + result
  Scenario: Capture 002: Tool calls are matched pre/post and recorded with args + result
    Given a Hermes turn that called the terminal tool with {"command":"ls"}
    When the turn completes
    Then the captured tools list contains one entry named "terminal"
    And the entry's input is {"command":"ls"} and its output is the ls result
    And an unpaired pre_tool_call is recorded as an error on session_end

  # Capture 003: A sub-agent records prompt, cost and latency separately from the parent
  Scenario: Capture 003: A sub-agent records prompt, cost and latency separately from the parent
    Given a Hermes turn that delegated to a sub-agent named "repo-explorer"
    When subagent_stop fires
    Then the captured event has a subAgents entry with the sub-agent's prompt
    And the sub-agent's usage, cost and durationMs are recorded
    And the parent's own usage excludes the sub-agent's tokens

  # Capture 004: An api_request_error marks the result as error
  Scenario: Capture 004: An api_request_error marks the result as error
    Given a Hermes turn whose provider request failed
    When api_request_error fires
    Then the captured event's result is "error"
    And the event's error carries the failure message

  # Capture 005: Fail-open — a hook exception never breaks the agent loop
  Scenario: Capture 005: Fail-open — a hook exception never breaks the agent loop
    Given a hook callback raises an exception
    When the hook returns
    Then the exception is logged and swallowed
    And no event is delivered (but the agent loop continues)

  # Capture 006: A requestless turn is not emitted to the daemon
  Scenario: Capture 006: A requestless turn is not emitted to the daemon
    Given a turn with no pre_api_request / post_api_request fires
    When on_session_end fires
    Then the plugin does not enqueue anything
    And the daemon is never contacted