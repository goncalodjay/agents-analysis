Feature: La TUI Go muestra consultas capturadas de Pi

  # La TUI Go muestra consultas capturadas de Pi 001: Lista consultas finalizadas capturadas
  Scenario Outline: La TUI Go muestra consultas capturadas de Pi 001: Lista consultas finalizadas capturadas
    Given el historial SQLite ~/.local/share/agents-analysis/trazas.sqlite contiene las consultas finalizadas <consultas>
    When el usuario inicia la TUI Go
    Then el listado muestra <consultas>
    And la consulta más reciente queda seleccionada

    Examples:
      | consultas  |
      | pi-1, pi-2 |

  # La TUI Go muestra consultas capturadas de Pi 002: Expone el detalle de una consulta capturada
  Scenario Outline: La TUI Go muestra consultas capturadas de Pi 002: Expone el detalle de una consulta capturada
    Given el historial SQLite ~/.local/share/agents-analysis/trazas.sqlite contiene la consulta finalizada <consulta_id>
    When el usuario selecciona <consulta_id>
    Then el panel de detalle muestra identidad, prompts, respuesta, uso y herramientas de <consulta_id>

    Examples:
      | consulta_id |
      | pi-1        |
