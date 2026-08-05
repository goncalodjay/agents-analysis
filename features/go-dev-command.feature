Feature: Comando de desarrollo ./dev

  # Comando de desarrollo ./dev 001: Valida, recompila, conserva el daemon activo y abre la TUI
  Scenario Outline: Comando de desarrollo ./dev 001: Valida, recompila, conserva el daemon activo y abre la TUI
    Given el repositorio tiene cambios locales pendientes
    And la unidad systemd de usuario <unidad> está <estado_daemon>
    When el usuario ejecuta ./dev
    Then el comando ejecuta la suite de pruebas de Go
    And el comando recompila el binario de Go
    And el comando comprueba si la unidad systemd de usuario está activa
    And si la unidad estaba inactiva, el comando la inicia
    And si la unidad estaba activa, el comando no inicia otra instancia
    And el comando abre la TUI

    Examples:
      | unidad                         | estado_daemon |
      | agents-analysis-capture.service | activa        |
      | agents-analysis-capture.service | inactiva      |

  # Comando de desarrollo ./dev 002: Se detiene si fallan las pruebas o la compilación
  Scenario Outline: Comando de desarrollo ./dev 002: Se detiene si fallan las pruebas o la compilación
    Given la validación de Go falla por <fallo>
    When el usuario ejecuta ./dev
    Then el comando informa el fallo
    And el comando finaliza con un código distinto de cero
    And el comando no comprueba la unidad systemd de usuario
    And el comando no inicia el daemon
    And el comando no abre la TUI

    Examples:
      | fallo                |
      | pruebas              |
      | compilación          |
