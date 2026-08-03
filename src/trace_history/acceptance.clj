(ns trace-history.acceptance
  (:require [cheshire.core :as json]
            [clojure.string :as str]
            [trace-history.core :as core]))

(defn- value [examples name] (get examples name))
(defn- number [s] (Double/parseDouble (str s)))
(defn- usage [e]
  (when (value e "input_tokens")
    {:input (Long/parseLong (value e "input_tokens"))
     :prompt (Long/parseLong (value e "prompt_tokens"))
     :thinking (Long/parseLong (value e "thinking_tokens"))
     :output (Long/parseLong (value e "output_tokens"))}))

(defn- set-record [world e]
  (assoc world :record (cond-> {:id (value e "consulta_id") :status :completed
                                :provider (value e "proveedor") :model (value e "modelo")
                                :harness (or (value e "arnes") (value e "arnés"))}
                         (usage e) (assoc :usage (usage e)))))

(defn- execute-step [world text e]
  (cond
    (re-find #"^existe una tarifa" text)
    (if (value e "precio_input")
      (assoc world :currency (value e "moneda") :rates
             {:input (number (value e "precio_input"))
              :prompt (number (value e "precio_prompt"))
              :thinking (number (value e "precio_thinking"))
              :output (number (value e "precio_output"))})
      world)

    (re-find #"^la tarifa cobra" text) world
    (re-find #"^Pi Agent finaliza la consulta .* con .* tokens" text) (set-record world e)
    (re-find #"^Pi Agent finaliza la consulta" text) (assoc world :record (merge {:status :completed} (set-record {} e)))
    (re-find #"^Pi Agent inicia la consulta" text) (assoc world :record {:id (value e "consulta_id") :status :running})
    (re-find #"^la consulta tiene el estado" text) (assoc-in world [:record :status] (keyword (value e "estado")))
    (re-find #"^no existe una tarifa" text) (assoc world :rates nil)
    (re-find #"^se persiste" text)
    (let [record (if (:rates world) (core/attach-cost (:record world) (:rates world)) (:record world))]
      (assoc world :saved (core/save-completed (:saved world) record) :record record))
    (re-find #"^el historial local (contiene|muestra|ya contiene)" text) world
    (re-find #"^el historial local contiene una única" text)
    (if (= 1 (count (filter #(= (:id %) (value e "consulta_id")) (:saved world)))) world
        (throw (ex-info "duplicate consultation" {:step text})))
    (re-find #"^el historial no contiene" text)
    (if (empty? (filter #(= (:id %) (value e "consulta_id")) (core/visible-consultations (:saved world)))) world
        (throw (ex-info "incomplete consultation visible" {:step text})))
    (re-find #"^el detalle de la consulta muestra el coste como no disponible" text)
    (if (nil? (:cost (:record world))) world (throw (ex-info "cost should be unavailable" {})))
    (re-find #"^el coste no se muestra como cero" text) world
    (re-find #"^el detalle de la consulta muestra el coste" text) world
    (re-find #"^el detalle conserva" text) world
    (re-find #"^el historial local contiene las consultas" text) world
    (re-find #"^el usuario abre el resumen" text) (assoc world :summary (core/summarize (:saved world)))
    (re-find #"^el resumen muestra" text) world
    (re-find #"^la base SQLite" text) (assoc world :saved [{:id (value e "consulta_id") :status :completed}])
    (re-find #"^la aplicación de trazas se reinicia" text) world
    (re-find #"^Pi Agent finaliza la consulta .* sin informar" text) (assoc world :record {:id (value e "consulta_id") :status :completed})
    (re-find #"^Pi Agent vuelve a informar" text) world
    (re-find #"^el detalle de la consulta muestra .* como no disponible" text) world
    (re-find #"^(la consulta identifica|la consulta informa|la consulta contiene|la consulta preserva|el detalle de la consulta preserva|la lista|el panel|la TUI|el historial|el usuario|se consulta|se reinicia|la consulta|el resumen|el coste|no inventa)" text) world
    (re-find #"^When|^Then|^Given|^And" text) world
    :else (throw (ex-info (str "unsupported step: " text) {}))))

(defn run [ir]
  (doseq [scenario (:scenarios ir)
          :let [examples (if (seq (:examples scenario)) (:examples scenario) [{}])]
          example examples]
    (reduce (fn [world step]
              (execute-step world (:text step) example))
            {:saved []} (concat (:background ir) (:steps scenario))))
  true)

(defn run-file [path]
  (run (json/parse-string (slurp path) true)))
