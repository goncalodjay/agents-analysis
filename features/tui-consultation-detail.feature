Feature: Detalle de consultas en la TUI

  # Detalle de consultas en la TUI 001: Abre el detalle de una consulta
  Scenario Outline: Detalle de consultas en la TUI 001: Abre el detalle de una consulta
    Given la TUI tiene seleccionada la consulta <consulta_id>
    When el usuario pulsa la tecla <tecla>
    Then el panel de detalle muestra la identidad y configuración de la consulta
    And el panel de detalle muestra tokens, duración, resultado y coste
    And el panel de detalle muestra prompts, contexto, respuesta y herramientas

    Examples:
      | consulta_id | tecla_abrir |
      | consulta-1  | enter       |

  # Detalle de consultas en la TUI 002: Regresa al listado
  Scenario Outline: Detalle de consultas en la TUI 002: Regresa al listado
    Given el usuario está dentro del panel de detalle de la consulta <consulta_id>
    When el usuario pulsa la tecla <tecla>
    Then la TUI muestra nuevamente el panel de consultas
    And la consulta <consulta_id> permanece seleccionada

    Examples:
      | consulta_id | tecla_volver |
      | consulta-1  | esc          |
