Feature: Renderizado de la TUI de historial

  # Renderizado de la TUI de historial 001: Renderiza los paneles principales
  Scenario Outline: Renderizado de la TUI de historial 001: Renderiza los paneles principales
    Given el modelo de la TUI contiene <cantidad> consultas y la consulta <seleccionada> está seleccionada
    When la TUI renderiza la pantalla
    Then el marco izquierdo contiene el listado de consultas
    And el marco derecho contiene el detalle de la consulta
    And el listado muestra <campos_lista>
    And el detalle muestra <campos_detalle>
    And la consulta seleccionada se distingue visualmente

    Examples:
      | cantidad | seleccionada | campos_lista                              | campos_detalle                              |
      | 2        | consulta-1   | fecha, proveedor, modelo, tokens y coste  | proveedor, modelo, resultado y coste        |

  # Renderizado de la TUI de historial 002: Renderiza el estado vacío
  Scenario: Renderizado de la TUI de historial 002: Renderiza el estado vacío
    Given el modelo de la TUI está vacío
    When la TUI renderiza la pantalla
    Then el marco del listado indica que no hay consultas disponibles
    And el marco del detalle permanece sin contenido
    And la pantalla conserva la indicación para salir

  # Renderizado de la TUI de historial 003: Adapta los paneles al terminal
  Scenario Outline: Renderizado de la TUI de historial 003: Adapta los paneles al terminal
    Given la TUI está configurada con <columnas> columnas y <filas> filas
    When la TUI renderiza la pantalla
    Then los paneles permanecen dentro de los límites del terminal
    And ningún contenido se dibuja fuera de la pantalla

    Examples:
      | columnas | filas |
      | 80       | 24    |
