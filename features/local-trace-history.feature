Feature: Historial local de trazas

  # Historial local de trazas 001: Conserva consultas entre reinicios
  Scenario Outline: Historial local de trazas 001: Conserva consultas entre reinicios
    Given la base SQLite local configurada en <ruta_base> contiene la consulta finalizada <consulta_id>
    When la aplicación de trazas se reinicia
    Then el historial local contiene la consulta <consulta_id>
    And el detalle conserva el prompt, contexto, respuesta, herramientas y métricas de la consulta <consulta_id>

    Examples:
      | ruta_base                  | consulta_id |
      | datos/trazas.sqlite         | consulta-1  |

  # Historial local de trazas 002: Señala los datos no informados por Pi Agent
  Scenario Outline: Historial local de trazas 002: Señala los datos no informados por Pi Agent
    Given Pi Agent finaliza la consulta <consulta_id> sin informar <campo>
    When se persiste la consulta finalizada
    Then el detalle de la consulta muestra <campo> como no disponible
    And no inventa un valor para <campo>

    Examples:
      | consulta_id | campo           |
      | consulta-6  | thinking_tokens |
      | consulta-7  | contexto_agregado |
      | consulta-8  | herramientas    |
