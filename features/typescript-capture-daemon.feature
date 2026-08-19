Feature: TypeScript agent capture daemon

  # TypeScript agent capture daemon 001: Accepts a valid event
  Scenario Outline: TypeScript agent capture daemon 001: Accepts a valid event
    Given the daemon is listening on <daemon_address>
    And the daemon receives a completed event from agent <agent> for consultation <consultation_id>
    When the daemon validates the event
    Then the daemon acknowledges receipt of <consultation_id>
    And the daemon delivers the validated consultation to the SQLite history

    Examples:
      | daemon_address                                    | agent | consultation_id |
      | unix://~/.local/share/agents-analysis/daemon.sock | pi    | pi-1            |

  # TypeScript agent capture daemon 002: Rejects invalid events
  Scenario Outline: TypeScript agent capture daemon 002: Rejects invalid events
    Given the daemon receives the <event> event for consultation <consultation_id>
    When the daemon validates the event
    Then the daemon rejects the event with reason <reason>
    And the SQLite history does not contain a consultation created by <consultation_id>

    Examples:
      | event                  | consultation_id | reason                 |
      | missing identity       | sin-id          | identidad obligatoria  |
      | negative token usage   | pi-4            | uso de tokens inválido |

  # TypeScript agent capture daemon 003: Preserves the agent origin
  Scenario Outline: TypeScript agent capture daemon 003: Preserves the agent origin
    Given the daemon receives a completed event from agent <agent> for consultation <consultation_id>
    When the event satisfies the capture contract
    Then the SQLite history preserves <agent> as the origin of <consultation_id>

    Examples:
      | agent       | consultation_id |
      | pi          | pi-5            |
      | other-agent | other-1         |

  # TypeScript agent capture daemon 004: Stops the server when the socket closes
  Scenario Outline: TypeScript agent capture daemon 004: Stops the server when the socket closes
    Given the daemon is listening on <daemon_address>
    When the server socket is closed
    Then the server terminates without error

    Examples:
      | daemon_address                                    |
      | unix://~/.local/share/agents-analysis/daemon.sock |
