Feature: Agent menu as TUI entry point

  # Agent menu as TUI entry point 001: Lists agents on startup
  Scenario Outline: Agent menu as TUI entry point 001: Lists agents on startup
    Given the history contains consultations from agents <agents>
    When the TUI starts
    Then the menu panel is shown
    And the menu lists <agents> with their consultation counts

    Examples:
      | agents                  |
      | pi, opencode, codex     |

  # Agent menu as TUI entry point 002: Enters an agent's list
  Scenario Outline: Agent menu as TUI entry point 002: Enters an agent's list
    Given the menu panel is shown with agents <agents>
    And the agent <selected_agent> is highlighted
    When the user presses enter
    Then the focus moves to the list panel
    And only consultations from <selected_agent> are shown

    Examples:
      | agents               | selected_agent |
      | pi, opencode, codex  | opencode       |

  # Agent menu as TUI entry point 003: Filters inside an agent's list
  Scenario Outline: Agent menu as TUI entry point 003: Filters inside an agent's list
    Given the list panel shows consultations from agent <agent> with providers <providers>
    When the user enters the filter <filter>
    Then the list shows only consultations matching <filter>
    And all shown consultations still belong to agent <agent>

    Examples:
      | agent | providers         | filter          |
      | pi    | openai, anthropic | provider=openai |

  # Agent menu as TUI entry point 004: Esc bubbles one level at a time
  Scenario Outline: Agent menu as TUI entry point 004: Esc bubbles one level at a time
    Given the TUI focus is on the <panel> panel
    When the user presses esc
    Then the focus moves to the <previous_panel> panel

    Examples:
      | panel  | previous_panel |
      | detail | list           |
      | list   | menu           |

  # Agent menu as TUI entry point 005: Empty history shows a menu placeholder
  Scenario Outline: Agent menu as TUI entry point 005: Empty history shows a menu placeholder
    Given the history contains no consultations
    When the TUI starts
    Then the menu panel shows "no agents captured yet"
