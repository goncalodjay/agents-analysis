Feature: Navegación estable de la TUI Go en paneles divididos

  # Navegación estable de la TUI Go en paneles divididos 001: Cambia la selección con las flechas
  Scenario: Navegación estable de la TUI Go en paneles divididos 001: Cambia la selección con las flechas
    Given la TUI Go muestra las consultas pi-1 y pi-2
    And el foco está en el panel de listado
    When el usuario pulsa down
    Then la consulta seleccionada pasa a pi-2
    And el panel de detalle muestra pi-2

  # Navegación estable de la TUI Go en paneles divididos 002: Mueve el foco y el detalle sin perder la selección
  Scenario: Navegación estable de la TUI Go en paneles divididos 002: Mueve el foco y el detalle sin perder la selección
    Given la TUI Go muestra la consulta pi-1
    And la consulta pi-1 está seleccionada
    When el usuario pulsa tab
    Then el foco cambia al panel detail
    When el usuario pulsa down
    Then la selección sigue en pi-1
    And el panel detail desplaza su contenido

  # Navegación estable de la TUI Go en paneles divididos 003: Abre y cierra la ayuda sin alterar la selección
  Scenario: Navegación estable de la TUI Go en paneles divididos 003: Abre y cierra la ayuda sin alterar la selección
    Given la TUI Go muestra la consulta pi-1
    And la consulta pi-1 está seleccionada
    When el usuario pulsa ?
    Then la TUI muestra el menú de ayuda
    And la selección sigue en pi-1
    When el usuario pulsa ?
    Then la TUI oculta el menú de ayuda
