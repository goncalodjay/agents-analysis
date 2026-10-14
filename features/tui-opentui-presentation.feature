Feature: OpenTUI presentation and readable figures

  # OpenTUI presentation 001: Green is the focus colour
  Scenario: OpenTUI presentation 001: Green is the focus colour
    Given the TUI is rendered with the OpenTUI renderer
    When a panel holds the keyboard focus
    Then that panel's border is drawn in the primary green
    And every unfocused panel is drawn in the dim green instead

  # OpenTUI presentation 002: Total cost is pinned top right
  Scenario: OpenTUI presentation 002: Total cost is pinned top right
    Given the history contains priced consultations
    When any panel is shown
    Then the header shows the total cost across all agents
    And the total sits on the right-hand half of the header

  # OpenTUI presentation 003: Token counts are grouped for reading
  Scenario Outline: OpenTUI presentation 003: Token counts are grouped for reading
    Given a consultation whose token count is <tokens>
    When its figures are displayed
    Then the count reads <formatted>

    Examples:
      | tokens | formatted |
      | 12000  | 12.000    |
      | 244352 | 244.352   |
      | 0      | 0         |

  # OpenTUI presentation 004: Latency is read in seconds, then minutes, then hours
  Scenario Outline: OpenTUI presentation 004: Latency is read in seconds, then minutes, then hours
    Given a consultation that took <milliseconds> milliseconds
    When its latency is displayed
    Then the latency reads <formatted>
    And the raw millisecond figure is never shown

    Examples:
      | milliseconds | formatted |
      | 850          | 0,85s     |
      | 16264        | 16,26s    |
      | 272000       | 4m 32s    |
      | 5400000      | 1h 30m    |

  # OpenTUI presentation 005: Costs screen breaks spend down per agent and model
  Scenario: OpenTUI presentation 005: Costs screen breaks spend down per agent and model
    Given the agent menu is shown
    When the user selects the costs entry
    Then the costs panel lists each configured agent
    And each agent's spend is broken down by the model that produced it
    And a grand total is shown beneath the breakdown
    And esc returns to the agent menu

  # OpenTUI presentation 006: Provider and model are separate columns
  Scenario: OpenTUI presentation 006: Provider and model are separate columns
    Given a consultation from provider "anthropic" on model "claude-opus-5"
    When it is shown in the list and in the detail stats
    Then the provider and the model are rendered as distinct fields
    And they are not collapsed into a single slash-joined string
