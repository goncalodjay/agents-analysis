Feature: Detail submenus for prompts, tools and sub-agents

  # Detail submenus 001: A category is a list before it is a document
  Scenario Outline: Detail submenus 001: A category is a list before it is a document
    Given a consultation's detail panel is focused
    When the user opens the <category> category
    Then a list of that category's entries is shown
    And enter opens the highlighted entry in full
    And esc returns from the entry to the list, and from the list to the detail menu

    Examples:
      | category  |
      | prompts   |
      | tools     |
      | subagents |

  # Detail submenus 002: Prompts offers the system and the user prompt
  Scenario: Detail submenus 002: Prompts offers the system and the user prompt
    Given a consultation with a long system prompt and a long user prompt
    When the user opens the prompts category
    Then exactly two entries are offered, the system prompt and the user prompt
    And selecting either shows that prompt in full, scrollable line by line
    And a prompt the agent never reported is marked as not captured

  # Detail submenus 003: A huge tool result never breaks the layout
  Scenario: Detail submenus 003: A huge tool result never breaks the layout
    Given a consultation whose tool result is 51281 characters across 1078 lines
    When the user opens that tool
    Then every rendered row fits within the terminal width
    And the frame never exceeds the terminal height
    And the footer is still visible
    And the scroll position reports which lines of the total are shown

  # Detail submenus 004: Tools are ordered and described
  Scenario: Detail submenus 004: Tools are ordered and described
    Given a consultation that called several tools
    When the user opens the tools category
    Then the tools are listed in the order they were called
    And each entry shows its tool name and the size of its arguments and result
    And the detail menu summarises how many times each distinct tool was used
    And opening a tool shows its arguments indented as JSON rather than as one line

  # Detail submenus 005: Sub-agents are their own section
  Scenario: Detail submenus 005: Sub-agents are their own section
    Given a consultation that delegated work to a sub-agent
    When the user opens the sub-agents category
    Then each delegated call is listed with its cost, latency and token count
    And opening one shows the prompt that was sent to the sub-agent
    And it also shows that sub-agent's response, model, cost and latency

  # Detail submenus 006: An empty category cannot be opened into a blank pane
  Scenario: Detail submenus 006: An empty category cannot be opened into a blank pane
    Given a consultation that used no tools and delegated to no sub-agents
    When the user opens that category
    Then a message explains that nothing was captured under it
    And pressing enter does not open an empty entry view
