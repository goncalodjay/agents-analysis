Feature: TypeScript SQLite history store and domain model

  # TypeScript SQLite history store and domain model 001: Stores and retrieves consultations
  Scenario Outline: TypeScript SQLite history store and domain model 001: Stores and retrieves consultations
    Given an empty SQLite history at <history_path>
    When the consultation <consultation> is saved
    And the stored consultations are listed
    Then the history contains <count> consultation
    And the retrieved consultation preserves <fields>

    Examples:
      | history_path     | consultation | count | fields                                            |
      | tmp/history.sqlite | consulta-1   | 1     | id, provider, model, response, usage, toolResults |

  # TypeScript SQLite history store and domain model 002: Updates existing consultations
  Scenario Outline: TypeScript SQLite history store and domain model 002: Updates existing consultations
    Given an SQLite history containing consultation <consultation_id>
    When the same consultation is saved with <field> changed to <new_value>
    Then the history contains <count> consultation
    And the retrieved consultation's <field> is <new_value>

    Examples:
      | consultation_id | field    | new_value | count |
      | pi-1            | response | updated   | 1     |

  # TypeScript SQLite history store and domain model 003: Computes costs and summary
  Scenario Outline: TypeScript SQLite history store and domain model 003: Computes costs and summary
    Given the completed consultations <consultations>
    And the rates <rates>
    When costs are attached to the consultations
    And the history summary is generated
    Then the total token count is <tokens>
    And the total cost is <cost>

    Examples:
      | consultations                                 | rates                                | tokens | cost |
      | completed-consultation-1, completed-consultation-2 | input=2,prompt=1,thinking=3,output=4 | 12     | 35   |

  # TypeScript SQLite history store and domain model 004: Migrates legacy payloads
  Scenario Outline: TypeScript SQLite history store and domain model 004: Migrates legacy payloads
    Given a SQLite database with consultation <consultation_id> in encoded EDN format
    And rates in encoded EDN format
    When the TypeScript history is opened
    Then consultation <consultation_id> appears with provider <provider>
    And the rates preserve output <output>

    Examples:
      | consultation_id | provider | output |
      | pi-1            | openai   | 0.4    |
