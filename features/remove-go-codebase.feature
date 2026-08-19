Feature: Remove Go codebase

  # Remove Go codebase 001: Removes Go sources and modules
  Scenario Outline: Remove Go codebase 001: Removes Go sources and modules
    Given the TypeScript migration is complete and tested
    When the versioned files are inspected
    Then no files with extension <go_extension> exist
    And the file <module_manifest> does not exist
    And the file <module_sum> does not exist

    Examples:
      | go_extension | module_manifest | module_sum |
      | .go          | go.mod          | go.sum       |

  # Remove Go codebase 002: Removes Go-built binaries
  Scenario Outline: Remove Go codebase 002: Removes Go-built binaries
    Given the TypeScript migration is complete
    When the <tools_directory> directory is inspected
    Then the executable <go_parser> does not exist

    Examples:
      | tools_directory | go_parser      |
      | .tools/bin      | gherkin-parser |

  # Remove Go codebase 003: Updates scripts to not use Go
  Scenario Outline: Remove Go codebase 003: Updates scripts to not use Go
    Given the TypeScript migration is complete
    When the scripts <scripts> are inspected
    Then no script invokes the <go_command> command

    Examples:
      | scripts                                  | go_command |
      | scripts/acceptance, scripts/property-tests | go         |

  # Remove Go codebase 004: Project builds and tests without Go
  Scenario Outline: Remove Go codebase 004: Project builds and tests without Go
    Given the environment does not have <go_command> in PATH
    When the tests are run with <test_command>
    And the acceptance pipeline is run with <acceptance_script>
    Then both processes exit with code <exit_code>

    Examples:
      | go_command | test_command | acceptance_script | exit_code |
      | go         | npm test     | scripts/acceptance | 0         |

  # Remove Go codebase 005: Removes obsolete Go feature files
  Scenario Outline: Remove Go codebase 005: Removes obsolete Go feature files
    Given the TypeScript migration is complete
    When the feature files are listed
    Then no files with the <go_prefix> prefix exist

    Examples:
      | go_prefix |
      | go-       |
