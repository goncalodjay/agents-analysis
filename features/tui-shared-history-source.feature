Feature: Historial SQLite compartido entre la TUI y el daemon

  # Historial SQLite compartido entre la TUI y el daemon 001: Usa la misma ruta por defecto
  Scenario Outline: Historial SQLite compartido entre la TUI y el daemon 001: Usa la misma ruta por defecto
    When el componente <componente> se inicia sin pasar --history
    Then el componente <componente> usa ~/.local/share/agents-analysis/trazas.sqlite como historial SQLite canónico

    Examples:
      | componente |
      | TUI        |
      | daemon     |

  # Historial SQLite compartido entre la TUI y el daemon 002: Respeta un historial explícito
  Scenario Outline: Historial SQLite compartido entre la TUI y el daemon 002: Respeta un historial explícito
    When el componente <componente> se inicia con --history <ruta_historial>
    Then el componente <componente> usa <ruta_historial> como historial SQLite canónico

    Examples:
      | componente | ruta_historial                 |
      | TUI        | /tmp/agents-analysis.sqlite     |
      | daemon     | /tmp/agents-analysis.sqlite     |