Feature: Captura de consultas de Pi Agent

  # Captura de consultas de Pi Agent 001: Guarda la traza completa de una consulta finalizada
  Scenario Outline: Captura de consultas de Pi Agent 001: Guarda la traza completa de una consulta finalizada
    Given Pi Agent finaliza la consulta <consulta_id>
    And la consulta identifica el proveedor <proveedor>, el modelo <modelo> y el arnés <arnes>
    And la consulta informa los parámetros de inferencia <parametros_inferencia>
    And la consulta informa <input_tokens> tokens de entrada, <prompt_tokens> tokens de prompt, <thinking_tokens> tokens de razonamiento y <output_tokens> tokens de salida
    And la consulta informa inicio <inicio>, fin <fin>, duración <duracion_ms> milisegundos, resultado <resultado> y error <error>
    And la consulta contiene el prompt de sistema <prompt_sistema>, el contexto agregado <contexto_agregado>, el prompt de usuario <prompt_usuario> y la respuesta <respuesta>
    And la consulta contiene las ejecuciones de herramientas <herramientas>
    And la consulta contiene los metadatos del proveedor <metadatos_proveedor>
    When se persiste la consulta finalizada
    Then el historial local contiene una única consulta <consulta_id>
    And la consulta preserva la identidad, configuración, uso de tokens, duración y resultado informados
    And el detalle de la consulta preserva todo el contenido enviado y recibido informado

    Examples:
      | consulta_id | proveedor | modelo        | arnes           | parametros_inferencia       | input_tokens | prompt_tokens | thinking_tokens | output_tokens | inicio               | fin                  | duracion_ms | resultado | error         | prompt_sistema      | contexto_agregado       | prompt_usuario         | respuesta            | herramientas                       | metadatos_proveedor         |
      | consulta-1  | openai    | gpt-5         | pi-agent-0.1.0  | temperature=0.2,max=512    | 120          | 80            | 40              | 160           | 2026-08-03T10:00:00Z | 2026-08-03T10:00:02Z | 2000        | exito     | sin-error     | eres-un-asistente    | repo=agentes-analysis  | resume-el-repositorio | repositorio-resumido | read-file(repo)=>contenido         | cache_read_tokens=30        |
      | consulta-2  | anthropic | claude-sonnet | pi-agent-0.1.0  | temperature=0.7,max=1024   | 220          | 100           | 90              | 260           | 2026-08-03T11:00:00Z | 2026-08-03T11:00:05Z | 5000        | error     | limite-tiempo | responde-en-espanol  | rama=experimento        | explica-el-error      | sin-respuesta        | search-code(error)=>coincidencias  | cache_creation_tokens=60    |

  # Captura de consultas de Pi Agent 002: No muestra consultas sin finalizar
  Scenario Outline: Captura de consultas de Pi Agent 002: No muestra consultas sin finalizar
    Given Pi Agent inicia la consulta <consulta_id>
    And la consulta tiene el estado <estado>
    When se consulta el historial local
    Then el historial no contiene la consulta <consulta_id>

    Examples:
      | consulta_id | estado    |
      | consulta-3  | ejecutando |
      | consulta-4  | interrumpida |

  # Captura de consultas de Pi Agent 003: Evita duplicar la misma consulta finalizada
  Scenario Outline: Captura de consultas de Pi Agent 003: Evita duplicar la misma consulta finalizada
    Given el historial local ya contiene la consulta finalizada <consulta_id>
    When Pi Agent vuelve a informar la finalización de la consulta <consulta_id>
    Then el historial local contiene una única consulta <consulta_id>

    Examples:
      | consulta_id |
      | consulta-5  |
