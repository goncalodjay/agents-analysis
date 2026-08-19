Feature: TypeScript CLI and scripts

  # TypeScript CLI and scripts 001: Shows help
  Scenario Outline: TypeScript CLI and scripts 001: Shows help
    When the user runs <command>
    Then the output shows the command usage and its main options
    And the process exits with code <exit_code>

    Examples:
      | command                | exit_code |
      | agents-analysis --help | 0         |

  # TypeScript CLI and scripts 002: Starts the TUI with a given history
  Scenario Outline: TypeScript CLI and scripts 002: Starts the TUI with a given history
    Given the local history is available at <history_path>
    When the user runs <command>
    Then the process starts the history TUI
    And the TUI accepts the <quit_key> key to finish
    When the user presses the <quit_key> key
    Then the process exits with code <exit_code>

    Examples:
      | history_path        | command                                      | quit_key | exit_code |
      | datos/trazas.sqlite | agents-analysis --history datos/trazas.sqlite | q        | 0         |

  # TypeScript CLI and scripts 003: Reports startup errors
  Scenario Outline: TypeScript CLI and scripts 003: Reports startup errors
    Given opening the local history fails due to <cause>
    When the user runs <command>
    Then the process reports the startup error
    And the process exits with code <exit_code>

    Examples:
      | cause            | command         | exit_code |
      | inaccessible path | agents-analysis | 1         |

  # TypeScript CLI and scripts 004: Starts the daemon with valid options
  Scenario Outline: TypeScript CLI and scripts 004: Starts the daemon with valid options
    When the user runs <command>
    Then the daemon listens on <socket>
    And the daemon opens the history at <history>

    Examples:
      | command                                                                  | socket                  | history             |
      | agents-analysis daemon --history /tmp/history.sqlite --socket unix:///tmp/daemon.sock | unix:///tmp/daemon.sock | /tmp/history.sqlite |

  # TypeScript CLI and scripts 005: Rejects non-Unix socket addresses
  Scenario Outline: TypeScript CLI and scripts 005: Rejects non-Unix socket addresses
    When the user runs <command>
    Then the process reports that the socket must use unix://
    And the process exits with code <exit_code>

    Examples:
      | command                                              | exit_code |
      | agents-analysis daemon --socket tcp://localhost:1234 | 2         |

  # TypeScript CLI and scripts 006: Runs the acceptance pipeline with the TypeScript parser
  Scenario Outline: TypeScript CLI and scripts 006: Runs the acceptance pipeline with the TypeScript parser
    Given the files <feature_files> exist
    When the <acceptance_script> script is run
    Then the TypeScript parser generates the JSON IR files in <output_directory>
    And the pipeline exits with code <exit_code>

    Examples:
      | feature_files      | acceptance_script | output_directory | exit_code |
      | features/*.feature | scripts/acceptance | build/acceptance | 0         |
