Feature: Daemon Go de captura de agentes

  # Daemon Go de captura de agentes 001: Acepta un evento de Pi
  Scenario Outline: Daemon Go de captura de agentes 001: Acepta un evento de Pi
    Given el daemon escucha en <direccion_daemon>
    And el daemon recibe un evento finalizado del agente <agente> para la consulta <consulta_id>
    When el daemon valida el evento
    Then el daemon confirma la recepción de <consulta_id>
    And el daemon entrega la consulta validada al historial SQLite

    Examples:
      | direccion_daemon                                  | agente | consulta_id |
      | unix://~/.local/share/agents-analysis/daemon.sock | pi     | pi-1        |

  # Daemon Go de captura de agentes 002: Rechaza eventos inválidos sin dañar el historial
  Scenario Outline: Daemon Go de captura de agentes 002: Rechaza eventos inválidos sin dañar el historial
    Given el daemon recibe el evento <evento> para la consulta <consulta_id>
    When el daemon valida el evento
    Then el daemon rechaza el evento con el motivo <motivo>
    And el historial SQLite no contiene una consulta creada por <consulta_id>

    Examples:
      | evento                         | consulta_id | motivo                    |
      | sin identidad                  | sin-id      | identidad obligatoria     |
      | con uso de tokens negativo     | pi-4        | uso de tokens inválido    |

  # Daemon Go de captura de agentes 003: Es extensible a otros agentes
  Scenario Outline: Daemon Go de captura de agentes 003: Es extensible a otros agentes
    Given el daemon recibe un evento finalizado del agente <agente> para la consulta <consulta_id>
    When el evento cumple el contrato de captura
    Then el historial SQLite conserva <agente> como origen de <consulta_id>

    Examples:
      | agente | consulta_id |
      | pi     | pi-5        |
