Feature: Migración unificada del producto a Go

  # Migración unificada del producto a Go 001: Conserva el comportamiento aceptado
  Scenario Outline: Migración unificada del producto a Go 001: Conserva el comportamiento aceptado
    Given la versión anterior satisface las features aceptadas en <directorio_features>
    When el producto migrado se construye y prueba con <comando_pruebas>
    Then todas las features aceptadas continúan satisfechas
    And el ejecutable <comando_producto> inicia sin un runtime de Clojure o Babashka

    Examples:
      | directorio_features | comando_pruebas | comando_producto |
      | features            | go test ./...   | agents-analysis  |

  # Migración unificada del producto a Go 002: Migra el historial SQLite existente
  Scenario Outline: Migración unificada del producto a Go 002: Migra el historial SQLite existente
    Given la versión anterior creó la base SQLite <ruta_base> con la consulta <consulta_id> y sus tarifas
    When la versión Go abre la base por primera vez
    Then el historial conserva todos los datos de <consulta_id> y sus tarifas
    And la base queda almacenada en el formato canónico de la versión Go
    When la versión Go vuelve a abrir la base
    Then el historial conserva una única consulta <consulta_id>

    Examples:
      | ruta_base                                     | consulta_id |
      | ~/.local/share/agents-analysis/history.sqlite | pi-1        |

  # Migración unificada del producto a Go 003: Elimina Clojure del código mantenido
  Scenario Outline: Migración unificada del producto a Go 003: Elimina Clojure del código mantenido
    Given la migración del repositorio está terminada
    When se inspeccionan los archivos versionados fuera de <configuracion_local>
    Then no existen fuentes, manifiestos, scripts ni dependencias de Clojure o Babashka
    And el producto, sus pruebas y el soporte de aceptación están implementados en Go
    And solo los scripts auxiliares pueden estar implementados en <lenguajes_scripts>

    Examples:
      | configuracion_local | lenguajes_scripts |
      | swarmforge          | Python o Shell    |

  # Migración unificada del producto a Go 004: Ejecuta el producto sin adaptadores externos
  Scenario Outline: Migración unificada del producto a Go 004: Ejecuta el producto sin adaptadores externos
    Given el ejecutable Go <comando_producto> y una base SQLite compatible están instalados
    When el usuario inicia el producto
    Then el producto accede a SQLite dentro del proceso Go
    And el producto no invoca Clojure, Babashka ni <lenguaje_script> durante su ejecución

    Examples:
      | comando_producto | lenguaje_script |
      | agents-analysis  | Python          |
