Feature: Servicio systemd de captura

  # Servicio systemd de captura 001: Inicia el daemon al iniciar la sesión de WSL
  Scenario Outline: Servicio systemd de captura 001: Inicia el daemon al iniciar la sesión de WSL
    Given systemd de usuario está habilitado en WSL
    And la unidad <unidad> está instalada y habilitada
    When el usuario inicia WSL
    Then systemd inicia el daemon agents-analysis
    And el daemon escucha en <direccion_daemon>

    Examples:
      | unidad                         | direccion_daemon                              |
      | agents-analysis-capture.service | unix://~/.local/share/agents-analysis/daemon.sock |

  # Servicio systemd de captura 002: Reinicia el daemon tras un fallo
  Scenario Outline: Servicio systemd de captura 002: Reinicia el daemon tras un fallo
    Given la unidad <unidad> está activa
    When el proceso del daemon termina con fallo
    Then systemd reinicia el daemon
    And la unidad vuelve al estado <estado>

    Examples:
      | unidad                         | estado |
      | agents-analysis-capture.service | active |

  # Servicio systemd de captura 003: Protege los datos del usuario
  Scenario Outline: Servicio systemd de captura 003: Protege los datos del usuario
    Given la unidad <unidad> crea el directorio de datos <ruta_datos>
    When el daemon prepara su almacenamiento local
    Then solo el usuario propietario puede leer el directorio de datos
    And el socket del daemon solo acepta conexiones del usuario propietario

    Examples:
      | unidad                         | ruta_datos                           |
      | agents-analysis-capture.service | ~/.local/share/agents-analysis       |
