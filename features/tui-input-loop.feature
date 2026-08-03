Feature: Interacción de la TUI de historial

  # Interacción de la TUI de historial 001: Procesa la navegación
  Scenario Outline: Interacción de la TUI de historial 001: Procesa la navegación
    Given la TUI muestra las consultas <consultas> y tiene seleccionada <seleccionada>
    When el usuario pulsa la tecla de navegación <tecla>
    Then la TUI deja seleccionada <resultado>
    And la TUI actualiza el panel de detalle para <resultado>

    Examples:
      | consultas               | seleccionada | tecla | resultado  |
      | consulta-1, consulta-2 | consulta-1   | down  | consulta-2 |
      | consulta-1, consulta-2 | consulta-2   | up    | consulta-1 |

  # Interacción de la TUI de historial 002: Abre y cierra el detalle
  Scenario Outline: Interacción de la TUI de historial 002: Abre y cierra el detalle
    Given la TUI tiene seleccionada la consulta <consulta_id>
    When el usuario pulsa la tecla de apertura <tecla_abrir>
    Then la TUI muestra el detalle completo de <consulta_id>
    When el usuario pulsa la tecla de cierre <tecla_cerrar>
    Then la TUI vuelve al listado con <consulta_id> seleccionada

    Examples:
      | consulta_id | tecla_abrir | tecla_cerrar |
      | consulta-1  | enter       | esc          |

  # Interacción de la TUI de historial 003: Finaliza el proceso
  Scenario Outline: Interacción de la TUI de historial 003: Finaliza el proceso
    Given la TUI está ejecutándose
    When el usuario solicita salir con la tecla <tecla_salida>
    Then la TUI deja de leer entradas
    And la TUI finaliza con el código <codigo_salida>

    Examples:
      | tecla_salida | codigo_salida |
      | q            | 0             |
