Feature: Navegación y filtros de la TUI

  # Navegación y filtros de la TUI 001: Navega entre consultas
  Scenario Outline: Navegación y filtros de la TUI 001: Navega entre consultas
    Given la TUI muestra las consultas <consultas>
    And la consulta <seleccionada> está seleccionada
    When el usuario pulsa la tecla <tecla>
    Then la TUI selecciona la consulta <resultado>

    Examples:
      | consultas             | seleccionada | tecla | resultado  |
      | consulta-1, consulta-2 | consulta-1   | down  | consulta-2 |
      | consulta-1, consulta-2 | consulta-2   | up    | consulta-1 |

  # Navegación y filtros de la TUI 002: Filtra el listado
  Scenario Outline: Navegación y filtros de la TUI 002: Filtra el listado
    Given la TUI contiene consultas de los proveedores <proveedores> y modelos <modelos>
    When el usuario aplica el filtro <filtro>
    Then el listado muestra solo las consultas que coinciden con <filtro>
    And el resumen de costes considera solo las consultas mostradas

    Examples:
      | proveedores       | modelos              | filtro             |
      | openai, anthropic | gpt-5, claude-sonnet | proveedor=openai   |
      | openai, anthropic | gpt-5, claude-sonnet | modelo=gpt-5       |

  # Navegación y filtros de la TUI 003: Sale de la TUI
  Scenario Outline: Navegación y filtros de la TUI 003: Sale de la TUI
    Given el usuario está en la TUI
    When el usuario solicita salir con la tecla <tecla_salida>
    Then la TUI finaliza
    And el proceso devuelve el código <codigo_salida>

    Examples:
      | tecla_salida | codigo_salida |
      | q            | 0             |
