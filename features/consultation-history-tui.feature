Feature: TUI de historial de consultas

  # TUI de historial de consultas 001: Lista las consultas finalizadas de forma comprensible
  Scenario Outline: TUI de historial de consultas 001: Lista las consultas finalizadas de forma comprensible
    Given el historial local contiene las consultas finalizadas <consultas>
    When el usuario abre la TUI
    Then la lista muestra cada consulta con fecha, proveedor, modelo, prompt resumido, tokens totales y coste
    And la consulta más reciente aparece antes que las anteriores

    Examples:
      | consultas                  |
      | consulta-1, consulta-2      |

  # TUI de historial de consultas 002: Desglosa una consulta seleccionada
  Scenario Outline: TUI de historial de consultas 002: Desglosa una consulta seleccionada
    Given la TUI lista la consulta finalizada <consulta_id>
    When el usuario selecciona la consulta <consulta_id>
    Then el panel de detalle muestra proveedor, modelo, arnés y parámetros de inferencia
    And el panel de detalle muestra tokens de entrada, prompt, razonamiento y salida, métricas específicas del proveedor, duración, resultado y coste
    And el panel de detalle muestra prompt de sistema, contexto agregado, prompt de usuario y respuesta
    And el panel de detalle muestra cada herramienta con su solicitud y resultado

    Examples:
      | consulta_id |
      | consulta-1  |

  # TUI de historial de consultas 003: Filtra para comparar configuraciones registradas
  Scenario Outline: TUI de historial de consultas 003: Filtra para comparar configuraciones registradas
    Given el historial local contiene consultas de los proveedores <proveedores>, modelos <modelos> y arneses <arneses>
    When el usuario filtra la lista por proveedor <proveedor>, modelo <modelo> y arnés <arnes>
    Then la lista muestra solo las consultas que usaron proveedor <proveedor>, modelo <modelo> y arnés <arnes>
    And el resumen de costes considera solo las consultas mostradas

    Examples:
      | proveedores       | modelos              | arneses                      | proveedor | modelo | arnes          |
      | openai, anthropic | gpt-5, claude-sonnet | pi-agent-0.1.0, pi-agent-0.2.0 | openai    | gpt-5 | pi-agent-0.1.0 |
