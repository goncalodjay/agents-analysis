Feature: Listado de consultas en la TUI

  # Listado de consultas en la TUI 001: Presenta los datos resumidos
  Scenario Outline: Listado de consultas en la TUI 001: Presenta los datos resumidos
    Given la TUI contiene las consultas finalizadas <consultas>
    When el usuario observa el panel de consultas
    Then cada fila muestra fecha, proveedor, modelo, tokens totales y coste
    And la consulta más reciente aparece antes que las anteriores
    And la fila seleccionada se distingue visualmente

    Examples:
      | consultas             |
      | consulta-1, consulta-2 |

  # Listado de consultas en la TUI 002: Redimensiona los paneles
  Scenario Outline: Listado de consultas en la TUI 002: Redimensiona los paneles
    Given la TUI muestra el panel de consultas y el panel de detalle
    When el usuario cambia el tamaño del terminal a <columnas> columnas y <filas> filas
    Then la TUI conserva ambos paneles visibles
    And la TUI adapta el contenido al espacio disponible sin desbordarlo

    Examples:
      | columnas | filas |
      | 120      | 40    |
      | 80       | 24    |
