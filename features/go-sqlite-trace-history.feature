Feature: Historial SQLite de agentes

  # Historial SQLite de agentes 001: Persiste una traza completa de Pi
  Scenario Outline: Historial SQLite de agentes 001: Persiste una traza completa de Pi
    Given el historial SQLite está ubicado en <ruta_base>
    And el historial recibe la consulta finalizada <consulta_id> de Pi
    When el historial persiste la consulta
    Then la base contiene una única consulta <consulta_id>
    And el detalle conserva prompts, contexto, respuesta y resultados de herramientas
    And el detalle conserva proveedor, modelo, razonamiento, uso de tokens, duración y resultado

    Examples:
      | ruta_base                                           | consulta_id |
      | ~/.local/share/agents-analysis/history.sqlite       | pi-1        |

  # Historial SQLite de agentes 002: Mantiene la consulta después del reinicio
  Scenario Outline: Historial SQLite de agentes 002: Mantiene la consulta después del reinicio
    Given la base SQLite <ruta_base> contiene la consulta <consulta_id>
    When el daemon se reinicia
    Then el historial SQLite contiene la consulta <consulta_id>

    Examples:
      | ruta_base                                           | consulta_id |
      | ~/.local/share/agents-analysis/history.sqlite       | pi-2        |

  # Historial SQLite de agentes 003: Evita duplicados entregados por reintentos
  Scenario Outline: Historial SQLite de agentes 003: Evita duplicados entregados por reintentos
    Given la base SQLite <ruta_base> contiene la consulta <consulta_id>
    When el daemon recibe nuevamente la consulta <consulta_id>
    Then la base contiene una única consulta <consulta_id>

    Examples:
      | ruta_base                                     | consulta_id |
      | ~/.local/share/agents-analysis/history.sqlite | pi-3        |
