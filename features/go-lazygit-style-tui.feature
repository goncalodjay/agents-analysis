Feature: TUI Go estilo LazyGit

  # TUI Go estilo LazyGit 001: Presenta paneles y atajos sin requerir Enter
  Scenario Outline: TUI Go estilo LazyGit 001: Presenta paneles y atajos sin requerir Enter
    Given el historial SQLite contiene las consultas <consultas>
    When el usuario ejecuta <comando>
    Then la TUI Go ocupa la pantalla del terminal
    And la TUI muestra recuadros para el listado, detalle y ayuda de teclas
    And la consulta más reciente queda seleccionada
    When el usuario pulsa <tecla_siguiente> sin pulsar Enter
    Then la TUI selecciona la siguiente consulta
    And el recuadro de detalle muestra la información completa de la consulta seleccionada

    Examples:
      | consultas             | comando         | tecla_siguiente |
      | pi-1, pi-2            | agents-analysis | down            |

  # TUI Go estilo LazyGit 002: Navega entre paneles y contenido extenso
  Scenario Outline: TUI Go estilo LazyGit 002: Navega entre paneles y contenido extenso
    Given la TUI muestra el detalle completo de la consulta <consulta_id>
    When el usuario pulsa <tecla_foco> para cambiar el foco
    Then el foco cambia al panel <panel>
    When el usuario pulsa <tecla_desplazar> para desplazar el contenido
    Then el contenido de <panel> se desplaza sin alterar la consulta seleccionada

    Examples:
      | consulta_id | tecla_foco | panel   | tecla_desplazar |
      | pi-1        | tab        | detalle | down            |

  # TUI Go estilo LazyGit 003: Filtra y restaura el historial mostrado
  Scenario Outline: TUI Go estilo LazyGit 003: Filtra y restaura el historial mostrado
    Given la TUI muestra consultas de los proveedores <proveedores>
    When el usuario introduce el filtro <filtro>
    Then el listado muestra solo las consultas que coinciden con <filtro>
    And el resumen de coste considera solo las consultas mostradas
    When el usuario borra el filtro
    Then el listado muestra nuevamente todas las consultas

    Examples:
      | proveedores       | filtro           |
      | openai, anthropic | proveedor=openai |

  # TUI Go estilo LazyGit 004: Sale y restaura el terminal
  Scenario Outline: TUI Go estilo LazyGit 004: Sale y restaura el terminal
    Given la TUI Go está activa
    When el usuario pulsa <tecla_salida> para salir
    Then la TUI restaura el terminal
    And el proceso finaliza con el código <codigo_salida>

    Examples:
      | tecla_salida | codigo_salida |
      | q            | 0             |

  # TUI Go estilo LazyGit 005: Muestra la ayuda de comandos
  Scenario Outline: TUI Go estilo LazyGit 005: Muestra la ayuda de comandos
    Given la TUI Go está activa
    When el usuario pulsa <tecla_ayuda> para consultar los comandos
    Then la TUI muestra un menú de ayuda sobre <comandos>
    And el historial permanece sin cambios

    Examples:
      | tecla_ayuda | comandos                                           |
      | ?           | navegación, foco, desplazamiento, filtros y salida |
