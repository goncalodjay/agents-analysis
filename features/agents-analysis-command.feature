Feature: Comando de terminal agents-analysis

  # Comando de terminal agents-analysis 001: Inicia la TUI
  Scenario Outline: Comando de terminal agents-analysis 001: Inicia la TUI
    Given el historial local está disponible en <ruta_historial>
    When el usuario ejecuta el comando <comando>
    Then el proceso inicia la TUI de historial
    And la TUI muestra los paneles de consultas y detalle
    And la TUI acepta la tecla <tecla_salida> para finalizar
    When el usuario pulsa la tecla <tecla_salida>
    Then el proceso finaliza con el código <codigo_salida>

    Examples:
      | ruta_historial      | comando         | tecla_salida | codigo_salida |
      | datos/trazas.sqlite | agents-analysis | q            | 0             |

  # Comando de terminal agents-analysis 002: Informa errores de inicio
  Scenario Outline: Comando de terminal agents-analysis 002: Informa errores de inicio
    Given la apertura del historial local falla por <causa>
    When el usuario ejecuta el comando <comando>
    Then el proceso informa el error de inicio
    And el proceso finaliza con el código <codigo_salida>
    And el proceso no presenta una TUI como si hubiera iniciado correctamente

    Examples:
      | causa            | comando         | codigo_salida |
      | ruta inaccesible | agents-analysis | 1             |

  # Comando de terminal agents-analysis 003: Muestra la ayuda
  Scenario Outline: Comando de terminal agents-analysis 003: Muestra la ayuda
    When el usuario ejecuta el comando <comando>
    Then el proceso muestra el uso del comando y sus opciones principales
    And el proceso finaliza con el código <codigo_salida>

    Examples:
      | comando                 | codigo_salida |
      | agents-analysis --help  | 0             |
