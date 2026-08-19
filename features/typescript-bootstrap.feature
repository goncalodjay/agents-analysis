Feature: TypeScript project bootstrap

  # TypeScript project bootstrap 001: Defines the project manifest
  Scenario Outline: TypeScript project bootstrap 001: Defines the project manifest
    Given the repository has a <manifest> file
    When the manifest is inspected
    Then the type field is <module_type>
    And the bin field defines the command <bin_command> pointing to <cli_entry>
    And the scripts include <test_script> and <acceptance_script>

    Examples:
      | manifest     | module_type | bin_command     | cli_entry | test_script | acceptance_script |
      | package.json | module      | agents-analysis | src/cli.ts | test        | acceptance        |

  # TypeScript project bootstrap 002: Runs TypeScript sources without a compile step
  Scenario Outline: TypeScript project bootstrap 002: Runs TypeScript sources without a compile step
    Given the source file <source_file> exists
    When <node_command> is run on the file
    Then the process exits with code <exit_code>
    And the output contains <message>

    Examples:
      | source_file       | node_command                                 | exit_code | message       |
      | src/smoke-test.ts | node --experimental-strip-types src/smoke-test.ts | 0         | typescript-ok |

  # TypeScript project bootstrap 003: Creates the application directory structure
  Scenario Outline: TypeScript project bootstrap 003: Creates the application directory structure
    Given the bootstrap is applied
    When the application directories are listed
    Then the directory <src_dir> exists
    And the directory <consultation_dir> exists
    And the directory <history_dir> exists
    And the directory <capture_dir> exists
    And the directory <tui_dir> exists

    Examples:
      | src_dir | consultation_dir | history_dir | capture_dir | tui_dir |
      | src     | src/consultation | src/history | src/capture | src/tui |
