Feature: Inicio de la TUI de historial

  # Inicio de la TUI de historial 001: Muestra el historial al iniciar
  Scenario Outline: Inicio de la TUI de historial 001: Muestra el historial al iniciar
    Given el historial local contiene <cantidad> consultas finalizadas
    When el usuario inicia la TUI
    Then la TUI muestra el panel de consultas
    And la TUI muestra <estado_inicial>

    Examples:
      | cantidad | estado_inicial                    |
      | 3        | las consultas ordenadas por fecha |
      | 0        | el estado vacío                  |

  # Inicio de la TUI de historial 002: Informa un error de lectura
  Scenario Outline: Inicio de la TUI de historial 002: Informa un error de lectura
    Given el historial local no puede leerse por <causa>
    When el usuario inicia la TUI
    Then la pantalla de inicio informa el error de lectura
    And la TUI no muestra consultas como si la carga hubiera sido correcta
    And el usuario puede salir de la TUI con la tecla <tecla_salida>

    Examples:
      | causa                 | tecla_salida |
      | ruta inaccesible      | q            |
      | datos corruptos       | q            |
