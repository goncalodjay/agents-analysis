Feature: Extensión global de captura para Pi

  # Extensión global de captura para Pi 001: Registra una consulta finalizada de Pi
  Scenario Outline: Extensión global de captura para Pi 001: Registra una consulta finalizada de Pi
    Given la extensión agents-analysis está instalada en <ruta_extension>
    And Pi ejecuta la consulta <consulta_id> con proveedor <proveedor>, modelo <modelo> y nivel de razonamiento <razonamiento>
    And la consulta contiene prompt de sistema <prompt_sistema>, contexto <contexto>, prompt de usuario <prompt_usuario> y respuesta <respuesta>
    And la consulta informa uso <uso_tokens>, duración <duracion_ms> milisegundos y resultado <resultado>
    And la consulta ejecuta las herramientas <herramientas>
    When Pi alcanza el estado settled de la consulta <consulta_id>
    Then la extensión envía al daemon un evento finalizado para <consulta_id>
    And el evento conserva identidad, contenido, uso, duración, resultado y herramientas

    Examples:
      | ruta_extension                           | consulta_id | proveedor | modelo | razonamiento | prompt_sistema   | contexto                | prompt_usuario       | respuesta             | uso_tokens                              | duracion_ms | resultado | herramientas                       |
      | ~/.pi/agent/extensions/agents-analysis.ts | pi-1        | openai    | gpt-5  | medium       | eres-asistente   | AGENTS.md=reglas        | resume-el-repositorio | repositorio-resumido  | input=120,prompt=80,thinking=40,output=160 | 2000        | exito     | read(file)=>contenido             |

  # Extensión global de captura para Pi 002: No duplica una consulta asentada
  Scenario Outline: Extensión global de captura para Pi 002: No duplica una consulta asentada
    Given la extensión ya envió el evento finalizado de la consulta <consulta_id>
    When Pi vuelve a emitir el estado settled de la consulta <consulta_id>
    Then la extensión no envía una segunda consulta finalizada con identidad <consulta_id>

    Examples:
      | consulta_id |
      | pi-2        |

  # Extensión global de captura para Pi 003: Conserva eventos mientras el daemon no responde
  Scenario Outline: Extensión global de captura para Pi 003: Conserva eventos mientras el daemon no responde
    Given el daemon no acepta conexiones en <direccion_daemon>
    And Pi finaliza la consulta <consulta_id>
    When la extensión intenta enviar su evento finalizado
    Then la extensión conserva el evento pendiente localmente
    And la extensión reintenta enviarlo cuando el daemon vuelve a estar disponible

    Examples:
      | direccion_daemon                              | consulta_id |
      | unix://~/.local/share/agents-analysis/daemon.sock | pi-3        |
