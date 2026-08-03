Feature: Costes de consultas finalizadas

  # Costes de consultas finalizadas 001: Calcula y conserva el coste con las tarifas configuradas
  Scenario Outline: Costes de consultas finalizadas 001: Calcula y conserva el coste con las tarifas configuradas
    Given existe una tarifa en <moneda> para el proveedor <proveedor> y el modelo <modelo>
    And la tarifa cobra <precio_input> por token de entrada, <precio_prompt> por token de prompt, <precio_thinking> por token de razonamiento y <precio_output> por token de salida
    And Pi Agent finaliza la consulta <consulta_id> con <input_tokens> tokens de entrada, <prompt_tokens> tokens de prompt, <thinking_tokens> tokens de razonamiento y <output_tokens> tokens de salida
    When se persiste la consulta finalizada
    Then el detalle de la consulta muestra el coste <coste> en <moneda>
    And el detalle conserva el desglose de tarifas usado para la consulta <consulta_id>

    Examples:
      | moneda | proveedor | modelo | precio_input | precio_prompt | precio_thinking | precio_output | consulta_id | input_tokens | prompt_tokens | thinking_tokens | output_tokens | coste |
      | USD    | openai    | gpt-5 | 0.000002     | 0.000001      | 0.000003       | 0.000004      | consulta-9  | 100          | 20            | 10              | 50            | 0.00046 |
      | USD    | openai    | gpt-5 | 0.000002     | 0.000001      | 0.000003       | 0.000004      | consulta-10 | 200          | 40            | 20              | 100           | 0.00092 |

  # Costes de consultas finalizadas 002: No estima el coste sin una tarifa aplicable
  Scenario Outline: Costes de consultas finalizadas 002: No estima el coste sin una tarifa aplicable
    Given Pi Agent finaliza la consulta <consulta_id> con el proveedor <proveedor> y el modelo <modelo>
    And no existe una tarifa aplicable para el proveedor <proveedor> y el modelo <modelo>
    When se persiste la consulta finalizada
    Then el detalle de la consulta muestra el coste como no disponible
    And el coste no se muestra como cero

    Examples:
      | consulta_id | proveedor | modelo          |
      | consulta-11 | local     | modelo-privado  |

  # Costes de consultas finalizadas 003: Resume gasto y tokens de las consultas mostradas
  Scenario Outline: Costes de consultas finalizadas 003: Resume gasto y tokens de las consultas mostradas
    Given el historial local muestra las consultas <consultas>
    When el usuario abre el resumen de costes
    Then el resumen muestra <tokens_totales> tokens totales
    And el resumen muestra <coste_total> en <moneda> para las consultas con coste disponible

    Examples:
      | consultas                  | tokens_totales | coste_total | moneda |
      | consulta-9, consulta-10     | 540            | 0.00138     | USD    |
