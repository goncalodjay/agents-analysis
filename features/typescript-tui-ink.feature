Feature: History TUI in TypeScript with Ink

  # History TUI in TypeScript with Ink 001: Renders with Ink components
  Scenario Outline: History TUI in TypeScript with Ink 001: Renders with Ink components
    Given the local history contains consultations <consultations>
    When the TypeScript TUI is rendered
    Then the output contains the <list_panel> panel
    And the output contains the <detail_panel> panel
    And the output contains the <keys_panel> panel
    And the most recent consultation appears selected

    Examples:
      | consultations | list_panel | detail_panel | keys_panel |
      | pi-1, pi-2    | List       | Detail       | Keys       |

  # History TUI in TypeScript with Ink 002: Navigates the list
  Scenario Outline: History TUI in TypeScript with Ink 002: Navigates the list
    Given the TypeScript TUI displays consultations <consultations>
    And the selected consultation is <selected>
    When the user presses the <key> key
    Then the selected consultation becomes <result>

    Examples:
      | consultations | selected | key  | result |
      | pi-1, pi-2    | pi-1     | down | pi-2   |
      | pi-1, pi-2    | pi-2     | up   | pi-1   |

  # History TUI in TypeScript with Ink 003: Changes focus and scrolls detail
  Scenario Outline: History TUI in TypeScript with Ink 003: Changes focus and scrolls detail
    Given the TypeScript TUI displays consultation <consultation_id>
    And consultation <consultation_id> is selected
    When the user presses <focus_key>
    Then the focus moves to the <panel> panel
    When the user presses <scroll_key>
    Then the <panel> panel content scrolls without changing the selected consultation

    Examples:
      | consultation_id | focus_key | panel   | scroll_key |
      | pi-1            | tab       | detail  | down       |

  # History TUI in TypeScript with Ink 004: Filters and restores history
  Scenario Outline: History TUI in TypeScript with Ink 004: Filters and restores history
    Given the TypeScript TUI displays consultations from providers <providers>
    When the user enters the filter <filter>
    Then the list shows only consultations matching <filter>
    And the cost summary considers only the displayed consultations
    When the user clears the filter
    Then the list shows all consultations again

    Examples:
      | providers         | filter          |
      | openai, anthropic | provider=openai |

  # History TUI in TypeScript with Ink 005: Shows and hides help
  Scenario Outline: History TUI in TypeScript with Ink 005: Shows and hides help
    Given the TypeScript TUI is active
    When the user presses <help_key>
    Then the TUI shows the help menu
    When the user presses <help_key>
    Then the TUI hides the help menu

    Examples:
      | help_key |
      | ?        |

  # History TUI in TypeScript with Ink 006: Exits and restores the terminal
  Scenario Outline: History TUI in TypeScript with Ink 006: Exits and restores the terminal
    Given the TypeScript TUI is active
    When the user presses <quit_key>
    Then the Ink app exits
    And the process exits with code <exit_code>

    Examples:
      | quit_key | exit_code |
      | q        | 0         |
